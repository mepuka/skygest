import { D1Client } from "@effect/sql-d1";
import { Clock, Effect, Layer, Option, Random, Schema } from "effect";
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

type D1DatabaseBinding = D1Client.D1Client["config"]["db"];
type D1PreparedStatementBinding = ReturnType<D1DatabaseBinding["prepare"]>;
type D1BatchResult = {
  readonly success?: boolean;
  readonly error?: unknown;
};

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

const toItem = (
  row: ReindexQueueRow
): Effect.Effect<ReindexQueueItem, SqlError> =>
  Schema.decodeUnknownEffect(ReindexQueueItem)({
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
  }).pipe(Effect.mapError(decodeSqlError));

const COALESCE_WINDOW_MS = 30_000;

const coalesceKey = (request: ReindexRequest, now: number): string => {
  const bucket = Math.floor(now / COALESCE_WINDOW_MS);
  return `${request.targetEntityType}:${request.targetIri}:${bucket}`;
};

const backoffMs = (attempts: number): number =>
  Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));

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
  }).pipe(
    Effect.flatMap((results) => {
      const failureIndex = (results as ReadonlyArray<D1BatchResult>).findIndex(
        (result) => result.success === false
      );
      return failureIndex === -1
        ? Effect.void
        : Effect.fail(
            d1BatchSqlError(
              (results as ReadonlyArray<D1BatchResult>)[failureIndex],
              `${operation}[${String(failureIndex)}]`
            )
          );
    })
  );

export const ReindexQueueD1 = {
  layer: Layer.effect(
    ReindexQueueService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const d1Client = yield* Effect.serviceOption(D1Client.D1Client);
      const rawDb = Option.match(d1Client, {
        onNone: () => null,
        onSome: (client) => client.config.db
      });

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
          Effect.flatMap((rows) => Effect.forEach(rows, toItem))
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
            ${item.attempts},
            ${item.nextAttemptAt},
            ${item.enqueuedAt},
            ${now},
            ${now},
            ${message ?? null}
          )
        `.pipe(Effect.asVoid);

      const moveToDlqWithD1Batch = (
        item: ReindexQueueItem,
        now: number,
        message: string | undefined
      ) =>
        rawDb === null
          ? sql.withTransaction(
              Effect.gen(function* () {
                yield* moveToDlq(item, now, message);
                yield* markComplete(item.queueId);
              })
            )
          : runD1Batch(
              rawDb,
              [
                rawDb
                  .prepare(
                    `INSERT OR REPLACE INTO reindex_queue_dlq (
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
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                  )
                  .bind(
                    item.queueId,
                    item.coalesceKey,
                    item.targetEntityType,
                    item.targetIri,
                    item.originIri,
                    item.cause,
                    item.causePriority,
                    item.propagationDepth,
                    item.attempts,
                    item.nextAttemptAt,
                    item.enqueuedAt,
                    now,
                    now,
                    message ?? null
                  ),
                rawDb
                  .prepare(
                    `DELETE FROM reindex_queue
                     WHERE queue_id = ?`
                  )
                  .bind(item.queueId)
              ],
              "ReindexQueueD1.markFailed"
            );

      const markFailed = (
        queueId: string,
        now: number,
        message?: string
      ) =>
        Effect.gen(function* () {
          const rows = yield* sql<ReindexQueueRow>`
            UPDATE reindex_queue
            SET attempts = attempts + 1,
              next_attempt_at = CASE
                WHEN attempts + 1 >= 3 THEN next_attempt_at
                WHEN attempts + 1 = 1 THEN ${now + backoffMs(1)}
                WHEN attempts + 1 = 2 THEN ${now + backoffMs(2)}
                ELSE ${now + backoffMs(3)}
              END,
              updated_at = ${now}
            WHERE queue_id = ${queueId}
              AND attempts < 3
            RETURNING
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
          `.pipe(Effect.flatMap(decodeRows));
          const row = rows[0];
          if (row === undefined) return;
          const item = yield* toItem(row);
          if (item.attempts >= 3) {
            yield* moveToDlqWithD1Batch(item, now, message);
          }
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
