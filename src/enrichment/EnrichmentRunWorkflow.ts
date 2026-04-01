import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Either, ManagedRuntime, Schema } from "effect";
import {
  defaultSchemaVersionForEnrichmentKind,
  type EnrichmentOutput,
  type VisionEnrichment
} from "../domain/enrichment";
import {
  describeEnrichmentPlanStopReason,
  type EnrichmentExecutionPlan,
  isSourceAttributionExecutionPlan,
  isVisionExecutionPlan,
  type SourceAttributionExecutionPlan as SourceAttributionExecutionPlanValue,
  type VisionExecutionPlan as VisionExecutionPlanValue
} from "../domain/enrichmentPlan";
import {
  EnrichmentRunParams,
  type EnrichmentRunParams as EnrichmentRunParamsValue
} from "../domain/enrichmentRun";
import {
  EnrichmentDependencyPendingError,
  EnrichmentPayloadMissingError,
  EnrichmentQualityGateError,
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
import { EnrichmentWorkflowLauncher } from "./EnrichmentWorkflowLauncher";
import { assessVisionQuality } from "./EnrichmentQualityGate";
import { SourceAttributionExecutor } from "./SourceAttributionExecutor";
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

  private persistEnrichment(
    plan: EnrichmentExecutionPlan,
    enrichment: EnrichmentOutput,
    resultWrittenAt: number
  ) {
    return Effect.flatMap(CandidatePayloadRepo, (payloads) =>
      payloads.saveEnrichment(
        {
          postUri: plan.postUri,
          enrichmentType: plan.enrichmentType,
          enrichmentPayload: enrichment
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

      if (
        isSkippedEnrichmentPlan(plan) &&
        plan.enrichmentType === "source-attribution" &&
        plan.stopReason === "awaiting-vision"
      ) {
        await this.runEffect(
          EnrichmentDependencyPendingError.make({
            dependency: "vision",
            postUri: plan.postUri,
            operation: "EnrichmentRunWorkflow.run"
          }),
          "EnrichmentRunWorkflow.awaitingVision"
        );
      }

      if (!isVisionExecutionPlan(plan) && !isSourceAttributionExecutionPlan(plan)) {
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

      const enrichment = isVisionExecutionPlan(plan)
        ? await step.do("execute vision enrichment", async () =>
            this.runEffect(
              Effect.flatMap(VisionEnrichmentExecutor, (executor) =>
                executor.execute(plan as VisionExecutionPlanValue)
              ),
              "EnrichmentRunWorkflow.executeVision"
            )
          )
        : await step.do("execute source attribution", async () =>
            this.runEffect(
              Effect.flatMap(SourceAttributionExecutor, (executor) =>
                executor.execute(plan as SourceAttributionExecutionPlanValue)
              ),
              "EnrichmentRunWorkflow.executeSourceAttribution"
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
      await step.do(`persist ${plan.enrichmentType} enrichment`, async () =>
        this.runEffect(
          this.persistEnrichment(plan, enrichment, resultWrittenAt),
          "EnrichmentRunWorkflow.persistEnrichment"
        )
      );

      // --- Quality gate (Enriching → Reviewable transition) ---
      // Classification only, no retry. Vision output is deterministic for
      // a given input. Quality improvement comes from prompt tuning
      // (SKY-42/SKY-51) and manual retry via EnrichmentRepairService.
      if (isVisionExecutionPlan(plan)) {
        const verdict = assessVisionQuality(enrichment as VisionEnrichment);
        if (verdict.outcome === "needs-review") {
          await step.do("mark needs review (quality gate)", async () =>
            this.runEffect(
              Effect.flatMap(EnrichmentRunsRepo, (runs) =>
                runs.markNeedsReview({
                  id: run.id,
                  lastProgressAt: Date.now(),
                  resultWrittenAt,
                  error: toEnrichmentErrorEnvelope(
                    EnrichmentQualityGateError.make({
                      postUri: plan.postUri,
                      reason: verdict.reason
                    }),
                    {
                      runId,
                      operation: "EnrichmentRunWorkflow.qualityGate"
                    }
                  )
                })
              ),
              "EnrichmentRunWorkflow.markNeedsReviewQuality"
            )
          );

          // Early return — source-attribution is NOT queued.
          // Intentional: weak vision output makes downstream attribution unreliable.
          return {
            runId,
            status: "needs-review"
          } as const;
        }
      }

      if (isVisionExecutionPlan(plan)) {
        await step.do("queue source attribution", async () =>
          this.runEffect(
            Effect.flatMap(EnrichmentWorkflowLauncher, (launcher) =>
              launcher.startIfAbsent({
                postUri: plan.postUri,
                enrichmentType: "source-attribution",
                schemaVersion: defaultSchemaVersionForEnrichmentKind(
                  "source-attribution"
                ),
                triggeredBy: run.triggeredBy,
                requestedBy: run.requestedBy
              })
            ),
            "EnrichmentRunWorkflow.queueSourceAttribution"
          )
        );
      }

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
