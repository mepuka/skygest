/**
 * D1Snapshot — freshness check and cache pipeline for locally cached
 * `wrangler d1 export` dumps. Used by `src/platform/D1SnapshotLayer.ts` to
 * back a `SqlClient.SqlClient` with a staging D1 snapshot for script runs.
 *
 * This module is deliberately free of any Bun-specific imports so it can
 * be loaded under Node (vitest) without pulling in `bun:sqlite` via
 * `@effect/sql-sqlite-bun`. The Bun-specific `SqliteClient.layer` wrapper
 * lives in the sibling `D1SnapshotLayer.ts` file.
 *
 * Pipeline on cache miss:
 *   1. `wrangler d1 export <dbName> --remote --output <cacheDir>/<dbName>.dump.sql`
 *   2. `sqlite3 <cacheDir>/<dbName>.sqlite.tmp ".read <cacheDir>/<dbName>.dump.sql"`
 *   3. Rename the sqlite tmp file to the final path (atomic).
 *   4. Best-effort delete of the intermediate `.dump.sql`.
 *
 * Cache hits (mtime younger than `maxAge`) skip the entire pipeline.
 */
import {
  Clock,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Schema,
  Stream
} from "effect";
import {
  ChildProcess,
  ChildProcessSpawner
} from "effect/unstable/process";
import { stringifyUnknown } from "./Json";

// ---------------------------------------------------------------------------
// Tagged error
// ---------------------------------------------------------------------------

export const D1SnapshotOperation = Schema.Literals([
  "wrangler-export",
  "sqlite-import",
  "rename",
  "makeDirectory"
]);
export type D1SnapshotOperation = Schema.Schema.Type<typeof D1SnapshotOperation>;

export class D1SnapshotError extends Schema.TaggedErrorClass<D1SnapshotError>()(
  "D1SnapshotError",
  {
    operation: D1SnapshotOperation,
    dbName: Schema.String,
    message: Schema.String
  }
) {}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface D1SnapshotOptions {
  /** Wrangler D1 database name, e.g. `"skygest-staging"`. */
  readonly dbName: string;
  /** Directory to cache the imported sqlite dump (e.g. `".cache/d1"`). */
  readonly cacheDir: string;
  /** Maximum age of a cached dump before it is re-exported. */
  readonly maxAge: Duration.Input;
  /** Extra args to pass through to `wrangler d1 export`. */
  readonly extraArgs?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const mapFsError = (operation: D1SnapshotOperation, dbName: string) =>
  (error: unknown): D1SnapshotError =>
    new D1SnapshotError({
      operation,
      dbName,
      message: stringifyUnknown(error)
    });

/**
 * Run a command via `ChildProcessSpawner`, collecting stdout+stderr as a single
 * string, and fail with `D1SnapshotError` when the exit code is non-zero.
 * `executor.string` does not check exit code on its own, so we spawn manually.
 */
const runCommand = (
  dbName: string,
  operation: D1SnapshotOperation,
  command: ChildProcess.Command
): Effect.Effect<string, D1SnapshotError, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const handle = yield* spawner.spawn(command);
    const output = yield* Stream.decodeText(handle.all).pipe(Stream.mkString);
    const code = yield* handle.exitCode;
    if (code !== 0) {
      return yield* new D1SnapshotError({
        operation,
        dbName,
        message: `exit code ${String(code)}: ${output.trim()}`
      });
    }
    return output;
  }).pipe(
    Effect.scoped,
    Effect.mapError((error) =>
      error instanceof D1SnapshotError
        ? error
        : new D1SnapshotError({
            operation,
            dbName,
            message: stringifyUnknown(error)
          })
    )
  );

/**
 * True when `cachePath` exists, is a regular file, and its `mtime` is within
 * `maxAge` of now. Any stat failure, missing mtime, or non-file dirent returns
 * false — the caller should re-export.
 */
export const isCacheFreshWithNow = (
  cachePath: string,
  maxAge: Duration.Input,
  now: number
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const info = yield* fs.stat(cachePath).pipe(Effect.option);
    if (Option.isNone(info)) return false;
    if (info.value.type !== "File") return false;
    if (Option.isNone(info.value.mtime)) return false;
    const ageMs = now - info.value.mtime.value.getTime();
    return ageMs <= Duration.toMillis(Duration.fromInputUnsafe(maxAge));
  });

export const isCacheFresh = (
  cachePath: string,
  maxAge: Duration.Input
): Effect.Effect<boolean, never, FileSystem.FileSystem | Clock.Clock> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) => isCacheFreshWithNow(cachePath, maxAge, now))
  );

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a cached sqlite file for `dbName` exists and is fresh, running the
 * `wrangler d1 export` → `sqlite3 .read` pipeline on cache miss. Returns the
 * absolute path to the cached sqlite file.
 */
export const ensureD1Snapshot = (
  options: D1SnapshotOptions
): Effect.Effect<
  string,
  D1SnapshotError,
  FileSystem.FileSystem | Path.Path | Clock.Clock | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const cachePath = path.join(options.cacheDir, `${options.dbName}.sqlite`);
    const dumpPath = path.join(options.cacheDir, `${options.dbName}.dump.sql`);
    const tmpSqlitePath = `${cachePath}.tmp`;

    // Fast path: cache hit.
    if (yield* isCacheFresh(cachePath, options.maxAge)) {
      yield* Effect.logDebug("d1.snapshot.cache.hit").pipe(
        Effect.annotateLogs({
          dbName: options.dbName,
          cachePath
        })
      );
      return cachePath;
    }

    // Cache miss — prepare directory, wipe any stale intermediates.
    yield* fs
      .makeDirectory(options.cacheDir, { recursive: true })
      .pipe(Effect.mapError(mapFsError("makeDirectory", options.dbName)));

    yield* fs.remove(dumpPath, { force: true }).pipe(Effect.ignore);
    yield* fs.remove(tmpSqlitePath, { force: true }).pipe(Effect.ignore);

    yield* Effect.logInfo("d1.snapshot.export.start").pipe(
      Effect.annotateLogs({
        dbName: options.dbName,
        cachePath,
        dumpPath
      })
    );

    const cleanupIntermediateFiles = Effect.all(
      [
        fs.remove(dumpPath, { force: true }).pipe(Effect.ignore),
        fs.remove(tmpSqlitePath, { force: true }).pipe(Effect.ignore)
      ],
      { discard: true }
    );

    yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          // Step 1: wrangler d1 export --remote --output <dumpPath>
          const exportArgs: ReadonlyArray<string> = [
            "d1",
            "export",
            options.dbName,
            "--remote",
            "--output",
            dumpPath,
            ...(options.extraArgs ?? [])
          ];
          yield* runCommand(
            options.dbName,
            "wrangler-export",
            ChildProcess.make("wrangler", exportArgs)
          );

          // Step 2: sqlite3 <tmpSqlite> ".read <dumpPath>"
          yield* runCommand(
            options.dbName,
            "sqlite-import",
            ChildProcess.make("sqlite3", [tmpSqlitePath, `.read ${dumpPath}`])
          );

          // Step 3: atomic rename temp sqlite → final cache path.
          yield* fs
            .rename(tmpSqlitePath, cachePath)
            .pipe(Effect.mapError(mapFsError("rename", options.dbName)));
        }),
      (_void, exit) =>
        Exit.isFailure(exit)
          ? cleanupIntermediateFiles
          : fs.remove(dumpPath, { force: true }).pipe(Effect.ignore)
    );

    yield* Effect.logInfo("d1.snapshot.export.done").pipe(
      Effect.annotateLogs({
        dbName: options.dbName,
        cachePath
      })
    );

    return cachePath;
  });
