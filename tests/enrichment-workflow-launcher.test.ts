import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { EnrichmentRunParams } from "../src/domain/enrichmentRun";
import {
  WorkflowEnrichmentEnv,
  type WorkflowEnrichmentEnvBindings
} from "../src/platform/Env";
import { EnrichmentWorkflowLauncher } from "../src/enrichment/EnrichmentWorkflowLauncher";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";

describe("EnrichmentWorkflowLauncher", () => {
  it.effect("creates a queued run and launches the workflow with the same instance id", () =>
    Effect.gen(function* () {
      const rows: Array<unknown> = [];
      const launched: Array<{ readonly id?: string; readonly params: EnrichmentRunParams }> = [];

      const workflow = {
        create: async (input: { readonly id?: string; readonly params: EnrichmentRunParams }) => {
          launched.push(input);
          return { id: input.id ?? "missing-id" };
        },
        get: async () => ({ id: "unused" }),
        createBatch: async () => []
      } as unknown as WorkflowEnrichmentEnvBindings["ENRICHMENT_RUN_WORKFLOW"];

      const env: WorkflowEnrichmentEnvBindings = {
        DB: {} as D1Database,
        ENRICHMENT_RUN_WORKFLOW: workflow
      };

      const layer = EnrichmentWorkflowLauncher.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(WorkflowEnrichmentEnv, env),
            Layer.succeed(EnrichmentRunsRepo, {
              createQueuedIfAbsent: (input) =>
                Effect.sync(() => {
                  rows.push(input);
                  return true;
                }),
              getById: () => Effect.succeed(null),
              listRunning: () => Effect.succeed([]),
              listRecent: () => Effect.succeed([]),
              listActive: () => Effect.succeed([]),
              listStaleActive: () => Effect.succeed([]),
              markPhase: () => Effect.void,
              resetForRetry: () => Effect.succeed(false),
              markComplete: () => Effect.void,
              markFailed: () => Effect.void,
              markNeedsReview: () => Effect.void,
              listLatestByPostUri: () => Effect.succeed([])
            })
          )
        )
      );

      const launcher = yield* EnrichmentWorkflowLauncher.pipe(Effect.provide(layer));
      const queued = yield* launcher.start({
        postUri: "at://did:plc:test/app.bsky.feed.post/post-1" as any,
        enrichmentType: "vision",
        schemaVersion: "v1",
        triggeredBy: "admin",
        requestedBy: "operator@example.com"
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          workflowInstanceId: expect.any(String),
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "vision",
          schemaVersion: "v1",
          triggeredBy: "admin",
          requestedBy: "operator@example.com"
        })
      );
      expect(launched).toHaveLength(1);
      expect(launched[0]).toEqual({
        id: queued.runId,
        params: {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "vision",
          schemaVersion: "v1",
          triggeredBy: "admin",
          requestedBy: "operator@example.com"
        }
      });
      expect(queued).toEqual({
        runId: expect.any(String),
        workflowInstanceId: expect.any(String),
        status: "queued"
      });
    })
  );

  it.effect("marks the run failed when workflow creation throws", () =>
    Effect.gen(function* () {
      const failures: Array<unknown> = [];

      const workflow = {
        create: async () => {
          throw new Error("boom");
        },
        get: async () => ({ id: "unused" }),
        createBatch: async () => []
      } as unknown as WorkflowEnrichmentEnvBindings["ENRICHMENT_RUN_WORKFLOW"];

      const env: WorkflowEnrichmentEnvBindings = {
        DB: {} as D1Database,
        ENRICHMENT_RUN_WORKFLOW: workflow
      };

      const layer = EnrichmentWorkflowLauncher.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(WorkflowEnrichmentEnv, env),
            Layer.succeed(EnrichmentRunsRepo, {
              createQueuedIfAbsent: () => Effect.succeed(true),
              getById: () => Effect.succeed(null),
              listRunning: () => Effect.succeed([]),
              listRecent: () => Effect.succeed([]),
              listActive: () => Effect.succeed([]),
              listStaleActive: () => Effect.succeed([]),
              markPhase: () => Effect.void,
              resetForRetry: () => Effect.succeed(false),
              markComplete: () => Effect.void,
              markFailed: (input) =>
                Effect.sync(() => {
                  failures.push(input);
                }),
              markNeedsReview: () => Effect.void,
              listLatestByPostUri: () => Effect.succeed([])
            })
          )
        )
      );

      const launcher = yield* EnrichmentWorkflowLauncher.pipe(Effect.provide(layer));
      const exit = yield* Effect.exit(
        launcher.start({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-2" as any,
          enrichmentType: "vision",
          schemaVersion: "v1",
          triggeredBy: "admin",
          requestedBy: null
        })
      );

      expect(exit._tag).toBe("Failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          error: expect.objectContaining({
            tag: "EnrichmentWorkflowLaunchError",
            retryable: true
          })
        })
      );
    })
  );
});
