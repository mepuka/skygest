import { Context, Effect, Either, Layer, Schema } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  IngestRunParams,
  type IngestQueuedResponse
} from "../domain/polling";
import {
  IngestSchemaDecodeError,
  IngestWorkflowLaunchError,
  toIngestErrorEnvelope
} from "../domain/errors";
import { WorkflowIngestEnv } from "../platform/Env";
import { formatSchemaParseError, stringifyUnknown } from "../platform/Json";
import { IngestRunsRepo } from "../services/IngestRunsRepo";

const toCronSlotId = (scheduledTime: number) =>
  `head-sweep:${new Date(scheduledTime).toISOString().slice(0, 16)}`;

const decodeIngestRunParams = (input: unknown, operation: string) =>
  (() => {
    const decoded = Schema.decodeUnknownEither(IngestRunParams)(input);
    return Either.isRight(decoded)
      ? Effect.succeed(decoded.right)
      : Effect.fail(
          IngestSchemaDecodeError.make({
            message: formatSchemaParseError(decoded.left),
            operation
          })
        );
  })();

const launchWorkflow = <A>(
  operation: string,
  thunk: () => Promise<A>
) =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) =>
      IngestWorkflowLaunchError.make({
        message: stringifyUnknown(cause),
        operation
      })
  });

export class IngestWorkflowLauncher extends Context.Tag("@skygest/IngestWorkflowLauncher")<
  IngestWorkflowLauncher,
  {
    readonly start: (
      params: IngestRunParams
    ) => Effect.Effect<
      IngestQueuedResponse,
      SqlError | DbError | IngestSchemaDecodeError | IngestWorkflowLaunchError
    >;
    readonly startCronHeadSweep: (
      scheduledTime: number
    ) => Effect.Effect<
      void,
      SqlError | DbError | IngestSchemaDecodeError | IngestWorkflowLaunchError
    >;
  }
>() {
  static readonly layer = Layer.effect(
    IngestWorkflowLauncher,
    Effect.gen(function* () {
      const env = yield* WorkflowIngestEnv;
      const runs = yield* IngestRunsRepo;
      const workflow = env.INGEST_RUN_WORKFLOW;

      const start = Effect.fn("IngestWorkflowLauncher.start")(function* (
        params: IngestRunParams
      ) {
        const operation = "IngestWorkflowLauncher.start";
        const validatedParams = yield* decodeIngestRunParams(params, operation);
        const runId = crypto.randomUUID();
        const startedAt = Date.now();

        const inserted = yield* runs.createQueuedIfAbsent({
          id: runId,
          workflowInstanceId: runId,
          kind: validatedParams.kind,
          triggeredBy: validatedParams.triggeredBy,
          requestedBy: validatedParams.requestedBy ?? null,
          startedAt
        });

        if (!inserted) {
          return yield* IngestWorkflowLaunchError.make({
            message: `ingest run id already exists: ${runId}`,
            operation
          });
        }

        yield* launchWorkflow(operation, () =>
          workflow.create({
            id: runId,
            params: validatedParams
          })
        ).pipe(
          Effect.catchAll((error) =>
            runs.markFailed({
              id: runId,
              finishedAt: Date.now(),
              error: toIngestErrorEnvelope(error, {
                runId,
                operation
              })
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
        );

        return {
          runId,
          workflowInstanceId: runId,
          status: "queued"
        } satisfies IngestQueuedResponse;
      });

      const startCronHeadSweep = Effect.fn("IngestWorkflowLauncher.startCronHeadSweep")(function* (
        scheduledTime: number
      ) {
        const operation = "IngestWorkflowLauncher.startCronHeadSweep";
        const runId = toCronSlotId(scheduledTime);
        const inserted = yield* runs.createQueuedIfAbsent({
          id: runId,
          workflowInstanceId: runId,
          kind: "head-sweep",
          triggeredBy: "cron",
          requestedBy: null,
          startedAt: scheduledTime
        });

        if (!inserted) {
          yield* Effect.logInfo("ingest cron slot already queued").pipe(
            Effect.annotateLogs({
              runId,
              scheduledTime
            })
          );
          return;
        }

        const params = yield* decodeIngestRunParams({
          kind: "head-sweep",
          triggeredBy: "cron"
        }, operation);

        yield* launchWorkflow(operation, () =>
          workflow.createBatch([
            {
              id: runId,
              params
            }
          ])
        ).pipe(
          Effect.asVoid,
          Effect.catchAll((error) =>
            runs.markFailed({
              id: runId,
              finishedAt: Date.now(),
              error: toIngestErrorEnvelope(error, {
                runId,
                operation
              })
            }).pipe(Effect.zipRight(Effect.fail(error)))
          )
        );
      });

      return IngestWorkflowLauncher.of({
        start,
        startCronHeadSweep
      });
    })
  );
}
