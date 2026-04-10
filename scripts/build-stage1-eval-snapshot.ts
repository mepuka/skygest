import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Command, Flag } from "effect/unstable/cli";
import { Effect, FileSystem, Layer, Runtime, Schema } from "effect";
import * as fs from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { buildStage1EvalSnapshot } from "../src/eval/Stage1EvalSnapshotBuilder";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { PostEnrichmentReadService } from "../src/services/PostEnrichmentReadService";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import { KnowledgeRepoD1 } from "../src/services/d1/KnowledgeRepoD1";
import { PostEnrichmentReadRepoD1 } from "../src/services/d1/PostEnrichmentReadRepoD1";
import { stringifyUnknown } from "../src/platform/Json";

class LocalSnapshotFileSystemError extends Schema.TaggedErrorClass<LocalSnapshotFileSystemError>()(
  "LocalSnapshotFileSystemError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

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

const toAbsolutePath = (value: string) =>
  isAbsolute(value) ? value : resolve(ROOT, value);

const defaultReportPath = (outputPath: string) =>
  outputPath.endsWith(".jsonl")
    ? outputPath.replace(/\.jsonl$/u, ".build-report.json")
    : `${outputPath}.build-report.json`;

const unsupportedFileSystemMethod = (method: string) =>
  (path: string, ..._args: Array<any>): any =>
    Effect.fail(
      new LocalSnapshotFileSystemError({
        operation: method,
        path,
        message: `FileSystem.${method} is not implemented in build-stage1-eval-snapshot`
      })
    );

const toFileSystemError = (
  operation: string,
  path: string,
  error: unknown
) =>
  new LocalSnapshotFileSystemError({
    operation,
    path,
    message: stringifyUnknown(error)
  });

const fileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  FileSystem.make({
    access: (path) =>
      Effect.tryPromise({
        try: async () => {
          await fs.access(path);
        },
        catch: (error) => toFileSystemError("access", path, error)
      }),
    copy: unsupportedFileSystemMethod("copy"),
    copyFile: unsupportedFileSystemMethod("copyFile"),
    chmod: unsupportedFileSystemMethod("chmod"),
    chown: unsupportedFileSystemMethod("chown"),
    link: unsupportedFileSystemMethod("link"),
    makeDirectory: (path, options) =>
      Effect.tryPromise({
        try: async () => {
          await fs.mkdir(path, {
            recursive: Boolean(options?.recursive),
            mode: options?.mode
          });
        },
        catch: (error) => toFileSystemError("makeDirectory", path, error)
      }),
    makeTempDirectory: unsupportedFileSystemMethod("makeTempDirectory"),
    makeTempDirectoryScoped: unsupportedFileSystemMethod(
      "makeTempDirectoryScoped"
    ),
    makeTempFile: unsupportedFileSystemMethod("makeTempFile"),
    makeTempFileScoped: unsupportedFileSystemMethod("makeTempFileScoped"),
    open: unsupportedFileSystemMethod("open"),
    readDirectory: (path) =>
      Effect.tryPromise({
        try: () => fs.readdir(path),
        catch: (error) => toFileSystemError("readDirectory", path, error)
      }),
    readFile: (path) =>
      Effect.tryPromise({
        try: async () => new Uint8Array(await fs.readFile(path)),
        catch: (error) => toFileSystemError("readFile", path, error)
      }),
    readLink: unsupportedFileSystemMethod("readLink"),
    realPath: (path) =>
      Effect.tryPromise({
        try: () => fs.realpath(path),
        catch: (error) => toFileSystemError("realPath", path, error)
      }),
    remove: (path, options) =>
      Effect.tryPromise({
        try: async () => {
          await fs.rm(path, {
            recursive: Boolean(options?.recursive),
            force: Boolean(options?.force)
          });
        },
        catch: (error) => toFileSystemError("remove", path, error)
      }),
    rename: (oldPath, newPath) =>
      Effect.tryPromise({
        try: () => fs.rename(oldPath, newPath),
        catch: (error) =>
          toFileSystemError("rename", `${oldPath} -> ${newPath}`, error)
      }),
    stat: unsupportedFileSystemMethod("stat"),
    symlink: unsupportedFileSystemMethod("symlink"),
    truncate: (path, length) =>
      Effect.tryPromise({
        try: () => fs.truncate(path, Number(length ?? 0)),
        catch: (error) => toFileSystemError("truncate", path, error)
      }),
    utimes: unsupportedFileSystemMethod("utimes"),
    watch: unsupportedFileSystemMethod("watch"),
    writeFile: (path, data) =>
      Effect.tryPromise({
        try: () => fs.writeFile(path, data),
        catch: (error) => toFileSystemError("writeFile", path, error)
      })
  })
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

const ensureParentDirectory = (filePath: string) =>
  Effect.tryPromise({
    try: () => fs.mkdir(dirname(filePath), { recursive: true }),
    catch: (error) =>
      new LocalSnapshotFileSystemError({
        operation: "mkdir",
        path: dirname(filePath),
        message: stringifyUnknown(error)
      })
  });

const manifestOption = Flag.string("manifest").pipe(
  Flag.withDescription("Path to references/cold-start/survey/gold-set-resolver.json"),
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

const dbOption = (() => {
  const option = Flag.string("db").pipe(
    Flag.withDescription(
      "Path to the sqlite database. Falls back to STAGE1_EVAL_SQLITE_PATH if set."
    )
  );
  const envValue = process.env.STAGE1_EVAL_SQLITE_PATH;
  return envValue === undefined ? option : option.pipe(Flag.withDefault(envValue));
})();

const buildStage1EvalSnapshotCommand = Command.make(
  "build-stage1-eval-snapshot",
  {
    db: dbOption,
    manifest: manifestOption,
    out: outOption,
    reportOut: reportOutOption
  },
  ({ db, manifest, out, reportOut }) =>
    Effect.gen(function* () {
      const sqlitePath = toAbsolutePath(db);
      const manifestPath = toAbsolutePath(manifest);
      const outputPath = toAbsolutePath(out);
      const reportPath = toAbsolutePath(
        reportOut ?? defaultReportPath(outputPath)
      );

      yield* ensureParentDirectory(outputPath);
      yield* ensureParentDirectory(reportPath);

      const result = yield* buildStage1EvalSnapshot({
        manifestPath,
        outputPath,
        reportPath
      }).pipe(Effect.provide(makeLiveLayer(sqlitePath)));

      yield* Effect.log(
        `Wrote ${String(result.rowCount)} Stage 1 snapshot rows to ${outputPath}`
      );
      yield* Effect.log(`Build report written to ${reportPath}`);

      if (result.diagnosticCount > 0) {
        yield* Effect.log(
          `Snapshot build kept ${String(result.diagnosticCount)} diagnostic(s). Review ${reportPath} for rows that still need attention.`
        );
      }
    })
);

const cli = Command.runWith(buildStage1EvalSnapshotCommand, {
  version: "0.1.0"
});

const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => teardown(exit, (code) => process.exit(code)));
});

Effect.suspend(() => cli(Array.from(process.argv).slice(2))).pipe(
  Effect.tapError((error) => Effect.logError(stringifyUnknown(error))),
  runMain
);
