/**
 * build-stage1-eval-snapshot — rebuild the Stage 1 resolver eval snapshot.
 *
 * Reads the gold-set manifest, pulls `postContext` / `vision` /
 * `sourceAttribution` for each entry from a D1-shaped sqlite store, and
 * writes a `snapshot.jsonl` + `snapshot.build-report.json` under
 * `eval/resolution-stage1/`.
 *
 * Storage source resolution order:
 *   1. Explicit `--db <path>` flag.
 *   2. `STAGE1_EVAL_SQLITE_PATH` env var.
 *   3. Fallback to `d1SnapshotLayer` — runs `wrangler d1 export <name>`
 *      + `sqlite3 .read` and caches the resulting sqlite file under
 *      `.cache/d1/<name>.sqlite`. Cache TTL via `D1_SNAPSHOT_MAX_AGE_HOURS`
 *      (default 24h). Database name via `--snapshot-db-name`
 *      (default `skygest-staging`).
 */
import { SqliteClient } from "@effect/sql-sqlite-bun";
import {
  Config,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option
} from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { dirname, isAbsolute, resolve } from "node:path";
import { buildStage1EvalSnapshot } from "../src/eval/Stage1EvalSnapshotBuilder";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { PostEnrichmentReadService } from "../src/services/PostEnrichmentReadService";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { PostEnrichmentReadRepoD1 } from "../src/services/d1/PostEnrichmentReadRepoD1";
import { D1SnapshotKeys } from "../src/platform/ConfigShapes";
import { d1SnapshotLayer } from "../src/platform/D1SnapshotLayer";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_MANIFEST_PATH = resolve(
  ROOT,
  "references",
  "cold-start",
  "survey",
  "gold-set-resolver.json"
);
const DEFAULT_OUT_PATH = resolve(
  ROOT,
  "eval",
  "resolution-stage1",
  "snapshot.jsonl"
);
const DEFAULT_SNAPSHOT_DB_NAME = "skygest-staging";

/**
 * Tables the Stage 1 eval snapshot actually reads. Listed explicitly so the
 * `wrangler d1 export` call skips the `posts_fts` FTS5 virtual table (wrangler
 * refuses to export databases containing virtual tables). Adjust if the
 * KnowledgeRepo / CandidatePayloadRepo / PostEnrichmentReadRepo query set
 * grows to touch additional tables.
 */
const STAGE1_D1_TABLES: ReadonlyArray<string> = [
  "posts",
  "experts",
  "post_topics",
  "links",
  "post_enrichments",
  "post_payloads",
  "post_enrichment_runs",
  "candidates"
];

const STAGE1_D1_TABLE_ARGS: ReadonlyArray<string> = STAGE1_D1_TABLES.flatMap(
  (name) => ["--table", name]
);

const toAbsolutePath = (value: string) =>
  isAbsolute(value) ? value : resolve(ROOT, value);

const defaultReportPath = (outputPath: string) =>
  outputPath.endsWith(".jsonl")
    ? outputPath.replace(/\.jsonl$/u, ".build-report.json")
    : `${outputPath}.build-report.json`;

const repoLayers = (
  sqlClientLayer: Layer.Layer<
    SqliteClient.SqliteClient,
    never,
    FileSystem.FileSystem | never
  >
) => {
  const knowledgeRepoLayer = KnowledgeRepoD1.layer.pipe(
    Layer.provideMerge(sqlClientLayer)
  );
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqlClientLayer)
  );
  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );
  const postEnrichmentReadRepoLayer = PostEnrichmentReadRepoD1.layer.pipe(
    Layer.provideMerge(sqlClientLayer)
  );
  const postEnrichmentReadServiceLayer = PostEnrichmentReadService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(candidatePayloadServiceLayer, postEnrichmentReadRepoLayer)
    )
  );

  return Layer.mergeAll(
    sqlClientLayer,
    knowledgeRepoLayer,
    candidatePayloadRepoLayer,
    candidatePayloadServiceLayer,
    postEnrichmentReadRepoLayer,
    postEnrichmentReadServiceLayer
  );
};

const ensureParentDirectory = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(dirname(filePath), { recursive: true });
  });

const manifestOption = Flag.string("manifest").pipe(
  Flag.withDescription(
    "Path to references/cold-start/survey/gold-set-resolver.json"
  ),
  Flag.withDefault(DEFAULT_MANIFEST_PATH)
);

const outOption = Flag.string("out").pipe(
  Flag.withDescription("Path to the output snapshot jsonl"),
  Flag.withDefault(DEFAULT_OUT_PATH)
);

const reportOutOption = Flag.string("report-out").pipe(
  Flag.withDescription("Optional path for the diagnostic build report"),
  Flag.optional
);

const dbOption = Flag.string("db").pipe(
  Flag.withDescription(
    "Explicit sqlite path. When absent, falls back to $STAGE1_EVAL_SQLITE_PATH, then to the D1 snapshot cache."
  ),
  Flag.optional
);

const snapshotDbNameOption = Flag.string("snapshot-db-name").pipe(
  Flag.withDescription(
    `Wrangler D1 database name to snapshot when --db is absent (default: ${DEFAULT_SNAPSHOT_DB_NAME})`
  ),
  Flag.withDefault(DEFAULT_SNAPSHOT_DB_NAME)
);

const buildStage1EvalSnapshotCommand = Command.make(
  "build-stage1-eval-snapshot",
  {
    db: dbOption,
    snapshotDbName: snapshotDbNameOption,
    manifest: manifestOption,
    out: outOption,
    reportOut: reportOutOption
  },
  ({ db, snapshotDbName, manifest, out, reportOut }) =>
    Effect.gen(function* () {
      const manifestPath = toAbsolutePath(manifest);
      const outputPath = toAbsolutePath(out);
      const reportPath = toAbsolutePath(
        Option.getOrElse(reportOut, () => defaultReportPath(outputPath))
      );

      yield* ensureParentDirectory(outputPath);
      yield* ensureParentDirectory(reportPath);

      // Resolve the SqlClient source. Priority: --db > $STAGE1_EVAL_SQLITE_PATH
      // > d1SnapshotLayer fallback.
      const explicitDbPath = Option.orElse(db, () =>
        Option.fromUndefinedOr(process.env.STAGE1_EVAL_SQLITE_PATH)
      );

      const sqlClientLayer = yield* Option.match(explicitDbPath, {
        onSome: (path) => {
          const absolute = toAbsolutePath(path);
          return Effect.as(
            Effect.logInfo("stage1.snapshot.source.explicit").pipe(
              Effect.annotateLogs({ path: absolute })
            ),
            SqliteClient.layer({ filename: absolute, readonly: true })
          );
        },
        onNone: () =>
          Effect.gen(function* () {
            const snapshotConfig = yield* Config.all(D1SnapshotKeys);
            yield* Effect.logInfo("stage1.snapshot.source.d1-cache").pipe(
              Effect.annotateLogs({
                dbName: snapshotDbName,
                cacheDir: snapshotConfig.cacheDir,
                maxAgeHours: snapshotConfig.maxAgeHours
              })
            );
            return d1SnapshotLayer({
              dbName: snapshotDbName,
              cacheDir: toAbsolutePath(snapshotConfig.cacheDir),
              maxAge: Duration.hours(snapshotConfig.maxAgeHours),
              extraArgs: STAGE1_D1_TABLE_ARGS
            });
          })
      });

      const result = yield* buildStage1EvalSnapshot({
        manifestPath,
        outputPath,
        reportPath
      }).pipe(Effect.provide(repoLayers(sqlClientLayer)));

      yield* Effect.logInfo("stage1.snapshot.wrote").pipe(
        Effect.annotateLogs({
          rowCount: result.rowCount,
          outputPath,
          reportPath,
          diagnosticCount: result.diagnosticCount
        })
      );
    })
);

const cli = Command.runWith(buildStage1EvalSnapshotCommand, {
  version: "0.1.0"
});

if (import.meta.main) {
  runScriptMain(
    "BuildStage1EvalSnapshot",
    Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
      Effect.provide(scriptPlatformLayer)
    )
  );
}
