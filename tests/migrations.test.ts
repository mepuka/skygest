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
            'ingest_run_items',
            'ingest_runs',
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
        "ingest_run_items",
        "ingest_runs",
        "links",
        "post_topics",
        "posts",
        "posts_fts"
      ]);
      expect(applied).toEqual([
        { id: 1, name: "init" },
        { id: 2, name: "polling_state" },
        { id: 3, name: "ingest_runs" },
        { id: 4, name: "drop_ingest_leases" },
        { id: 5, name: "ingest_recovery_state" },
        { id: 6, name: "post_topic_match_provenance" },
        { id: 7, name: "fts_porter_stemming" },
        { id: 8, name: "fts_external_content" }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("adds run tracking columns and indexes and removes ingest_leases", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      const ingestRunsColumns = yield* sql<{ name: string }>`
        SELECT name as name
        FROM pragma_table_info('ingest_runs')
        ORDER BY cid ASC
      `;
      const ingestRunItemsColumns = yield* sql<{ name: string }>`
        SELECT name as name
        FROM pragma_table_info('ingest_run_items')
        ORDER BY cid ASC
      `;
      const ingestLeasesTables = yield* sql<{ name: string }>`
        SELECT name as name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'ingest_leases'
      `;
      const ingestRunsIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('ingest_runs')
        WHERE origin = 'c'
        ORDER BY name ASC
      `;
      const ingestRunItemsIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('ingest_run_items')
        WHERE origin = 'c'
        ORDER BY name ASC
      `;

      expect(ingestRunsColumns.map((row) => row.name)).toEqual([
        "id",
        "workflow_instance_id",
        "kind",
        "triggered_by",
        "requested_by",
        "status",
        "started_at",
        "finished_at",
        "total_experts",
        "experts_succeeded",
        "experts_failed",
        "pages_fetched",
        "posts_seen",
        "posts_stored",
        "posts_deleted",
        "error",
        "phase",
        "last_progress_at"
      ]);
      expect(ingestRunItemsColumns.map((row) => row.name)).toEqual([
        "run_id",
        "did",
        "mode",
        "status",
        "enqueued_at",
        "attempt_count",
        "started_at",
        "finished_at",
        "pages_fetched",
        "posts_seen",
        "posts_stored",
        "posts_deleted",
        "error",
        "last_progress_at"
      ]);
      expect(ingestLeasesTables).toEqual([]);
      expect(ingestRunsIndexes).toEqual([
        { name: "idx_ingest_runs_kind_started_at", isUnique: 0 },
        { name: "idx_ingest_runs_phase_last_progress_at", isUnique: 0 },
        { name: "idx_ingest_runs_status_started_at", isUnique: 0 },
        { name: "idx_ingest_runs_workflow_instance_id", isUnique: 1 }
      ]);
      expect(ingestRunItemsIndexes).toEqual([
        { name: "idx_ingest_run_items_did_status_finished_at", isUnique: 0 },
        { name: "idx_ingest_run_items_run_dispatch", isUnique: 0 },
        { name: "idx_ingest_run_items_run_status_progress", isUnique: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );
});
