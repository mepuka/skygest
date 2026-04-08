import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../../domain/errors";
import {
  decodeStoredIngestError,
  encodeStoredIngestError
} from "../../domain/errors";
import {
  CompleteIngestRunItem as CompleteIngestRunItemSchema,
  CreateIngestRunItem as CreateIngestRunItemSchema,
  FailIngestRunItem as FailIngestRunItemSchema,
  IngestRunItemRecord as IngestRunItemRecordSchema,
  IngestRunItemSummary as IngestRunItemSummarySchema,
  MarkIngestRunItemDispatched as MarkIngestRunItemDispatchedSchema,
  MarkIngestRunItemQueued as MarkIngestRunItemQueuedSchema,
  MarkIngestRunItemRunning as MarkIngestRunItemRunningSchema,
  UpdateIngestRunItemCounts as UpdateIngestRunItemCountsSchema,
  type CompleteIngestRunItem,
  type CreateIngestRunItem,
  type FailIngestRunItem,
  type IngestRunItemRecord,
  type IngestRunItemSummary,
  type MarkIngestRunItemDispatched,
  type MarkIngestRunItemQueued,
  type MarkIngestRunItemRunning,
  type UpdateIngestRunItemCounts
} from "../../domain/polling";
import { IngestRunItemsRepo } from "../IngestRunItemsRepo";
import { decodeWithDbError } from "./schemaDecode";

const D1_MAX_BOUND_PARAMETERS = 100;
const INSERT_VALUE_COLUMN_COUNT = 13;
const INSERT_BATCH_SIZE = Math.max(
  1,
  Math.floor(D1_MAX_BOUND_PARAMETERS / INSERT_VALUE_COLUMN_COUNT)
);
const RawIngestRunItemRowSchema = Schema.Struct({
  runId: Schema.String,
  did: Schema.String,
  mode: Schema.String,
  status: Schema.String,
  enqueuedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  attemptCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  startedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  finishedAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  lastProgressAt: Schema.NullOr(Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))),
  pagesFetched: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  postsSeen: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  postsStored: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  postsDeleted: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  error: Schema.NullOr(Schema.String)
});
const RawIngestRunItemRowsSchema = Schema.Array(RawIngestRunItemRowSchema);
const IngestRunItemRowsSchema = Schema.Array(IngestRunItemRecordSchema);
const CountRowsSchema = Schema.Array(
  Schema.Struct({
    count: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  })
);
const RawIngestRunItemSummaryRowsSchema = Schema.Array(
  Schema.Struct({
    totalExperts: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    expertsSucceeded: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    expertsFailed: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    pagesFetched: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    postsSeen: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    postsStored: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    postsDeleted: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  })
);
const ErrorRowsSchema = Schema.Array(
  Schema.Struct({
    error: Schema.NullOr(Schema.String)
  })
);

const ingestRunItemSelectColumns = `
  run_id as runId,
  did as did,
  mode as mode,
  status as status,
  enqueued_at as enqueuedAt,
  attempt_count as attemptCount,
  started_at as startedAt,
  finished_at as finishedAt,
  last_progress_at as lastProgressAt,
  pages_fetched as pagesFetched,
  posts_seen as postsSeen,
  posts_stored as postsStored,
  posts_deleted as postsDeleted,
  error as error
`;

const chunkItems = <A>(items: ReadonlyArray<A>, size: number) => {
  const chunks: Array<ReadonlyArray<A>> = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const decodeIngestRunItemRows = (
  rows: unknown,
  decodeMessage: string,
  normalizeMessage: string
): Effect.Effect<ReadonlyArray<IngestRunItemRecord>, DbError> =>
  decodeWithDbError(
    RawIngestRunItemRowsSchema,
    rows,
    decodeMessage
  ).pipe(
    Effect.map((rawRows) =>
      rawRows.map((row) => ({
        ...row,
        error: decodeStoredIngestError(row.error)
      }))
    ),
    Effect.flatMap((normalizedRows) =>
      decodeWithDbError(
        IngestRunItemRowsSchema,
        normalizedRows,
        normalizeMessage
      )
    )
  );

export const IngestRunItemsRepoD1 = {
  layer: Layer.effect(IngestRunItemsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const createMany = (items: ReadonlyArray<CreateIngestRunItem>) =>
      decodeWithDbError(
        Schema.Array(CreateIngestRunItemSchema),
        items,
        "Invalid create ingest run items input"
      ).pipe(
        Effect.flatMap((validated) =>
          validated.length === 0
            ? Effect.void
            : Effect.forEach(
                chunkItems(validated, INSERT_BATCH_SIZE),
                (batch) =>
                  sql`
                    INSERT OR IGNORE INTO ingest_run_items
                    ${sql.insert(batch.map((item) => ({
                      run_id: item.runId,
                      did: item.did,
                      mode: item.mode,
                      status: "queued",
                      enqueued_at: null,
                      attempt_count: 0,
                      started_at: null,
                      finished_at: null,
                      last_progress_at: null,
                      pages_fetched: 0,
                      posts_seen: 0,
                      posts_stored: 0,
                      posts_deleted: 0,
                      error: null
                    })))}
                  `.pipe(Effect.asVoid),
                { discard: true }
              )
        )
      );

    const markDispatched = (input: MarkIngestRunItemDispatched) =>
      decodeWithDbError(
        MarkIngestRunItemDispatchedSchema,
        input,
        "Invalid mark ingest run item dispatched input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_run_items
            SET status = 'dispatched',
                enqueued_at = COALESCE(enqueued_at, ${validated.enqueuedAt}),
                last_progress_at = ${validated.lastProgressAt},
                error = NULL
            WHERE run_id = ${validated.runId}
              AND did = ${validated.did}
              AND mode = ${validated.mode}
          `.pipe(Effect.asVoid)
        )
      );

    const markQueued = (input: MarkIngestRunItemQueued) =>
      decodeWithDbError(
        MarkIngestRunItemQueuedSchema,
        input,
        "Invalid mark ingest run item queued input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_run_items
            SET status = 'queued',
                enqueued_at = NULL,
                started_at = NULL,
                finished_at = NULL,
                last_progress_at = ${validated.lastProgressAt},
                error = NULL
            WHERE run_id = ${validated.runId}
              AND did = ${validated.did}
              AND mode = ${validated.mode}
          `.pipe(Effect.asVoid)
        )
      );

    const markRunning = (input: MarkIngestRunItemRunning) =>
      decodeWithDbError(
        MarkIngestRunItemRunningSchema,
        input,
        "Invalid mark ingest run item running input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_run_items
            SET status = 'running',
                enqueued_at = COALESCE(enqueued_at, ${validated.startedAt}),
                started_at = COALESCE(started_at, ${validated.startedAt}),
                last_progress_at = ${validated.lastProgressAt},
                error = NULL
            WHERE run_id = ${validated.runId}
              AND did = ${validated.did}
              AND mode = ${validated.mode}
          `.pipe(Effect.asVoid)
        )
      );

    const applyCounts = (
      status: "running" | "complete" | "failed",
      input: UpdateIngestRunItemCounts | CompleteIngestRunItem | FailIngestRunItem
    ) =>
      sql`
        UPDATE ingest_run_items
        SET status = ${status},
            attempt_count = ${input.attemptCount},
            pages_fetched = ${input.pagesFetched},
            posts_seen = ${input.postsSeen},
            posts_stored = ${input.postsStored},
            posts_deleted = ${input.postsDeleted},
            last_progress_at = ${
              "finishedAt" in input
                ? input.finishedAt
                : input.lastProgressAt
            },
            finished_at = ${
              "finishedAt" in input
                ? input.finishedAt
                : null
            },
            error = ${
              "error" in input
                ? encodeStoredIngestError(input.error)
                : null
            }
        WHERE run_id = ${input.runId}
          AND did = ${input.did}
          AND mode = ${input.mode}
      `.pipe(Effect.asVoid);

    const markProgress = (input: UpdateIngestRunItemCounts) =>
      decodeWithDbError(
        UpdateIngestRunItemCountsSchema,
        input,
        "Invalid mark ingest run item progress input"
      ).pipe(
        Effect.flatMap((validated) => applyCounts("running", validated))
      );

    const markComplete = (input: CompleteIngestRunItem) =>
      decodeWithDbError(
        CompleteIngestRunItemSchema,
        input,
        "Invalid mark ingest run item complete input"
      ).pipe(
        Effect.flatMap((validated) => applyCounts("complete", validated))
      );

    const markFailed = (input: FailIngestRunItem) =>
      decodeWithDbError(
        FailIngestRunItemSchema,
        input,
        "Invalid mark ingest run item failed input"
      ).pipe(
        Effect.flatMap((validated) => applyCounts("failed", validated))
      );

    const listByRun = (runId: string) =>
      sql<any>`
        SELECT
          ${sql.unsafe(ingestRunItemSelectColumns)}
        FROM ingest_run_items
        WHERE run_id = ${runId}
        ORDER BY did ASC, mode ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeIngestRunItemRows(
            rows,
            `Failed to decode ingest run items for ${runId}`,
            `Failed to normalize ingest run items for ${runId}`
          )
        )
      );

    const countActiveByRun = (runId: string) =>
      sql<any>`
        SELECT COUNT(*) as count
        FROM ingest_run_items
        WHERE run_id = ${runId}
          AND status IN ('dispatched', 'running')
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CountRowsSchema,
            rows,
            `Failed to decode active ingest run item count for ${runId}`
          )
        ),
        Effect.map((rows) => rows[0]?.count ?? 0)
      );

    const listUndispatchedByRun = (runId: string, limit: number) =>
      sql<any>`
        SELECT
          ${sql.unsafe(ingestRunItemSelectColumns)}
        FROM ingest_run_items
        WHERE run_id = ${runId}
          AND status = 'queued'
        ORDER BY did ASC, mode ASC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeIngestRunItemRows(
            rows,
            `Failed to decode undispatched ingest run items for ${runId}`,
            `Failed to normalize undispatched ingest run items for ${runId}`
          )
        )
      );

    const listStaleDispatchedByRun = (runId: string, staleBefore: number) =>
      sql<any>`
        SELECT
          ${sql.unsafe(ingestRunItemSelectColumns)}
        FROM ingest_run_items
        WHERE run_id = ${runId}
          AND status = 'dispatched'
          AND COALESCE(last_progress_at, enqueued_at, 0) <= ${staleBefore}
        ORDER BY did ASC, mode ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeIngestRunItemRows(
            rows,
            `Failed to decode stale dispatched ingest run items for ${runId}`,
            `Failed to normalize stale dispatched ingest run items for ${runId}`
          )
        )
      );

    const listStaleRunningByRun = (runId: string, staleBefore: number) =>
      sql<any>`
        SELECT
          ${sql.unsafe(ingestRunItemSelectColumns)}
        FROM ingest_run_items
        WHERE run_id = ${runId}
          AND status = 'running'
          AND COALESCE(last_progress_at, started_at, 0) <= ${staleBefore}
        ORDER BY did ASC, mode ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeIngestRunItemRows(
            rows,
            `Failed to decode stale running ingest run items for ${runId}`,
            `Failed to normalize stale running ingest run items for ${runId}`
          )
        )
      );

    const countIncompleteByRun = (runId: string) =>
      sql<any>`
        SELECT COUNT(*) as count
        FROM ingest_run_items
        WHERE run_id = ${runId}
          AND status NOT IN ('complete', 'failed')
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CountRowsSchema,
            rows,
            `Failed to decode incomplete ingest run item count for ${runId}`
          )
        ),
        Effect.map((rows) => rows[0]?.count ?? 0)
      );

    const summarizeByRun = (runId: string): Effect.Effect<IngestRunItemSummary, SqlError | DbError> =>
      Effect.all({
        summary: sql<any>`
          SELECT
            COUNT(*) as totalExperts,
            COALESCE(SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END), 0) as expertsSucceeded,
            COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as expertsFailed,
            COALESCE(SUM(pages_fetched), 0) as pagesFetched,
            COALESCE(SUM(posts_seen), 0) as postsSeen,
            COALESCE(SUM(posts_stored), 0) as postsStored,
            COALESCE(SUM(posts_deleted), 0) as postsDeleted
          FROM ingest_run_items
          WHERE run_id = ${runId}
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              RawIngestRunItemSummaryRowsSchema,
              rows,
              `Failed to decode ingest run item summary for ${runId}`
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            totalExperts: 0,
            expertsSucceeded: 0,
            expertsFailed: 0,
            pagesFetched: 0,
            postsSeen: 0,
            postsStored: 0,
            postsDeleted: 0
          })
        ),
        error: sql<any>`
          SELECT error as error
          FROM ingest_run_items
          WHERE run_id = ${runId}
            AND status = 'failed'
            AND error IS NOT NULL
          ORDER BY finished_at ASC, did ASC, mode ASC
          LIMIT 1
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              ErrorRowsSchema,
              rows,
              `Failed to decode ingest run item failure for ${runId}`
            )
          ),
          Effect.map((rows) => decodeStoredIngestError(rows[0]?.error ?? null))
        )
      }).pipe(
        Effect.flatMap(({ summary, error }) =>
          decodeWithDbError(
            IngestRunItemSummarySchema,
            {
              ...summary,
              error
            },
            `Failed to normalize ingest run item summary for ${runId}`
          )
        )
      );

    return {
      createMany,
      markDispatched,
      markQueued,
      markRunning,
      markProgress,
      markComplete,
      markFailed,
      listByRun,
      countActiveByRun,
      countIncompleteByRun,
      listUndispatchedByRun,
      listStaleDispatchedByRun,
      listStaleRunningByRun,
      summarizeByRun
    };
  }))
};
