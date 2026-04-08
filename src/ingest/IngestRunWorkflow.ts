import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep
} from "cloudflare:workers";
import { Effect, Result, ManagedRuntime, Schema } from "effect";
import type { Did } from "../domain/types";
import {
  IngestSchemaDecodeError,
  WorkflowRunCompensationError,
  legacyIngestErrorEnvelope,
  toIngestErrorEnvelope
} from "../domain/errors";
import type { WorkflowIngestEnvBindings } from "../platform/Env";
import {
  atRuntimeBoundary,
  makeManagedRuntime,
  runScopedWithRuntime
} from "../platform/EffectRuntime";
import { ExpertsRepo } from "../services/ExpertsRepo";
import { IngestRunsRepo } from "../services/IngestRunsRepo";
import { IngestRunItemsRepo } from "../services/IngestRunItemsRepo";
import { KnowledgeRepo } from "../services/KnowledgeRepo";
import type {
  IngestRunParams,
  PollMode
} from "../domain/polling";
import { IngestRunParams as IngestRunParamsSchema } from "../domain/polling";
import type {
  EnqueueBackfillCoordinatorInput,
  EnqueueHeadCoordinatorInput,
  EnqueueReconcileCoordinatorInput
} from "./ExpertPollCoordinatorState";
import { IngestRepairService } from "./IngestRepairService";
import { makeWorkflowIngestLayer } from "./Router";
import { formatSchemaParseError, stringifyUnknown } from "../platform/Json";

const WORKFLOW_FANOUT_HEAD = 10;
const WORKFLOW_FANOUT_BACKFILL = 3;
const WORKFLOW_FANOUT_RECONCILE = 5;
const WORKFLOW_POLL_INTERVAL_MS = 5_000;

type ExpertPollCoordinatorStub = DurableObjectStub & {
  enqueueHead(input: EnqueueHeadCoordinatorInput): Promise<unknown>;
  enqueueBackfill(input: EnqueueBackfillCoordinatorInput): Promise<unknown>;
  enqueueReconcile(input: EnqueueReconcileCoordinatorInput): Promise<unknown>;
};

const dedupe = <A>(values: ReadonlyArray<A>) => [...new Set(values)];

const modeForKind = (kind: IngestRunParams["kind"]): PollMode =>
  kind === "head-sweep" ? "head" : kind;

const fanoutForKind = (kind: IngestRunParams["kind"]): number => {
  switch (modeForKind(kind)) {
    case "head":
      return WORKFLOW_FANOUT_HEAD;
    case "backfill":
      return WORKFLOW_FANOUT_BACKFILL;
    case "reconcile":
      return WORKFLOW_FANOUT_RECONCILE;
  }
};

const decodeIngestRunParams = (input: unknown) =>
  (() => {
    const decoded = Schema.decodeUnknownResult(IngestRunParamsSchema)(input);
    return Result.isSuccess(decoded)
      ? Effect.succeed(decoded.success)
      : Effect.fail(
          new IngestSchemaDecodeError({
            message: formatSchemaParseError(decoded.failure),
            operation: "IngestRunWorkflow.run"
          })
        );
  })();

export class IngestRunWorkflow extends WorkflowEntrypoint<
  WorkflowIngestEnvBindings,
  IngestRunParams
> {
  private runtime: ManagedRuntime.ManagedRuntime<any, any> | undefined;

  private getRuntime() {
    this.runtime ??= makeManagedRuntime(makeWorkflowIngestLayer(this.env));
    return this.runtime;
  }

  private runEffect = async <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    operation = "IngestRunWorkflow.run"
  ) =>
    runScopedWithRuntime(
      this.getRuntime(),
      atRuntimeBoundary(effect),
      { operation }
    );

  private logEventEffect = (
    event: string,
    annotations: Record<string, string | number | boolean>
  ) =>
    Effect.logInfo(event).pipe(
      Effect.annotateLogs(annotations)
    );

  private logEvent(
    event: string,
    annotations: Record<string, string | number | boolean>
  ) {
    return this.runEffect(
      this.logEventEffect(event, annotations),
      `IngestRunWorkflow.log:${event}`
    );
  }

  private coordinatorStub(did: Did): ExpertPollCoordinatorStub {
    const namespace = this.env.EXPERT_POLL_COORDINATOR;
    return namespace.get(namespace.idFromName(did)) as ExpertPollCoordinatorStub;
  }

  private async resolveTargets(params: IngestRunParams): Promise<ReadonlyArray<Did>> {
    return await this.runEffect(
      Effect.gen(function* () {
        if (params.dids !== undefined) {
          return dedupe(params.dids);
        }

        const experts = yield* ExpertsRepo;
        const active = yield* experts.listActive();
        return active
          .filter((e) => !(e.did as string).startsWith("did:x:"))
          .map((expert) => expert.did);
      })
    );
  }

  private async createRunItems(
    runId: string,
    targets: ReadonlyArray<Did>,
    params: IngestRunParams
  ) {
    const mode = modeForKind(params.kind);
    await this.runEffect(
      Effect.gen(function* () {
        const items = yield* IngestRunItemsRepo;
        yield* items.createMany(
          targets.map((did) => ({
            runId,
            did,
            mode
          }))
        );
      })
    );

    return {
      queuedExperts: targets.length,
      mode
    } as const;
  }

  private async markPreparing(runId: string) {
    await this.runEffect(
      Effect.gen(function* () {
        const runs = yield* IngestRunsRepo;
        yield* runs.markPreparing({
          id: runId,
          lastProgressAt: Date.now()
        });
      })
    );
  }

  private async markDispatching(runId: string, totalExperts: number) {
    await this.runEffect(
      Effect.gen(function* () {
        const runs = yield* IngestRunsRepo;
        yield* runs.markDispatching({
          id: runId,
          totalExperts,
          lastProgressAt: Date.now()
        });
      })
    );
  }

  private async repairLiveRun(runId: string) {
    return await this.runEffect(
      IngestRepairService.use( (repair) =>
        repair.repairLiveRun(runId)
      ),
      "IngestRunWorkflow.repairLiveRun"
    );
  }

  private async dispatchAvailable(runId: string, params: IngestRunParams) {
    const coordinatorStub = (did: Did) => this.coordinatorStub(did);

    return await this.runEffect(
      Effect.gen(function* () {
        const items = yield* IngestRunItemsRepo;
        const runs = yield* IngestRunsRepo;
        const repair = yield* IngestRepairService;
        const recovered = yield* repair.repairLiveRun(runId);
        const active = yield* items.countActiveByRun(runId);
        const fanout = fanoutForKind(params.kind);
        const available = Math.max(0, fanout - active);
        if (available > 0) {
          const undispatched = yield* items.listUndispatchedByRun(runId, available);
          const enqueuedAt = Date.now();

          yield* Effect.forEach(
            undispatched,
            (item) =>
              Effect.promise(async () => {
                const stub = coordinatorStub(item.did);
                if (params.kind === "head-sweep") {
                  await stub.enqueueHead({
                    did: item.did,
                    runId
                  });
                } else if (params.kind === "backfill") {
                  await stub.enqueueBackfill({
                    did: item.did,
                    runId,
                    ...(params.maxPosts === undefined ? {} : { maxPosts: params.maxPosts }),
                    ...(params.maxAgeDays === undefined ? {} : { maxAgeDays: params.maxAgeDays })
                  });
                } else {
                  await stub.enqueueReconcile({
                    did: item.did,
                    runId,
                    ...(params.depth === undefined ? {} : { depth: params.depth })
                  });
                }
              }).pipe(
                Effect.andThen(
                  items.markDispatched({
                    runId,
                    did: item.did,
                    mode: item.mode,
                    enqueuedAt,
                    lastProgressAt: enqueuedAt
                  })
                )
              ),
            { discard: true }
          );
        }

        const incomplete = yield* items.countIncompleteByRun(runId);

        // Periodic progress rollup — best-effort, never aborts the workflow
        yield* Effect.gen(function* () {
          const summary = yield* items.summarizeByRun(runId);
          const { error: _error, ...counters } = summary;
          yield* runs.updateProgress({
            id: runId,
            lastProgressAt: Date.now(),
            ...counters
          });
        }).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("progress rollup failed, continuing").pipe(
              Effect.annotateLogs({ runId, error: String(cause) })
            )
          )
        );

        return {
          terminal: incomplete === 0,
          recovered
        };
      })
    );
  }

  private async finalizeRun(runId: string) {
    return await this.runEffect(
      Effect.gen(function* () {
        const runs = yield* IngestRunsRepo;
        const items = yield* IngestRunItemsRepo;
        yield* runs.markFinalizing({
          id: runId,
          lastProgressAt: Date.now()
        });
        const summary = yield* items.summarizeByRun(runId);
        const { error, ...counters } = summary;
        const finishedAt = Date.now();

        if (summary.expertsFailed > 0) {
          yield* runs.markFailed({
            id: runId,
            finishedAt,
            error: error ?? legacyIngestErrorEnvelope(
              `${summary.expertsFailed} ingest items failed`
            ),
            ...counters
          });
        } else {
          yield* runs.markComplete({
            id: runId,
            finishedAt,
            ...counters
          });
        }

        return yield* runs.getById(runId);
      })
    );
  }

  private async compensateFailure(runId: string, error: unknown) {
    return await this.runEffect(
      Effect.gen(function* () {
        const runs = yield* IngestRunsRepo;
        const items = yield* IngestRunItemsRepo;
        const summary = yield* items.summarizeByRun(runId);
        const finishedAt = Date.now();

        yield* runs.markFailed({
          id: runId,
          finishedAt,
          ...summary,
          error: toIngestErrorEnvelope(
            new WorkflowRunCompensationError({
              message: `workflow failed after run creation: ${stringifyUnknown(error)}`,
              runId,
              operation: "IngestRunWorkflow.run"
            }),
            {
              runId,
              operation: "IngestRunWorkflow.run"
            }
          )
        });

        return yield* runs.getById(runId);
      }),
      "IngestRunWorkflow.compensateFailure"
    );
  }

  private async dispatchUntilTerminal(
    step: WorkflowStep,
    runId: string,
    payload: IngestRunParams
  ) {
    const self = this;
    await self.runEffect(
      Effect.gen(function* () {
        let iteration = 0;
        let terminal = false;
        while (!terminal) {
          const currentIteration = iteration;
          const dispatch = yield* Effect.promise(async () =>
            await step.do(`dispatch-${currentIteration}`, async () => {
              const d = await self.dispatchAvailable(runId, payload);
              await self.logEvent("ingest-workflow-dispatch", {
                runId,
                iteration: currentIteration,
                terminal: d.terminal,
                requeuedItems: d.recovered.requeuedItems,
                failedItems: d.recovered.failedItems
              });
              return d;
            })
          );
          if (dispatch.terminal) {
            terminal = true;
          } else {
            yield* Effect.promise(async () => {
              await step.sleep(`wait-${currentIteration}`, WORKFLOW_POLL_INTERVAL_MS);
            });
            iteration = currentIteration + 1;
          }
        }
      }),
      "IngestRunWorkflow.dispatchUntilTerminal"
    );
  }

  override async run(event: WorkflowEvent<IngestRunParams>, step: WorkflowStep) {
    const runId = event.instanceId;
    try {
      const payload = await this.runEffect(
        decodeIngestRunParams(event.payload),
        "IngestRunWorkflow.decodePayload"
      );
      const markRunningLog = this.logEventEffect("ingest-workflow-marked-running", {
        runId,
        kind: payload.kind
      });

      await step.do("mark run running", async () => {
        await this.markPreparing(runId);
        await this.runEffect(markRunningLog);
        return {
          runId,
          status: "running" as const
        };
      });

      const targets = await step.do("resolve targets", async () => {
        const resolvedTargets = await this.resolveTargets(payload);
        await this.logEvent("ingest-workflow-resolved-targets", {
          runId,
          targets: resolvedTargets.length
        });
        return resolvedTargets;
      });

      await step.do("create run items", async () => {
        const created = await this.createRunItems(runId, targets, payload);
        await this.markDispatching(runId, created.queuedExperts);
        await this.logEvent("ingest-workflow-created-items", {
          runId,
          targets: targets.length,
          queuedExperts: created.queuedExperts,
          mode: created.mode
        });
        return created;
      });

      await this.dispatchUntilTerminal(step, runId, payload);

      await step.do("finalize run", async () => {
        const finalized = await this.finalizeRun(runId);
        await this.logEvent("ingest-workflow-finished", {
          runId,
          status: finalized?.status ?? "unknown"
        });
        return finalized;
      });

      await step.do("optimize fts index", async () => {
        await this.runEffect(
          Effect.gen(function* () {
            const repo = yield* KnowledgeRepo;
            yield* repo.optimizeFts().pipe(
              Effect.catch((error) =>
                Effect.logWarning("FTS optimize failed (non-fatal)").pipe(
                  Effect.annotateLogs({ error: String(error) })
                )
              )
            );
          }),
          "IngestRunWorkflow.optimizeFts"
        );
      });
    } catch (error) {
      await step.do("compensate run failure", async () => {
        const compensated = await this.compensateFailure(runId, error);
        await this.logEvent("ingest-workflow-compensated-failure", {
          runId,
          status: compensated?.status ?? "failed"
        });
        return compensated;
      });
      throw error;
    }
  }
}
