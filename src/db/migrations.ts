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
    created_at_day TEXT NOT NULL,
    indexed_at INTEGER NOT NULL,
    search_text TEXT,
    reply_root TEXT,
    reply_parent TEXT,
    status TEXT DEFAULT 'active'
  )`;

  yield* sql`CREATE INDEX IF NOT EXISTS idx_posts_author_time
    ON posts(author_did, created_at DESC)`;

  yield* sql`CREATE TABLE IF NOT EXISTS users (
    did TEXT PRIMARY KEY,
    handle TEXT,
    display_name TEXT,
    created_at INTEGER,
    last_access_at INTEGER,
    access_count INTEGER DEFAULT 0,
    consent_accesses INTEGER DEFAULT 0,
    opt_out INTEGER DEFAULT 0,
    deactivated INTEGER DEFAULT 0
  )`;

  yield* sql`CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    user_did TEXT NOT NULL,
    post_uri TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`;

  yield* sql`CREATE TABLE IF NOT EXISTS user_access_log (
    id TEXT PRIMARY KEY,
    did TEXT NOT NULL,
    access_at INTEGER NOT NULL,
    recs_shown TEXT,
    cursor_start INTEGER,
    cursor_end INTEGER,
    default_from INTEGER
  )`;
});

export const migrations: ReadonlyArray<ResolvedMigration> = [
  [1, "init", Effect.succeed(migration1)]
];
