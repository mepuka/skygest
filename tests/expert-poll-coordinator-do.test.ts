import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { ExpertNotFoundError } from "../src/domain/bi";
import type { IngestErrorEnvelope } from "../src/domain/errors";
import type { Did } from "../src/domain/types";
import type { WorkflowIngestEnvBindings } from "../src/platform/Env";
import { ExpertPollExecutor } from "../src/ingest/ExpertPollExecutor";
import { IngestRunItemsRepo } from "../src/services/IngestRunItemsRepo";

let currentLayer: Layer.Layer<any, any, never>;

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    protected readonly ctx: DurableObjectState;
    protected readonly env: WorkflowIngestEnvBindings;

    constructor(ctx: DurableObjectState, env: WorkflowIngestEnvBindings) {
      this.ctx = ctx;
      this.env = env;
    }
  }
}));

vi.mock("../src/ingest/Router", () => ({
  makeWorkflowIngestLayer: () => currentLayer
}));

const asDid = (value: string) => value as Did;

const makeStorage = () => {
  const values = new Map<string, unknown>();
  const alarms: Array<number> = [];

  return {
    alarms,
    ctx: {
      storage: {
        get: async (key: string) => values.get(key),
        put: async (key: string, value: unknown) => {
          values.set(key, value);
        },
        getAlarm: async () => alarms[alarms.length - 1] ?? null,
        setAlarm: async (time: number) => {
          alarms.push(time);
        }
      }
    } as unknown as DurableObjectState
  };
};

describe("ExpertPollCoordinatorDo", () => {
  it.live("marks run items failed and records the last failure when execution errors", () =>
    Effect.promise(async () => {
      const did = asDid("did:plc:missing-expert");
      const runItems = new Map<string, {
        status: string;
        error: IngestErrorEnvelope | null;
        attempts: number;
      }>();

      currentLayer = Layer.mergeAll(
        Layer.succeed(ExpertPollExecutor, {
          runExpert: () => Effect.dieMessage("not used"),
          runDid: (failedDid) => Effect.fail(ExpertNotFoundError.make({ did: failedDid }))
        }),
        Layer.succeed(IngestRunItemsRepo, {
          createMany: () => Effect.void,
          markDispatched: () => Effect.void,
          markQueued: () => Effect.void,
          markRunning: ({ runId }) =>
            Effect.sync(() => {
              runItems.set(runId, {
                status: "running",
                error: null,
                attempts: 0
              });
            }),
          markProgress: () => Effect.void,
          markComplete: () => Effect.void,
          markFailed: ({ runId, error, attemptCount }) =>
            Effect.sync(() => {
              runItems.set(runId, {
                status: "failed",
                error,
                attempts: attemptCount
              });
            }),
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
        })
      );

      const { alarms, ctx } = makeStorage();
      const { ExpertPollCoordinatorDo } = await import("../src/ingest/ExpertPollCoordinatorDo");
      const coordinator = new ExpertPollCoordinatorDo(
        ctx,
        {
          DB: {} as D1Database,
          INGEST_RUN_WORKFLOW: {} as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"],
          EXPERT_POLL_COORDINATOR: {} as WorkflowIngestEnvBindings["EXPERT_POLL_COORDINATOR"]
        }
      );

      await coordinator.enqueueHead({
        did,
        runId: "run-1"
      });
      await coordinator.alarm();

      const status = await coordinator.getStatus();

      expect(alarms.length).toBe(1);
      expect(runItems.get("run-1")).toEqual({
        status: "failed",
        error: {
          tag: "ExpertNotFoundError",
          message: `expert not found: ${did}`,
          retryable: false,
          did,
          runId: "run-1",
          operation: "ExpertPollCoordinatorDo.alarm"
        },
        attempts: 1
      });
      expect(status.current).toBeNull();
      expect(status.lastFailure).toEqual({
        tag: "ExpertNotFoundError",
        message: `expert not found: ${did}`,
        retryable: false,
        did,
        runId: "run-1",
        operation: "ExpertPollCoordinatorDo.alarm"
      });
    })
  );
});
