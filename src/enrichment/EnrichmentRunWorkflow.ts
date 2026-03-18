import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Either, ManagedRuntime, Schema } from "effect";
import {
  EnrichmentRunParams,
  type EnrichmentRunParams as EnrichmentRunParamsValue
} from "../domain/enrichmentRun";
import {
  EnrichmentRunNotFoundError,
  EnrichmentSchemaDecodeError,
  toEnrichmentErrorEnvelope
} from "../domain/errors";
import { makeManagedRuntime, runScopedWithRuntime } from "../platform/EffectRuntime";
import type { WorkflowEnrichmentEnvBindings } from "../platform/Env";
import { EnrichmentRunsRepo } from "../services/EnrichmentRunsRepo";
import { formatSchemaParseError } from "../platform/Json";
import { makeWorkflowEnrichmentLayer } from "./Layer";

const decodeEnrichmentRunParams = (input: unknown) =>
  (() => {
    const decoded = Schema.decodeUnknownEither(EnrichmentRunParams)(input);
    return Either.isRight(decoded)
      ? Effect.succeed(decoded.right)
      : Effect.fail(
          EnrichmentSchemaDecodeError.make({
            message: formatSchemaParseError(decoded.left),
            operation: "EnrichmentRunWorkflow.run"
          })
        );
  })();

export class EnrichmentRunWorkflow extends WorkflowEntrypoint<
  WorkflowEnrichmentEnvBindings,
  EnrichmentRunParamsValue
> {
  private runtime: ManagedRuntime.ManagedRuntime<any, any> | undefined;

  private getRuntime() {
    this.runtime ??= makeManagedRuntime(makeWorkflowEnrichmentLayer(this.env));
    return this.runtime;
  }

  private runEffect = async <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    operation = "EnrichmentRunWorkflow.run"
  ) =>
    runScopedWithRuntime(
      this.getRuntime(),
      effect as Effect.Effect<A, E, never>,
      { operation }
    );

  override async run(
    event: WorkflowEvent<EnrichmentRunParamsValue>,
    step: WorkflowStep
  ) {
    const runId = event.instanceId;

    try {
      await this.runEffect(
        decodeEnrichmentRunParams(event.payload),
        "EnrichmentRunWorkflow.decode"
      );

      await step.do("mark assembling", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markPhase({
              id: runId,
              phase: "assembling",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markAssembling"
        )
      );

      const run = await step.do("load run", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.getById(runId)
          ).pipe(
            Effect.flatMap((record) =>
              record === null
                ? Effect.fail(
                    EnrichmentRunNotFoundError.make({ runId })
                  )
                : Effect.succeed(record)
            )
          ),
          "EnrichmentRunWorkflow.loadRun"
        )
      );

      await step.do("mark planning", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markPhase({
              id: run.id,
              phase: "planning",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markPlanning"
        )
      );

      await step.do("mark needs review", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markNeedsReview({
              id: run.id,
              lastProgressAt: Date.now(),
              error: toEnrichmentErrorEnvelope({
                _tag: "EnrichmentExecutionDeferred",
                message: "enrichment execution lane not implemented yet"
              }, {
                runId,
                operation: "EnrichmentRunWorkflow.run"
              })
            })
          ),
          "EnrichmentRunWorkflow.markNeedsReview"
        )
      );

      return {
        runId,
        status: "needs-review"
      } as const;
    } catch (error) {
      await this.runEffect(
        Effect.flatMap(EnrichmentRunsRepo, (runs) =>
          runs.markFailed({
            id: runId,
            finishedAt: Date.now(),
            error: toEnrichmentErrorEnvelope(error, {
              runId,
              operation: "EnrichmentRunWorkflow.run"
            })
          })
        ),
        "EnrichmentRunWorkflow.markFailed"
      );
      throw error;
    }
  }
}
