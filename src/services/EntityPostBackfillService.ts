import { Clock, Effect, Exit, Layer, Schema, ServiceMap } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import {
  EntitySnapshotStore,
  PostEntity,
  ReindexQueueService,
  asEntityIri,
  asEntityTag,
  postFromLegacyRow,
  type LegacyPostRow
} from "@skygest/ontology-store";

export interface EntityPostBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityPostBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly failed: number;
  readonly failedUris: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const POST_ENTITY_TAG = asEntityTag("Post");

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
    ) => Effect.Effect<EntityPostBackfillResult, SqlError>;
  }
>()("@skygest/EntityPostBackfillService") {
  static readonly layer = Layer.effect(
    EntityPostBackfillService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const saveAndQueue = Effect.fn(
        "EntityPostBackfillService.saveAndQueue"
      )(function* (row: PostRow) {
        const post = yield* postFromLegacyRow(toLegacyRow(row));
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
      });

      const backfill = Effect.fn("EntityPostBackfillService.backfill")(
        function* (input?: EntityPostBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);

          const totalRows = yield* sql<{ total: number }>`
            SELECT COUNT(*) as total FROM posts WHERE status = 'active'
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
          const failedUris = outcomes.flatMap((outcome, index) =>
            Exit.isSuccess(outcome) ? [] : [rows[index]?.uri ?? "unknown"]
          );

          return {
            total,
            scanned: rows.length,
            migrated,
            queued: migrated,
            failed: rows.length - migrated,
            failedUris
          };
        }
      );

      return EntityPostBackfillService.of({ backfill });
    })
  );
}
