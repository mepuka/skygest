import { ServiceMap, Effect, Result, Layer, Schema } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  EnrichmentRunParams,
  type EnrichmentQueuedResponse
} from "../domain/enrichmentRun";
import {
  EnrichmentSchemaDecodeError,
  EnrichmentWorkflowLaunchError,
  toEnrichmentErrorEnvelope
} from "../domain/errors";
import { WorkflowEnrichmentEnv } from "../platform/Env";
import { formatSchemaParseError, stringifyUnknown } from "../platform/Json";
import { EnrichmentRunsRepo } from "../services/EnrichmentRunsRepo";
import { VISION_PROMPT_VERSION } from "./prompts";

const decodeEnrichmentRunParams = (input: unknown, operation: string) =>
  (() => {
    const decoded = Schema.decodeUnknownResult(EnrichmentRunParams)(input);
    return Result.isSuccess(decoded)
      ? Effect.succeed(decoded.success)
      : Effect.fail(
          new EnrichmentSchemaDecodeError({
            message: formatSchemaParseError(decoded.failure),
            operation
          })
        );
  })();

const launchWorkflow = <A>(operation: string, thunk: () => Promise<A>) =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) =>
      new EnrichmentWorkflowLaunchError({
        message: stringifyUnknown(cause),
        operation
      })
  });

export class EnrichmentWorkflowLauncher extends ServiceMap.Service<
  EnrichmentWorkflowLauncher,
  {
    readonly start: (
      params: EnrichmentRunParams
    ) => Effect.Effect<
      EnrichmentQueuedResponse,
      SqlError | DbError | EnrichmentSchemaDecodeError | EnrichmentWorkflowLaunchError
    >;
    readonly startIfAbsent: (
      params: EnrichmentRunParams
    ) => Effect.Effect<
      boolean,
      SqlError | DbError | EnrichmentSchemaDecodeError | EnrichmentWorkflowLaunchError
    >;
  }
>()("@skygest/EnrichmentWorkflowLauncher") {
  static readonly layer = Layer.effect(
    EnrichmentWorkflowLauncher,
    Effect.gen(function* () {
      const env = yield* WorkflowEnrichmentEnv;
      const runs = yield* EnrichmentRunsRepo;
      const workflow = env.ENRICHMENT_RUN_WORKFLOW;

      const queueRun = Effect.fn("EnrichmentWorkflowLauncher.queueRun")(function* (
        params: EnrichmentRunParams
      ) {
        const operation = "EnrichmentWorkflowLauncher.start";
        const validatedParams = yield* decodeEnrichmentRunParams(params, operation);
        const runId = crypto.randomUUID();
        const startedAt = Date.now();
        const modelLane = validatedParams.enrichmentType === "vision"
          ? env.GEMINI_VISION_MODEL ?? "gemini-2.5-flash"
          : null;
        const promptVersion = validatedParams.enrichmentType === "vision"
          ? VISION_PROMPT_VERSION
          : null;

        const inserted = yield* runs.createQueuedIfAbsent({
          id: runId,
          workflowInstanceId: runId,
          postUri: validatedParams.postUri,
          enrichmentType: validatedParams.enrichmentType,
          schemaVersion: validatedParams.schemaVersion,
          triggeredBy: validatedParams.triggeredBy,
          requestedBy: validatedParams.requestedBy ?? null,
          modelLane,
          promptVersion,
          inputFingerprint: null,
          startedAt
        });

        if (!inserted) {
          return null;
        }

        yield* launchWorkflow(operation, () =>
          workflow.create({
            id: runId,
            params: validatedParams
          })
        ).pipe(
          Effect.catch((error) =>
            runs.markFailed({
              id: runId,
              finishedAt: Date.now(),
              error: toEnrichmentErrorEnvelope(error, {
                runId,
                operation
              })
            }).pipe(Effect.andThen(Effect.fail(error)))
          )
        );

        return {
          runId,
          workflowInstanceId: runId,
          status: "queued"
        } satisfies EnrichmentQueuedResponse;
      });

      const startIfAbsent = Effect.fn(
        "EnrichmentWorkflowLauncher.startIfAbsent"
      )(function* (params: EnrichmentRunParams) {
        const queued = yield* queueRun(params);
        return queued !== null;
      });

      const start = Effect.fn("EnrichmentWorkflowLauncher.start")(function* (
        params: EnrichmentRunParams
      ) {
        const queued = yield* queueRun(params);

        if (queued === null) {
          return yield* new EnrichmentWorkflowLaunchError({
            message: `enrichment run already exists for ${params.postUri}`,
            operation: "EnrichmentWorkflowLauncher.start"
          });
        }

        return queued;
      });

      return {
        start,
        startIfAbsent
      };
    })
  );
}
