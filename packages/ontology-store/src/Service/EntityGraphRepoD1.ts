import { D1Client } from "@effect/sql-d1";
import { Clock, Effect, Layer, Option, Random, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";

import {
  EntityGraphEndpointNotFoundError,
  EntityGraphLinkInvalidError,
  EntityGraphLinkNotFoundError,
  EntityGraphTraversalLimitError,
  EntityGraphTypeMismatchError,
  EntityNotFoundError
} from "../Domain/Errors";
import {
  EntityIri,
  EntityLink,
  EntityRecord,
  EntityTag,
  GraphIri,
  LinkEvidence,
  LinkId,
  TripleHash,
  asEntityIri,
  type EntityLinkWithEvidence
} from "../Domain/EntityGraph";
import { PredicateIri } from "../Domain/EntityDefinition";
import {
  isPredicateTypeAllowed,
  predicateSpec,
  type PredicateName,
  type TypedLinkInput
} from "../Domain/PredicateRegistry";
import {
  EntityGraphRepo,
  type LinkQueryOptions,
  type NewLinkEvidence,
  type TraversalPattern
} from "./EntityGraphRepo";

const DEFAULT_GRAPH_IRI = Schema.decodeUnknownSync(GraphIri)(
  "urn:skygest:graph:default"
);

type D1DatabaseBinding = D1Client.D1Client["config"]["db"];
type D1PreparedStatementBinding = ReturnType<D1DatabaseBinding["prepare"]>;

const EntityRecordRow = Schema.Struct({
  iri: Schema.String,
  entity_type: Schema.String,
  created_at: Schema.Number,
  updated_at: Schema.Number
});
type EntityRecordRow = typeof EntityRecordRow.Type;

const EntityLinkRow = Schema.Struct({
  link_id: Schema.String,
  triple_hash: Schema.String,
  subject_iri: Schema.String,
  predicate_iri: Schema.String,
  object_iri: Schema.NullOr(Schema.String),
  object_value: Schema.NullOr(Schema.String),
  object_datatype: Schema.NullOr(Schema.String),
  graph_iri: Schema.String,
  subject_type: Schema.String,
  object_type: Schema.String,
  state: Schema.String,
  effective_from: Schema.Number,
  effective_until: Schema.NullOr(Schema.Number),
  superseded_by: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
  updated_at: Schema.Number
});
type EntityLinkRow = typeof EntityLinkRow.Type;

const LinkEvidenceRow = Schema.Struct({
  evidence_id: Schema.String,
  link_id: Schema.String,
  asserted_by: Schema.String,
  assertion_kind: Schema.String,
  confidence: Schema.Number,
  evidence_span: Schema.NullOr(Schema.String),
  source_iri: Schema.NullOr(Schema.String),
  review_state: Schema.String,
  reviewer: Schema.NullOr(Schema.String),
  reviewed_at: Schema.NullOr(Schema.Number),
  asserted_at: Schema.Number
});
type LinkEvidenceRow = typeof LinkEvidenceRow.Type;

const EntityLinkWithEvidenceRow = Schema.Struct({
  link_id: Schema.String,
  triple_hash: Schema.String,
  subject_iri: Schema.String,
  predicate_iri: Schema.String,
  object_iri: Schema.NullOr(Schema.String),
  object_value: Schema.NullOr(Schema.String),
  object_datatype: Schema.NullOr(Schema.String),
  graph_iri: Schema.String,
  subject_type: Schema.String,
  object_type: Schema.String,
  state: Schema.String,
  effective_from: Schema.Number,
  effective_until: Schema.NullOr(Schema.Number),
  superseded_by: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
  updated_at: Schema.Number,
  evidence_id: Schema.NullOr(Schema.String),
  asserted_by: Schema.NullOr(Schema.String),
  assertion_kind: Schema.NullOr(Schema.String),
  confidence: Schema.NullOr(Schema.Number),
  evidence_span: Schema.NullOr(Schema.String),
  source_iri: Schema.NullOr(Schema.String),
  review_state: Schema.NullOr(Schema.String),
  reviewer: Schema.NullOr(Schema.String),
  reviewed_at: Schema.NullOr(Schema.Number),
  asserted_at: Schema.NullOr(Schema.Number)
});
type EntityLinkWithEvidenceRow = typeof EntityLinkWithEvidenceRow.Type;

const decodeSqlError = (cause: unknown, operation: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: `Failed to decode ${operation}`,
      operation
    })
  });

const decodeEntityRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(EntityRecordRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "entity registry rows"))
  );
const decodeLinkRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(EntityLinkRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "entity link rows"))
  );
const decodeEvidenceRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(LinkEvidenceRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "entity link evidence rows"))
  );
const decodeLinkWithEvidenceRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(EntityLinkWithEvidenceRow))(rows).pipe(
    Effect.mapError((cause) =>
      decodeSqlError(cause, "entity link evidence join rows")
    )
  );

const entityRecordFromRow = (row: EntityRecordRow): EntityRecord =>
  Schema.decodeUnknownSync(EntityRecord)({
    iri: Schema.decodeUnknownSync(EntityIri)(row.iri),
    entityType: Schema.decodeUnknownSync(EntityTag)(row.entity_type),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });

const entityLinkFromRow = (row: EntityLinkRow): EntityLink => {
  const candidate: Record<string, unknown> = {
    linkId: row.link_id,
    tripleHash: row.triple_hash,
    subjectIri: row.subject_iri,
    predicateIri: row.predicate_iri,
    graphIri: row.graph_iri,
    subjectType: row.subject_type,
    objectType: row.object_type,
    state: row.state,
    effectiveFrom: row.effective_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.object_iri !== null) candidate.objectIri = row.object_iri;
  if (row.object_value !== null) candidate.objectValue = row.object_value;
  if (row.object_datatype !== null) candidate.objectDatatype = row.object_datatype;
  if (row.effective_until !== null) candidate.effectiveUntil = row.effective_until;
  if (row.superseded_by !== null) candidate.supersededBy = row.superseded_by;
  return Schema.decodeUnknownSync(EntityLink)(candidate);
};

const evidenceFromRow = (row: LinkEvidenceRow): LinkEvidence => {
  const candidate: Record<string, unknown> = {
    evidenceId: row.evidence_id,
    linkId: row.link_id,
    assertedBy: row.asserted_by,
    assertionKind: row.assertion_kind,
    confidence: row.confidence,
    reviewState: row.review_state,
    assertedAt: row.asserted_at
  };
  if (row.evidence_span !== null) candidate.evidenceSpan = row.evidence_span;
  if (row.source_iri !== null) candidate.sourceIri = row.source_iri;
  if (row.reviewer !== null) candidate.reviewer = row.reviewer;
  if (row.reviewed_at !== null) candidate.reviewedAt = row.reviewed_at;
  return Schema.decodeUnknownSync(LinkEvidence)(candidate);
};

const evidenceFromJoinedRow = (
  row: EntityLinkWithEvidenceRow
): LinkEvidence | null => {
  if (
    row.evidence_id === null ||
    row.asserted_by === null ||
    row.assertion_kind === null ||
    row.confidence === null ||
    row.review_state === null ||
    row.asserted_at === null
  ) {
    return null;
  }
  return evidenceFromRow({
    evidence_id: row.evidence_id,
    link_id: row.link_id,
    asserted_by: row.asserted_by,
    assertion_kind: row.assertion_kind,
    confidence: row.confidence,
    evidence_span: row.evidence_span,
    source_iri: row.source_iri,
    review_state: row.review_state,
    reviewer: row.reviewer,
    reviewed_at: row.reviewed_at,
    asserted_at: row.asserted_at
  });
};

const linksWithEvidenceFromRows = (
  rows: ReadonlyArray<EntityLinkWithEvidenceRow>
): ReadonlyArray<EntityLinkWithEvidence> => {
  const byLinkId = new Map<string, EntityLinkWithEvidence>();
  for (const row of rows) {
    const existing = byLinkId.get(row.link_id);
    const current =
      existing ??
      ({
        link: entityLinkFromRow(row),
        evidence: []
      } satisfies EntityLinkWithEvidence);
    const evidence = evidenceFromJoinedRow(row);
    if (evidence !== null) {
      (current.evidence as Array<LinkEvidence>).push(evidence);
    }
    byLinkId.set(row.link_id, current);
  }
  return [...byLinkId.values()];
};

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashTriple = (
  subjectIri: string,
  predicateIri: string,
  objectIri: string,
  graphIri: string
): Effect.Effect<TripleHash> =>
  Effect.promise(async () => {
    const bytes = new TextEncoder().encode(
      `${subjectIri}\u0000${predicateIri}\u0000${objectIri}\u0000${graphIri}`
    );
    return Schema.decodeUnknownSync(TripleHash)(
      hex(await crypto.subtle.digest("SHA-256", bytes))
    );
  });

const firstEntity = (
  rows: ReadonlyArray<EntityRecordRow>,
  iri: EntityIri
): Effect.Effect<EntityRecord, EntityNotFoundError> =>
  Effect.gen(function* () {
    const row = rows[0];
    if (row === undefined) {
      return yield* new EntityNotFoundError({ iri });
    }
    return entityRecordFromRow(row);
  });

const firstLink = (
  rows: ReadonlyArray<EntityLinkRow>,
  linkId: LinkId
): Effect.Effect<EntityLink, EntityGraphLinkNotFoundError> =>
  Effect.gen(function* () {
    const row = rows[0];
    if (row === undefined) {
      return yield* new EntityGraphLinkNotFoundError({ linkId });
    }
    return entityLinkFromRow(row);
  });

const validateEndpoint = (
  record: EntityRecord,
  expected: string,
  position: "subject" | "object"
) =>
  Effect.gen(function* () {
    if (record.entityType === expected) return;
    return yield* new EntityGraphTypeMismatchError({
      iri: record.iri,
      expected,
      actual: record.entityType,
      position
    });
  });

const linkPredicateMatches = (opts: LinkQueryOptions | undefined, link: EntityLink) =>
  opts?.predicate === undefined || link.predicateIri === opts.predicate;

const linkAsOfMatches = (opts: LinkQueryOptions | undefined, link: EntityLink) =>
  opts?.asOf === undefined ||
  (link.effectiveFrom <= opts.asOf &&
    (link.effectiveUntil === undefined || link.effectiveUntil > opts.asOf));

const d1BatchSqlError = (cause: unknown, operation: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: `Failed to execute D1 batch for ${operation}`,
      operation
    })
  });

const runD1Batch = (
  db: D1DatabaseBinding,
  statements: ReadonlyArray<D1PreparedStatementBinding>,
  operation: string
): Effect.Effect<void, SqlError> =>
  Effect.tryPromise({
    try: () => db.batch(Array.from(statements)),
    catch: (cause) => d1BatchSqlError(cause, operation)
  }).pipe(Effect.asVoid);

export const EntityGraphRepoD1 = {
  layer: Layer.effect(
    EntityGraphRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const d1Client = yield* Effect.serviceOption(D1Client.D1Client);
      const rawDb = Option.match(d1Client, {
        onNone: () => null,
        onSome: (client) => client.config.db
      });

      yield* sql`${sql.unsafe("PRAGMA foreign_keys = ON")}`.pipe(
        Effect.asVoid
      );

      const lookupEntity = (iri: EntityIri) =>
        sql<EntityRecordRow>`
          SELECT
            iri as iri,
            entity_type as entity_type,
            created_at as created_at,
            updated_at as updated_at
          FROM entities
          WHERE iri = ${iri}
          LIMIT 1
        `.pipe(
          Effect.flatMap(decodeEntityRows),
          Effect.flatMap((rows) => firstEntity(rows, iri))
        );

      const selectLinkById = (linkId: LinkId) =>
        sql<EntityLinkRow>`
          SELECT
            link_id as link_id,
            triple_hash as triple_hash,
            subject_iri as subject_iri,
            predicate_iri as predicate_iri,
            object_iri as object_iri,
            object_value as object_value,
            object_datatype as object_datatype,
            graph_iri as graph_iri,
            subject_type as subject_type,
            object_type as object_type,
            state as state,
            effective_from as effective_from,
            effective_until as effective_until,
            superseded_by as superseded_by,
            created_at as created_at,
            updated_at as updated_at
          FROM entity_links
          WHERE link_id = ${linkId}
          LIMIT 1
        `.pipe(
          Effect.flatMap(decodeLinkRows),
          Effect.flatMap((rows) => firstLink(rows, linkId))
        );

      const upsertEntity = (iri: EntityIri, entityType: EntityTag) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* sql`
            INSERT INTO entities (iri, entity_type, created_at, updated_at)
            VALUES (${iri}, ${entityType}, ${now}, ${now})
            ON CONFLICT(iri) DO UPDATE SET
              entity_type = excluded.entity_type,
              updated_at = excluded.updated_at
          `.pipe(Effect.asVoid);
          return Schema.decodeUnknownSync(EntityRecord)({
            iri,
            entityType,
            createdAt: now,
            updatedAt: now
          });
        });

      const listEntities = (filter?: {
        readonly entityType?: EntityTag;
        readonly limit?: number;
        readonly cursor?: string;
      }) =>
        sql<EntityRecordRow>`
          SELECT
            iri as iri,
            entity_type as entity_type,
            created_at as created_at,
            updated_at as updated_at
          FROM entities
          WHERE (${filter?.entityType ?? null} IS NULL OR entity_type = ${filter?.entityType ?? null})
            AND (${filter?.cursor ?? null} IS NULL OR iri > ${filter?.cursor ?? null})
          ORDER BY iri ASC
          LIMIT ${filter?.limit ?? 100}
        `.pipe(
          Effect.flatMap(decodeEntityRows),
          Effect.map((rows) => {
            const records = rows.map(entityRecordFromRow);
            const last = records[records.length - 1];
            return last === undefined
              ? { records }
              : { records, nextCursor: last.iri };
          })
        );

      const requireEndpoint = (
        endpoint: { readonly iri: string; readonly type: string },
        position: "subject" | "object"
      ) =>
        lookupEntity(asEntityIri(endpoint.iri)).pipe(
          Effect.catchTag("EntityNotFoundError", () =>
            Effect.gen(function* () {
              return yield* new EntityGraphEndpointNotFoundError({
                iri: endpoint.iri,
                entityType: endpoint.type,
                position
              });
            })
          ),
          Effect.flatMap((record) => validateEndpoint(record, endpoint.type, position))
        );

      const insertLink = <P extends PredicateName>(
        input: TypedLinkInput<P>,
        state: "active" | "draft",
        linkId: LinkId,
        tripleHash: TripleHash,
        now: number
      ) => {
        const spec = predicateSpec(input.predicate);
        return sql`
          INSERT INTO entity_links (
            link_id,
            triple_hash,
            subject_iri,
            predicate_iri,
            object_iri,
            object_value,
            object_datatype,
            graph_iri,
            subject_type,
            object_type,
            state,
            effective_from,
            effective_until,
            superseded_by,
            created_at,
            updated_at
          ) VALUES (
            ${linkId},
            ${tripleHash},
            ${input.subject.iri},
            ${spec.iri},
            ${input.object.iri},
            NULL,
            NULL,
            ${DEFAULT_GRAPH_IRI},
            ${input.subject.type},
            ${input.object.type},
            ${state},
            ${input.effectiveFrom},
            NULL,
            NULL,
            ${now},
            ${now}
          )
          ON CONFLICT(triple_hash) WHERE state = 'active' DO UPDATE SET
            updated_at = excluded.updated_at
        `.pipe(Effect.asVoid);
      };

      const createLink = <P extends PredicateName>(input: TypedLinkInput<P>) =>
        Effect.gen(function* () {
          if (!isPredicateTypeAllowed(input.predicate, input.subject.type, input.object.type)) {
            return yield* new EntityGraphLinkInvalidError({
              predicate: input.predicate,
              subjectType: input.subject.type,
              objectType: input.object.type,
              message: "predicate does not allow subject/object type combination"
            });
          }
          yield* requireEndpoint(input.subject, "subject");
          yield* requireEndpoint(input.object, "object");
          const now = yield* Clock.currentTimeMillis;
          const linkId = Schema.decodeUnknownSync(LinkId)(
            yield* Random.nextUUIDv4
          );
          const spec = predicateSpec(input.predicate);
          const tripleHash = yield* hashTriple(
            input.subject.iri,
            spec.iri,
            input.object.iri,
            DEFAULT_GRAPH_IRI
          );
          yield* insertLink(input, "active", linkId, tripleHash, now);
          const rows = yield* sql<EntityLinkRow>`
            SELECT
              link_id as link_id,
              triple_hash as triple_hash,
              subject_iri as subject_iri,
              predicate_iri as predicate_iri,
              object_iri as object_iri,
              object_value as object_value,
              object_datatype as object_datatype,
              graph_iri as graph_iri,
              subject_type as subject_type,
              object_type as object_type,
              state as state,
              effective_from as effective_from,
              effective_until as effective_until,
              superseded_by as superseded_by,
              created_at as created_at,
              updated_at as updated_at
            FROM entity_links
            WHERE triple_hash = ${tripleHash}
              AND state = 'active'
            LIMIT 1
          `.pipe(Effect.flatMap(decodeLinkRows));
          const row = rows[0];
          if (row === undefined) {
            return yield* new EntityGraphLinkInvalidError({
              predicate: input.predicate,
              subjectType: input.subject.type,
              objectType: input.object.type,
              message: "created link could not be read back"
            });
          }
          return entityLinkFromRow(row);
        });

      const recordEvidence = (linkId: LinkId, evidence: NewLinkEvidence) =>
        Effect.gen(function* () {
          yield* selectLinkById(linkId);
          const assertedAt = yield* Clock.currentTimeMillis;
          const evidenceId = yield* Random.nextUUIDv4;
          yield* sql`
            INSERT INTO entity_link_evidence (
              evidence_id,
              link_id,
              asserted_by,
              assertion_kind,
              confidence,
              evidence_span,
              source_iri,
              review_state,
              reviewer,
              reviewed_at,
              asserted_at
            ) VALUES (
              ${evidenceId},
              ${linkId},
              ${evidence.assertedBy},
              ${evidence.assertionKind},
              ${evidence.confidence},
              ${evidence.evidenceSpan ?? null},
              ${evidence.sourceIri ?? null},
              'pending',
              NULL,
              NULL,
              ${assertedAt}
            )
          `.pipe(Effect.asVoid);
          const rows = yield* sql<LinkEvidenceRow>`
            SELECT
              evidence_id as evidence_id,
              link_id as link_id,
              asserted_by as asserted_by,
              assertion_kind as assertion_kind,
              confidence as confidence,
              evidence_span as evidence_span,
              source_iri as source_iri,
              review_state as review_state,
              reviewer as reviewer,
              reviewed_at as reviewed_at,
              asserted_at as asserted_at
            FROM entity_link_evidence
            WHERE evidence_id = ${evidenceId}
            LIMIT 1
          `.pipe(Effect.flatMap(decodeEvidenceRows));
          const row = rows[0];
          if (row === undefined) {
            return yield* new EntityGraphLinkNotFoundError({ linkId });
          }
          return evidenceFromRow(row);
        });

      const retractLink = (linkId: LinkId, _reason: string) =>
        Effect.gen(function* () {
          yield* selectLinkById(linkId);
          const now = yield* Clock.currentTimeMillis;
          yield* sql`
            UPDATE entity_links
            SET state = 'retracted',
              effective_until = COALESCE(effective_until, ${now}),
              updated_at = ${now}
            WHERE link_id = ${linkId}
          `.pipe(Effect.asVoid);
          return true;
        });

      const supersede = (
        oldId: LinkId,
        replacement: TypedLinkInput<PredicateName>
      ) =>
        Effect.gen(function* () {
          yield* selectLinkById(oldId);
          if (
            !isPredicateTypeAllowed(
              replacement.predicate,
              replacement.subject.type,
              replacement.object.type
            )
          ) {
            return yield* new EntityGraphLinkInvalidError({
              predicate: replacement.predicate,
              subjectType: replacement.subject.type,
              objectType: replacement.object.type,
              message: "predicate does not allow subject/object type combination"
            });
          }
          yield* requireEndpoint(replacement.subject, "subject");
          yield* requireEndpoint(replacement.object, "object");
          const now = yield* Clock.currentTimeMillis;
          const replacementId = Schema.decodeUnknownSync(LinkId)(
            yield* Random.nextUUIDv4
          );
          const spec = predicateSpec(replacement.predicate);
          const replacementTripleHash = yield* hashTriple(
            replacement.subject.iri,
            spec.iri,
            replacement.object.iri,
            DEFAULT_GRAPH_IRI
          );
          if (rawDb !== null) {
            yield* runD1Batch(
              rawDb,
              [
                rawDb.prepare(
                  `INSERT INTO entity_links (
                    link_id,
                    triple_hash,
                    subject_iri,
                    predicate_iri,
                    object_iri,
                    object_value,
                    object_datatype,
                    graph_iri,
                    subject_type,
                    object_type,
                    state,
                    effective_from,
                    effective_until,
                    superseded_by,
                    created_at,
                    updated_at
                  ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'draft', ?, NULL, NULL, ?, ?)`
                ).bind(
                  replacementId,
                  replacementTripleHash,
                  replacement.subject.iri,
                  spec.iri,
                  replacement.object.iri,
                  DEFAULT_GRAPH_IRI,
                  replacement.subject.type,
                  replacement.object.type,
                  replacement.effectiveFrom,
                  now,
                  now
                ),
                rawDb.prepare(
                  `UPDATE entity_links
                   SET state = 'superseded',
                     effective_until = ?,
                     superseded_by = ?,
                     updated_at = ?
                   WHERE link_id = ?`
                ).bind(
                  replacement.effectiveFrom,
                  replacementId,
                  now,
                  oldId
                ),
                rawDb.prepare(
                  `UPDATE entity_links
                   SET state = 'active',
                     updated_at = ?
                   WHERE link_id = ?`
                ).bind(now, replacementId)
              ],
              "EntityGraphRepoD1.supersede"
            );
          } else {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* insertLink(
                  replacement,
                  "draft",
                  replacementId,
                  replacementTripleHash,
                  now
                );
                yield* sql`
                  UPDATE entity_links
                  SET state = 'superseded',
                    effective_until = ${replacement.effectiveFrom},
                    superseded_by = ${replacementId},
                    updated_at = ${now}
                  WHERE link_id = ${oldId}
                `.pipe(Effect.asVoid);
                yield* sql`
                  UPDATE entity_links
                  SET state = 'active',
                    updated_at = ${now}
                  WHERE link_id = ${replacementId}
                `.pipe(Effect.asVoid);
              })
            );
          }
          return yield* selectLinkById(replacementId);
        });

      const linksFor = (
        column: "subject_iri" | "object_iri",
        iri: EntityIri,
        opts?: LinkQueryOptions
      ) =>
        Effect.gen(function* () {
          const loaded = yield* sql<EntityLinkWithEvidenceRow>`
            WITH selected_links AS (
              SELECT
                link_id,
                triple_hash,
                subject_iri,
                predicate_iri,
                object_iri,
                object_value,
                object_datatype,
                graph_iri,
                subject_type,
                object_type,
                state,
                effective_from,
                effective_until,
                superseded_by,
                created_at,
                updated_at
              FROM entity_links
              WHERE ${sql.unsafe(column)} = ${iri}
                AND state = ${opts?.state ?? "active"}
              ORDER BY effective_from DESC
              LIMIT ${opts?.limit ?? 100}
            )
            SELECT
              l.link_id as link_id,
              l.triple_hash as triple_hash,
              l.subject_iri as subject_iri,
              l.predicate_iri as predicate_iri,
              l.object_iri as object_iri,
              l.object_value as object_value,
              l.object_datatype as object_datatype,
              l.graph_iri as graph_iri,
              l.subject_type as subject_type,
              l.object_type as object_type,
              l.state as state,
              l.effective_from as effective_from,
              l.effective_until as effective_until,
              l.superseded_by as superseded_by,
              l.created_at as created_at,
              l.updated_at as updated_at,
              e.evidence_id as evidence_id,
              e.asserted_by as asserted_by,
              e.assertion_kind as assertion_kind,
              e.confidence as confidence,
              e.evidence_span as evidence_span,
              e.source_iri as source_iri,
              e.review_state as review_state,
              e.reviewer as reviewer,
              e.reviewed_at as reviewed_at,
              e.asserted_at as asserted_at
            FROM selected_links l
            LEFT JOIN entity_link_evidence e
              ON e.link_id = l.link_id
            ORDER BY l.effective_from DESC, e.asserted_at DESC
          `.pipe(Effect.flatMap(decodeLinkWithEvidenceRows));

          const withEvidence = linksWithEvidenceFromRows(loaded)
            .filter((item) => linkPredicateMatches(opts, item.link))
            .filter((item) => linkAsOfMatches(opts, item.link));
          return opts?.minConfidence === undefined
            ? withEvidence
            : withEvidence.filter((item) =>
                item.evidence.some(
                  (evidence) => evidence.confidence >= opts.minConfidence!
                )
              );
        });

      const linksOut = (subject: EntityIri, opts?: LinkQueryOptions) =>
        linksFor("subject_iri", subject, opts);

      const linksIn = (object: EntityIri, opts?: LinkQueryOptions) =>
        linksFor("object_iri", object, opts);

      const neighbors = (
        iri: EntityIri,
        predicate?: PredicateIri,
        opts?: LinkQueryOptions
      ) =>
        Effect.gen(function* () {
          const queryOpts =
            predicate === undefined ? opts : { ...opts, predicate };
          const [out, inbound] = yield* Effect.all([
            linksOut(iri, queryOpts),
            linksIn(iri, queryOpts)
          ]);
          return [...out, ...inbound].map((item) => item.link);
        });

      const traverse = (seed: EntityIri, pattern: TraversalPattern) =>
        Effect.gen(function* () {
          const seen = new Set<string>([seed]);
          const links = new Map<string, EntityLink>();
          let frontier: ReadonlyArray<EntityIri> = [seed];
          for (let depth = 0; depth < pattern.maxDepth; depth++) {
            const next: EntityIri[] = [];
            for (const iri of frontier) {
              const currentLinks = yield* neighbors(iri);
              for (const link of currentLinks) {
                if (
                  pattern.predicates !== undefined &&
                  !pattern.predicates.includes(link.predicateIri)
                ) {
                  continue;
                }
                links.set(link.linkId, link);
                for (const candidate of [link.subjectIri, link.objectIri]) {
                  if (candidate !== undefined && !seen.has(candidate)) {
                    seen.add(candidate);
                    if (seen.size > pattern.maxNodes) {
                      return yield* new EntityGraphTraversalLimitError({
                        iri: seed,
                        maxDepth: pattern.maxDepth,
                        maxNodes: pattern.maxNodes
                      });
                    }
                    next.push(candidate);
                  }
                }
              }
            }
            frontier = next;
            if (frontier.length === 0) break;
          }
          return { seed, links: [...links.values()] };
        });

      return EntityGraphRepo.of({
        upsertEntity,
        lookupEntity,
        listEntities,
        createLink,
        recordEvidence,
        retractLink,
        supersede,
        linksOut,
        linksIn,
        neighbors,
        traverse
      });
    })
  )
};
