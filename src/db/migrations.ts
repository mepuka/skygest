import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";

export type D1Migration = {
  readonly id: number;
  readonly name: string;
  readonly statements?: ReadonlyArray<string>;
  readonly run?: (
    sql: SqlClient.SqlClient
  ) => Effect.Effect<void, SqlError, never>;
};

const executeUnsafeStatement = (
  sql: SqlClient.SqlClient,
  statement: string
) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid);

const tableExists = (
  sql: SqlClient.SqlClient,
  tableName: string
) =>
  sql<{ name: string }>`
    SELECT name as name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ${tableName}
  `.pipe(
    Effect.map((rows) => rows.length > 0)
  );

const columnExists = (
  sql: SqlClient.SqlClient,
  tableName: string,
  columnName: string
) =>
  sql<{ name: string }>`
    ${sql.unsafe(
      `SELECT name as name
       FROM pragma_table_info('${tableName}')
       WHERE name = '${columnName}'`
    )}
  `.pipe(
    Effect.map((rows) => rows.length > 0)
  );

const publicationRegistryIdentityTableStatement = `CREATE TABLE IF NOT EXISTS publications (
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
)`;

const publicationRegistryIdentityIndexStatements = [
  `CREATE INDEX IF NOT EXISTS idx_publications_tier_last_seen_at
    ON publications(tier, last_seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_publications_medium_tier_last_seen_at
    ON publications(medium, tier, last_seen_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_feed_url
    ON publications(feed_url)
    WHERE feed_url IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_apple_id
    ON publications(apple_id)
    WHERE apple_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_publications_spotify_id
    ON publications(spotify_id)
    WHERE spotify_id IS NOT NULL`
] as const;

const ensurePublicationRegistryIdentityIndexes = (
  sql: SqlClient.SqlClient
) =>
  Effect.forEach(
    publicationRegistryIdentityIndexStatements,
    (statement) => executeUnsafeStatement(sql, statement),
    { discard: true }
  );

const runPublicationRegistryIdentityMigration = (
  sql: SqlClient.SqlClient
) =>
  Effect.gen(function* () {
    const hasPublications = yield* tableExists(sql, "publications");
    let hasLegacyPublications = yield* tableExists(sql, "publications_legacy");
    const hasPublicationId = hasPublications
      ? yield* columnExists(sql, "publications", "publication_id")
      : false;

    if (hasPublications && hasPublicationId && !hasLegacyPublications) {
      return yield* ensurePublicationRegistryIdentityIndexes(sql);
    }

    if (hasPublications && !hasPublicationId && !hasLegacyPublications) {
      yield* executeUnsafeStatement(
        sql,
        `ALTER TABLE publications RENAME TO publications_legacy`
      );
      hasLegacyPublications = true;
    }

    yield* executeUnsafeStatement(
      sql,
      publicationRegistryIdentityTableStatement
    );

    if (hasLegacyPublications) {
      yield* executeUnsafeStatement(
        sql,
        `INSERT INTO publications (
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
        SELECT
          legacy.hostname as publication_id,
          'text' as medium,
          legacy.hostname,
          NULL as show_slug,
          NULL as feed_url,
          NULL as apple_id,
          NULL as spotify_id,
          legacy.tier,
          legacy.source,
          legacy.first_seen_at,
          legacy.last_seen_at
        FROM publications_legacy legacy
        WHERE NOT EXISTS (
          SELECT 1
          FROM publications current
          WHERE current.publication_id = legacy.hostname
        )`
      );
      yield* executeUnsafeStatement(sql, `DROP TABLE publications_legacy`);
    }

    yield* ensurePublicationRegistryIdentityIndexes(sql);
  });

const migration1: D1Migration = {
  id: 1,
  name: "init",
  statements: [
    `CREATE TABLE IF NOT EXISTS experts (
      did TEXT PRIMARY KEY,
      handle TEXT,
      display_name TEXT,
      description TEXT,
      domain TEXT NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      shard INTEGER NOT NULL,
      active INTEGER DEFAULT 1,
      added_at INTEGER NOT NULL,
      last_synced_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS expert_sources (
      uri TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT,
      domain TEXT NOT NULL,
      last_crawled_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      uri TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      cid TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      has_links INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      ingest_id TEXT UNIQUE,
      FOREIGN KEY (did) REFERENCES experts(did)
    )`,
    `CREATE TABLE IF NOT EXISTS post_topics (
      post_uri TEXT NOT NULL,
      topic_slug TEXT NOT NULL,
      matched_term TEXT,
      PRIMARY KEY (post_uri, topic_slug),
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE TABLE IF NOT EXISTS links (
      post_uri TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT,
      description TEXT,
      domain TEXT,
      extracted_at INTEGER NOT NULL,
      PRIMARY KEY (post_uri, url),
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
      uri UNINDEXED,
      text
    )`,
    `CREATE INDEX IF NOT EXISTS idx_experts_active_domain_shard
      ON experts(active, domain, shard)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_did_created_at
      ON posts(did, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_created_at
      ON posts(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_posts_has_links_created_at
      ON posts(has_links, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_post_topics_topic_slug_post_uri
      ON post_topics(topic_slug, post_uri)`,
    `CREATE INDEX IF NOT EXISTS idx_links_domain_extracted_at
      ON links(domain, extracted_at DESC)`
  ]
};

const migration2: D1Migration = {
  id: 2,
  name: "polling_state",
  statements: [
    `CREATE TABLE IF NOT EXISTS expert_sync_state (
      did TEXT PRIMARY KEY,
      pds_url TEXT,
      pds_verified_at INTEGER,
      head_uri TEXT,
      head_rkey TEXT,
      head_created_at INTEGER,
      last_polled_at INTEGER,
      last_completed_at INTEGER,
      backfill_cursor TEXT,
      backfill_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT,
      FOREIGN KEY (did) REFERENCES experts(did)
    )`,
    `CREATE TABLE IF NOT EXISTS ingest_leases (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`
  ]
};

const migration3: D1Migration = {
  id: 3,
  name: "ingest_runs",
  statements: [
    `CREATE TABLE IF NOT EXISTS ingest_runs (
      id TEXT PRIMARY KEY,
      workflow_instance_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      triggered_by TEXT NOT NULL,
      requested_by TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      total_experts INTEGER NOT NULL DEFAULT 0,
      experts_succeeded INTEGER NOT NULL DEFAULT 0,
      experts_failed INTEGER NOT NULL DEFAULT 0,
      pages_fetched INTEGER NOT NULL DEFAULT 0,
      posts_seen INTEGER NOT NULL DEFAULT 0,
      posts_stored INTEGER NOT NULL DEFAULT 0,
      posts_deleted INTEGER NOT NULL DEFAULT 0,
      error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ingest_run_items (
      run_id TEXT NOT NULL,
      did TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      enqueued_at INTEGER,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      finished_at INTEGER,
      pages_fetched INTEGER NOT NULL DEFAULT 0,
      posts_seen INTEGER NOT NULL DEFAULT 0,
      posts_stored INTEGER NOT NULL DEFAULT 0,
      posts_deleted INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      PRIMARY KEY (run_id, did, mode),
      FOREIGN KEY (run_id) REFERENCES ingest_runs(id),
      FOREIGN KEY (did) REFERENCES experts(did)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_runs_workflow_instance_id
      ON ingest_runs(workflow_instance_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_runs_status_started_at
      ON ingest_runs(status, started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_runs_kind_started_at
      ON ingest_runs(kind, started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_run_items_run_dispatch
      ON ingest_run_items(run_id, status, enqueued_at, did, mode)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_run_items_did_status_finished_at
      ON ingest_run_items(did, status, finished_at DESC)`
  ]
};

const migration4: D1Migration = {
  id: 4,
  name: "drop_ingest_leases",
  statements: [
    `DROP TABLE IF EXISTS ingest_leases`
  ]
};

const migration5: D1Migration = {
  id: 5,
  name: "ingest_recovery_state",
  statements: [
    `ALTER TABLE ingest_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'queued'`,
    `ALTER TABLE ingest_runs ADD COLUMN last_progress_at INTEGER`,
    `ALTER TABLE ingest_run_items ADD COLUMN last_progress_at INTEGER`,
    `UPDATE ingest_runs
      SET phase = CASE
        WHEN status = 'queued' THEN 'queued'
        WHEN status = 'running' AND EXISTS (
          SELECT 1
          FROM ingest_run_items
          WHERE ingest_run_items.run_id = ingest_runs.id
        ) THEN 'dispatching'
        WHEN status = 'running' THEN 'preparing'
        WHEN status = 'complete' THEN 'complete'
        WHEN status = 'failed' THEN 'failed'
        ELSE 'queued'
      END`,
    `UPDATE ingest_runs
      SET last_progress_at = COALESCE(finished_at, started_at)
      WHERE last_progress_at IS NULL`,
    `UPDATE ingest_run_items
      SET status = CASE
        WHEN status = 'queued' AND enqueued_at IS NOT NULL THEN 'dispatched'
        ELSE status
      END`,
    `UPDATE ingest_run_items
      SET last_progress_at = COALESCE(finished_at, started_at, enqueued_at)
      WHERE last_progress_at IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_runs_phase_last_progress_at
      ON ingest_runs(phase, last_progress_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_run_items_run_status_progress
      ON ingest_run_items(run_id, status, last_progress_at, enqueued_at, did, mode)`
  ]
};

const migration6: D1Migration = {
  id: 6,
  name: "post_topic_match_provenance",
  statements: [
    `ALTER TABLE post_topics ADD COLUMN match_signal TEXT NOT NULL DEFAULT 'term'`,
    `ALTER TABLE post_topics ADD COLUMN match_value TEXT`,
    `ALTER TABLE post_topics ADD COLUMN match_score REAL`,
    `ALTER TABLE post_topics ADD COLUMN ontology_version TEXT NOT NULL DEFAULT 'legacy-static'`,
    `ALTER TABLE post_topics ADD COLUMN matcher_version TEXT NOT NULL DEFAULT 'legacy-static'`,
    `UPDATE post_topics
      SET match_value = COALESCE(match_value, matched_term)
      WHERE match_value IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_post_topics_post_uri_topic_slug
      ON post_topics(post_uri, topic_slug)`
  ]
};

const migration7: D1Migration = {
  id: 7,
  name: "fts_porter_stemming",
  statements: [
    `DROP TABLE IF EXISTS posts_fts`,
    `CREATE VIRTUAL TABLE posts_fts USING fts5(
      uri UNINDEXED,
      text,
      tokenize='porter unicode61'
    )`,
    `INSERT INTO posts_fts (uri, text)
      SELECT uri, text FROM posts WHERE status = 'active'`
  ]
};

const migration8: D1Migration = {
  id: 8,
  name: "fts_external_content",
  statements: [
    `DROP TABLE IF EXISTS posts_fts`,
    `CREATE VIRTUAL TABLE posts_fts USING fts5(
      text,
      content='posts',
      content_rowid='rowid',
      tokenize='porter unicode61'
    )`,
    `INSERT INTO posts_fts (rowid, text)
      SELECT rowid, text FROM posts WHERE status = 'active'`
  ]
};

const migration9: D1Migration = {
  id: 9,
  name: "expert_avatar_and_link_images",
  statements: [
    `ALTER TABLE experts ADD COLUMN avatar TEXT`,
    `ALTER TABLE links ADD COLUMN image_url TEXT`
  ]
};

const migration10: D1Migration = {
  id: 10,
  name: "publications_and_expert_tiers",
  statements: [
    `ALTER TABLE experts ADD COLUMN tier TEXT NOT NULL DEFAULT 'independent'`,
    `CREATE TABLE IF NOT EXISTS publications (
      hostname    TEXT PRIMARY KEY,
      tier        TEXT NOT NULL,
      source      TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_publications_tier_last_seen_at
      ON publications(tier, last_seen_at DESC)`
  ]
};

const migration11: D1Migration = {
  id: 11,
  name: "editorial_picks",
  statements: [
    `CREATE TABLE IF NOT EXISTS editorial_picks (
      post_uri    TEXT PRIMARY KEY,
      score       REAL NOT NULL,
      reason      TEXT NOT NULL,
      category    TEXT,
      curator     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active',
      picked_at   INTEGER NOT NULL,
      expires_at  INTEGER,
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_picks_active_score
      ON editorial_picks(status, score DESC, picked_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_editorial_picks_expires
      ON editorial_picks(expires_at)
      WHERE expires_at IS NOT NULL AND status = 'active'`
  ]
};

const migration12: D1Migration = {
  id: 12,
  name: "post_payloads",
  statements: [
    `CREATE TABLE IF NOT EXISTS post_payloads (
      post_uri                 TEXT PRIMARY KEY,
      capture_stage            TEXT NOT NULL CHECK (capture_stage IN ('candidate', 'picked')),
      embed_type               TEXT CHECK (embed_type IN ('link', 'img', 'quote', 'media', 'video')),
      embed_payload_json       TEXT,
      enrichment_payload_json  TEXT,
      captured_at              INTEGER NOT NULL,
      updated_at               INTEGER NOT NULL,
      enriched_at              INTEGER,
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_post_payloads_stage_updated
      ON post_payloads(capture_stage, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_post_payloads_enriched
      ON post_payloads(enriched_at DESC)
      WHERE enriched_at IS NOT NULL`
  ]
};

const migration13: D1Migration = {
  id: 13,
  name: "post_curation",
  statements: [
    `CREATE TABLE IF NOT EXISTS post_curation (
      post_uri         TEXT PRIMARY KEY,
      status           TEXT NOT NULL DEFAULT 'flagged',
      signal_score     REAL NOT NULL,
      predicates_applied TEXT NOT NULL,
      flagged_at       INTEGER NOT NULL,
      curated_at       INTEGER,
      curated_by       TEXT,
      review_note      TEXT,
      FOREIGN KEY (post_uri) REFERENCES posts(uri)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_post_curation_status_score
      ON post_curation(status, signal_score DESC, flagged_at DESC)`
  ]
};

const migration14: D1Migration = {
  id: 14,
  name: "post_enrichments",
  statements: [
    `CREATE TABLE IF NOT EXISTS post_enrichments (
      post_uri                 TEXT NOT NULL,
      enrichment_type          TEXT NOT NULL,
      enrichment_payload_json  TEXT NOT NULL,
      updated_at               INTEGER NOT NULL,
      enriched_at              INTEGER NOT NULL,
      PRIMARY KEY (post_uri, enrichment_type),
      FOREIGN KEY (post_uri) REFERENCES post_payloads(post_uri)
    )`
  ]
};

const migration15: D1Migration = {
  id: 15,
  name: "post_enrichment_runs",
  statements: [
    `CREATE TABLE IF NOT EXISTS post_enrichment_runs (
      id                  TEXT PRIMARY KEY,
      workflow_instance_id TEXT NOT NULL,
      post_uri            TEXT NOT NULL,
      enrichment_type     TEXT NOT NULL CHECK (enrichment_type IN ('vision', 'source-attribution', 'grounding')),
      schema_version      TEXT NOT NULL,
      triggered_by        TEXT NOT NULL CHECK (triggered_by IN ('pick', 'admin', 'repair')),
      requested_by        TEXT,
      status              TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed', 'needs-review')),
      phase               TEXT NOT NULL CHECK (phase IN ('queued', 'assembling', 'planning', 'executing', 'validating', 'persisting', 'complete', 'failed', 'needs-review')),
      attempt_count       INTEGER NOT NULL DEFAULT 0,
      model_lane          TEXT,
      prompt_version      TEXT,
      input_fingerprint   TEXT,
      started_at          INTEGER NOT NULL,
      finished_at         INTEGER,
      last_progress_at    INTEGER,
      result_written_at   INTEGER,
      error               TEXT,
      FOREIGN KEY (post_uri) REFERENCES post_payloads(post_uri)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_post_enrichment_runs_workflow_instance_id
      ON post_enrichment_runs(workflow_instance_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_post_enrichment_runs_logical_key
      ON post_enrichment_runs(post_uri, enrichment_type, schema_version)`,
    `CREATE INDEX IF NOT EXISTS idx_post_enrichment_runs_status_started_at
      ON post_enrichment_runs(status, started_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_post_enrichment_runs_phase_last_progress_at
      ON post_enrichment_runs(phase, last_progress_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_post_enrichment_runs_post_type_started_at
      ON post_enrichment_runs(post_uri, enrichment_type, started_at DESC)`
  ]
};

const migration16: D1Migration = {
  id: 16,
  name: "posts_embed_type",
  statements: [
    `ALTER TABLE posts ADD COLUMN embed_type TEXT CHECK (embed_type IN ('link', 'img', 'quote', 'media', 'video'))`
  ]
};

const migration17: D1Migration = {
  id: 17,
  name: "fts_search_metadata",
  statements: [
    `DROP TABLE IF EXISTS posts_fts`,
    `CREATE VIRTUAL TABLE posts_fts USING fts5(
      uri UNINDEXED,
      text,
      handle,
      topic_terms,
      tokenize='porter unicode61'
    )`,
    `INSERT INTO posts_fts (rowid, uri, text, handle, topic_terms)
      SELECT
        p.rowid,
        p.uri,
        p.text,
        COALESCE(e.handle, ''),
        COALESCE((
          SELECT group_concat(
            COALESCE(NULLIF(pt.match_value, ''), NULLIF(pt.matched_term, ''), pt.topic_slug),
            ' '
          )
          FROM post_topics pt
          WHERE pt.post_uri = p.uri
        ), '')
      FROM posts p
      LEFT JOIN experts e ON e.did = p.did
      WHERE p.status = 'active'`
  ]
};

const migration18: D1Migration = {
  id: 18,
  name: "mcp_sessions",
  statements: [
    `CREATE TABLE IF NOT EXISTS mcp_sessions (
      session_id TEXT PRIMARY KEY,
      initialize_payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_sessions_updated_at
      ON mcp_sessions(updated_at DESC)`
  ]
};

const migration19: D1Migration = {
  id: 19,
  name: "pipeline_status_indexes",
  statements: [
    `CREATE INDEX IF NOT EXISTS idx_posts_status
      ON posts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_ingest_runs_head_sweep_finished_at
      ON ingest_runs(finished_at DESC, id DESC)
      WHERE kind = 'head-sweep'
        AND finished_at IS NOT NULL
        AND status IN ('complete', 'failed')`
  ]
};

const migration20: D1Migration = {
  id: 20,
  name: "publication_registry_identity",
  run: runPublicationRegistryIdentityMigration
};

const migration21: D1Migration = {
  id: 21,
  name: "podcast_schema",
  statements: [
    `CREATE TABLE IF NOT EXISTS podcast_episodes (
      episode_id TEXT PRIMARY KEY,
      show_slug TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at INTEGER NOT NULL,
      audio_url TEXT,
      duration_seconds INTEGER,
      speaker_dids TEXT NOT NULL,
      chapter_markers TEXT,
      transcript_r2_key TEXT,
      lifecycle_state TEXT NOT NULL CHECK (lifecycle_state IN ('fetched', 'transcribed', 'segmented', 'pushed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
      CHECK (updated_at >= created_at),
      FOREIGN KEY (show_slug) REFERENCES publications(publication_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_podcast_episodes_show_slug_published_at
      ON podcast_episodes(show_slug, published_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_podcast_episodes_lifecycle_state_published_at
      ON podcast_episodes(lifecycle_state, published_at DESC)`,
    `CREATE TABLE IF NOT EXISTS podcast_segments (
      segment_id TEXT PRIMARY KEY,
      episode_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      primary_speaker_did TEXT NOT NULL,
      speaker_dids TEXT NOT NULL,
      start_timestamp_ms INTEGER NOT NULL,
      end_timestamp_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (episode_id, segment_index),
      CHECK (segment_index >= 0),
      CHECK (start_timestamp_ms >= 0),
      CHECK (end_timestamp_ms > start_timestamp_ms),
      FOREIGN KEY (episode_id) REFERENCES podcast_episodes(episode_id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_podcast_segments_episode_id_segment_index
      ON podcast_segments(episode_id, segment_index ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_podcast_segments_primary_speaker_created_at
      ON podcast_segments(primary_speaker_did, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS podcast_segment_topics (
      segment_id TEXT NOT NULL,
      topic_slug TEXT NOT NULL,
      matched_term TEXT,
      match_signal TEXT NOT NULL DEFAULT 'term',
      match_value TEXT,
      match_score REAL,
      ontology_version TEXT NOT NULL,
      matcher_version TEXT NOT NULL,
      PRIMARY KEY (segment_id, topic_slug),
      FOREIGN KEY (segment_id) REFERENCES podcast_segments(segment_id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_podcast_segment_topics_topic_slug_segment_id
      ON podcast_segment_topics(topic_slug, segment_id)`
  ]
};

const migration22: D1Migration = {
  id: 22,
  name: "data_layer_registry",
  statements: [
    `CREATE TABLE IF NOT EXISTS variables (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      definition TEXT,
      measured_property TEXT,
      domain_object TEXT,
      technology_or_fuel TEXT,
      statistic_type TEXT,
      aggregation TEXT,
      basis_json TEXT,
      unit_family TEXT,
      aliases_json TEXT NOT NULL,
      facets_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_variables_label
      ON variables(label)`,
    `CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      variable_id TEXT NOT NULL,
      dataset_id TEXT,
      fixed_dims_json TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_series_variable_id
      ON series(variable_id)`,
    `CREATE INDEX IF NOT EXISTS idx_series_dataset_id
      ON series(dataset_id)`,
    `CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      alternate_names_json TEXT,
      homepage TEXT,
      homepage_domain TEXT,
      parent_agent_id TEXT,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_agents_homepage_domain
      ON agents(homepage_domain)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_parent_agent_id
      ON agents(parent_agent_id)`,
    `CREATE TABLE IF NOT EXISTS catalogs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      publisher_agent_id TEXT NOT NULL,
      homepage TEXT,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_catalogs_publisher_agent_id
      ON catalogs(publisher_agent_id)`,
    `CREATE TABLE IF NOT EXISTS catalog_records (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      primary_topic_type TEXT NOT NULL,
      primary_topic_id TEXT NOT NULL,
      source_record_id TEXT,
      harvested_from TEXT,
      first_seen TEXT,
      last_seen TEXT,
      source_modified TEXT,
      is_authoritative INTEGER,
      duplicate_of TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_catalog_records_catalog_id
      ON catalog_records(catalog_id)`,
    `CREATE INDEX IF NOT EXISTS idx_catalog_records_primary_topic_id
      ON catalog_records(primary_topic_id)`,
    `CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      creator_agent_id TEXT,
      was_derived_from_json TEXT,
      publisher_agent_id TEXT,
      landing_page TEXT,
      access_rights TEXT,
      license TEXT,
      temporal_coverage_json TEXT,
      keywords_json TEXT,
      themes_json TEXT,
      distribution_ids_json TEXT,
      data_service_ids_json TEXT,
      in_series TEXT,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_datasets_publisher_agent_id
      ON datasets(publisher_agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_datasets_in_series
      ON datasets(in_series)`,
    `CREATE TABLE IF NOT EXISTS distributions (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      description TEXT,
      access_url TEXT,
      access_url_hostname TEXT,
      download_url TEXT,
      download_url_hostname TEXT,
      media_type TEXT,
      format TEXT,
      byte_size REAL,
      checksum TEXT,
      access_rights TEXT,
      license TEXT,
      access_service_id TEXT,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_distributions_dataset_id
      ON distributions(dataset_id)`,
    `CREATE INDEX IF NOT EXISTS idx_distributions_access_service_id
      ON distributions(access_service_id)`,
    `CREATE INDEX IF NOT EXISTS idx_distributions_access_url_hostname
      ON distributions(access_url_hostname)`,
    `CREATE INDEX IF NOT EXISTS idx_distributions_download_url_hostname
      ON distributions(download_url_hostname)`,
    `CREATE TABLE IF NOT EXISTS data_services (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      publisher_agent_id TEXT,
      endpoint_urls_json TEXT NOT NULL,
      endpoint_description TEXT,
      conforms_to TEXT,
      serves_dataset_ids_json TEXT NOT NULL,
      access_rights TEXT,
      license TEXT,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_data_services_publisher_agent_id
      ON data_services(publisher_agent_id)`,
    `CREATE TABLE IF NOT EXISTS dataset_series (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      publisher_agent_id TEXT,
      cadence TEXT NOT NULL,
      aliases_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      deleted_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_dataset_series_publisher_agent_id
      ON dataset_series(publisher_agent_id)`,
    `CREATE TABLE IF NOT EXISTS data_layer_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      entity_kind TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
      operator TEXT NOT NULL,
      before_row TEXT,
      after_row TEXT,
      timestamp TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_data_layer_audit_entity
      ON data_layer_audit(entity_kind, entity_id, timestamp DESC)`
  ]
};

const runRuntimeVariableProfileAlignmentMigration = (
  sql: SqlClient.SqlClient
) =>
  Effect.gen(function* () {
    const hasPolicyInstrument = yield* columnExists(
      sql,
      "variables",
      "policy_instrument"
    );
    if (!hasPolicyInstrument) {
      yield* executeUnsafeStatement(
        sql,
        `ALTER TABLE variables ADD COLUMN policy_instrument TEXT`
      );
    }

    const hasVariableIds = yield* columnExists(
      sql,
      "datasets",
      "variable_ids_json"
    );
    if (!hasVariableIds) {
      yield* executeUnsafeStatement(
        sql,
        `ALTER TABLE datasets ADD COLUMN variable_ids_json TEXT`
      );
    }
  });

const migration23: D1Migration = {
  id: 23,
  name: "runtime_variable_profile_alignment",
  run: runRuntimeVariableProfileAlignmentMigration
};

const runSeriesDatasetAlignmentMigration = (
  sql: SqlClient.SqlClient
) =>
  Effect.gen(function* () {
    const hasSeries = yield* tableExists(sql, "series");
    if (!hasSeries) {
      return;
    }

    const hasDatasetId = yield* columnExists(sql, "series", "dataset_id");
    if (!hasDatasetId) {
      yield* executeUnsafeStatement(
        sql,
        `ALTER TABLE series ADD COLUMN dataset_id TEXT`
      );
    }

    yield* executeUnsafeStatement(
      sql,
      `CREATE INDEX IF NOT EXISTS idx_series_dataset_id
        ON series(dataset_id)`
    );
  });

const migration24: D1Migration = {
  id: 24,
  name: "series_dataset_alignment",
  run: runSeriesDatasetAlignmentMigration
};

const migration25: D1Migration = {
  id: 25,
  name: "data_ref_candidate_citations",
  statements: [
    `CREATE TABLE IF NOT EXISTS data_ref_candidate_citations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_post_uri TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      resolution_state TEXT NOT NULL CHECK (resolution_state IN ('source_only', 'partially_resolved', 'resolved')),
      asserted_value_json TEXT,
      asserted_unit TEXT,
      observation_start TEXT,
      observation_end TEXT,
      observation_label TEXT,
      normalized_observation_start TEXT NOT NULL DEFAULT '',
      normalized_observation_end TEXT NOT NULL DEFAULT '',
      observation_sort_key TEXT NOT NULL DEFAULT '',
      has_observation_time INTEGER NOT NULL DEFAULT 0 CHECK (has_observation_time IN (0, 1)),
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (source_post_uri) REFERENCES posts(uri) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_data_ref_candidate_citations_entity_cursor
      ON data_ref_candidate_citations(
        entity_id,
        has_observation_time DESC,
        observation_sort_key DESC,
        source_post_uri ASC,
        id ASC
      )`,
    `CREATE INDEX IF NOT EXISTS idx_data_ref_candidate_citations_entity_end
      ON data_ref_candidate_citations(
        entity_id,
        normalized_observation_end DESC
      )`,
    `CREATE INDEX IF NOT EXISTS idx_data_ref_candidate_citations_post
      ON data_ref_candidate_citations(source_post_uri)`
  ]
};

export const migrations: ReadonlyArray<D1Migration> = [
  migration1,
  migration2,
  migration3,
  migration4,
  migration5,
  migration6,
  migration7,
  migration8,
  migration9,
  migration10,
  migration11,
  migration12,
  migration13,
  migration14,
  migration15,
  migration16,
  migration17,
  migration18,
  migration19,
  migration20,
  migration21,
  migration22,
  migration23,
  migration24,
  migration25
];
