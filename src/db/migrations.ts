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

export const migrations: ReadonlyArray<D1Migration> = [migration1];
