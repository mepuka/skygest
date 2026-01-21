import { Effect } from "effect";
import { SqlClient } from "@effect/sql";
import type { ResolvedMigration } from "@effect/sql/Migrator";

const migration1 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE IF NOT EXISTS posts (
    uri TEXT PRIMARY KEY,
    cid TEXT NOT NULL,
    author_did TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL,
    search_text TEXT,
    reply_root TEXT,
    reply_parent TEXT,
    status TEXT DEFAULT 'active'
  )`;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_posts_created_at
    ON posts(created_at DESC)`;
});

export const migrations: ReadonlyArray<ResolvedMigration> = [
  [1, "init", Effect.succeed(migration1)]
];
