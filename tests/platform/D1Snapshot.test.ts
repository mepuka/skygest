import { describe, expect, it } from "@effect/vitest";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Duration, Effect, FileSystem, Layer } from "effect";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { isCacheFreshWithNow } from "../../src/platform/D1Snapshot";

const bunFsLayer = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const makeTmpCacheDir = () =>
  Effect.tryPromise(() =>
    fsp.mkdtemp(nodePath.join(os.tmpdir(), "d1-snapshot-test-"))
  );

describe("D1SnapshotLayer.isCacheFresh", () => {
  it("returns false when the cache file does not exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dir = yield* makeTmpCacheDir();
        const missingPath = nodePath.join(dir, "absent.sqlite");
        const fresh = yield* isCacheFreshWithNow(
          missingPath,
          Duration.hours(24),
          Date.now()
        );
        expect(fresh).toBe(false);
        yield* Effect.tryPromise(() =>
          fsp.rm(dir, { recursive: true, force: true })
        );
      }).pipe(Effect.provide(bunFsLayer))
    );
  });

  it("returns true for a file whose mtime is within the maxAge window", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dir = yield* makeTmpCacheDir();
        const cachePath = nodePath.join(dir, "fresh.sqlite");
        yield* Effect.tryPromise(() =>
          fsp.writeFile(cachePath, "SQLite format 3")
        );
        const fresh = yield* isCacheFreshWithNow(
          cachePath,
          Duration.hours(24),
          Date.now()
        );
        expect(fresh).toBe(true);
        yield* Effect.tryPromise(() =>
          fsp.rm(dir, { recursive: true, force: true })
        );
      }).pipe(Effect.provide(bunFsLayer))
    );
  });

  it("returns false when the file is older than maxAge", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dir = yield* makeTmpCacheDir();
        const cachePath = nodePath.join(dir, "stale.sqlite");
        yield* Effect.tryPromise(() =>
          fsp.writeFile(cachePath, "SQLite format 3")
        );
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        yield* Effect.tryPromise(() =>
          fsp.utimes(cachePath, twoDaysAgo, twoDaysAgo)
        );
        const fresh = yield* isCacheFreshWithNow(
          cachePath,
          Duration.hours(24),
          Date.now()
        );
        expect(fresh).toBe(false);
        yield* Effect.tryPromise(() =>
          fsp.rm(dir, { recursive: true, force: true })
        );
      }).pipe(Effect.provide(bunFsLayer))
    );
  });

  it("returns false when the path points at a directory, not a file", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dir = yield* makeTmpCacheDir();
        const fresh = yield* isCacheFreshWithNow(
          dir,
          Duration.hours(24),
          Date.now()
        );
        expect(fresh).toBe(false);
        yield* Effect.tryPromise(() =>
          fsp.rm(dir, { recursive: true, force: true })
        );
      }).pipe(Effect.provide(bunFsLayer))
    );
  });

  it("accepts a short maxAge window that includes a just-created file", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const dir = yield* makeTmpCacheDir();
        const cachePath = nodePath.join(dir, "recent.sqlite");
        yield* Effect.tryPromise(() =>
          fsp.writeFile(cachePath, "SQLite format 3")
        );
        const fresh = yield* isCacheFreshWithNow(
          cachePath,
          Duration.seconds(10),
          Date.now()
        );
        expect(fresh).toBe(true);
        yield* Effect.tryPromise(() =>
          fsp.rm(dir, { recursive: true, force: true })
        );
      }).pipe(Effect.provide(bunFsLayer))
    );
  });
});

// NOTE: full ensureD1Snapshot / d1SnapshotLayer coverage (wrangler + sqlite3
// subprocess paths) is validated end-to-end by running
// `bun scripts/build-stage1-eval-snapshot.ts` against staging D1 rather than
// by mocking ChildProcessSpawner here. The subprocess contract is a thin
// wrapper over `ChildProcess.make` + exit-code checking and has no conditional
// logic worth unit-testing in isolation.
