/**
 * D1SnapshotLayer — thin Bun-only wrapper that turns `ensureD1Snapshot`'s
 * cached sqlite path into a `SqlClient.SqlClient` via `@effect/sql-sqlite-bun`.
 *
 * The freshness check and the wrangler+sqlite3 pipeline live in the sibling
 * `D1Snapshot.ts` module, which has no Bun-specific imports and can be loaded
 * under Node (vitest). Anything a test needs to exercise is in that file;
 * this file exists solely because `SqliteClient` transitively loads
 * `bun:sqlite`, which Node can't resolve.
 */
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect, Layer } from "effect";
import { ensureD1Snapshot, type D1SnapshotOptions } from "./D1Snapshot";

export {
  D1SnapshotError,
  ensureD1Snapshot,
  isCacheFresh,
  type D1SnapshotOptions
} from "./D1Snapshot";

/**
 * Layer providing a `SqlClient.SqlClient` backed by a cached D1 snapshot.
 * The snapshot is refreshed on first use per process if older than `maxAge`.
 *
 * Required platform services: `FileSystem`, `Path`, `ChildProcessSpawner`
 * (all provided by `@effect/platform-bun`'s `BunServices.layer`, which is
 * part of `src/platform/ScriptRuntime.ts`'s `scriptPlatformLayer`).
 */
export const d1SnapshotLayer = (options: D1SnapshotOptions) =>
  Layer.unwrap(
    ensureD1Snapshot(options).pipe(
      Effect.map((filename) =>
        SqliteClient.layer({ filename, readonly: true })
      )
    )
  );
