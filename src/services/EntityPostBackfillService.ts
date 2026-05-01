import {
  Clock,
  Duration,
  Effect,
  Exit,
  Layer,
  Random,
  Schedule,
  Schema,
  ServiceMap
} from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import {
  REINDEX_QUEUE_UPSERT_SET_CLAUSE,
  type D1DatabaseBinding,
  EntityGraphRepo,
  EntitySnapshotStore,
  PostEntity,
  ReindexQueueService,
  asEntityIri,
  asEntityTag,
  expertFromLegacyRow,
  optionalD1Database,
  predicateSpec,
  postFromLegacyRow,
  runD1Batch,
  type LegacyPostRow
} from "@skygest/ontology-store";
import type { DbError } from "../domain/errors";
import { ExpertsRepo } from "./ExpertsRepo";

export interface EntityPostBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityPostBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly authoredByEdges: number;
  readonly failed: number;
  readonly failedUris: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const WRITE_CONCURRENCY = 8;
const ROW_WRITE_RETRY_SCHEDULE = Schedule.exponential(
  Duration.millis(100)
).pipe(Schedule.jittered, Schedule.both(Schedule.recurs(2)));
const BACKFILL_ASSERTED_BY = "EntityPostBackfillService" as const;
const POST_ENTITY_TAG = asEntityTag("Post");
const EXPERT_ENTITY_TAG = asEntityTag("Expert");
const DEFAULT_GRAPH_IRI = "urn:skygest:graph:default";
const COALESCE_WINDOW_MS = 30_000;
const AUTHORED_BY_PREDICATE_IRI = predicateSpec("ei:authoredBy").iri;

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset)
    ? 0
    : Math.max(0, Math.floor(offset));

const PostRow = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  text: Schema.String,
  created_at: Schema.Number
});
type PostRow = typeof PostRow.Type;

const PostCountRow = Schema.Struct({
  total: Schema.Number
});

const decodeSqlError = (cause: unknown, operation: string): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: "Failed to decode posts row",
      operation
    })
  });

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(PostRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "posts.list"))
  );

const decodeCount = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(PostCountRow))(rows).pipe(
    Effect.mapError((cause) => decodeSqlError(cause, "posts.count"))
  );

const toLegacyRow = (row: PostRow): LegacyPostRow => ({
  uri: row.uri,
  did: row.did,
  text: row.text,
  createdAt: row.created_at
});

type PostValue = Schema.Schema.Type<typeof PostEntity.schema>;

interface PreparedPostRow {
  readonly source: PostRow;
  readonly post: PostValue;
  readonly iri: string;
  readonly payloadJson: string;
  readonly authorIri: string | null;
  readonly authoredByTripleHash: string | null;
}

const encodeJsonString = Schema.encodeUnknownEffect(
  Schema.UnknownFromJsonString
);

const encodePostPayload = (
  post: PostValue
): Effect.Effect<string, Schema.SchemaError> =>
  Schema.encodeUnknownEffect(PostEntity.schema)(post).pipe(
    Effect.flatMap((encoded) => encodeJsonString(encoded)),
    Effect.map(String)
  );

const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const hashTriple = (
  subjectIri: string,
  predicateIri: string,
  objectIri: string,
  graphIri: string
): Effect.Effect<string, SqlError> =>
  Effect.tryPromise({
    try: async () => {
      const bytes = new TextEncoder().encode(
        `${subjectIri}\u0000${predicateIri}\u0000${objectIri}\u0000${graphIri}`
      );
      return hex(await crypto.subtle.digest("SHA-256", bytes));
    },
    catch: (cause) => decodeSqlError(cause, "post.authoredBy.tripleHash")
  });

const coalesceKey = (iri: string, now: number): string => {
  const bucket = Math.floor(now / COALESCE_WINDOW_MS);
  return `${POST_ENTITY_TAG}:${iri}:${String(bucket)}`;
};

export class EntityPostBackfillService extends ServiceMap.Service<
  EntityPostBackfillService,
  {
    readonly backfill: (
      input?: EntityPostBackfillInput
    ) => Effect.Effect<EntityPostBackfillResult, SqlError | DbError>;
  }
>()("@skygest/EntityPostBackfillService") {
  static readonly layer = Layer.effect(
    EntityPostBackfillService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const experts = yield* ExpertsRepo;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;
      const entityGraph = yield* EntityGraphRepo;
      const rawDb = yield* optionalD1Database;

      const buildAuthorIriByDid = Effect.fn(
        "EntityPostBackfillService.buildAuthorIriByDid"
      )(function* (rows: ReadonlyArray<PostRow>) {
        const dids = Array.from(new Set(rows.map((row) => row.did)));
        if (dids.length === 0) return new Map<string, string>();
        const expertRecords = yield* experts.getByDids(dids);
        const entries = yield* Effect.forEach(
          expertRecords,
          (expertRecord) => Effect.gen(function* () {
            const expert = yield* expertFromLegacyRow({
              did: expertRecord.did,
              handle: expertRecord.handle,
              displayName: expertRecord.displayName,
              bio: expertRecord.description,
              tier: expertRecord.tier,
              primaryTopic: expertRecord.domain
            }).pipe(
              Effect.mapError((cause) =>
                decodeSqlError(cause, "experts.authorIri")
              )
            );
            return [expertRecord.did, expert.iri] as const;
          }),
          { concurrency: WRITE_CONCURRENCY }
        );
        return new Map(entries);
      });

      const upsertAuthors = Effect.fn(
        "EntityPostBackfillService.upsertAuthors"
      )(function* (authorIriByDid: ReadonlyMap<string, string>) {
        const authorIris = Array.from(new Set(authorIriByDid.values()));
        yield* Effect.forEach(
          authorIris,
          (authorIri) =>
            entityGraph.upsertEntity(asEntityIri(authorIri), EXPERT_ENTITY_TAG),
          { concurrency: WRITE_CONCURRENCY }
        );
      });

      const writeAuthoredByEdge = Effect.fn(
        "EntityPostBackfillService.writeAuthoredByEdge"
      )(function* (
        postIri: ReturnType<typeof asEntityIri>,
        expertIri: ReturnType<typeof asEntityIri>,
        effectiveFrom: number
      ) {
        const link = yield* entityGraph.createLink({
          predicate: "ei:authoredBy",
          subject: { iri: postIri, type: "Post" },
          object: { iri: expertIri, type: "Expert" },
          effectiveFrom
        });
        yield* entityGraph.recordEvidence(link.linkId, {
          assertedBy: BACKFILL_ASSERTED_BY,
          assertionKind: "imported",
          confidence: 1
        });
      });

      const preparePostRow = Effect.fn(
        "EntityPostBackfillService.preparePostRow"
      )(function* (row: PostRow, authorIriByDid: ReadonlyMap<string, string>) {
        const basePost = yield* postFromLegacyRow(toLegacyRow(row));
        const authorIri = authorIriByDid.get(row.did) ?? null;
        const post =
          authorIri === null
            ? basePost
            : yield* Schema.decodeUnknownEffect(PostEntity.schema)({
                ...basePost,
                authoredBy: authorIri
              });
        const payloadJson = yield* encodePostPayload(post);
        const iri = String(post.iri);
        const authoredByTripleHash =
          authorIri === null
            ? null
            : yield* hashTriple(
                iri,
                AUTHORED_BY_PREDICATE_IRI,
                authorIri,
                DEFAULT_GRAPH_IRI
              );
        return {
          source: row,
          post,
          iri,
          payloadJson,
          authorIri,
          authoredByTripleHash
        } satisfies PreparedPostRow;
      });

      const bulkWritePrepared = Effect.fn(
        "EntityPostBackfillService.bulkWritePrepared"
      )(function* (
        db: D1DatabaseBinding,
        preparedRows: ReadonlyArray<PreparedPostRow>,
        authorIriByDid: ReadonlyMap<string, string>
      ) {
        if (preparedRows.length === 0) return;
        const now = yield* Clock.currentTimeMillis;
        const statements = [db.prepare("PRAGMA foreign_keys = ON")];

        const upsertEntityStatement = db.prepare(
          `INSERT INTO entities (iri, entity_type, created_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             updated_at = excluded.updated_at`
        );
        const upsertSnapshotStatement = db.prepare(
          `INSERT INTO entity_snapshots (
             iri,
             entity_type,
             payload_json,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(iri) DO UPDATE SET
             entity_type = excluded.entity_type,
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        );
        const upsertQueueStatement = db.prepare(
          `INSERT INTO reindex_queue (
             queue_id,
             coalesce_key,
             target_entity_type,
             target_iri,
             origin_iri,
             cause,
             cause_priority,
             propagation_depth,
             attempts,
             next_attempt_at,
             enqueued_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(coalesce_key) DO UPDATE SET
           ${REINDEX_QUEUE_UPSERT_SET_CLAUSE}`
        );
        const upsertAuthoredByLinkStatement = db.prepare(
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
           ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?)
           ON CONFLICT(triple_hash) WHERE state = 'active' DO UPDATE SET
             updated_at = excluded.updated_at`
        );
        const insertEvidenceStatement = db.prepare(
          `INSERT INTO entity_link_evidence (
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
           )
           SELECT ?, link_id, ?, ?, ?, NULL, NULL, 'pending', NULL, NULL, ?
           FROM entity_links
           WHERE triple_hash = ?
             AND state = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM entity_link_evidence existing
               WHERE existing.link_id = entity_links.link_id
                 AND existing.asserted_by = ?
                 AND existing.assertion_kind = ?
             )`
        );

        const authorIris = Array.from(new Set(authorIriByDid.values()));
        for (const authorIri of authorIris) {
          statements.push(
            upsertEntityStatement.bind(
              authorIri,
              EXPERT_ENTITY_TAG,
              now,
              now
            )
          );
        }

        for (const row of preparedRows) {
          statements.push(
            upsertEntityStatement.bind(row.iri, POST_ENTITY_TAG, now, now),
            upsertSnapshotStatement.bind(
              row.iri,
              POST_ENTITY_TAG,
              row.payloadJson,
              now,
              now
            ),
            upsertQueueStatement.bind(
              yield* Random.nextUUIDv4,
              coalesceKey(row.iri, now),
              POST_ENTITY_TAG,
              row.iri,
              row.iri,
              "entity-changed",
              0,
              0,
              0,
              now,
              now,
              now
            )
          );
          if (
            row.authorIri !== null &&
            row.authoredByTripleHash !== null
          ) {
            statements.push(
              upsertAuthoredByLinkStatement.bind(
                yield* Random.nextUUIDv4,
                row.authoredByTripleHash,
                row.iri,
                AUTHORED_BY_PREDICATE_IRI,
                row.authorIri,
                DEFAULT_GRAPH_IRI,
                POST_ENTITY_TAG,
                EXPERT_ENTITY_TAG,
                row.post.postedAt,
                now,
                now
              ),
              insertEvidenceStatement.bind(
                yield* Random.nextUUIDv4,
                BACKFILL_ASSERTED_BY,
                "imported",
                1,
                now,
                row.authoredByTripleHash,
                BACKFILL_ASSERTED_BY,
                "imported"
              )
            );
          }
        }

        yield* runD1Batch(
          db,
          statements,
          "EntityPostBackfillService.bulkWritePrepared"
        );
      });

      const backfillWithD1Batch = Effect.fn(
        "EntityPostBackfillService.backfillWithD1Batch"
      )(function* (
        db: D1DatabaseBinding,
        rows: ReadonlyArray<PostRow>,
        authorIriByDid: ReadonlyMap<string, string>
      ) {
        const outcomes = yield* Effect.forEach(
          rows,
          (row) => Effect.exit(preparePostRow(row, authorIriByDid)),
          { concurrency: WRITE_CONCURRENCY }
        );
        const preparedRows = outcomes.flatMap((outcome) =>
          Exit.isSuccess(outcome) ? [outcome.value] : []
        );
        yield* bulkWritePrepared(db, preparedRows, authorIriByDid);
        const failedUris = outcomes.flatMap((outcome, index) =>
          Exit.isSuccess(outcome) ? [] : [rows[index]?.uri ?? "unknown"]
        );
        return {
          migrated: preparedRows.length,
          queued: preparedRows.length,
          authoredByEdges: preparedRows.filter((row) => row.authorIri !== null)
            .length,
          failed: rows.length - preparedRows.length,
          failedUris
        };
      });

      const saveAndQueue = Effect.fn(
        "EntityPostBackfillService.saveAndQueue"
      )(function* (row: PostRow, authorIriByDid: ReadonlyMap<string, string>) {
        const basePost = yield* postFromLegacyRow(toLegacyRow(row));
        const authorIri = authorIriByDid.get(row.did) ?? null;
        const post =
          authorIri === null
            ? basePost
            : yield* Schema.decodeUnknownEffect(PostEntity.schema)({
                ...basePost,
                authoredBy: authorIri
              });
        const iri = asEntityIri(post.iri);
        const now = yield* Clock.currentTimeMillis;

        yield* snapshots.save(PostEntity, post);
        yield* queue.schedule({
          targetEntityType: POST_ENTITY_TAG,
          targetIri: iri,
          originIri: iri,
          cause: "entity-changed",
          causePriority: 0,
          propagationDepth: 0,
          nextAttemptAt: now
        });
        if (authorIri === null) {
          return { authoredByEdges: 0 };
        }
        yield* writeAuthoredByEdge(
          iri,
          asEntityIri(authorIri),
          post.postedAt
        );
        return { authoredByEdges: 1 };
      });

      const backfill = Effect.fn("EntityPostBackfillService.backfill")(
        function* (input?: EntityPostBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);

          const totalRows = yield* sql<{ total: number }>`
            SELECT COUNT(*) as total
            FROM posts
            WHERE status = 'active'
              AND uri LIKE 'at://%'
          `.pipe(Effect.flatMap(decodeCount));
          const total = totalRows[0]?.total ?? 0;

          const rawRows = yield* sql<PostRow>`
            SELECT
              uri as uri,
              did as did,
              text as text,
              created_at as created_at
            FROM posts
            WHERE status = 'active'
              AND uri LIKE 'at://%'
            ORDER BY created_at ASC
            LIMIT ${limit}
            OFFSET ${offset}
          `;
          const rows = yield* decodeRows(rawRows);
          const authorIriByDid = yield* buildAuthorIriByDid(rows);
          const result =
            rawDb === null
              ? yield* Effect.gen(function* () {
                  yield* upsertAuthors(authorIriByDid);
                  const outcomes = yield* Effect.forEach(
                    rows,
                    (row) =>
                      Effect.exit(
                        saveAndQueue(row, authorIriByDid).pipe(
                          Effect.retry({ schedule: ROW_WRITE_RETRY_SCHEDULE })
                        )
                      ),
                    { concurrency: WRITE_CONCURRENCY }
                  );
                  const migrated = outcomes.filter((outcome) =>
                    Exit.isSuccess(outcome)
                  ).length;
                  const authoredByEdges = outcomes.reduce(
                    (total, outcome) =>
                      Exit.isSuccess(outcome)
                        ? total + outcome.value.authoredByEdges
                        : total,
                    0
                  );
                  const failedUris = outcomes.flatMap((outcome, index) =>
                    Exit.isSuccess(outcome)
                      ? []
                      : [rows[index]?.uri ?? "unknown"]
                  );
                  return {
                    migrated,
                    queued: migrated,
                    authoredByEdges,
                    failed: rows.length - migrated,
                    failedUris
                  };
                })
              : yield* backfillWithD1Batch(rawDb, rows, authorIriByDid);

          return {
            total,
            scanned: rows.length,
            ...result
          };
        }
      );

      return EntityPostBackfillService.of({ backfill });
    })
  );
}
