import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, ManagedRuntime, Result, Schema } from "effect";
import {
  DataRefResolutionEnrichment,
  defaultSchemaVersionForEnrichmentKind,
  type EnrichmentKind,
  type EnrichmentOutput,
  type SourceAttributionEnrichment,
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
import {
  atRuntimeBoundary,
  makeManagedRuntime,
  runScopedWithRuntime
} from "../platform/EffectRuntime";
import { AppConfig } from "../platform/Config";
import type { WorkflowEnrichmentEnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
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
import { ResolverClient } from "../resolver/Client";
import { buildStage1Input } from "../resolver/stage1Input";

const decodeEnrichmentRunParams = (input: unknown) =>
  Schema.decodeUnknownEffect(EnrichmentRunParams)(input).pipe(
    Effect.mapError(
      (decodeError) =>
        new EnrichmentSchemaDecodeError({
          message: formatSchemaParseError(decodeError),
          operation: "EnrichmentRunWorkflow.run"
        })
    )
  );

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
      atRuntimeBoundary(effect),
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
    postUri: EnrichmentExecutionPlan["postUri"],
    enrichmentType: EnrichmentKind,
    enrichment: EnrichmentOutput,
    resultWrittenAt: number
  ) {
    return CandidatePayloadRepo.use( (payloads) =>
      payloads.saveEnrichment(
        {
          postUri,
          enrichmentType,
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
              new EnrichmentPayloadMissingError({
                postUri
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
          EnrichmentRunsRepo.use( (runs) =>
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
          EnrichmentRunsRepo.use( (runs) =>
            runs.getById(runId)
          ).pipe(
            Effect.flatMap((record) =>
              record === null
                ? Effect.fail(
                    new EnrichmentRunNotFoundError({ runId })
                  )
                : Effect.succeed(record)
            )
          ),
          "EnrichmentRunWorkflow.loadRun"
        )
      );

      await step.do("mark planning", async () =>
        this.runEffect(
          EnrichmentRunsRepo.use( (runs) =>
            runs.markPhase({
              id: run.id,
              phase: "planning",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markPlanning"
        )
      );

      const plan = await this.runEffect(
        EnrichmentPlanner.use( (planner) =>
          planner.plan({
            postUri: run.postUri,
            enrichmentType: run.enrichmentType,
            schemaVersion: run.schemaVersion
          })
        ),
        "EnrichmentRunWorkflow.plan"
      );

      if (
        isSkippedEnrichmentPlan(plan) &&
        plan.enrichmentType === "source-attribution" &&
        plan.stopReason === "awaiting-vision"
      ) {
        await this.runEffect(
          Effect.fail(new EnrichmentDependencyPendingError({
            dependency: "vision",
            postUri: plan.postUri,
            operation: "EnrichmentRunWorkflow.run"
          })),
          "EnrichmentRunWorkflow.awaitingVision"
        );
      }

      if (!isVisionExecutionPlan(plan) && !isSourceAttributionExecutionPlan(plan)) {
        await step.do("mark needs review", async () =>
          this.runEffect(
            EnrichmentRunsRepo.use( (runs) =>
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
          EnrichmentRunsRepo.use( (runs) =>
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
              VisionEnrichmentExecutor.use( (executor) =>
                executor.execute(plan as VisionExecutionPlanValue)
              ),
              "EnrichmentRunWorkflow.executeVision"
            )
          )
        : await step.do("execute source attribution", async () =>
            this.runEffect(
              SourceAttributionExecutor.use( (executor) =>
                executor.execute(plan as SourceAttributionExecutionPlanValue)
              ),
              "EnrichmentRunWorkflow.executeSourceAttribution"
            )
          );

      await step.do("mark persisting", async () =>
        this.runEffect(
          EnrichmentRunsRepo.use( (runs) =>
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
      let latestResultWrittenAt = resultWrittenAt;
      await step.do(`persist ${plan.enrichmentType} enrichment`, async () =>
        this.runEffect(
          this.persistEnrichment(
            plan.postUri,
            plan.enrichmentType,
            enrichment,
            resultWrittenAt
          ),
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
              EnrichmentRunsRepo.use( (runs) =>
                runs.markNeedsReview({
                  id: run.id,
                  lastProgressAt: Date.now(),
                  resultWrittenAt: latestResultWrittenAt,
                  error: toEnrichmentErrorEnvelope(
                    new EnrichmentQualityGateError({
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
            EnrichmentWorkflowLauncher.use( (launcher) =>
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

      if (isSourceAttributionExecutionPlan(plan)) {
        const config = await this.runEffect(
          Effect.gen(function* () {
            return yield* AppConfig;
          }),
          "EnrichmentRunWorkflow.loadConfig"
        );

        if (!config.enableDataRefResolution) {
          await step.do("mark complete", async () =>
            this.runEffect(
              EnrichmentRunsRepo.use( (runs) =>
                runs.markComplete({
                  id: run.id,
                  finishedAt: Date.now(),
                  resultWrittenAt: latestResultWrittenAt
                })
              ),
              "EnrichmentRunWorkflow.markComplete"
            )
          );

          return {
            runId,
            status: "complete"
          } as const;
        }

        const resolverResponse = await step.do(
          "call resolver service binding",
          async () =>
            this.runEffect(
              ResolverClient.use((client) =>
                client.resolvePost(
                  {
                    postUri: plan.postUri,
                    stage1Input: buildStage1Input(
                      plan,
                      enrichment as SourceAttributionEnrichment
                    )
                  },
                  {
                    requestId: run.id
                  }
                )
              ).pipe(
                Effect.tapError((error) =>
                  Logging.logWarning("data-ref resolution skipped after resolver failure", {
                    postUri: plan.postUri,
                    runId: run.id,
                    errorTag: error._tag
                  })
                ),
                Effect.result,
                Effect.map((result) =>
                  Result.isSuccess(result) ? result.success : null
                )
              ),
              "EnrichmentRunWorkflow.resolveDataRefs"
            )
        );

        if (resolverResponse !== null) {
          const resolverWrittenAt = Date.now();
          latestResultWrittenAt = resolverWrittenAt;
          const decodedResolverEnrichment = await this.runEffect(
            Schema.decodeUnknownEffect(DataRefResolutionEnrichment)({
              kind: "data-ref-resolution",
              stage1: resolverResponse.stage1,
              resolution: resolverResponse.resolution,
              resolverVersion: resolverResponse.resolverVersion,
              processedAt: resolverWrittenAt
            }).pipe(
              Effect.mapError(
                (decodeError) =>
                  new EnrichmentSchemaDecodeError({
                    message: formatSchemaParseError(decodeError),
                    operation: "EnrichmentRunWorkflow.resolveDataRefs"
                  })
              )
            ),
            "EnrichmentRunWorkflow.decodeDataRefResolution"
          );

          await step.do("persist data-ref resolution", async () =>
            this.runEffect(
              this.persistEnrichment(
                plan.postUri,
                "data-ref-resolution",
                decodedResolverEnrichment,
                resolverWrittenAt
              ),
              "EnrichmentRunWorkflow.persistDataRefResolution"
            )
          );
        }
      }

      await step.do("mark complete", async () =>
        this.runEffect(
          EnrichmentRunsRepo.use( (runs) =>
            runs.markComplete({
              id: run.id,
              finishedAt: Date.now(),
              resultWrittenAt: latestResultWrittenAt
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
        EnrichmentRunsRepo.use( (runs) =>
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
