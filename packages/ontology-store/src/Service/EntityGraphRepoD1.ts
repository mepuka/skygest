import { Clock, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

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

const decodeEntityRows = (rows: unknown) =>
  Effect.sync(() => Schema.decodeUnknownSync(Schema.Array(EntityRecordRow))(rows));
const decodeLinkRows = (rows: unknown) =>
  Effect.sync(() => Schema.decodeUnknownSync(Schema.Array(EntityLinkRow))(rows));
const decodeEvidenceRows = (rows: unknown) =>
  Effect.sync(() =>
    Schema.decodeUnknownSync(Schema.Array(LinkEvidenceRow))(rows)
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

const randomId = (): string => crypto.randomUUID();

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
  record.entityType === expected
    ? Effect.void
    : Effect.fail(
        new EntityGraphTypeMismatchError({
          iri: record.iri,
          expected,
          actual: record.entityType,
          position
        })
      );

const linkPredicateMatches = (opts: LinkQueryOptions | undefined, link: EntityLink) =>
  opts?.predicate === undefined || link.predicateIri === opts.predicate;

const linkAsOfMatches = (opts: LinkQueryOptions | undefined, link: EntityLink) =>
  opts?.asOf === undefined ||
  (link.effectiveFrom <= opts.asOf &&
    (link.effectiveUntil === undefined || link.effectiveUntil > opts.asOf));

export const EntityGraphRepoD1 = {
  layer: Layer.effect(
    EntityGraphRepo,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

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

      const evidenceForLink = (linkId: LinkId) =>
        sql<LinkEvidenceRow>`
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
          WHERE link_id = ${linkId}
          ORDER BY asserted_at DESC
        `.pipe(
          Effect.flatMap(decodeEvidenceRows),
          Effect.map((rows) => rows.map(evidenceFromRow))
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
            Effect.fail(
              new EntityGraphEndpointNotFoundError({
                iri: endpoint.iri,
                entityType: endpoint.type,
                position
              })
            )
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
          const linkId = Schema.decodeUnknownSync(LinkId)(randomId());
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
          const evidenceId = randomId();
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
          const old = yield* selectLinkById(oldId);
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
          const replacementId = Schema.decodeUnknownSync(LinkId)(randomId());
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* insertLink(
                replacement,
                "draft",
                replacementId,
                old.tripleHash,
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
          return yield* selectLinkById(replacementId);
        });

      const linksFor = (
        column: "subject_iri" | "object_iri",
        iri: EntityIri,
        opts?: LinkQueryOptions
      ) =>
        Effect.gen(function* () {
          const loaded = yield* sql<EntityLinkRow>`
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
            WHERE ${sql.unsafe(column)} = ${iri}
              AND state = ${opts?.state ?? "active"}
            ORDER BY effective_from DESC
            LIMIT ${opts?.limit ?? 100}
          `.pipe(Effect.flatMap(decodeLinkRows));

          const links = loaded
            .map(entityLinkFromRow)
            .filter((link) => linkPredicateMatches(opts, link))
            .filter((link) => linkAsOfMatches(opts, link));
          const withEvidence = yield* Effect.forEach(links, (link) =>
            evidenceForLink(link.linkId).pipe(
              Effect.map((evidence): EntityLinkWithEvidence => ({ link, evidence }))
            )
          );
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
