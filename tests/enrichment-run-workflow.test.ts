import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { EnrichmentErrorEnvelope } from "../src/domain/errors";
import type {
  EnrichmentRunParams,
  EnrichmentRunRecord
} from "../src/domain/enrichmentRun";
import type { AtUri } from "../src/domain/types";
import type { WorkflowEnrichmentEnvBindings } from "../src/platform/Env";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";

let currentLayer: Layer.Layer<any, any, never>;

vi.mock("cloudflare:workers", () => ({
  WorkflowEntrypoint: class {
    protected readonly ctx: ExecutionContext;
    protected readonly env: WorkflowEnrichmentEnvBindings;

    constructor(ctx: ExecutionContext, env: WorkflowEnrichmentEnvBindings) {
      this.ctx = ctx;
      this.env = env;
    }
  }
}));

vi.mock("../src/enrichment/Layer", () => ({
  makeWorkflowEnrichmentLayer: () => currentLayer
}));

const asAtUri = (value: string) => value as AtUri;

const makeRunRecord = (
  overrides: Partial<EnrichmentRunRecord> = {}
): EnrichmentRunRecord => ({
  id: "run-1",
  workflowInstanceId: "run-1",
  postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
  enrichmentType: "vision",
  schemaVersion: "v1",
  triggeredBy: "admin",
  requestedBy: "operator@example.com",
  status: "queued",
  phase: "queued",
  attemptCount: 0,
  modelLane: null,
  promptVersion: null,
  inputFingerprint: null,
  startedAt: 1,
  finishedAt: null,
  lastProgressAt: null,
  resultWrittenAt: null,
  error: null,
  ...overrides
});

const makeEnv = (): WorkflowEnrichmentEnvBindings => ({
  DB: {} as D1Database,
  ENRICHMENT_RUN_WORKFLOW: {
    create: async () => ({ id: "unused" }),
    get: async () => ({ id: "unused" }),
    createBatch: async () => []
  } as unknown as WorkflowEnrichmentEnvBindings["ENRICHMENT_RUN_WORKFLOW"]
});

const makeStep = () =>
  ({
    do: async (_name: string, thunk: () => Promise<unknown>) => await thunk()
  }) as unknown as WorkflowStep;

describe("EnrichmentRunWorkflow", () => {
  it.live("marks a launched run as needs review until execution steps are implemented", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const phases: Array<EnrichmentRunRecord["phase"]> = [];
      const reviewMarks: Array<unknown> = [];
      const failures: Array<unknown> = [];
      const runState = {
        status: "queued" as EnrichmentRunRecord["status"],
        phase: "queued" as EnrichmentRunRecord["phase"],
        attemptCount: 0,
        lastProgressAt: null as number | null,
        finishedAt: null as number | null,
        error: null as EnrichmentErrorEnvelope | null
      };

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(makeRunRecord(runState)),
        listRunning: () => Effect.succeed([]),
        markPhase: (input) =>
          Effect.sync(() => {
            phases.push(input.phase);
            runState.status = "running";
            runState.phase = input.phase;
            runState.lastProgressAt = input.lastProgressAt;
            if (runState.attemptCount === 0) {
              runState.attemptCount = 1;
            }
          }),
        markComplete: () => Effect.void,
        markFailed: (input) =>
          Effect.sync(() => {
            failures.push(input);
            runState.status = "failed";
            runState.phase = "failed";
            runState.finishedAt = input.finishedAt;
            runState.error = input.error;
          }),
        markNeedsReview: (input) =>
          Effect.sync(() => {
            reviewMarks.push(input);
            runState.status = "needs-review";
            runState.phase = "needs-review";
            runState.lastProgressAt = input.lastProgressAt;
            runState.error = input.error;
          })
      });

      const workflow = new EnrichmentRunWorkflow(
        {} as ExecutionContext,
        makeEnv()
      );
      const result = await workflow.run(
        {
          instanceId: "run-1",
          payload: {
            postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "vision",
            schemaVersion: "v1",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          } satisfies EnrichmentRunParams
        } as any,
        makeStep()
      );

      expect(result).toEqual({
        runId: "run-1",
        status: "needs-review"
      });
      expect(phases).toEqual(["assembling", "planning"]);
      expect(reviewMarks).toHaveLength(1);
      expect(reviewMarks[0]).toEqual(
        expect.objectContaining({
          id: "run-1",
          error: expect.objectContaining({
            tag: "EnrichmentExecutionDeferred",
            message: "enrichment execution lane not implemented yet",
            retryable: false,
            runId: "run-1",
            operation: "EnrichmentRunWorkflow.run"
          })
        })
      );
      expect(failures).toEqual([]);
    })
  );

  it.live("marks the run failed when workflow params do not decode", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const failures: Array<{
        readonly id: string;
        readonly finishedAt: number;
        readonly error: EnrichmentErrorEnvelope;
      }> = [];

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(makeRunRecord()),
        listRunning: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        markComplete: () => Effect.void,
        markFailed: (input) =>
          Effect.sync(() => {
            failures.push(input);
          }),
        markNeedsReview: () => Effect.void
      });

      const workflow = new EnrichmentRunWorkflow(
        {} as ExecutionContext,
        makeEnv()
      );

      await expect(
        workflow.run(
          {
            instanceId: "run-1",
            payload: {
              postUri: "not-an-at-uri",
              enrichmentType: "vision",
              schemaVersion: "v1",
              triggeredBy: "admin"
            }
          } as any,
          makeStep()
        )
      ).rejects.toMatchObject({
        _tag: "EnrichmentSchemaDecodeError"
      });

      expect(failures).toHaveLength(1);
      expect(failures[0]).toEqual(
        expect.objectContaining({
          id: "run-1",
          error: expect.objectContaining({
            tag: "EnrichmentSchemaDecodeError",
            retryable: false,
            runId: "run-1"
          })
        })
      );
    })
  );
});
