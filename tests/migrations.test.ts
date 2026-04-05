import { SqlClient } from "effect/unstable/sql";
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
            'editorial_picks',
            'experts',
            'expert_sync_state',
            'expert_sources',
            'post_enrichment_runs',
            'ingest_run_items',
            'ingest_runs',
            'mcp_sessions',
            'posts',
            'post_curation',
            'post_enrichments',
            'post_payloads',
            'post_topics',
            'links',
            'posts_fts',
            'publications'
          )
        ORDER BY name ASC
      `;
      const applied = yield* sql<{ id: number; name: string }>`
        SELECT id as id, name as name
        FROM _migrations
        ORDER BY id ASC
      `;

      expect(rows.map((row) => row.name)).toEqual([
        "editorial_picks",
        "expert_sources",
        "expert_sync_state",
        "experts",
        "ingest_run_items",
        "ingest_runs",
        "links",
        "mcp_sessions",
        "post_curation",
        "post_enrichment_runs",
        "post_enrichments",
        "post_payloads",
        "post_topics",
        "posts",
        "posts_fts",
        "publications"
      ]);
      expect(applied).toEqual([
        { id: 1, name: "init" },
        { id: 2, name: "polling_state" },
        { id: 3, name: "ingest_runs" },
        { id: 4, name: "drop_ingest_leases" },
        { id: 5, name: "ingest_recovery_state" },
        { id: 6, name: "post_topic_match_provenance" },
        { id: 7, name: "fts_porter_stemming" },
        { id: 8, name: "fts_external_content" },
        { id: 9, name: "expert_avatar_and_link_images" },
        { id: 10, name: "publications_and_expert_tiers" },
        { id: 11, name: "editorial_picks" },
        { id: 12, name: "post_payloads" },
        { id: 13, name: "post_curation" },
        { id: 14, name: "post_enrichments" },
        { id: 15, name: "post_enrichment_runs" },
        { id: 16, name: "posts_embed_type" },
        { id: 17, name: "fts_search_metadata" },
        { id: 18, name: "mcp_sessions" },
        { id: 19, name: "pipeline_status_indexes" },
        { id: 20, name: "publication_registry_identity" }
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
      const postsIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('posts')
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
        { name: "idx_ingest_runs_head_sweep_finished_at", isUnique: 0 },
        { name: "idx_ingest_runs_kind_started_at", isUnique: 0 },
        { name: "idx_ingest_runs_phase_last_progress_at", isUnique: 0 },
        { name: "idx_ingest_runs_status_started_at", isUnique: 0 },
        { name: "idx_ingest_runs_workflow_instance_id", isUnique: 1 }
      ]);
      expect(postsIndexes).toEqual([
        { name: "idx_posts_created_at", isUnique: 0 },
        { name: "idx_posts_did_created_at", isUnique: 0 },
        { name: "idx_posts_has_links_created_at", isUnique: 0 },
        { name: "idx_posts_status", isUnique: 0 }
      ]);
      expect(ingestRunItemsIndexes).toEqual([
        { name: "idx_ingest_run_items_did_status_finished_at", isUnique: 0 },
        { name: "idx_ingest_run_items_run_dispatch", isUnique: 0 },
        { name: "idx_ingest_run_items_run_status_progress", isUnique: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("upgrades publications to the new identity shape and backfills existing rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        )
      `.pipe(Effect.asVoid);

      for (let id = 1; id <= 19; id++) {
        yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${id}, ${`migration-${String(id)}`}, ${1_710_000_000_000 + id})
        `.pipe(Effect.asVoid);
      }

      yield* sql`
        CREATE TABLE publications (
          hostname TEXT PRIMARY KEY,
          tier TEXT NOT NULL,
          source TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        )
      `.pipe(Effect.asVoid);

      yield* sql`
        INSERT INTO publications (hostname, tier, source, first_seen_at, last_seen_at)
        VALUES ('reuters.com', 'general-outlet', 'seed', 100, 200)
      `.pipe(Effect.asVoid);

      yield* runMigrations;

      const publicationColumns = yield* sql<{ name: string }>`
        SELECT name as name
        FROM pragma_table_info('publications')
        ORDER BY cid ASC
      `;
      const publications = yield* sql<{
        publicationId: string;
        medium: string;
        hostname: string | null;
        showSlug: string | null;
        feedUrl: string | null;
        appleId: string | null;
        spotifyId: string | null;
        tier: string;
        source: string;
        firstSeenAt: number;
        lastSeenAt: number;
      }>`
        SELECT
          publication_id as publicationId,
          medium as medium,
          hostname as hostname,
          show_slug as showSlug,
          feed_url as feedUrl,
          apple_id as appleId,
          spotify_id as spotifyId,
          tier as tier,
          source as source,
          first_seen_at as firstSeenAt,
          last_seen_at as lastSeenAt
        FROM publications
      `;
      const publicationIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('publications')
        ORDER BY name ASC
      `;

      expect(publicationColumns.map((row) => row.name)).toEqual([
        "publication_id",
        "medium",
        "hostname",
        "show_slug",
        "feed_url",
        "apple_id",
        "spotify_id",
        "tier",
        "source",
        "first_seen_at",
        "last_seen_at"
      ]);
      expect(publications).toEqual([
        {
          publicationId: "reuters.com",
          medium: "text",
          hostname: "reuters.com",
          showSlug: null,
          feedUrl: null,
          appleId: null,
          spotifyId: null,
          tier: "general-outlet",
          source: "seed",
          firstSeenAt: 100,
          lastSeenAt: 200
        }
      ]);
      expect(publicationIndexes).toEqual([
        { name: "idx_publications_apple_id", isUnique: 1 },
        { name: "idx_publications_feed_url", isUnique: 1 },
        { name: "idx_publications_medium_tier_last_seen_at", isUnique: 0 },
        { name: "idx_publications_spotify_id", isUnique: 1 },
        { name: "idx_publications_tier_last_seen_at", isUnique: 0 },
        { name: "sqlite_autoindex_publications_1", isUnique: 1 },
        { name: "sqlite_autoindex_publications_2", isUnique: 1 },
        { name: "sqlite_autoindex_publications_3", isUnique: 1 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );
});
