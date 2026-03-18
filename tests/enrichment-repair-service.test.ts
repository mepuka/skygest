import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type {
  EnrichmentRunRecord,
  EnrichmentRunStatus
} from "../src/domain/enrichmentRun";
import { EnrichmentRepairService } from "../src/enrichment/EnrichmentRepairService";
import {
  WorkflowEnrichmentEnv,
  type WorkflowEnrichmentEnvBindings
} from "../src/platform/Env";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";

const asAtUri = (value: string) => value as EnrichmentRunRecord["postUri"];

const makeRun = (
  overrides: Partial<EnrichmentRunRecord> = {}
): EnrichmentRunRecord => ({
  id: "run-1",
  workflowInstanceId: "run-1",
  postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
  enrichmentType: "vision",
  schemaVersion: "v1",
  triggeredBy: "admin",
  requestedBy: "operator@example.com",
  status: "failed",
  phase: "failed",
  attemptCount: 1,
  modelLane: null,
  promptVersion: null,
  inputFingerprint: null,
  startedAt: 1,
  finishedAt: 2,
  lastProgressAt: 2,
  resultWrittenAt: null,
  error: {
    tag: "EnrichmentExecutionDeferred",
    message: "not implemented",
    retryable: false
  },
  ...overrides
});

const isStale = (
  run: EnrichmentRunRecord,
  queuedBefore: number,
  runningBefore: number
) =>
  (run.status === "queued" &&
    (run.lastProgressAt ?? run.startedAt) <= queuedBefore) ||
  (run.status === "running" &&
    (run.lastProgressAt ?? run.startedAt) <= runningBefore);

const makeRepoLayer = (
  state: Map<string, EnrichmentRunRecord>,
  events: Array<unknown>
) =>
  Layer.succeed(EnrichmentRunsRepo, {
    createQueuedIfAbsent: () => Effect.succeed(true),
    getById: (id: string) => Effect.succeed(state.get(id) ?? null),
    listRunning: () =>
      Effect.succeed(
        Array.from(state.values()).filter((run) => run.status === "running")
      ),
    listRecent: ({ status, limit }) =>
      Effect.succeed(
        Array.from(state.values())
          .filter((run) => status === undefined || run.status === status)
          .sort((left, right) => right.startedAt - left.startedAt)
          .slice(0, limit)
      ),
    listActive: () =>
      Effect.succeed(
        Array.from(state.values()).filter(
          (run) => run.status === "queued" || run.status === "running"
        )
      ),
    listStaleActive: ({ queuedBefore, runningBefore }) =>
      Effect.succeed(
        Array.from(state.values()).filter((run) =>
          isStale(run, queuedBefore, runningBefore)
        )
      ),
    markPhase: () => Effect.void,
    markComplete: () => Effect.void,
    markFailed: (input) =>
      Effect.sync(() => {
        events.push({ type: "markFailed", input });
        const run = state.get(input.id);
        if (run !== undefined) {
          state.set(input.id, {
            ...run,
            status: "failed",
            phase: "failed",
            finishedAt: input.finishedAt,
            lastProgressAt: input.finishedAt,
            error: input.error
          });
        }
      }),
    markNeedsReview: () => Effect.void,
    resetForRetry: (input) =>
      Effect.sync(() => {
        events.push({ type: "resetForRetry", input });
        const run = state.get(input.id);
        if (
          run === undefined ||
          (run.status !== "failed" && run.status !== "needs-review")
        ) {
          return false;
        }

        state.set(input.id, {
          ...run,
          status: "queued",
          phase: "queued",
          startedAt: input.queuedAt,
          finishedAt: null,
          lastProgressAt: input.queuedAt,
          resultWrittenAt: null,
          error: null
        });
        return true;
      })
  });

const makeWorkflowLayer = (handlers: {
  readonly restart?: (runId: string) => Promise<void>;
  readonly terminate?: (runId: string) => Promise<void>;
}) => {
  const makeInstance = (runId: string) => ({
    id: runId,
    restart: async () => handlers.restart?.(runId),
    terminate: async () => handlers.terminate?.(runId),
    pause: async () => {},
    resume: async () => {},
    status: async () => ({ status: "running" as const }),
    sendEvent: async () => {}
  });

  const env: WorkflowEnrichmentEnvBindings = {
    DB: {} as D1Database,
    ENRICHMENT_RUN_WORKFLOW: {
      get: async (runId: string) => makeInstance(runId),
      create: async (options?: { readonly id?: string }) =>
        makeInstance(options?.id ?? "unused"),
      createBatch: async (batch: ReadonlyArray<{ readonly id?: string }>) =>
        batch.map((item) => makeInstance(item.id ?? "unused"))
    } as unknown as WorkflowEnrichmentEnvBindings["ENRICHMENT_RUN_WORKFLOW"]
  };

  return Layer.succeed(WorkflowEnrichmentEnv, env);
};

describe("EnrichmentRepairService", () => {
  it.effect("retries failed runs by resetting the same record and restarting the workflow", () =>
    Effect.gen(function* () {
      const state = new Map([
        ["run-1", makeRun()]
      ]);
      const events: Array<unknown> = [];
      const restarted: Array<string> = [];

      const layer = EnrichmentRepairService.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            makeRepoLayer(state, events),
            makeWorkflowLayer({
              restart: async (runId) => {
                restarted.push(runId);
              }
            })
          )
        )
      );

      const repair = yield* EnrichmentRepairService.pipe(Effect.provide(layer));
      const queued = yield* repair.retryRun("run-1", 100);

      expect(queued).toEqual({
        runId: "run-1",
        workflowInstanceId: "run-1",
        status: "queued"
      });
      expect(restarted).toEqual(["run-1"]);
      expect(state.get("run-1")).toEqual(
        expect.objectContaining({
          status: "queued",
          phase: "queued",
          attemptCount: 1,
          startedAt: 100,
          finishedAt: null,
          lastProgressAt: 100,
          error: null
        })
      );
      expect(events).toEqual([
        {
          type: "resetForRetry",
          input: { id: "run-1", queuedAt: 100 }
        }
      ]);
    })
  );

  it.effect("rejects retry when the run is not in a terminal retryable state", () =>
    Effect.gen(function* () {
      const state = new Map([
        [
          "run-1",
          makeRun({
            status: "complete" satisfies EnrichmentRunStatus,
            phase: "complete",
            error: null
          })
        ]
      ]);

      const layer = EnrichmentRepairService.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            makeRepoLayer(state, []),
            makeWorkflowLayer({})
          )
        )
      );

      const repair = yield* EnrichmentRepairService.pipe(Effect.provide(layer));
      const failure = yield* Effect.flip(repair.retryRun("run-1", 100));

      expect(failure).toMatchObject({
        _tag: "EnrichmentRetryNotAllowedError",
        runId: "run-1",
        status: "complete"
      });
    })
  );

  it.effect("re-fails the same run when workflow restart control fails", () =>
    Effect.gen(function* () {
      const state = new Map([
        [
          "run-1",
          makeRun({
            status: "needs-review",
            phase: "needs-review"
          })
        ]
      ]);
      const events: Array<unknown> = [];

      const layer = EnrichmentRepairService.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            makeRepoLayer(state, events),
            makeWorkflowLayer({
              restart: async () => {
                throw new Error("boom");
              }
            })
          )
        )
      );

      const repair = yield* EnrichmentRepairService.pipe(Effect.provide(layer));
      const failure = yield* Effect.flip(repair.retryRun("run-1", 100));

      expect(failure).toMatchObject({
        _tag: "EnrichmentWorkflowControlError",
        runId: "run-1"
      });
      expect(state.get("run-1")).toEqual(
        expect.objectContaining({
          status: "failed",
          phase: "failed",
          error: expect.objectContaining({
            tag: "EnrichmentWorkflowControlError",
            runId: "run-1"
          })
        })
      );
      expect(events).toEqual([
        {
          type: "resetForRetry",
          input: { id: "run-1", queuedAt: 100 }
        },
        {
          type: "markFailed",
          input: expect.objectContaining({
            id: "run-1",
            error: expect.objectContaining({
              tag: "EnrichmentWorkflowControlError",
              runId: "run-1"
            })
          })
        }
      ]);
    })
  );

  it.effect("repairs stale runs and leaves fresh active runs untouched across repeated passes", () =>
    Effect.gen(function* () {
      const state = new Map([
        [
          "stale-queued",
          makeRun({
            id: "stale-queued",
            workflowInstanceId: "stale-queued",
            status: "queued",
            phase: "queued",
            startedAt: 10,
            finishedAt: null,
            lastProgressAt: 10,
            error: null
          })
        ],
        [
          "stale-running",
          makeRun({
            id: "stale-running",
            workflowInstanceId: "stale-running",
            status: "running",
            phase: "planning",
            startedAt: 20,
            finishedAt: null,
            lastProgressAt: 20,
            error: null
          })
        ],
        [
          "fresh-running",
          makeRun({
            id: "fresh-running",
            workflowInstanceId: "fresh-running",
            status: "running",
            phase: "executing",
            startedAt: 1_900_000,
            finishedAt: null,
            lastProgressAt: 1_900_000,
            error: null
          })
        ]
      ]);
      const events: Array<unknown> = [];

      const layer = EnrichmentRepairService.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            makeRepoLayer(state, events),
            makeWorkflowLayer({
              terminate: async (runId) => {
                if (runId === "stale-running") {
                  throw new Error("terminate failed");
                }
              }
            })
          )
        )
      );

      const repair = yield* EnrichmentRepairService.pipe(Effect.provide(layer));
      const first = yield* repair.repairHistoricalRuns(2_000_000);
      const second = yield* repair.repairHistoricalRuns(2_000_000);

      expect(first).toEqual({
        repairedRuns: 2,
        staleQueuedRuns: 1,
        staleRunningRuns: 1,
        untouchedRuns: 1
      });
      expect(second).toEqual({
        repairedRuns: 0,
        staleQueuedRuns: 0,
        staleRunningRuns: 0,
        untouchedRuns: 1
      });
      expect(state.get("stale-queued")).toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({
            tag: "HistoricalEnrichmentRepairError",
            runId: "stale-queued"
          })
        })
      );
      expect(state.get("stale-running")).toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.objectContaining({
            tag: "EnrichmentWorkflowControlError",
            runId: "stale-running"
          })
        })
      );
      expect(state.get("fresh-running")).toEqual(
        expect.objectContaining({
          status: "running",
          phase: "executing"
        })
      );
      expect(events.filter((event) =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "markFailed"
      )).toHaveLength(2);
    })
  );
});
