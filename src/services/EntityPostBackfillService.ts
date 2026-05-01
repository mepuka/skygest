import { Clock, Effect, Exit, Layer, Schema, ServiceMap } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import {
  EntityGraphRepo,
  EntitySnapshotStore,
  PostEntity,
  ReindexQueueService,
  asEntityIri,
  asEntityTag,
  expertFromLegacyRow,
  postFromLegacyRow,
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
const BACKFILL_ASSERTED_BY = "EntityPostBackfillService" as const;
const POST_ENTITY_TAG = asEntityTag("Post");
const EXPERT_ENTITY_TAG = asEntityTag("Expert");

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

      const resolveAuthorIri = Effect.fn(
        "EntityPostBackfillService.resolveAuthorIri"
      )(function* (did: string) {
        const expertRecord = yield* experts.getByDid(did);
        if (expertRecord === null) return null;
        const expert = yield* expertFromLegacyRow({
          did: expertRecord.did,
          handle: expertRecord.handle,
          displayName: expertRecord.displayName,
          bio: expertRecord.description,
          tier: expertRecord.tier,
          primaryTopic: expertRecord.domain
        });
        return expert.iri;
      });

      const writeAuthoredByEdge = Effect.fn(
        "EntityPostBackfillService.writeAuthoredByEdge"
      )(function* (
        postIri: ReturnType<typeof asEntityIri>,
        expertIri: ReturnType<typeof asEntityIri>,
        effectiveFrom: number
      ) {
        yield* entityGraph.upsertEntity(expertIri, EXPERT_ENTITY_TAG);
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

      const saveAndQueue = Effect.fn(
        "EntityPostBackfillService.saveAndQueue"
      )(function* (row: PostRow) {
        const basePost = yield* postFromLegacyRow(toLegacyRow(row));
        const authorIri = yield* resolveAuthorIri(row.did);
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

          const outcomes = yield* Effect.forEach(
            rows,
            (row) => Effect.exit(saveAndQueue(row)),
            { concurrency: 1 }
          );
          const migrated = outcomes.filter((outcome) => Exit.isSuccess(outcome))
            .length;
          const authoredByEdges = outcomes.reduce(
            (total, outcome) =>
              Exit.isSuccess(outcome)
                ? total + outcome.value.authoredByEdges
                : total,
            0
          );
          const failedUris = outcomes.flatMap((outcome, index) =>
            Exit.isSuccess(outcome) ? [] : [rows[index]?.uri ?? "unknown"]
          );

          return {
            total,
            scanned: rows.length,
            migrated,
            queued: migrated,
            authoredByEdges,
            failed: rows.length - migrated,
            failedUris
          };
        }
      );

      return EntityPostBackfillService.of({ backfill });
    })
  );
}
