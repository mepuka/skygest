import type { D1Migration } from "../db/migrations";

const entitySearchDocsTableStatement = `CREATE TABLE IF NOT EXISTS entity_search_docs (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('Agent', 'Dataset', 'Distribution', 'Series', 'Variable')
  ),
  primary_label TEXT NOT NULL,
  secondary_label TEXT,
  publisher_agent_id TEXT,
  agent_id TEXT,
  dataset_id TEXT,
  variable_id TEXT,
  series_id TEXT,
  measured_property TEXT,
  domain_object TEXT,
  technology_or_fuel TEXT,
  statistic_type TEXT,
  aggregation TEXT,
  unit_family TEXT,
  policy_instrument TEXT,
  frequency TEXT,
  place TEXT,
  market TEXT,
  homepage_hostname TEXT,
  landing_page_hostname TEXT,
  access_hostname TEXT,
  download_hostname TEXT,
  canonical_urls_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  primary_text TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  lineage_text TEXT NOT NULL,
  url_text TEXT NOT NULL,
  ontology_text TEXT NOT NULL,
  semantic_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
)`;

const entitySearchDocsIndexStatements = [
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_entity_type
    ON entity_search_docs(entity_type)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_publisher_agent_id
    ON entity_search_docs(publisher_agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_dataset_id
    ON entity_search_docs(dataset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_variable_id
    ON entity_search_docs(variable_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_series_id
    ON entity_search_docs(series_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_homepage_hostname
    ON entity_search_docs(homepage_hostname)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_landing_page_hostname
    ON entity_search_docs(landing_page_hostname)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_access_hostname
    ON entity_search_docs(access_hostname)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_download_hostname
    ON entity_search_docs(download_hostname)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_statistic_type
    ON entity_search_docs(statistic_type)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_search_docs_unit_family
    ON entity_search_docs(unit_family)`
] as const;

const entitySearchFtsStatement = `CREATE VIRTUAL TABLE IF NOT EXISTS entity_search_fts USING fts5(
  entity_id UNINDEXED,
  entity_type UNINDEXED,
  primary_text,
  alias_text,
  lineage_text,
  url_text,
  ontology_text,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '3 4',
  detail = full
)`;

const entitySearchDocUrlsTableStatement = `CREATE TABLE IF NOT EXISTS entity_search_doc_urls (
  entity_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  PRIMARY KEY (entity_id, canonical_url)
)`;

const entitySearchDocUrlsIndexStatement = `CREATE INDEX IF NOT EXISTS idx_entity_search_doc_urls_canonical_url
  ON entity_search_doc_urls(canonical_url)`;

export const entitySearchMigrations: ReadonlyArray<D1Migration> = [
  {
    id: 1,
    name: "entity_search_init",
    statements: [
      entitySearchDocsTableStatement,
      ...entitySearchDocsIndexStatements,
      entitySearchFtsStatement
    ]
  },
  {
    id: 2,
    name: "entity_search_exact_urls",
    statements: [
      entitySearchDocUrlsTableStatement,
      entitySearchDocUrlsIndexStatement
    ]
  }
];
