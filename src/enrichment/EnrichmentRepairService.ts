import { Context, Effect, Either, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  EnrichmentRetryNotAllowedError,
  EnrichmentRunNotFoundError,
  EnrichmentWorkflowControlError,
  HistoricalEnrichmentRepairError,
  toEnrichmentErrorEnvelope
} from "../domain/errors";
import type {
  EnrichmentQueuedResponse,
  EnrichmentRepairSummary,
  EnrichmentRunRecord
} from "../domain/enrichmentRun";
import { WorkflowEnrichmentEnv } from "../platform/Env";
import { stringifyUnknown } from "../platform/Json";
import { EnrichmentRunsRepo } from "../services/EnrichmentRunsRepo";

export const STALE_ENRICHMENT_QUEUED_MS = 5 * 60 * 1000;
export const STALE_ENRICHMENT_RUNNING_MS = 30 * 60 * 1000;

const staleQueuedBefore = (now: number) => now - STALE_ENRICHMENT_QUEUED_MS;
const staleRunningBefore = (now: number) => now - STALE_ENRICHMENT_RUNNING_MS;

const emptyRepairSummary = (): EnrichmentRepairSummary => ({
  repairedRuns: 0,
  staleQueuedRuns: 0,
  staleRunningRuns: 0,
  untouchedRuns: 0
});

const asRetryConflict = (run: EnrichmentRunRecord) =>
  EnrichmentRetryNotAllowedError.make({
    runId: run.id,
    status: run.status
  });

const workflowControlFailure = (
  runId: string,
  operation: string,
  cause: unknown
) =>
  EnrichmentWorkflowControlError.make({
    runId,
    operation,
    message: stringifyUnknown(cause)
  });

export class EnrichmentRepairService extends Context.Tag("@skygest/EnrichmentRepairService")<
  EnrichmentRepairService,
  {
    readonly retryRun: (
      runId: string,
      now?: number
    ) => Effect.Effect<
      EnrichmentQueuedResponse,
      | SqlError
      | DbError
      | EnrichmentRunNotFoundError
      | EnrichmentRetryNotAllowedError
      | EnrichmentWorkflowControlError
    >;
    readonly repairHistoricalRuns: (
      now?: number
    ) => Effect.Effect<EnrichmentRepairSummary, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(
    EnrichmentRepairService,
    Effect.gen(function* () {
      const env = yield* WorkflowEnrichmentEnv;
      const runs = yield* EnrichmentRunsRepo;
      const workflow = env.ENRICHMENT_RUN_WORKFLOW;

      const getWorkflowInstance = (
        workflowInstanceId: string,
        runId: string,
        operation: string
      ) =>
        Effect.tryPromise({
          try: () => workflow.get(workflowInstanceId),
          catch: (cause) => workflowControlFailure(runId, operation, cause)
        });

      const restartWorkflowInstance = (
        workflowInstanceId: string,
        runId: string,
        operation: string
      ) =>
        getWorkflowInstance(
          workflowInstanceId,
          runId,
          `${operation}.get`
        ).pipe(
          Effect.flatMap((instance) =>
            Effect.tryPromise({
              try: () => instance.restart(),
              catch: (cause) =>
                workflowControlFailure(runId, `${operation}.restart`, cause)
            })
          )
        );

      const terminateWorkflowInstance = (
        workflowInstanceId: string,
        runId: string,
        operation: string
      ) =>
        getWorkflowInstance(
          workflowInstanceId,
          runId,
          `${operation}.get`
        ).pipe(
          Effect.flatMap((instance) =>
            Effect.tryPromise({
              try: () => instance.terminate(),
              catch: (cause) =>
                workflowControlFailure(runId, `${operation}.terminate`, cause)
            })
          )
        );

      const retryRun = Effect.fn("EnrichmentRepairService.retryRun")(function* (
        runId: string,
        now = Date.now()
      ) {
        const run = yield* runs.getById(runId).pipe(
          Effect.flatMap((record) =>
            record === null
              ? Effect.fail(EnrichmentRunNotFoundError.make({ runId }))
              : Effect.succeed(record)
          )
        );

        if (run.status !== "failed" && run.status !== "needs-review") {
          return yield* asRetryConflict(run);
        }

        const reset = yield* runs.resetForRetry({
          id: run.id,
          queuedAt: now
        });

        if (!reset) {
          const current = yield* runs.getById(run.id).pipe(
            Effect.map((record) => record ?? run)
          );
          return yield* asRetryConflict(current);
        }

        yield* restartWorkflowInstance(
          run.workflowInstanceId,
          run.id,
          "EnrichmentRepairService.retryRun"
        ).pipe(
          Effect.catchAll((error) =>
            runs.markFailed({
              id: run.id,
              finishedAt: Date.now(),
              error: toEnrichmentErrorEnvelope(error, {
                runId: run.id,
                operation: "EnrichmentRepairService.retryRun"
              })
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
        );

        return {
          runId: run.id,
          workflowInstanceId: run.workflowInstanceId,
          status: "queued"
        } satisfies EnrichmentQueuedResponse;
      });

      const repairHistoricalRuns = Effect.fn(
        "EnrichmentRepairService.repairHistoricalRuns"
      )(function* (now = Date.now()) {
        const [activeRuns, staleRuns] = yield* Effect.all([
          runs.listActive(),
          runs.listStaleActive({
            queuedBefore: staleQueuedBefore(now),
            runningBefore: staleRunningBefore(now)
          })
        ]);

        if (activeRuns.length === 0) {
          return emptyRepairSummary();
        }

        const staleRunIds = new Set(staleRuns.map((run) => run.id));
        const staleQueuedRuns = staleRuns.filter((run) => run.status === "queued").length;
        const staleRunningRuns = staleRuns.filter((run) => run.status === "running").length;

        yield* Effect.forEach(
          staleRuns,
          (run) =>
            Effect.gen(function* () {
              const termination = yield* Effect.either(
                terminateWorkflowInstance(
                  run.workflowInstanceId,
                  run.id,
                  "EnrichmentRepairService.repairHistoricalRuns"
                )
              );

              const error = Either.isRight(termination)
                ? HistoricalEnrichmentRepairError.make({
                    runId: run.id,
                    operation: "EnrichmentRepairService.repairHistoricalRuns",
                    message: `repaired stale enrichment ${run.status} run`
                  })
                : termination.left;

              yield* runs.markFailed({
                id: run.id,
                finishedAt: now,
                error: toEnrichmentErrorEnvelope(error, {
                  runId: run.id,
                  operation: "EnrichmentRepairService.repairHistoricalRuns"
                })
              });
            }),
          { discard: true }
        );

        return {
          repairedRuns: staleRuns.length,
          staleQueuedRuns,
          staleRunningRuns,
          untouchedRuns: activeRuns.filter((run) => !staleRunIds.has(run.id)).length
        } satisfies EnrichmentRepairSummary;
      });

      return EnrichmentRepairService.of({
        retryRun,
        repairHistoricalRuns
      });
    })
  );
}
