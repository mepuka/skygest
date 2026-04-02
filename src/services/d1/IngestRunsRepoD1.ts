import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  decodeStoredIngestError,
  encodeStoredIngestError
} from "../../domain/errors";
import {
  CompleteIngestRun as CompleteIngestRunSchema,
  CreateQueuedIngestRun as CreateQueuedIngestRunSchema,
  FailIngestRun as FailIngestRunSchema,
  IngestRunRecord as IngestRunRecordSchema,
  MarkIngestRunDispatching as MarkIngestRunDispatchingSchema,
  MarkIngestRunFinalizing as MarkIngestRunFinalizingSchema,
  MarkIngestRunPreparing as MarkIngestRunPreparingSchema,
  UpdateIngestRunProgress as UpdateIngestRunProgressSchema,
  type CompleteIngestRun,
  type CreateQueuedIngestRun,
  type FailIngestRun,
  type MarkIngestRunDispatching,
  type MarkIngestRunFinalizing,
  type MarkIngestRunPreparing,
  type UpdateIngestRunProgress
} from "../../domain/polling";
import { IngestRunsRepo } from "../IngestRunsRepo";
import { decodeWithDbError } from "./schemaDecode";

const RawIngestRunRowSchema = Schema.Struct({
  id: Schema.String,
  workflowInstanceId: Schema.String,
  kind: Schema.String,
  triggeredBy: Schema.String,
  requestedBy: Schema.NullOr(Schema.String),
  status: Schema.String,
  phase: Schema.String,
  startedAt: Schema.NonNegativeInt,
  finishedAt: Schema.NullOr(Schema.NonNegativeInt),
  lastProgressAt: Schema.NullOr(Schema.NonNegativeInt),
  totalExperts: Schema.NonNegativeInt,
  expertsSucceeded: Schema.NonNegativeInt,
  expertsFailed: Schema.NonNegativeInt,
  pagesFetched: Schema.NonNegativeInt,
  postsSeen: Schema.NonNegativeInt,
  postsStored: Schema.NonNegativeInt,
  postsDeleted: Schema.NonNegativeInt,
  error: Schema.NullOr(Schema.String)
});
const RawIngestRunRowsSchema = Schema.Array(RawIngestRunRowSchema);
const IngestRunRowsSchema = Schema.Array(IngestRunRecordSchema);

export const IngestRunsRepoD1 = {
  layer: Layer.effect(IngestRunsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getById = (id: string) =>
      sql<any>`
        SELECT
          id as id,
          workflow_instance_id as workflowInstanceId,
          kind as kind,
          triggered_by as triggeredBy,
          requested_by as requestedBy,
          status as status,
          phase as phase,
          started_at as startedAt,
          finished_at as finishedAt,
          last_progress_at as lastProgressAt,
          total_experts as totalExperts,
          experts_succeeded as expertsSucceeded,
          experts_failed as expertsFailed,
          pages_fetched as pagesFetched,
          posts_seen as postsSeen,
          posts_stored as postsStored,
          posts_deleted as postsDeleted,
          error as error
        FROM ingest_runs
        WHERE id = ${id}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            RawIngestRunRowsSchema,
            rows,
            `Failed to decode ingest run row for ${id}`
          )
        ),
        Effect.map((rows) =>
          rows.map((row) => ({
            ...row,
            error: decodeStoredIngestError(row.error)
          }))
        ),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            IngestRunRowsSchema,
            rows,
            `Failed to normalize ingest run row for ${id}`
          )
        ),
        Effect.map((rows) => rows[0] ?? null)
      );

    const listRunning = () =>
      sql<any>`
        SELECT
          id as id,
          workflow_instance_id as workflowInstanceId,
          kind as kind,
          triggered_by as triggeredBy,
          requested_by as requestedBy,
          status as status,
          phase as phase,
          started_at as startedAt,
          finished_at as finishedAt,
          last_progress_at as lastProgressAt,
          total_experts as totalExperts,
          experts_succeeded as expertsSucceeded,
          experts_failed as expertsFailed,
          pages_fetched as pagesFetched,
          posts_seen as postsSeen,
          posts_stored as postsStored,
          posts_deleted as postsDeleted,
          error as error
        FROM ingest_runs
        WHERE status = 'running'
        ORDER BY started_at ASC, id ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            RawIngestRunRowsSchema,
            rows,
            "Failed to decode running ingest runs"
          )
        ),
        Effect.map((rows) =>
          rows.map((row) => ({
            ...row,
            error: decodeStoredIngestError(row.error)
          }))
        ),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            IngestRunRowsSchema,
            rows,
            "Failed to normalize running ingest runs"
          )
        )
      );

    const createQueuedIfAbsent = (input: CreateQueuedIngestRun) =>
      decodeWithDbError(
        CreateQueuedIngestRunSchema,
        input,
        "Invalid create queued ingest run input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            INSERT OR IGNORE INTO ingest_runs (
              id,
              workflow_instance_id,
              kind,
              triggered_by,
              requested_by,
              status,
              phase,
              started_at,
              finished_at,
              last_progress_at,
              total_experts,
              experts_succeeded,
              experts_failed,
              pages_fetched,
              posts_seen,
              posts_stored,
              posts_deleted,
              error
            ) VALUES (
              ${validated.id},
              ${validated.workflowInstanceId},
              ${validated.kind},
              ${validated.triggeredBy},
              ${validated.requestedBy},
              'queued',
              'queued',
              ${validated.startedAt},
              NULL,
              ${validated.startedAt},
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              NULL
            )
            RETURNING id
          `.pipe(
            Effect.map((rows) => rows.length > 0)
          )
        )
      );

    const markPreparing = (input: MarkIngestRunPreparing) =>
      decodeWithDbError(
        MarkIngestRunPreparingSchema,
        input,
        "Invalid mark ingest run preparing input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_runs
            SET status = 'running',
                phase = 'preparing',
                error = NULL,
                last_progress_at = ${validated.lastProgressAt}
            WHERE id = ${validated.id}
              AND status IN ('queued', 'running')
          `.pipe(Effect.asVoid)
        )
      );

    const markDispatching = (input: MarkIngestRunDispatching) =>
      decodeWithDbError(
        MarkIngestRunDispatchingSchema,
        input,
        "Invalid mark ingest run dispatching input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_runs
            SET status = 'running',
                phase = 'dispatching',
                total_experts = ${validated.totalExperts},
                last_progress_at = ${validated.lastProgressAt}
            WHERE id = ${validated.id}
          `.pipe(Effect.asVoid)
        )
      );

    const markFinalizing = (input: MarkIngestRunFinalizing) =>
      decodeWithDbError(
        MarkIngestRunFinalizingSchema,
        input,
        "Invalid mark ingest run finalizing input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_runs
            SET status = 'running',
                phase = 'finalizing',
                last_progress_at = ${validated.lastProgressAt}
            WHERE id = ${validated.id}
          `.pipe(Effect.asVoid)
        )
      );

    const updateProgress = (input: UpdateIngestRunProgress) =>
      decodeWithDbError(
        UpdateIngestRunProgressSchema,
        input,
        "Invalid update ingest run progress input"
      ).pipe(
        Effect.flatMap((validated) =>
          sql`
            UPDATE ingest_runs
            SET total_experts = ${validated.totalExperts},
                experts_succeeded = ${validated.expertsSucceeded},
                experts_failed = ${validated.expertsFailed},
                pages_fetched = ${validated.pagesFetched},
                posts_seen = ${validated.postsSeen},
                posts_stored = ${validated.postsStored},
                posts_deleted = ${validated.postsDeleted},
                last_progress_at = ${validated.lastProgressAt}
            WHERE id = ${validated.id}
          `.pipe(Effect.asVoid)
        )
      );

    const applyTerminalUpdate = (
      status: "complete" | "failed",
      input: CompleteIngestRun | FailIngestRun
    ) =>
      sql`
        UPDATE ingest_runs
        SET status = ${status},
            phase = ${status},
            finished_at = ${input.finishedAt},
            last_progress_at = ${input.finishedAt},
            total_experts = COALESCE(${input.totalExperts ?? null}, total_experts),
            experts_succeeded = COALESCE(${input.expertsSucceeded ?? null}, experts_succeeded),
            experts_failed = COALESCE(${input.expertsFailed ?? null}, experts_failed),
            pages_fetched = COALESCE(${input.pagesFetched ?? null}, pages_fetched),
            posts_seen = COALESCE(${input.postsSeen ?? null}, posts_seen),
            posts_stored = COALESCE(${input.postsStored ?? null}, posts_stored),
            posts_deleted = COALESCE(${input.postsDeleted ?? null}, posts_deleted),
            error = ${
              "error" in input
                ? encodeStoredIngestError(input.error)
                : null
            }
        WHERE id = ${input.id}
      `.pipe(Effect.asVoid);

    const markComplete = (input: CompleteIngestRun) =>
      decodeWithDbError(
        CompleteIngestRunSchema,
        input,
        "Invalid complete ingest run input"
      ).pipe(
        Effect.flatMap((validated) => applyTerminalUpdate("complete", validated))
      );

    const markFailed = (input: FailIngestRun) =>
      decodeWithDbError(
        FailIngestRunSchema,
        input,
        "Invalid failed ingest run input"
      ).pipe(
        Effect.flatMap((validated) => applyTerminalUpdate("failed", validated))
      );

    return IngestRunsRepo.of({
      createQueuedIfAbsent,
      getById,
      listRunning,
      markPreparing,
      markDispatching,
      markFinalizing,
      updateProgress,
      markComplete,
      markFailed
    });
  }))
};
