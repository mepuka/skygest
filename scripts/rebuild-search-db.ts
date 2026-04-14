import { Console, Effect, Layer } from "effect";
import { Command } from "effect/unstable/cli";
import { resolve } from "node:path";
import { SearchDbScriptError } from "../src/domain/errors";
import { loadProjectedEntitySearchDocsFromDataLayer } from "../src/search/projectFromDataLayer";
import { buildEntitySearchRebuildSqlChunks } from "../src/search/rebuildPlan";
import { summarizeEntitySearchDocuments } from "../src/search/sqlText";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";
import {
  executeWranglerD1CommandJson,
  executeWranglerD1TempSqlFile
} from "../src/platform/WranglerD1";
import { DataLayerReposD1 } from "../src/services/d1/DataLayerReposD1";
import {
  freshSnapshotFlag,
  resolveEntitySearchSourceSqliteLayer,
  resolveSearchDbName,
  searchDbNameFlag,
  SearchDbScriptConfig,
  sourceDbFlag,
  sourceDbNameFlag,
  verifyFlag
} from "./support/entity-search";

const ROOT = resolve(import.meta.dirname, "..");

const asNumber = (value: unknown) =>
  typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : NaN;

const assertSearchDbSchemaReady = (databaseName: string) =>
  executeWranglerD1CommandJson({
    databaseName,
    sql: `SELECT name
          FROM sqlite_master
          WHERE name IN (
            '_migrations',
            'entity_search_docs',
            'entity_search_doc_urls',
            'entity_search_fts'
          )
          ORDER BY name ASC`
  }).pipe(
    Effect.flatMap((results) => {
      const names = new Set(
        (results[0]?.results ?? []).flatMap((row) =>
          typeof row.name === "string" ? [row.name] : []
        )
      );
      const missing = [
        "_migrations",
        "entity_search_docs",
        "entity_search_doc_urls",
        "entity_search_fts"
      ].filter((name) => !names.has(name));

      return missing.length === 0
        ? Effect.void
        : Effect.fail(
            new SearchDbScriptError({
              operation: "rebuildSearchDb.preflight",
              message: `SEARCH_DB schema is incomplete for ${databaseName}. Run migrate-search-db first. Missing: ${missing.join(", ")}`
            })
          );
    })
  );

const rebuildSearchDbCommand = Command.make(
  "rebuild-search-db",
  {
    searchDbName: searchDbNameFlag,
    sourceDb: sourceDbFlag,
    sourceDbName: sourceDbNameFlag,
    fresh: freshSnapshotFlag,
    verify: verifyFlag
  },
  ({ searchDbName, sourceDb, sourceDbName, fresh, verify }) =>
    Effect.gen(function* () {
      const configured = yield* SearchDbScriptConfig;
      const databaseName = resolveSearchDbName(configured, searchDbName);
      const source = yield* resolveEntitySearchSourceSqliteLayer(ROOT, {
        sourceDb,
        sourceDbName,
        fresh
      });
      const sourceRepoLayer = Layer.mergeAll(
        source.layer,
        DataLayerReposD1.layer.pipe(Layer.provideMerge(source.layer))
      );
      const documents = yield* loadProjectedEntitySearchDocsFromDataLayer().pipe(
        Effect.provide(sourceRepoLayer)
      );
      const chunks = buildEntitySearchRebuildSqlChunks(documents);

      yield* Console.log(
        `Projecting ${String(documents.length)} entity-search documents from ${source.sourceLabel}`
      );
      yield* Console.log(summarizeEntitySearchDocuments(documents));

      yield* assertSearchDbSchemaReady(databaseName);

      yield* Effect.forEach(
        chunks,
        (chunk) =>
          Console.log(`Executing ${chunk.label}`).pipe(
            Effect.andThen(
              executeWranglerD1TempSqlFile({
                databaseName,
                sql: chunk.sql,
                label: chunk.label
              })
            )
          ),
        { concurrency: 1, discard: true }
      );

      if (!verify) {
        yield* Console.log(`Rebuilt ${databaseName} without verification`);
        return;
      }

      const verification = yield* executeWranglerD1CommandJson({
        databaseName,
        sql: `SELECT entity_type, COUNT(*) as count
              FROM entity_search_docs
              WHERE deleted_at IS NULL
              GROUP BY entity_type
              ORDER BY entity_type ASC;
              SELECT COUNT(*) as count
              FROM entity_search_docs
              WHERE deleted_at IS NULL;
              SELECT COUNT(*) as count
              FROM entity_search_doc_urls;
              SELECT COUNT(*) as count
              FROM entity_search_fts`
      });

      const totalDocs = asNumber(verification[1]?.results[0]?.count);

      if (totalDocs !== documents.length) {
        return yield* new SearchDbScriptError({
          operation: "rebuildSearchDb.verify",
          message: `Verification failed for ${databaseName}: expected ${String(documents.length)} docs, found ${String(totalDocs)}`
        });
      }

      yield* Console.log(
        `Verified ${String(totalDocs)} docs in ${databaseName}`
      );

      for (const row of verification[0]?.results ?? []) {
        yield* Console.log(`${String(row.entity_type)}: ${String(row.count)}`);
      }

      yield* Console.log(
        `Exact URLs: ${String(verification[2]?.results[0]?.count ?? 0)}`
      );
      yield* Console.log(
        `FTS rows: ${String(verification[3]?.results[0]?.count ?? 0)}`
      );
    })
);

const cli = Command.runWith(rebuildSearchDbCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "RebuildSearchDb",
    Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
