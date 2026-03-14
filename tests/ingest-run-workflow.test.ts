import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { IngestErrorEnvelope } from "../src/domain/errors";
import type { IngestRunItemRecord, IngestRunRecord } from "../src/domain/polling";
import type { Did } from "../src/domain/types";
import { IngestRepairService } from "../src/ingest/IngestRepairService";
import type { WorkflowIngestEnvBindings } from "../src/platform/Env";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { IngestRunItemsRepo } from "../src/services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../src/services/IngestRunsRepo";

let currentLayer: Layer.Layer<any, any, never>;

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    protected readonly ctx: ExecutionContext;
    protected readonly env: WorkflowIngestEnvBindings;

    constructor(ctx: ExecutionContext, env: WorkflowIngestEnvBindings) {
      this.ctx = ctx;
      this.env = env;
    }
  }
}));

vi.mock("../src/ingest/Router", () => ({
  makeWorkflowIngestLayer: () => currentLayer
}));

const asDid = (value: string) => value as Did;

const makeExpert = (did: Did) => ({
  did,
  handle: `${did}.test`,
  displayName: did,
  description: null,
  domain: "energy",
  source: "manual" as const,
  sourceRef: null,
  shard: 0,
  active: true,
  addedAt: 1,
  lastSyncedAt: null
});

const makeMutableItem = (runId: string, did: Did, mode: IngestRunItemRecord["mode"]) => ({
  runId,
  did,
  mode,
  status: "queued" as IngestRunItemRecord["status"],
  enqueuedAt: null as number | null,
  attemptCount: 0,
  startedAt: null as number | null,
  finishedAt: null as number | null,
  lastProgressAt: null as number | null,
  pagesFetched: 0,
  postsSeen: 0,
  postsStored: 0,
  postsDeleted: 0,
  error: null as IngestErrorEnvelope | null
});

describe("IngestRunWorkflow", () => {
  it.live("dispatches head runs in a 5-wide window and finalizes the run", () =>
    Effect.promise(async () => {
      const { IngestRunWorkflow } = await import("../src/ingest/IngestRunWorkflow");

      const runState = {
        status: "queued" as IngestRunRecord["status"],
        phase: "queued" as IngestRunRecord["phase"],
        finishedAt: null as number | null,
        lastProgressAt: 1,
        totalExperts: 0,
        expertsSucceeded: 0,
        expertsFailed: 0,
        pagesFetched: 0,
        postsSeen: 0,
        postsStored: 0,
        postsDeleted: 0,
        error: null as IngestErrorEnvelope | null
      };
      const toRunRecord = (): IngestRunRecord => ({
        id: "run-1",
        workflowInstanceId: "run-1",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1,
        ...runState
      });
      const items = new Map<Did, ReturnType<typeof makeMutableItem>>();
      const enqueueOrder: Array<Did> = [];

      const expertsLayer = Layer.succeed(ExpertsRepo, {
          upsert: () => Effect.void,
          upsertMany: () => Effect.void,
          getByDid: (did: string) => Effect.succeed(makeExpert(asDid(did))),
          setActive: () => Effect.void,
          setLastSyncedAt: () => Effect.void,
          listActive: () =>
            Effect.succeed(
              Array.from({ length: 7 }, (_, index) =>
                makeExpert(asDid(`did:plc:expert-${index + 1}`))
              )
            ),
          listActiveByShard: () => Effect.succeed([]),
          list: () => Effect.succeed([])
        });
      const runsLayer = Layer.succeed(IngestRunsRepo, {
          createQueuedIfAbsent: () => Effect.succeed(true),
          getById: () => Effect.succeed(toRunRecord()),
          listRunning: () => Effect.succeed([]),
          markPreparing: (input) =>
            Effect.sync(() => {
              runState.status = "running";
              runState.phase = "preparing";
              runState.lastProgressAt = input.lastProgressAt;
              runState.error = null;
            }),
          markDispatching: (input) =>
            Effect.sync(() => {
              runState.status = "running";
              runState.phase = "dispatching";
              runState.lastProgressAt = input.lastProgressAt;
              runState.totalExperts = input.totalExperts;
            }),
          markFinalizing: (input) =>
            Effect.sync(() => {
              runState.status = "running";
              runState.phase = "finalizing";
              runState.lastProgressAt = input.lastProgressAt;
            }),
          markComplete: (input) =>
            Effect.sync(() => {
              runState.status = "complete";
              runState.phase = "complete";
              runState.finishedAt = input.finishedAt;
              runState.lastProgressAt = input.finishedAt;
              runState.totalExperts = input.totalExperts;
              runState.expertsSucceeded = input.expertsSucceeded;
              runState.expertsFailed = input.expertsFailed;
              runState.pagesFetched = input.pagesFetched;
              runState.postsSeen = input.postsSeen;
              runState.postsStored = input.postsStored;
              runState.postsDeleted = input.postsDeleted;
            }),
          markFailed: (input) =>
            Effect.sync(() => {
              runState.status = "failed";
              runState.phase = "failed";
              runState.finishedAt = input.finishedAt;
              runState.lastProgressAt = input.finishedAt;
              runState.error = input.error;
            })
        });
      const runItemsLayer = Layer.succeed(IngestRunItemsRepo, {
          createMany: (created) =>
            Effect.sync(() => {
              for (const item of created) {
                items.set(item.did, makeMutableItem(item.runId, item.did, item.mode));
              }
            }),
          markDispatched: ({ did, enqueuedAt, lastProgressAt }) =>
            Effect.sync(() => {
              const item = items.get(did)!;
              item.enqueuedAt = enqueuedAt;
              item.lastProgressAt = lastProgressAt;

              if (item.status === "complete") {
                item.startedAt ??= enqueuedAt;
                item.finishedAt ??= enqueuedAt;
                return;
              }

              item.status = "dispatched";
            }),
          markQueued: ({ did, lastProgressAt }) =>
            Effect.sync(() => {
              const item = items.get(did)!;
              item.status = "queued";
              item.enqueuedAt = null;
              item.startedAt = null;
              item.finishedAt = null;
              item.lastProgressAt = lastProgressAt;
              item.error = null;
            }),
          markRunning: ({ did, startedAt, lastProgressAt }) =>
            Effect.sync(() => {
              const item = items.get(did)!;
              item.status = "running";
              item.enqueuedAt ??= startedAt;
              item.startedAt ??= startedAt;
              item.lastProgressAt = lastProgressAt;
            }),
          markProgress: () => Effect.void,
          markComplete: () => Effect.void,
          markFailed: () => Effect.void,
          listByRun: () => Effect.succeed([...items.values()] as ReadonlyArray<IngestRunItemRecord>),
          countActiveByRun: () =>
            Effect.succeed(
              [...items.values()].filter((item) =>
                item.status === "dispatched" || item.status === "running"
              ).length
            ),
          countIncompleteByRun: () =>
            Effect.succeed(
              [...items.values()].filter((item) =>
                item.status !== "complete" && item.status !== "failed"
              ).length
            ),
          listUndispatchedByRun: (_runId, limit) =>
            Effect.succeed(
              [...items.values()]
                .filter((item) => item.status === "queued")
                .slice(0, limit) as ReadonlyArray<IngestRunItemRecord>
            ),
          listStaleDispatchedByRun: () => Effect.succeed([]),
          listStaleRunningByRun: () => Effect.succeed([]),
          summarizeByRun: () =>
            Effect.succeed(
              [...items.values()].reduce(
                (summary, item) => ({
                  totalExperts: summary.totalExperts + 1,
                  expertsSucceeded: summary.expertsSucceeded + (item.status === "complete" ? 1 : 0),
                  expertsFailed: summary.expertsFailed + (item.status === "failed" ? 1 : 0),
                  pagesFetched: summary.pagesFetched + item.pagesFetched,
                  postsSeen: summary.postsSeen + item.postsSeen,
                  postsStored: summary.postsStored + item.postsStored,
                  postsDeleted: summary.postsDeleted + item.postsDeleted,
                  error: summary.error ?? item.error
                }),
                {
                  totalExperts: 0,
                  expertsSucceeded: 0,
                  expertsFailed: 0,
                  pagesFetched: 0,
                  postsSeen: 0,
                  postsStored: 0,
                  postsDeleted: 0,
                  error: null as IngestErrorEnvelope | null
                }
              )
            )
        });

      currentLayer = Layer.mergeAll(
        expertsLayer,
        runsLayer,
        runItemsLayer,
        IngestRepairService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(runsLayer, runItemsLayer))
        )
      );

      const namespace = {
        idFromName: (name: string) => ({ name }),
        get: (_id: { readonly name: string }) => ({
          enqueueHead: async (input: { readonly did: Did }) => {
            enqueueOrder.push(input.did);
            const item = items.get(input.did)!;
            item.status = "complete";
            item.attemptCount = 1;
            item.startedAt = item.startedAt ?? item.enqueuedAt;
            item.finishedAt = item.enqueuedAt;
            item.lastProgressAt = item.enqueuedAt;
            item.pagesFetched = 1;
            item.postsSeen = 2;
            item.postsStored = 1;
            return { accepted: true };
          },
          enqueueBackfill: async () => ({ accepted: true }),
          enqueueReconcile: async () => ({ accepted: true })
        })
      } as unknown as DurableObjectNamespace;

      const workflow = new IngestRunWorkflow(
        ({
          waitUntil: () => {},
          passThroughOnException: () => {},
          props: {}
        } as unknown) as ExecutionContext,
        {
          DB: {} as D1Database,
          INGEST_RUN_WORKFLOW: {} as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"],
          EXPERT_POLL_COORDINATOR: namespace
        }
      );

      const step = {
        do: async <A>(
          _name: string,
          ...args: [(() => Promise<A>) | object, (() => Promise<A>)?]
        ) => {
          const fn = typeof args[0] === "function" ? args[0] : args[1]!;
          return await fn();
        },
        sleep: async () => {},
        sleepUntil: async () => {},
        waitForEvent: async () => {
          throw new Error("not used");
        }
      } as any;

      await workflow.run(
        {
          instanceId: "run-1",
          payload: {
            kind: "head-sweep",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          },
          timestamp: new Date()
        },
        step
      );

      expect(enqueueOrder).toHaveLength(7);
      expect(enqueueOrder.slice(0, 5)).toEqual([
        asDid("did:plc:expert-1"),
        asDid("did:plc:expert-2"),
        asDid("did:plc:expert-3"),
        asDid("did:plc:expert-4"),
        asDid("did:plc:expert-5")
      ]);
      expect(toRunRecord().status).toBe("complete");
      expect(toRunRecord().totalExperts).toBe(7);
      expect(toRunRecord().expertsSucceeded).toBe(7);
      expect(toRunRecord().pagesFetched).toBe(7);
      expect(toRunRecord().postsStored).toBe(7);
    })
  );

  it.live("compensates item creation failures by marking the run failed", () =>
    Effect.promise(async () => {
      const { IngestRunWorkflow } = await import("../src/ingest/IngestRunWorkflow");

      const runState = {
        status: "queued" as IngestRunRecord["status"],
        phase: "queued" as IngestRunRecord["phase"],
        finishedAt: null as number | null,
        lastProgressAt: 1,
        totalExperts: 0,
        expertsSucceeded: 0,
        expertsFailed: 0,
        pagesFetched: 0,
        postsSeen: 0,
        postsStored: 0,
        postsDeleted: 0,
        error: null as IngestErrorEnvelope | null
      };
      const toRunRecord = (): IngestRunRecord => ({
        id: "run-1",
        workflowInstanceId: "run-1",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1,
        ...runState
      });

      const runsLayer = Layer.succeed(IngestRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(toRunRecord()),
        listRunning: () => Effect.succeed([]),
        markPreparing: (input) =>
          Effect.sync(() => {
            runState.status = "running";
            runState.phase = "preparing";
            runState.lastProgressAt = input.lastProgressAt;
          }),
        markDispatching: () => Effect.void,
        markFinalizing: () => Effect.void,
        markComplete: () => Effect.void,
        markFailed: (input) =>
          Effect.sync(() => {
            runState.status = "failed";
            runState.phase = "failed";
            runState.finishedAt = input.finishedAt;
            runState.lastProgressAt = input.finishedAt;
            runState.error = input.error;
            runState.totalExperts = input.totalExperts ?? 0;
            runState.expertsSucceeded = input.expertsSucceeded ?? 0;
            runState.expertsFailed = input.expertsFailed ?? 0;
          })
      });
      const runItemsLayer = Layer.succeed(IngestRunItemsRepo, {
        createMany: () => Effect.fail({ _tag: "SqlError", message: "Failed to execute statement" } as any),
        markDispatched: () => Effect.void,
        markQueued: () => Effect.void,
        markRunning: () => Effect.void,
        markProgress: () => Effect.void,
        markComplete: () => Effect.void,
        markFailed: () => Effect.void,
        listByRun: () => Effect.succeed([]),
        countActiveByRun: () => Effect.succeed(0),
        countIncompleteByRun: () => Effect.succeed(0),
        listUndispatchedByRun: () => Effect.succeed([]),
        listStaleDispatchedByRun: () => Effect.succeed([]),
        listStaleRunningByRun: () => Effect.succeed([]),
        summarizeByRun: () =>
          Effect.succeed({
            totalExperts: 0,
            expertsSucceeded: 0,
            expertsFailed: 0,
            pagesFetched: 0,
            postsSeen: 0,
            postsStored: 0,
            postsDeleted: 0,
            error: null
          })
      });

      currentLayer = Layer.mergeAll(
        Layer.succeed(ExpertsRepo, {
          upsert: () => Effect.void,
          upsertMany: () => Effect.void,
          getByDid: (did: string) => Effect.succeed(makeExpert(asDid(did))),
          setActive: () => Effect.void,
          setLastSyncedAt: () => Effect.void,
          listActive: () => Effect.succeed([makeExpert(asDid("did:plc:expert-1"))]),
          listActiveByShard: () => Effect.succeed([]),
          list: () => Effect.succeed([])
        }),
        runsLayer,
        runItemsLayer,
        IngestRepairService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(runsLayer, runItemsLayer))
        )
      );

      const workflow = new IngestRunWorkflow(
        ({
          waitUntil: () => {},
          passThroughOnException: () => {},
          props: {}
        } as unknown) as ExecutionContext,
        {
          DB: {} as D1Database,
          INGEST_RUN_WORKFLOW: {} as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"],
          EXPERT_POLL_COORDINATOR: {} as WorkflowIngestEnvBindings["EXPERT_POLL_COORDINATOR"]
        }
      );

      const step = {
        do: async <A>(
          _name: string,
          ...args: [(() => Promise<A>) | object, (() => Promise<A>)?]
        ) => {
          const fn = typeof args[0] === "function" ? args[0] : args[1]!;
          return await fn();
        },
        sleep: async () => {},
        sleepUntil: async () => {},
        waitForEvent: async () => {
          throw new Error("not used");
        }
      } as any;

      await expect(workflow.run(
        {
          instanceId: "run-1",
          payload: {
            kind: "head-sweep",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          },
          timestamp: new Date()
        },
        step
      )).rejects.toThrow();

      expect(toRunRecord().status).toBe("failed");
      expect(toRunRecord().phase).toBe("failed");
      expect(toRunRecord().error?.tag).toBe("WorkflowRunCompensationError");
      expect(toRunRecord().totalExperts).toBe(0);
    })
  );

  it.live("leaves items queued when coordinator enqueue fails", () =>
    Effect.promise(async () => {
      const { IngestRunWorkflow } = await import("../src/ingest/IngestRunWorkflow");

      const runState = {
        status: "queued" as IngestRunRecord["status"],
        phase: "queued" as IngestRunRecord["phase"],
        finishedAt: null as number | null,
        lastProgressAt: 1,
        totalExperts: 0,
        expertsSucceeded: 0,
        expertsFailed: 0,
        pagesFetched: 0,
        postsSeen: 0,
        postsStored: 0,
        postsDeleted: 0,
        error: null as IngestErrorEnvelope | null
      };
      const toRunRecord = (): IngestRunRecord => ({
        id: "run-1",
        workflowInstanceId: "run-1",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1,
        ...runState
      });
      const did = asDid("did:plc:expert-1");
      const items = new Map([[did, makeMutableItem("run-1", did, "head")]]);

      const runsLayer = Layer.succeed(IngestRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(toRunRecord()),
        listRunning: () => Effect.succeed([]),
        markPreparing: (input) =>
          Effect.sync(() => {
            runState.status = "running";
            runState.phase = "preparing";
            runState.lastProgressAt = input.lastProgressAt;
          }),
        markDispatching: (input) =>
          Effect.sync(() => {
            runState.status = "running";
            runState.phase = "dispatching";
            runState.lastProgressAt = input.lastProgressAt;
            runState.totalExperts = input.totalExperts;
          }),
        markFinalizing: () => Effect.void,
        markComplete: () => Effect.void,
        markFailed: (input) =>
          Effect.sync(() => {
            runState.status = "failed";
            runState.phase = "failed";
            runState.finishedAt = input.finishedAt;
            runState.lastProgressAt = input.finishedAt;
            runState.error = input.error;
          })
      });
      const runItemsLayer = Layer.succeed(IngestRunItemsRepo, {
        createMany: () => Effect.void,
        markDispatched: ({ did: itemDid, enqueuedAt, lastProgressAt }) =>
          Effect.sync(() => {
            const item = items.get(itemDid)!;
            item.status = "dispatched";
            item.enqueuedAt = enqueuedAt;
            item.lastProgressAt = lastProgressAt;
          }),
        markQueued: () => Effect.void,
        markRunning: () => Effect.void,
        markProgress: () => Effect.void,
        markComplete: () => Effect.void,
        markFailed: () => Effect.void,
        listByRun: () => Effect.succeed([...items.values()] as ReadonlyArray<IngestRunItemRecord>),
        countActiveByRun: () => Effect.succeed(0),
        countIncompleteByRun: () => Effect.succeed(1),
        listUndispatchedByRun: () =>
          Effect.succeed([...items.values()] as ReadonlyArray<IngestRunItemRecord>),
        listStaleDispatchedByRun: () => Effect.succeed([]),
        listStaleRunningByRun: () => Effect.succeed([]),
        summarizeByRun: () =>
          Effect.succeed({
            totalExperts: 1,
            expertsSucceeded: 0,
            expertsFailed: 0,
            pagesFetched: 0,
            postsSeen: 0,
            postsStored: 0,
            postsDeleted: 0,
            error: null
          })
      });

      currentLayer = Layer.mergeAll(
        Layer.succeed(ExpertsRepo, {
          upsert: () => Effect.void,
          upsertMany: () => Effect.void,
          getByDid: (value: string) => Effect.succeed(makeExpert(asDid(value))),
          setActive: () => Effect.void,
          setLastSyncedAt: () => Effect.void,
          listActive: () => Effect.succeed([makeExpert(did)]),
          listActiveByShard: () => Effect.succeed([]),
          list: () => Effect.succeed([])
        }),
        runsLayer,
        runItemsLayer,
        IngestRepairService.layer.pipe(
          Layer.provideMerge(Layer.mergeAll(runsLayer, runItemsLayer))
        )
      );

      const namespace = {
        idFromName: (name: string) => ({ name }),
        get: () => ({
          enqueueHead: async () => {
            throw new Error("enqueue failed");
          },
          enqueueBackfill: async () => ({ accepted: true }),
          enqueueReconcile: async () => ({ accepted: true })
        })
      } as unknown as DurableObjectNamespace;

      const workflow = new IngestRunWorkflow(
        ({
          waitUntil: () => {},
          passThroughOnException: () => {},
          props: {}
        } as unknown) as ExecutionContext,
        {
          DB: {} as D1Database,
          INGEST_RUN_WORKFLOW: {} as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"],
          EXPERT_POLL_COORDINATOR: namespace
        }
      );

      const step = {
        do: async <A>(
          _name: string,
          ...args: [(() => Promise<A>) | object, (() => Promise<A>)?]
        ) => {
          const fn = typeof args[0] === "function" ? args[0] : args[1]!;
          return await fn();
        },
        sleep: async () => {},
        sleepUntil: async () => {},
        waitForEvent: async () => {
          throw new Error("not used");
        }
      } as any;

      await expect(workflow.run(
        {
          instanceId: "run-1",
          payload: {
            kind: "head-sweep",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          },
          timestamp: new Date()
        },
        step
      )).rejects.toThrow();

      expect(items.get(did)?.status).toBe("queued");
      expect(items.get(did)?.enqueuedAt).toBeNull();
      expect(toRunRecord().status).toBe("failed");
      expect(toRunRecord().error?.tag).toBe("WorkflowRunCompensationError");
    })
  );
});
