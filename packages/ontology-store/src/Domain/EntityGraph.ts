import { Schema } from "effect";

import { PredicateIri } from "./EntityDefinition";

export const EntityIri = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("EntityIri")
);
export type EntityIri = typeof EntityIri.Type;
export const asEntityIri = Schema.decodeUnknownSync(EntityIri);

export const EntityTag = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("EntityTag")
);
export type EntityTag = typeof EntityTag.Type;
export const asEntityTag = Schema.decodeUnknownSync(EntityTag);

export const LinkId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("LinkId")
);
export type LinkId = typeof LinkId.Type;

export const TripleHash = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("TripleHash")
);
export type TripleHash = typeof TripleHash.Type;

export const GraphIri = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("GraphIri")
);
export type GraphIri = typeof GraphIri.Type;

export const LinkState = Schema.Literals([
  "active",
  "superseded",
  "retracted",
  "draft"
]);
export type LinkState = typeof LinkState.Type;

export const AssertionKind = Schema.Literals([
  "extracted",
  "curated",
  "inferred",
  "imported"
]);
export type AssertionKind = typeof AssertionKind.Type;

export const ReviewState = Schema.Literals([
  "pending",
  "accepted",
  "rejected",
  "superseded"
]);
export type ReviewState = typeof ReviewState.Type;

export class EntityRecord extends Schema.Class<EntityRecord>("EntityRecord")({
  iri: EntityIri,
  entityType: EntityTag,
  createdAt: Schema.Number,
  updatedAt: Schema.Number
}) {}

export class EntityLink extends Schema.Class<EntityLink>("EntityLink")({
  linkId: LinkId,
  tripleHash: TripleHash,
  subjectIri: EntityIri,
  predicateIri: PredicateIri,
  objectIri: Schema.optionalKey(EntityIri),
  objectValue: Schema.optionalKey(Schema.String),
  objectDatatype: Schema.optionalKey(Schema.String),
  graphIri: GraphIri,
  subjectType: EntityTag,
  objectType: EntityTag,
  state: LinkState,
  effectiveFrom: Schema.Number,
  effectiveUntil: Schema.optionalKey(Schema.Number),
  supersededBy: Schema.optionalKey(LinkId),
  createdAt: Schema.Number,
  updatedAt: Schema.Number
}) {}

export class LinkEvidence extends Schema.Class<LinkEvidence>("LinkEvidence")({
  evidenceId: Schema.String,
  linkId: LinkId,
  assertedBy: Schema.String,
  assertionKind: AssertionKind,
  confidence: Schema.Number,
  evidenceSpan: Schema.optionalKey(Schema.String),
  sourceIri: Schema.optionalKey(EntityIri),
  reviewState: ReviewState,
  reviewer: Schema.optionalKey(Schema.String),
  reviewedAt: Schema.optionalKey(Schema.Number),
  assertedAt: Schema.Number
}) {}

export interface EntityLinkWithEvidence {
  readonly link: EntityLink;
  readonly evidence: ReadonlyArray<LinkEvidence>;
}

export const ReindexCause = Schema.Literals([
  "entity-changed",
  "edge-changed",
  "entity-renamed",
  "rebuild-all"
]);
export type ReindexCause = typeof ReindexCause.Type;

export class ReindexQueueItem extends Schema.Class<ReindexQueueItem>(
  "ReindexQueueItem"
)({
  queueId: Schema.String,
  coalesceKey: Schema.String,
  targetEntityType: EntityTag,
  targetIri: EntityIri,
  originIri: EntityIri,
  cause: ReindexCause,
  causePriority: Schema.Number,
  propagationDepth: Schema.Number,
  attempts: Schema.Number,
  nextAttemptAt: Schema.Number,
  enqueuedAt: Schema.Number,
  updatedAt: Schema.Number
}) {}

export const ENTITY_GRAPH_SCHEMA_STATEMENTS = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS entities (
    iri          TEXT PRIMARY KEY,
    entity_type  TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    UNIQUE (iri, entity_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entities_type
    ON entities(entity_type, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS entity_links (
    link_id          TEXT PRIMARY KEY,
    triple_hash      TEXT NOT NULL,
    subject_iri      TEXT NOT NULL,
    predicate_iri    TEXT NOT NULL,
    object_iri       TEXT,
    object_value     TEXT,
    object_datatype  TEXT,
    graph_iri        TEXT NOT NULL DEFAULT 'urn:skygest:graph:default',
    subject_type     TEXT NOT NULL,
    object_type      TEXT NOT NULL,
    state            TEXT NOT NULL DEFAULT 'active'
                       CHECK (state IN ('active','superseded','retracted','draft')),
    effective_from   INTEGER NOT NULL,
    effective_until  INTEGER,
    superseded_by    TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    CHECK (
      (object_value IS NULL AND object_iri IS NOT NULL) OR
      (object_value IS NOT NULL AND object_iri IS NULL)
    ),
    FOREIGN KEY (subject_iri, subject_type) REFERENCES entities(iri, entity_type),
    FOREIGN KEY (object_iri, object_type) REFERENCES entities(iri, entity_type),
    FOREIGN KEY (superseded_by) REFERENCES entity_links(link_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_out
    ON entity_links(subject_iri, predicate_iri, state, effective_from DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_in
    ON entity_links(object_iri, predicate_iri, state, effective_from DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_pred_time
    ON entity_links(predicate_iri, effective_from DESC, state)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_subject_type
    ON entity_links(subject_type, predicate_iri)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_links_object_type
    ON entity_links(object_type, predicate_iri)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_links_triple_active
    ON entity_links(triple_hash) WHERE state = 'active'`,
  `CREATE TABLE IF NOT EXISTS entity_link_evidence (
    evidence_id      TEXT PRIMARY KEY,
    link_id          TEXT NOT NULL,
    asserted_by      TEXT NOT NULL,
    assertion_kind   TEXT NOT NULL CHECK (assertion_kind IN ('extracted','curated','inferred','imported')),
    confidence       REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    evidence_span    TEXT,
    source_iri       TEXT,
    review_state     TEXT NOT NULL DEFAULT 'pending'
                       CHECK (review_state IN ('pending','accepted','rejected','superseded')),
    reviewer         TEXT,
    reviewed_at      INTEGER,
    asserted_at      INTEGER NOT NULL,
    FOREIGN KEY (link_id) REFERENCES entity_links(link_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_link_review
    ON entity_link_evidence(link_id, review_state, asserted_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_source
    ON entity_link_evidence(source_iri, asserted_at DESC)`
] as const;

export const REINDEX_QUEUE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS reindex_queue (
    queue_id           TEXT PRIMARY KEY,
    coalesce_key       TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    target_iri         TEXT NOT NULL,
    origin_iri         TEXT NOT NULL,
    cause              TEXT NOT NULL CHECK (cause IN ('entity-changed','edge-changed','entity-renamed','rebuild-all')),
    cause_priority     INTEGER NOT NULL DEFAULT 0,
    propagation_depth  INTEGER NOT NULL CHECK (propagation_depth >= 0),
    attempts           INTEGER NOT NULL DEFAULT 0,
    next_attempt_at    INTEGER NOT NULL,
    enqueued_at        INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_reindex_queue_coalesce
    ON reindex_queue(coalesce_key)`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_next
    ON reindex_queue(next_attempt_at) WHERE attempts < 3`,
  `CREATE TABLE IF NOT EXISTS reindex_queue_dlq (
    queue_id           TEXT PRIMARY KEY,
    coalesce_key       TEXT NOT NULL,
    target_entity_type TEXT NOT NULL,
    target_iri         TEXT NOT NULL,
    origin_iri         TEXT NOT NULL,
    cause              TEXT NOT NULL,
    cause_priority     INTEGER NOT NULL,
    propagation_depth  INTEGER NOT NULL,
    attempts           INTEGER NOT NULL,
    next_attempt_at    INTEGER NOT NULL,
    enqueued_at        INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    failed_at          INTEGER NOT NULL,
    failure_message    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reindex_queue_dlq_failed
    ON reindex_queue_dlq(failed_at DESC)`
] as const;

export const ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS = [
  ...ENTITY_GRAPH_SCHEMA_STATEMENTS,
  ...REINDEX_QUEUE_SCHEMA_STATEMENTS
] as const;

export const REINDEX_QUEUE_UPSERT_SET_CLAUSE = `
  propagation_depth = max(reindex_queue.propagation_depth, excluded.propagation_depth),
  cause_priority = max(reindex_queue.cause_priority, excluded.cause_priority),
  cause = CASE
    WHEN excluded.cause_priority >= reindex_queue.cause_priority THEN excluded.cause
    ELSE reindex_queue.cause
  END,
  next_attempt_at = min(reindex_queue.next_attempt_at, excluded.next_attempt_at),
  attempts = 0,
  updated_at = excluded.updated_at
`;
