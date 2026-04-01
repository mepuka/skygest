import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import {
  decodeStoredEnrichmentError,
  encodeStoredEnrichmentError
} from "../../domain/errors";
import {
  CompleteEnrichmentRun as CompleteEnrichmentRunSchema,
  CreateQueuedEnrichmentRun as CreateQueuedEnrichmentRunSchema,
  EnrichmentRunRecord as EnrichmentRunRecordSchema,
  EnrichmentRunListOptions as EnrichmentRunListOptionsSchema,
  FailEnrichmentRun as FailEnrichmentRunSchema,
  ListStaleEnrichmentRuns as ListStaleEnrichmentRunsSchema,
  MarkEnrichmentRunNeedsReview as MarkEnrichmentRunNeedsReviewSchema,
  MarkEnrichmentRunPhase as MarkEnrichmentRunPhaseSchema,
  ResetEnrichmentRunForRetry as ResetEnrichmentRunForRetrySchema,
  type CompleteEnrichmentRun,
  type CreateQueuedEnrichmentRun,
  type EnrichmentRunListOptions,
  type FailEnrichmentRun,
  type ListStaleEnrichmentRuns,
  type MarkEnrichmentRunNeedsReview,
  type MarkEnrichmentRunPhase,
  type ResetEnrichmentRunForRetry
} from "../../domain/enrichmentRun";
import { EnrichmentRunsRepo } from "../EnrichmentRunsRepo";
import { decodeWithDbError } from "./schemaDecode";

const RawEnrichmentRunRowSchema = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  postUri: Schema.String,
  enrichmentType: Schema.String,
  schemaVersion: Schema.String,
  triggeredBy: Schema.String,
  requestedBy: Schema.NullOr(Schema.String),
  status: Schema.String,
  phase: Schema.String,
  attemptCount: Schema.NonNegativeInt,
  modelLane: Schema.NullOr(Schema.String),
  promptVersion: Schema.NullOr(Schema.String),
  inputFingerprint: Schema.NullOr(Schema.String),
  startedAt: Schema.NonNegativeInt,
  finishedAt: Schema.NullOr(Schema.NonNegativeInt),
  lastProgressAt: Schema.NullOr(Schema.NonNegativeInt),
  resultWrittenAt: Schema.NullOr(Schema.NonNegativeInt),
  error: Schema.NullOr(Schema.String)
});
const RawEnrichmentRunRowsSchema = Schema.Array(RawEnrichmentRunRowSchema);
const EnrichmentRunRowsSchema = Schema.Array(EnrichmentRunRecordSchema);

export const EnrichmentRunsRepoD1 = {
  layer: Layer.effect(EnrichmentRunsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const selectColumns = sql.unsafe(`
      id as id,
      workflow_instance_id as workflowInstanceId,
      post_uri as postUri,
      enrichment_type as enrichmentType,
      schema_version as schemaVersion,
      triggered_by as triggeredBy,
      requested_by as requestedBy,
      status as status,
      phase as phase,
      attempt_count as attemptCount,
      model_lane as modelLane,
      prompt_version as promptVersion,
      input_fingerprint as inputFingerprint,
      started_at as startedAt,
      finished_at as finishedAt,
      last_progress_at as lastProgressAt,
      result_written_at as resultWrittenAt,
      error as error
    `);

    const decodeRows = (
      rows: ReadonlyArray<unknown>,
      message: string
    ) =>
      decodeWithDbError(
        RawEnrichmentRunRowsSchema,
        rows,
        message
      ).pipe(
        Effect.map((decodedRows) =>
          decodedRows.map((row) => ({
            ...row,
            error: decodeStoredEnrichmentError(row.error)
          }))
        ),
        Effect.flatMap((normalizedRows) =>
          decodeWithDbError(
            EnrichmentRunRowsSchema,
            normalizedRows,
            message
          )
        )
      );

    const getById = (id: string) =>
      sql<any>`
        SELECT ${selectColumns}
        FROM post_enrichment_runs
        WHERE id = ${id}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeRows(rows, `Failed to decode enrichment run row for ${id}`)
        ),
        Effect.map((rows) => rows[0] ?? null)
      );

    const listRunning = () =>
      sql<any>`
        SELECT ${selectColumns}
        FROM post_enrichment_runs
        WHERE status = 'running'
        ORDER BY started_at ASC, id ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeRows(rows, "Failed to decode running enrichment runs")
        )
      );

    const listRecent = (input: EnrichmentRunListOptions) =>
      decodeWithDbError(
        EnrichmentRunListOptionsSchema,
        input,
        "Invalid list enrichment runs input"
      ).pipe(
        Effect.flatMap((validated) =>
          validated.status === undefined
            ? sql<any>`
                SELECT ${selectColumns}
                FROM post_enrichment_runs
                ORDER BY started_at DESC, id DESC
                LIMIT ${validated.limit}
              `
            : sql<any>`
                SELECT ${selectColumns}
                FROM post_enrichment_runs
                WHERE status = ${validated.status}
                ORDER BY started_at DESC, id DESC
                LIMIT ${validated.limit}
              `
        ),
        Effect.flatMap((rows) =>
          decodeRows(rows, "Failed to decode recent enrichment runs")
        )
      );

    const listActive = () =>
      sql<any>`
        SELECT ${selectColumns}
        FROM post_enrichment_runs
        WHERE status IN ('queued', 'running')
        ORDER BY started_at ASC, id ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeRows(rows, "Failed to decode active enrichment runs")
        )
      );

    const listStaleActive = (input: ListStaleEnrichmentRuns) =>
      decodeWithDbError(
        ListStaleEnrichmentRunsSchema,
        input,
        "Invalid stale enrichment run query"
      ).pipe(
        Effect.flatMap((validated) =>
          sql<any>`
            SELECT ${selectColumns}
            FROM post_enrichment_runs
            WHERE (
              status = 'queued'
              AND COALESCE(last_progress_at, started_at, 9223372036854775807) <= ${validated.queuedBefore}
            ) OR (
              status = 'running'
              AND COALESCE(last_progress_at, started_at, 9223372036854775807) <= ${validated.runningBefore}
            )
            ORDER BY started_at ASC, id ASC
          `
        ),
        Effect.flatMap((rows) =>
          decodeRows(rows, "Failed to decode stale enrichment runs")
        )
      );

    const createQueuedIfAbsent = (input: CreateQueuedEnrichmentRun) =>
      decodeWithDbError(
        CreateQueuedEnrichmentRunSchema,
        input,
        "Invalid create queued enrichment run input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            INSERT OR IGNORE INTO post_enrichment_runs (
              id,
              workflow_instance_id,
              post_uri,
              enrichment_type,
              schema_version,
              triggered_by,
              requested_by,
              status,
              phase,
              attempt_count,
              model_lane,
              prompt_version,
              input_fingerprint,
              started_at,
              finished_at,
              last_progress_at,
              result_written_at,
              error
            ) VALUES (
              ${validated.id},
              ${validated.workflowInstanceId},
              ${validated.postUri},
              ${validated.enrichmentType},
              ${validated.schemaVersion},
              ${validated.triggeredBy},
              ${validated.requestedBy},
              'queued',
              'queued',
              0,
              ${validated.modelLane},
              ${validated.promptVersion},
              ${validated.inputFingerprint},
              ${validated.startedAt},
              NULL,
              ${validated.startedAt},
              NULL,
              NULL
            )
            RETURNING id
          `.pipe(
            Effect.map((rows) => rows.length > 0)
          )
        )
      );

    const markPhase = (input: MarkEnrichmentRunPhase) =>
      decodeWithDbError(
        MarkEnrichmentRunPhaseSchema,
        input,
        "Invalid mark enrichment run phase input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE post_enrichment_runs
            SET status = 'running',
                phase = ${validated.phase},
                attempt_count = CASE
                  WHEN status = 'queued' AND phase = 'queued' THEN attempt_count + 1
                  ELSE attempt_count
                END,
                last_progress_at = ${validated.lastProgressAt},
                error = CASE
                  WHEN status = 'queued' THEN NULL
                  ELSE error
                END
            WHERE id = ${validated.id}
              AND status IN ('queued', 'running')
          `.pipe(Effect.asVoid)
        )
      );

    const markComplete = (input: CompleteEnrichmentRun) =>
      decodeWithDbError(
        CompleteEnrichmentRunSchema,
        input,
        "Invalid mark enrichment run complete input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE post_enrichment_runs
            SET status = 'complete',
                phase = 'complete',
                finished_at = ${validated.finishedAt},
                last_progress_at = ${validated.finishedAt},
                result_written_at = ${validated.resultWrittenAt},
                error = NULL
            WHERE id = ${validated.id}
              AND status = 'running'
          `.pipe(Effect.asVoid)
        )
      );

    const markFailed = (input: FailEnrichmentRun) =>
      decodeWithDbError(
        FailEnrichmentRunSchema,
        input,
        "Invalid mark enrichment run failed input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE post_enrichment_runs
            SET status = 'failed',
                phase = 'failed',
                finished_at = ${validated.finishedAt},
                last_progress_at = ${validated.finishedAt},
                error = ${encodeStoredEnrichmentError(validated.error)}
            WHERE id = ${validated.id}
              AND status IN ('queued', 'running')
          `.pipe(Effect.asVoid)
        )
      );

    const markNeedsReview = (input: MarkEnrichmentRunNeedsReview) =>
      decodeWithDbError(
        MarkEnrichmentRunNeedsReviewSchema,
        input,
        "Invalid mark enrichment run needs review input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE post_enrichment_runs
            SET status = 'needs-review',
                phase = 'needs-review',
                finished_at = ${validated.lastProgressAt},
                last_progress_at = ${validated.lastProgressAt},
                result_written_at = COALESCE(${validated.resultWrittenAt ?? null}, result_written_at),
                error = ${encodeStoredEnrichmentError(validated.error)}
            WHERE id = ${validated.id}
              AND status = 'running'
          `.pipe(Effect.asVoid)
        )
      );

    const resetForRetry = (input: ResetEnrichmentRunForRetry) =>
      decodeWithDbError(
        ResetEnrichmentRunForRetrySchema,
        input,
        "Invalid enrichment retry reset input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql<any>`
            UPDATE post_enrichment_runs
            SET status = 'queued',
                phase = 'queued',
                started_at = ${validated.queuedAt},
                finished_at = NULL,
                last_progress_at = ${validated.queuedAt},
                result_written_at = NULL,
                error = NULL
            WHERE id = ${validated.id}
              AND status IN ('failed', 'needs-review')
            RETURNING id
          `.pipe(
            Effect.map((rows) => rows.length > 0)
          )
        )
      );

    return EnrichmentRunsRepo.of({
      createQueuedIfAbsent,
      getById,
      listRunning,
      listRecent,
      listActive,
      listStaleActive,
      markPhase,
      markComplete,
      markFailed,
      markNeedsReview,
      resetForRetry
    });
  }))
};
