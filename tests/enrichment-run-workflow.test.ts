import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import type { EnrichmentErrorEnvelope } from "../src/domain/errors";
import type { VisionEnrichment } from "../src/domain/enrichment";
import type { EnrichmentExecutionPlan } from "../src/domain/enrichmentPlan";
import type {
  EnrichmentRunParams,
  EnrichmentRunRecord
} from "../src/domain/enrichmentRun";
import type { AtUri } from "../src/domain/types";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { VisionEnrichmentExecutor } from "../src/enrichment/VisionEnrichmentExecutor";
import type { WorkflowEnrichmentEnvBindings } from "../src/platform/Env";
import { CandidatePayloadRepo } from "../src/services/CandidatePayloadRepo";
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

const makePlan = (
  overrides: Partial<EnrichmentExecutionPlan> = {}
): EnrichmentExecutionPlan => ({
  postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
  enrichmentType: "vision",
  schemaVersion: "v1",
  decision: "execute",
  captureStage: "picked",
  post: {
    postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
    did: "did:plc:test" as any,
    text: "Stored post text",
    createdAt: 1,
    threadCoverage: "focus-only"
  },
  embedType: "img",
  embedPayload: {
    kind: "img",
    images: [
      {
        thumb: "https://cdn.bsky.app/thumb-1.jpg",
        fullsize: "https://cdn.bsky.app/full-1.jpg",
        alt: null
      }
    ]
  },
  links: [],
  topicMatches: [],
  quote: null,
  linkCards: [],
  assets: [
    {
      assetKey: "embed:0:https://cdn.bsky.app/full-1.jpg",
      assetType: "image",
      source: "embed",
      index: 0,
      thumb: "https://cdn.bsky.app/thumb-1.jpg",
      fullsize: "https://cdn.bsky.app/full-1.jpg",
      alt: null
    }
  ],
  existingEnrichments: [],
  ...overrides
});

const makeVisionEnrichment = (): VisionEnrichment => ({
  kind: "vision",
  summary: {
    text: "Bar chart of Alberta pool prices by month.",
    mediaTypes: ["chart"],
    chartTypes: ["bar-chart"],
    titles: ["Alberta pool prices"],
    keyFindings: [
      {
        text: "Prices rose through the summer",
        assetKeys: ["embed:0:https://cdn.bsky.app/full-1.jpg"]
      }
    ]
  },
  assets: [
    {
      assetKey: "embed:0:https://cdn.bsky.app/full-1.jpg",
      assetType: "image",
      source: "embed",
      index: 0,
      originalAltText: null,
      analysis: {
        mediaType: "chart",
        chartTypes: ["bar-chart"],
        altText: "Bar chart of Alberta pool prices by month.",
        altTextProvenance: "synthetic",
        xAxis: { label: "Month", unit: null },
        yAxis: { label: "Price", unit: "$/MWh" },
        series: [{ legendLabel: "Pool price", unit: "$/MWh" }],
        sourceLines: [{ sourceText: "Source: AESO" }],
        temporalCoverage: {
          startDate: "2024-01",
          endDate: "2024-12"
        },
        keyFindings: ["Prices rose through the summer"],
        title: "Alberta pool prices",
        modelId: "gemini-2.5-flash",
        processedAt: 10
      }
    }
  ],
  modelId: "gemini-2.5-flash",
  promptVersion: "v1.0.0",
  processedAt: 10
});

describe("EnrichmentRunWorkflow", () => {
  it.live("completes a vision run and persists the enrichment payload", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const phases: Array<EnrichmentRunRecord["phase"]> = [];
      const completions: Array<unknown> = [];
      const persisted: Array<unknown> = [];
      const reviewMarks: Array<unknown> = [];
      const failures: Array<unknown> = [];
      const plannerCalls: Array<unknown> = [];
      const executorCalls: Array<unknown> = [];
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
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
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
        resetForRetry: () => Effect.succeed(false),
        markComplete: (input) =>
          Effect.sync(() => {
            completions.push(input);
            runState.status = "complete";
            runState.phase = "complete";
            runState.finishedAt = input.finishedAt;
            runState.lastProgressAt = input.finishedAt;
          }),
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
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(EnrichmentPlanner, {
              plan: (input) =>
                Effect.sync(() => {
                  plannerCalls.push(input);
                  return makePlan();
                })
            }),
            Layer.succeed(VisionEnrichmentExecutor, {
              execute: (input) =>
                Effect.sync(() => {
                  executorCalls.push(input);
                  return makeVisionEnrichment();
                })
            }),
            Layer.succeed(CandidatePayloadRepo, {
              upsertCapture: () => Effect.succeed(false),
              getByPostUri: () => Effect.succeed(null),
              markPicked: () => Effect.succeed(false),
              saveEnrichment: (input) =>
                Effect.sync(() => {
                  persisted.push(input);
                  return true;
                })
            })
          )
        )
      );

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
        status: "complete"
      });
      expect(phases).toEqual(["assembling", "planning", "executing", "persisting"]);
      expect(plannerCalls).toEqual([
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "vision",
          schemaVersion: "v1"
        }
      ]);
      expect(executorCalls).toEqual([makePlan()]);
      expect(persisted).toEqual([
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "vision",
          enrichmentPayload: makeVisionEnrichment()
        }
      ]);
      expect(completions).toHaveLength(1);
      expect(reviewMarks).toEqual([]);
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
        markNeedsReview: () => Effect.void
      }).pipe(
        Layer.provideMerge(
          Layer.succeed(EnrichmentPlanner, {
            plan: () => Effect.succeed(makePlan())
          })
        )
      );

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

  it.live("records a planning stop reason when the planner decides the lane should not run", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const reviewMarks: Array<unknown> = [];

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(makeRunRecord()),
        listRunning: () => Effect.succeed([]),
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        resetForRetry: () => Effect.succeed(false),
        markComplete: () => Effect.void,
        markFailed: () => Effect.void,
        markNeedsReview: (input) =>
          Effect.sync(() => {
            reviewMarks.push(input);
          })
      }).pipe(
        Layer.provideMerge(
          Layer.succeed(EnrichmentPlanner, {
            plan: () =>
              Effect.succeed(
                makePlan({
                  decision: "skip",
                  stopReason: "no-visual-assets",
                  assets: [],
                  embedType: "link",
                  embedPayload: {
                    kind: "link",
                    uri: "https://example.com/report",
                    title: "Grid report",
                    description: null,
                    thumb: null
                  }
                })
              )
          })
        )
      );

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
      expect(reviewMarks).toHaveLength(1);
      expect(reviewMarks[0]).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            tag: "EnrichmentPlanningStopped",
            message: "planner stopped: the stored post has no visual assets to analyze",
            retryable: false
          })
        })
      );
    })
  );
});
