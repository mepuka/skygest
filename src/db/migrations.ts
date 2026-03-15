export type D1Migration = {
  readonly id: number;
  readonly name: string;
  readonly statements: ReadonlyArray<string>;
};

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
  migration11
];
