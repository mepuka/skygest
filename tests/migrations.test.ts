import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import { makeSqliteLayer } from "./support/runtime";

describe("phase-one migrations", () => {
  it.effect("create the BI tables, record applied migrations, and remain idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ name: string }>`
        SELECT name as name
        FROM sqlite_master
        WHERE type IN ('table', 'virtual table')
          AND name IN (
            'experts',
            'expert_sync_state',
            'expert_sources',
            'ingest_leases',
            'posts',
            'post_topics',
            'links',
            'posts_fts'
          )
        ORDER BY name ASC
      `;
      const applied = yield* sql<{ id: number; name: string }>`
        SELECT id as id, name as name
        FROM _migrations
        ORDER BY id ASC
      `;

      expect(rows.map((row) => row.name)).toEqual([
        "expert_sources",
        "expert_sync_state",
        "experts",
        "ingest_leases",
        "links",
        "post_topics",
        "posts",
        "posts_fts"
      ]);
      expect(applied).toEqual([
        { id: 1, name: "init" },
        { id: 2, name: "polling_state" }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );
});
