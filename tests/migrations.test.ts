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
            'agents',
            'catalog_records',
            'catalogs',
            'data_layer_audit',
            'data_services',
            'dataset_series',
            'datasets',
            'distributions',
            'experts',
            'expert_sync_state',
            'expert_sources',
            'post_enrichment_runs',
            'ingest_run_items',
            'ingest_runs',
            'mcp_sessions',
            'podcast_episodes',
            'podcast_segment_topics',
            'podcast_segments',
            'posts',
            'post_curation',
            'post_enrichments',
            'post_payloads',
            'post_topics',
            'links',
            'posts_fts',
            'publications',
            'series',
            'variables'
          )
        ORDER BY name ASC
      `;
      const applied = yield* sql<{ id: number; name: string }>`
        SELECT id as id, name as name
        FROM _migrations
        ORDER BY id ASC
      `;

      expect(rows.map((row) => row.name)).toEqual([
        "agents",
        "catalog_records",
        "catalogs",
        "data_layer_audit",
        "data_services",
        "dataset_series",
        "datasets",
        "distributions",
        "editorial_picks",
        "expert_sources",
        "expert_sync_state",
        "experts",
        "ingest_run_items",
        "ingest_runs",
        "links",
        "mcp_sessions",
        "podcast_episodes",
        "podcast_segment_topics",
        "podcast_segments",
        "post_curation",
        "post_enrichment_runs",
        "post_enrichments",
        "post_payloads",
        "post_topics",
        "posts",
        "posts_fts",
        "publications",
        "series",
        "variables"
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
        { id: 20, name: "publication_registry_identity" },
        { id: 21, name: "podcast_schema" },
        { id: 22, name: "data_layer_registry" },
        { id: 23, name: "runtime_variable_profile_alignment" },
        { id: 24, name: "series_dataset_alignment" }
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

  it.effect("adds runtime profile columns idempotently when a partial environment already has them", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        )
      `.pipe(Effect.asVoid);

      for (let id = 1; id <= 22; id++) {
        yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${id}, ${`migration-${String(id)}`}, ${1_710_000_100_000 + id})
        `.pipe(Effect.asVoid);
      }

      yield* sql`
        CREATE TABLE variables (
          id TEXT PRIMARY KEY,
          policy_instrument TEXT
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        CREATE TABLE datasets (
          id TEXT PRIMARY KEY,
          variable_ids_json TEXT
        )
      `.pipe(Effect.asVoid);

      yield* runMigrations;
      yield* runMigrations;

      const variableColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('variables')
        WHERE name = 'policy_instrument'
      `;
      const datasetColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('datasets')
        WHERE name = 'variable_ids_json'
      `;

      expect(variableColumns).toEqual([
        { name: "policy_instrument", isNotNull: 0 }
      ]);
      expect(datasetColumns).toEqual([
        { name: "variable_ids_json", isNotNull: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("adds runtime profile columns on a full migration run from an empty database", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      const variableColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('variables')
        WHERE name = 'policy_instrument'
      `;
      const datasetColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('datasets')
        WHERE name = 'variable_ids_json'
      `;

      expect(variableColumns).toEqual([
        { name: "policy_instrument", isNotNull: 0 }
      ]);
      expect(datasetColumns).toEqual([
        { name: "variable_ids_json", isNotNull: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("adds the nullable series dataset column and index idempotently for upgraded databases", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS _migrations (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at INTEGER NOT NULL
        )
      `.pipe(Effect.asVoid);

      for (let id = 1; id <= 23; id++) {
        yield* sql`
          INSERT INTO _migrations (id, name, applied_at)
          VALUES (${id}, ${`migration-${String(id)}`}, ${1_710_000_200_000 + id})
        `.pipe(Effect.asVoid);
      }

      yield* sql`
        CREATE TABLE series (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          variable_id TEXT NOT NULL,
          fixed_dims_json TEXT NOT NULL,
          aliases_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          deleted_at TEXT
        )
      `.pipe(Effect.asVoid);

      yield* runMigrations;
      yield* runMigrations;

      const seriesColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('series')
        WHERE name = 'dataset_id'
      `;
      const seriesIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('series')
        WHERE name = 'idx_series_dataset_id'
      `;

      expect(seriesColumns).toEqual([
        { name: "dataset_id", isNotNull: 0 }
      ]);
      expect(seriesIndexes).toEqual([
        { name: "idx_series_dataset_id", isUnique: 0 }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("creates the nullable series dataset column and index on a fresh database", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      const seriesColumns = yield* sql<{ name: string; isNotNull: number }>`
        SELECT name as name, [notnull] as isNotNull
        FROM pragma_table_info('series')
        WHERE name = 'dataset_id'
      `;
      const seriesIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('series')
        WHERE name = 'idx_series_dataset_id'
      `;

      expect(seriesColumns).toEqual([
        { name: "dataset_id", isNotNull: 0 }
      ]);
      expect(seriesIndexes).toEqual([
        { name: "idx_series_dataset_id", isUnique: 0 }
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

  it.effect("resumes publication migration safely after a partial run with podcast rows present", () =>
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
        CREATE TABLE publications_legacy (
          hostname TEXT PRIMARY KEY,
          tier TEXT NOT NULL,
          source TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO publications_legacy (hostname, tier, source, first_seen_at, last_seen_at)
        VALUES ('reuters.com', 'general-outlet', 'seed', 100, 200)
      `.pipe(Effect.asVoid);

      yield* sql`
        CREATE TABLE publications (
          publication_id TEXT PRIMARY KEY,
          medium TEXT NOT NULL DEFAULT 'text' CHECK (medium IN ('text', 'podcast')),
          hostname TEXT UNIQUE,
          show_slug TEXT UNIQUE,
          feed_url TEXT,
          apple_id TEXT,
          spotify_id TEXT,
          tier TEXT NOT NULL,
          source TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          CHECK (
            (medium = 'text' AND hostname IS NOT NULL AND show_slug IS NULL) OR
            (medium = 'podcast' AND hostname IS NULL AND show_slug IS NOT NULL)
          ),
          CHECK (feed_url IS NULL OR medium = 'podcast'),
          CHECK (apple_id IS NULL OR medium = 'podcast'),
          CHECK (spotify_id IS NULL OR medium = 'podcast')
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO publications (
          publication_id,
          medium,
          hostname,
          show_slug,
          feed_url,
          apple_id,
          spotify_id,
          tier,
          source,
          first_seen_at,
          last_seen_at
        )
        VALUES (
          'catalyst-with-shayle-kann',
          'podcast',
          NULL,
          'catalyst-with-shayle-kann',
          'https://example.com/catalyst.rss',
          NULL,
          NULL,
          'energy-focused',
          'seed',
          300,
          400
        )
      `.pipe(Effect.asVoid);

      yield* runMigrations;

      const publications = yield* sql<{ publicationId: string; medium: string }>`
        SELECT publication_id as publicationId, medium as medium
        FROM publications
        ORDER BY publication_id ASC
      `;
      const legacyTables = yield* sql<{ name: string }>`
        SELECT name as name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = 'publications_legacy'
      `;

      expect(publications).toEqual([
        { publicationId: "catalyst-with-shayle-kann", medium: "podcast" },
        { publicationId: "reuters.com", medium: "text" }
      ]);
      expect(legacyTables).toEqual([]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("targets podcast foreign keys at publication ids and keeps only the useful topic index", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      const episodeForeignKeys = yield* sql<{
        tableName: string;
        fromColumn: string;
        toColumn: string;
      }>`
        ${sql.unsafe(
          "SELECT \"table\" as tableName, \"from\" as fromColumn, \"to\" as toColumn FROM pragma_foreign_key_list('podcast_episodes')"
        )}
      `;
      const topicIndexes = yield* sql<{ name: string; isUnique: number }>`
        SELECT name as name, "unique" as isUnique
        FROM pragma_index_list('podcast_segment_topics')
        WHERE origin = 'c'
        ORDER BY name ASC
      `;

      expect(episodeForeignKeys).toEqual([
        {
          tableName: "publications",
          fromColumn: "show_slug",
          toColumn: "publication_id"
        }
      ]);
      expect(topicIndexes).toEqual([
        {
          name: "idx_podcast_segment_topics_topic_slug_segment_id",
          isUnique: 0
        }
      ]);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("cascades podcast segment rows when an episode is deleted with foreign keys enabled", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`${sql.unsafe("PRAGMA foreign_keys = ON")}`.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO publications (
          publication_id,
          medium,
          hostname,
          show_slug,
          feed_url,
          apple_id,
          spotify_id,
          tier,
          source,
          first_seen_at,
          last_seen_at
        )
        VALUES (
          'catalyst-with-shayle-kann',
          'podcast',
          NULL,
          'catalyst-with-shayle-kann',
          'https://example.com/catalyst.rss',
          NULL,
          NULL,
          'energy-focused',
          'seed',
          100,
          100
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO podcast_episodes (
          episode_id,
          show_slug,
          title,
          published_at,
          audio_url,
          duration_seconds,
          speaker_dids,
          chapter_markers,
          transcript_r2_key,
          lifecycle_state,
          created_at,
          updated_at
        )
        VALUES (
          'catalyst-2026-04-04',
          'catalyst-with-shayle-kann',
          'Catalyst',
          100,
          'https://example.com/catalyst.mp3',
          1800,
          '[]',
          NULL,
          'transcripts/catalyst-with-shayle-kann/catalyst-2026-04-04.json',
          'segmented',
          100,
          100
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO podcast_segments (
          segment_id,
          episode_id,
          segment_index,
          primary_speaker_did,
          speaker_dids,
          start_timestamp_ms,
          end_timestamp_ms,
          text,
          created_at
        )
        VALUES (
          'segment-0',
          'catalyst-2026-04-04',
          0,
          'did:plc:test-host',
          '["did:plc:test-host"]',
          0,
          1000,
          'hello world',
          100
        )
      `.pipe(Effect.asVoid);
      yield* sql`
        INSERT INTO podcast_segment_topics (
          segment_id,
          topic_slug,
          matched_term,
          match_signal,
          match_value,
          match_score,
          ontology_version,
          matcher_version
        )
        VALUES (
          'segment-0',
          'storage',
          'storage',
          'term',
          'storage',
          0.9,
          'test',
          'test'
        )
      `.pipe(Effect.asVoid);

      yield* sql`
        DELETE FROM podcast_episodes
        WHERE episode_id = 'catalyst-2026-04-04'
      `.pipe(Effect.asVoid);

      const [segmentCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM podcast_segments
      `;
      const [topicCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM podcast_segment_topics
      `;

      expect(segmentCount?.count).toBe(0);
      expect(topicCount?.count).toBe(0);
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("enforces the publication identity check constraints", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      const exit = yield* Effect.exit(
        sql`
          INSERT INTO publications (
            publication_id,
            medium,
            hostname,
            show_slug,
            feed_url,
            apple_id,
            spotify_id,
            tier,
            source,
            first_seen_at,
            last_seen_at
          )
          VALUES (
            'broken-podcast',
            'podcast',
            'example.com',
            NULL,
            NULL,
            NULL,
            NULL,
            'unknown',
            'seed',
            1,
            1
          )
        `.pipe(Effect.asVoid)
      );

      expect(exit._tag).toBe("Failure");
    }).pipe(Effect.provide(makeSqliteLayer()))
  );

  it.effect("creates podcast tables and enforces segment timing constraints", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO publications (
          publication_id,
          medium,
          hostname,
          show_slug,
          feed_url,
          apple_id,
          spotify_id,
          tier,
          source,
          first_seen_at,
          last_seen_at
        )
        VALUES (
          'catalyst-with-shayle-kann',
          'podcast',
          NULL,
          'catalyst-with-shayle-kann',
          'https://example.com/catalyst.rss',
          NULL,
          NULL,
          'energy-focused',
          'seed',
          1,
          1
        )
      `.pipe(Effect.asVoid);

      yield* sql`
        INSERT INTO podcast_episodes (
          episode_id,
          show_slug,
          title,
          published_at,
          audio_url,
          duration_seconds,
          speaker_dids,
          chapter_markers,
          transcript_r2_key,
          lifecycle_state,
          created_at,
          updated_at
        )
        VALUES (
          'catalyst-2026-04-04',
          'catalyst-with-shayle-kann',
          'Catalyst sample',
          100,
          'https://example.com/catalyst.mp3',
          1800,
          '["did:plc:host","did:plc:guest"]',
          NULL,
          NULL,
          'segmented',
          100,
          100
        )
      `.pipe(Effect.asVoid);

      const invalidSegmentExit = yield* Effect.exit(
        sql`
          INSERT INTO podcast_segments (
            segment_id,
            episode_id,
            segment_index,
            primary_speaker_did,
            speaker_dids,
            start_timestamp_ms,
            end_timestamp_ms,
            text,
            created_at
          )
          VALUES (
            'catalyst-2026-04-04-segment-1',
            'catalyst-2026-04-04',
            0,
            'did:plc:host',
            '["did:plc:host"]',
            5_000,
            4_000,
            'Broken segment',
            100
          )
        `.pipe(Effect.asVoid)
      );

      const tables = yield* sql<{ name: string }>`
        SELECT name as name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN (
            'podcast_episodes',
            'podcast_segments',
            'podcast_segment_topics'
          )
        ORDER BY name ASC
      `;

      expect(tables.map((row) => row.name)).toEqual([
        "podcast_episodes",
        "podcast_segment_topics",
        "podcast_segments"
      ]);
      expect(invalidSegmentExit._tag).toBe("Failure");
    }).pipe(Effect.provide(makeSqliteLayer()))
  );
});
