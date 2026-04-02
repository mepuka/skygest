import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { IngestRunParams } from "../src/domain/polling";
import {
  WorkflowIngestEnv,
  type WorkflowIngestEnvBindings
} from "../src/platform/Env";
import { IngestWorkflowLauncher } from "../src/ingest/IngestWorkflowLauncher";
import { IngestRunsRepo } from "../src/services/IngestRunsRepo";

describe("IngestWorkflowLauncher", () => {
  it.effect("uses a deterministic workflow instance id for cron head sweeps", () => {
    const scheduledTime = Date.parse("2026-03-08T15:30:00.000Z");
    const expectedRunId = "head-sweep:2026-03-08T15:30";
    const rows: Array<unknown> = [];
    const batches: Array<
      ReadonlyArray<{ readonly id?: string; readonly params: IngestRunParams }>
    > = [];

    const workflow = {
      create: async () => ({ id: "unused" }),
      get: async () => ({ id: "unused" }),
      createBatch: async (items: ReadonlyArray<{ readonly id?: string; readonly params: IngestRunParams }>) => {
        batches.push(items);
        return items.map((item) => ({ id: item.id ?? "missing-id" }));
      }
    } as unknown as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"];

    const env: WorkflowIngestEnvBindings = {
      DB: {} as D1Database,
      INGEST_RUN_WORKFLOW: workflow,
      EXPERT_POLL_COORDINATOR: {} as WorkflowIngestEnvBindings["EXPERT_POLL_COORDINATOR"]
    };

    const layer = IngestWorkflowLauncher.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(WorkflowIngestEnv, env),
          Layer.succeed(IngestRunsRepo, {
            createQueuedIfAbsent: (input) =>
              Effect.sync(() => {
                rows.push(input);
                return true;
              }),
            getById: () => Effect.succeed(null),
            listRunning: () => Effect.succeed([]),
            markPreparing: () => Effect.void,
            markDispatching: () => Effect.void,
            markFinalizing: () => Effect.void,
            updateProgress: () => Effect.void,
            markComplete: () => Effect.void,
            markFailed: () => Effect.void
          })
        )
      )
    );

    return Effect.gen(function* () {
      const launcher = yield* IngestWorkflowLauncher;
      yield* launcher.startCronHeadSweep(scheduledTime);

      expect(rows).toEqual([
        {
          id: expectedRunId,
          workflowInstanceId: expectedRunId,
          kind: "head-sweep",
          triggeredBy: "cron",
          requestedBy: null,
          startedAt: scheduledTime
        }
      ]);
      expect(batches).toEqual([
        [
          {
            id: expectedRunId,
            params: {
              kind: "head-sweep",
              triggeredBy: "cron"
            }
          }
        ]
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.effect("does not relaunch a cron workflow when the deterministic run id already exists", () => {
    const scheduledTime = Date.parse("2026-03-08T15:30:00.000Z");
    const batches: Array<
      ReadonlyArray<{ readonly id?: string; readonly params: IngestRunParams }>
    > = [];

    const workflow = {
      create: async () => ({ id: "unused" }),
      get: async () => ({ id: "unused" }),
      createBatch: async (items: ReadonlyArray<{ readonly id?: string; readonly params: IngestRunParams }>) => {
        batches.push(items);
        return items.map((item) => ({ id: item.id ?? "missing-id" }));
      }
    } as unknown as WorkflowIngestEnvBindings["INGEST_RUN_WORKFLOW"];

    const env: WorkflowIngestEnvBindings = {
      DB: {} as D1Database,
      INGEST_RUN_WORKFLOW: workflow,
      EXPERT_POLL_COORDINATOR: {} as WorkflowIngestEnvBindings["EXPERT_POLL_COORDINATOR"]
    };

    const layer = IngestWorkflowLauncher.layer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(WorkflowIngestEnv, env),
          Layer.succeed(IngestRunsRepo, {
            createQueuedIfAbsent: () => Effect.succeed(false),
            getById: () => Effect.succeed(null),
            listRunning: () => Effect.succeed([]),
            markPreparing: () => Effect.void,
            markDispatching: () => Effect.void,
            markFinalizing: () => Effect.void,
            updateProgress: () => Effect.void,
            markComplete: () => Effect.void,
            markFailed: () => Effect.void
          })
        )
      )
    );

    return Effect.gen(function* () {
      const launcher = yield* IngestWorkflowLauncher;
      yield* launcher.startCronHeadSweep(scheduledTime);

      expect(batches).toEqual([]);
    }).pipe(Effect.provide(layer));
  });
});
