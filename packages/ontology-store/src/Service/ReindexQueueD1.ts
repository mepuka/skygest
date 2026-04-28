import { Clock, Effect, Layer, Random, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";

import {
  ReindexQueueItem,
  REINDEX_QUEUE_UPSERT_SET_CLAUSE
} from "../Domain/EntityGraph";
import {
  REINDEX_MAX_PROPAGATION_DEPTH,
  ReindexDepthExceededError,
  ReindexQueueService,
  type ReindexRequest
} from "./ReindexQueue";

const ReindexQueueRow = Schema.Struct({
  queue_id: Schema.String,
  coalesce_key: Schema.String,
  target_entity_type: Schema.String,
  target_iri: Schema.String,
  origin_iri: Schema.String,
  cause: Schema.String,
  cause_priority: Schema.Number,
  propagation_depth: Schema.Number,
  attempts: Schema.Number,
  next_attempt_at: Schema.Number,
  enqueued_at: Schema.Number,
  updated_at: Schema.Number
});
type ReindexQueueRow = typeof ReindexQueueRow.Type;

const decodeSqlError = (cause: unknown): SqlError =>
  new SqlError({
    reason: new UnknownError({
      cause,
      message: "Failed to decode reindex queue rows",
      operation: "reindex_queue.decode"
    })
  });

const decodeRows = (rows: unknown) =>
  Schema.decodeUnknownEffect(Schema.Array(ReindexQueueRow))(rows).pipe(
    Effect.mapError(decodeSqlError)
  );

const toItem = (row: ReindexQueueRow): ReindexQueueItem =>
  Schema.decodeUnknownSync(ReindexQueueItem)({
    queueId: row.queue_id,
    coalesceKey: row.coalesce_key,
    targetEntityType: row.target_entity_type,
    targetIri: row.target_iri,
    originIri: row.origin_iri,
    cause: row.cause,
    causePriority: row.cause_priority,
    propagationDepth: row.propagation_depth,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    enqueuedAt: row.enqueued_at,
    updatedAt: row.updated_at
  });

const COALESCE_WINDOW_MS = 30_000;

const coalesceKey = (request: ReindexRequest, now: number): string => {
  const bucket = Math.floor(now / COALESCE_WINDOW_MS);
  return `${request.targetEntityType}:${request.targetIri}:${bucket}`;
};

const backoffMs = (attempts: number): number =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));

export const ReindexQueueD1 = {
  layer: Layer.effect(
    ReindexQueueService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const schedule = (request: ReindexRequest) =>
        Effect.gen(function* () {
          if (request.propagationDepth > REINDEX_MAX_PROPAGATION_DEPTH) {
            return yield* new ReindexDepthExceededError({
              propagationDepth: request.propagationDepth
            });
          }
          const now = yield* Clock.currentTimeMillis;
          yield* sql`
            INSERT INTO reindex_queue (
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
            ) VALUES (
              ${yield* Random.nextUUIDv4},
              ${coalesceKey(request, now)},
              ${request.targetEntityType},
              ${request.targetIri},
              ${request.originIri},
              ${request.cause},
              ${request.causePriority},
              ${request.propagationDepth},
              ${0},
              ${request.nextAttemptAt},
              ${now},
              ${now}
            )
            ON CONFLICT(coalesce_key) DO UPDATE SET
            ${sql.unsafe(REINDEX_QUEUE_UPSERT_SET_CLAUSE)}
          `.pipe(Effect.asVoid);
        });

      const nextBatch = (now: number, limit: number) =>
        sql<ReindexQueueRow>`
          SELECT
            queue_id as queue_id,
            coalesce_key as coalesce_key,
            target_entity_type as target_entity_type,
            target_iri as target_iri,
            origin_iri as origin_iri,
            cause as cause,
            cause_priority as cause_priority,
            propagation_depth as propagation_depth,
            attempts as attempts,
            next_attempt_at as next_attempt_at,
            enqueued_at as enqueued_at,
            updated_at as updated_at
          FROM reindex_queue
          WHERE next_attempt_at <= ${now}
            AND attempts < 3
          ORDER BY next_attempt_at ASC, enqueued_at ASC
          LIMIT ${limit}
        `.pipe(
          Effect.flatMap(decodeRows),
          Effect.map((rows) => rows.map(toItem))
        );

      const markComplete = (queueId: string) =>
        sql`
          DELETE FROM reindex_queue
          WHERE queue_id = ${queueId}
        `.pipe(Effect.asVoid);

      const moveToDlq = (
        item: ReindexQueueItem,
        now: number,
        message: string | undefined
      ) =>
        sql`
          INSERT OR REPLACE INTO reindex_queue_dlq (
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
            updated_at,
            failed_at,
            failure_message
          ) VALUES (
            ${item.queueId},
            ${item.coalesceKey},
            ${item.targetEntityType},
            ${item.targetIri},
            ${item.originIri},
            ${item.cause},
            ${item.causePriority},
            ${item.propagationDepth},
            ${item.attempts + 1},
            ${item.nextAttemptAt},
            ${item.enqueuedAt},
            ${now},
            ${now},
            ${message ?? null}
          )
        `.pipe(Effect.asVoid);

      const markFailed = (
        queueId: string,
        now: number,
        message?: string
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<ReindexQueueRow>`
            SELECT
              queue_id as queue_id,
              coalesce_key as coalesce_key,
              target_entity_type as target_entity_type,
              target_iri as target_iri,
              origin_iri as origin_iri,
              cause as cause,
              cause_priority as cause_priority,
              propagation_depth as propagation_depth,
              attempts as attempts,
              next_attempt_at as next_attempt_at,
              enqueued_at as enqueued_at,
              updated_at as updated_at
            FROM reindex_queue
            WHERE queue_id = ${queueId}
            LIMIT 1
          `.pipe(Effect.flatMap(decodeRows));
          const row = rows[0];
          if (row === undefined) return;
          const item = toItem(row);
          if (item.attempts + 1 >= 3) {
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* moveToDlq(item, now, message);
                yield* markComplete(queueId);
              })
            );
            return;
          }
          const attempts = item.attempts + 1;
          yield* sql`
            UPDATE reindex_queue
            SET attempts = ${attempts},
              next_attempt_at = ${now + backoffMs(attempts)},
              updated_at = ${now}
            WHERE queue_id = ${queueId}
          `.pipe(Effect.asVoid);
        });

      const drain = (batch: ReadonlyArray<ReindexQueueItem>) =>
        Effect.succeed({ rendered: batch.length, failed: 0 });

      return ReindexQueueService.of({
        schedule,
        nextBatch,
        markComplete,
        markFailed,
        drain
      });
    })
  )
};
