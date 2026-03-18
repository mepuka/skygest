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
  FailEnrichmentRun as FailEnrichmentRunSchema,
  MarkEnrichmentRunNeedsReview as MarkEnrichmentRunNeedsReviewSchema,
  MarkEnrichmentRunPhase as MarkEnrichmentRunPhaseSchema,
  type CompleteEnrichmentRun,
  type CreateQueuedEnrichmentRun,
  type FailEnrichmentRun,
  type MarkEnrichmentRunNeedsReview,
  type MarkEnrichmentRunPhase
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
                  WHEN status = 'queued' AND phase = 'queued' THEN 1
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
                error = ${encodeStoredEnrichmentError(validated.error)}
            WHERE id = ${validated.id}
          `.pipe(Effect.asVoid)
        )
      );

    return EnrichmentRunsRepo.of({
      createQueuedIfAbsent,
      getById,
      listRunning,
      markPhase,
      markComplete,
      markFailed,
      markNeedsReview
    });
  }))
};
