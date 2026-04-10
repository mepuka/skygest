import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect, FileSystem, Layer, Runtime } from "effect";
import * as fs from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { buildStage1EvalSnapshot } from "../src/eval/Stage1EvalSnapshotBuilder";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { PostEnrichmentReadService } from "../src/services/PostEnrichmentReadService";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { PostEnrichmentReadRepoD1 } from "../src/services/d1/PostEnrichmentReadRepoD1";
import { stringifyUnknown } from "../src/platform/Json";

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

const parseArg = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const toAbsolutePath = (value: string) =>
  isAbsolute(value) ? value : resolve(ROOT, value);

const manifestPath = toAbsolutePath(
  parseArg("--manifest") ?? DEFAULT_MANIFEST_PATH
);
const outputPath = toAbsolutePath(parseArg("--out") ?? DEFAULT_OUT_PATH);
const sqlitePathValue =
  parseArg("--db") ?? process.env.STAGE1_EVAL_SQLITE_PATH;
const sqlitePath =
  sqlitePathValue === undefined ? undefined : toAbsolutePath(sqlitePathValue);

const fileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  {
    readFileString: (path: string) =>
      Effect.tryPromise({
        try: () => fs.readFile(path, "utf-8"),
        catch: (error) => error
      }),
    writeFileString: (path: string, content: string) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(dirname(path), { recursive: true });
          await fs.writeFile(path, content, "utf-8");
        },
        catch: (error) => error
      })
  } as unknown as FileSystem.FileSystem
);

const makeLiveLayer = (dbPath: string) => {
  const sqliteLayer = SqliteClient.layer({ filename: dbPath });
  const knowledgeRepoLayer = KnowledgeRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const candidatePayloadRepoLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const candidatePayloadServiceLayer = CandidatePayloadService.layer.pipe(
    Layer.provideMerge(candidatePayloadRepoLayer)
  );
  const postEnrichmentReadRepoLayer = PostEnrichmentReadRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const postEnrichmentReadServiceLayer = PostEnrichmentReadService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(candidatePayloadServiceLayer, postEnrichmentReadRepoLayer)
    )
  );

  return Layer.mergeAll(
    fileSystemLayer,
    sqliteLayer,
    knowledgeRepoLayer,
    candidatePayloadRepoLayer,
    candidatePayloadServiceLayer,
    postEnrichmentReadRepoLayer,
    postEnrichmentReadServiceLayer
  );
};

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

const program = sqlitePath === undefined
  ? Effect.die(
      new Error(
        "Missing sqlite database path. Pass --db /path/to/file.sqlite or set STAGE1_EVAL_SQLITE_PATH."
      )
    )
  : buildStage1EvalSnapshot({
      manifestPath,
      outputPath
    }).pipe(
      Effect.tap(({ rowCount }) =>
        Effect.log(
          `Wrote ${String(rowCount)} Stage 1 snapshot rows to ${outputPath} using ${manifestPath}`
        )
      ),
      Effect.provide(makeLiveLayer(sqlitePath))
    );

program.pipe(
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  runMain
);
