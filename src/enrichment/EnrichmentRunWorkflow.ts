import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Either, ManagedRuntime, Schema } from "effect";
import {
  describeEnrichmentPlanStopReason,
  type EnrichmentExecutionPlan,
  isVisionExecutionPlan,
  type VisionExecutionPlan as VisionExecutionPlanValue
} from "../domain/enrichmentPlan";
import {
  EnrichmentRunParams,
  type EnrichmentRunParams as EnrichmentRunParamsValue
} from "../domain/enrichmentRun";
import {
  EnrichmentPayloadMissingError,
  EnrichmentRunNotFoundError,
  EnrichmentSchemaDecodeError,
  toEnrichmentErrorEnvelope
} from "../domain/errors";
import { makeManagedRuntime, runScopedWithRuntime } from "../platform/EffectRuntime";
import type { WorkflowEnrichmentEnvBindings } from "../platform/Env";
import { CandidatePayloadRepo } from "../services/CandidatePayloadRepo";
import { EnrichmentRunsRepo } from "../services/EnrichmentRunsRepo";
import { formatSchemaParseError } from "../platform/Json";
import { makeWorkflowEnrichmentLayer } from "./Layer";
import { EnrichmentPlanner } from "./EnrichmentPlanner";
import {
  defaultStopReasonForEnrichmentType,
  isSkippedEnrichmentPlan
} from "./EnrichmentPredicates";
import { VisionEnrichmentExecutor } from "./VisionEnrichmentExecutor";

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

  private needsReviewErrorFromPlan(
    runId: string,
    plan: EnrichmentExecutionPlan
  ) {
    return isSkippedEnrichmentPlan(plan)
      ? (() => {
          const reason =
            plan.stopReason ??
            defaultStopReasonForEnrichmentType(plan.enrichmentType);
          return toEnrichmentErrorEnvelope(
            {
              _tag: "EnrichmentPlanningStopped",
              message: `planner stopped: ${describeEnrichmentPlanStopReason(
                reason
              )}`
            },
            {
              runId,
              operation: "EnrichmentRunWorkflow.run"
            }
          );
        })()
      : toEnrichmentErrorEnvelope(
        {
          _tag: "EnrichmentExecutionDeferred",
          message: "enrichment execution lane not implemented yet"
        },
        {
          runId,
          operation: "EnrichmentRunWorkflow.run"
        }
      );
  }

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

      const plan = await step.do("assemble enrichment plan", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentPlanner, (planner) =>
            planner.plan({
              postUri: run.postUri,
              enrichmentType: run.enrichmentType,
              schemaVersion: run.schemaVersion
            })
          ),
          "EnrichmentRunWorkflow.plan"
        )
      );

      if (!isVisionExecutionPlan(plan)) {
        await step.do("mark needs review", async () =>
          this.runEffect(
            Effect.flatMap(EnrichmentRunsRepo, (runs) =>
              runs.markNeedsReview({
                id: run.id,
                lastProgressAt: Date.now(),
                error: this.needsReviewErrorFromPlan(runId, plan)
              })
            ),
            "EnrichmentRunWorkflow.markNeedsReview"
          )
        );

        return {
          runId,
          status: "needs-review"
        } as const;
      }

      await step.do("mark executing", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markPhase({
              id: run.id,
              phase: "executing",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markExecuting"
        )
      );

      const vision = await step.do("execute vision enrichment", async () =>
        this.runEffect(
          Effect.flatMap(VisionEnrichmentExecutor, (executor) =>
            executor.execute(plan as VisionExecutionPlanValue)
          ),
          "EnrichmentRunWorkflow.executeVision"
        )
      );

      await step.do("mark persisting", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markPhase({
              id: run.id,
              phase: "persisting",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markPersisting"
        )
      );

      const resultWrittenAt = Date.now();
      await step.do("persist vision enrichment", async () =>
        this.runEffect(
          Effect.flatMap(CandidatePayloadRepo, (payloads) =>
            payloads.saveEnrichment(
              {
                postUri: plan.postUri,
                enrichmentType: "vision",
                enrichmentPayload: vision
              },
              resultWrittenAt,
              resultWrittenAt
            )
          ).pipe(
            Effect.flatMap((saved) =>
              saved
                ? Effect.void
                : Effect.fail(
                    EnrichmentPayloadMissingError.make({
                      postUri: plan.postUri
                    })
                  )
            )
          ),
          "EnrichmentRunWorkflow.persistVision"
        )
      );

      await step.do("mark complete", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markComplete({
              id: run.id,
              finishedAt: Date.now(),
              resultWrittenAt
            })
          ),
          "EnrichmentRunWorkflow.markComplete"
        )
      );

      return {
        runId,
        status: "complete"
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
