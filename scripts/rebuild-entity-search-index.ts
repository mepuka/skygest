import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Console, Effect, FileSystem, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { dirname, resolve } from "node:path";
import { loadProjectedEntitySearchDocsFromDataLayer } from "../src/search/projectFromDataLayer";
import { summarizeEntitySearchDocuments } from "../src/search/sqlText";
import { runScriptMain, scriptPlatformLayer } from "../src/platform/ScriptRuntime";
import { runEntitySearchMigrations } from "../src/search/migrate";
import { entitySearchSqlLayer } from "../src/search/Layer";
import { EntitySearchRepo } from "../src/services/EntitySearchRepo";
import { DataLayerReposD1 } from "../src/services/d1/DataLayerReposD1";
import { EntitySearchRepoD1 } from "../src/services/d1/EntitySearchRepoD1";
import {
  freshSnapshotFlag,
  resolveEntitySearchSourceSqliteLayer,
  sourceDbFlag,
  sourceDbNameFlag,
  toAbsolutePath
} from "./support/entity-search";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_TARGET_DB_FILE = resolve(ROOT, ".data", "entity-search.sqlite");

const dbFileFlag = Flag.string("db-file").pipe(
  Flag.withDescription("Local sqlite file for the derived entity search index"),
  Flag.withDefault(DEFAULT_TARGET_DB_FILE)
);

const rebuildEntitySearchIndexCommand = Command.make(
  "rebuild-entity-search-index",
  {
    dbFile: dbFileFlag,
    sourceDb: sourceDbFlag,
    sourceDbName: sourceDbNameFlag,
    fresh: freshSnapshotFlag
  },
  ({ dbFile, sourceDb, sourceDbName, fresh }) =>
    Effect.gen(function* () {
      const targetDbFile = toAbsolutePath(ROOT, dbFile);
      const fs = yield* FileSystem.FileSystem;

      yield* fs.makeDirectory(dirname(targetDbFile), { recursive: true });

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

      const targetSqliteLayer = SqliteClient.layer({ filename: targetDbFile });
      const searchSqlLayer = entitySearchSqlLayer(targetSqliteLayer);
      const targetLayer = Layer.mergeAll(
        targetSqliteLayer,
        searchSqlLayer,
        EntitySearchRepoD1.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(targetSqliteLayer, searchSqlLayer))
        )
      );

      yield* runEntitySearchMigrations.pipe(Effect.provide(targetSqliteLayer));
      yield* Effect.gen(function* () {
        const repo = yield* EntitySearchRepo;
        yield* repo.replaceAllDocuments(documents);
        yield* repo.optimizeFts();
      }).pipe(Effect.provide(targetLayer));

      yield* Console.log(
        `Rebuilt ${String(documents.length)} entity-search documents into ${targetDbFile}`
      );
      yield* Console.log(`Source: ${source.sourceLabel}`);
      yield* Console.log(summarizeEntitySearchDocuments(documents));
    })
);

const cli = Command.runWith(rebuildEntitySearchIndexCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "RebuildEntitySearchIndex",
    Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
