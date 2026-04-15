import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { WorkflowStep } from "cloudflare:workers";
import {
  ResolverClientError,
  type EnrichmentErrorEnvelope
} from "../src/domain/errors";
import type {
  SourceAttributionEnrichment,
  VisionEnrichment
} from "../src/domain/enrichment";
import type { EnrichmentExecutionPlan } from "../src/domain/enrichmentPlan";
import type {
  EnrichmentRunParams,
  EnrichmentRunRecord
} from "../src/domain/enrichmentRun";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import type { ResolutionOutcome } from "../src/domain/resolutionKernel";
import type { PostUri } from "../src/domain/types";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { EnrichmentWorkflowLauncher } from "../src/enrichment/EnrichmentWorkflowLauncher";
import { AppConfig } from "../src/platform/Config";
import { VisionEnrichmentExecutor } from "../src/enrichment/VisionEnrichmentExecutor";
import { SourceAttributionExecutor } from "../src/enrichment/SourceAttributionExecutor";
import { ResolverClient } from "../src/resolver/Client";
import type { WorkflowEnrichmentEnvBindings } from "../src/platform/Env";
import { CandidatePayloadRepo } from "../src/services/CandidatePayloadRepo";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";
import { testConfig } from "./support/runtime";

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

const asPostUri = (value: string) => value as PostUri;
const workflowPostUri = asPostUri("at://did:plc:test/app.bsky.feed.post/post-1");
const workflowAssetKey = chartAssetIdFromBluesky(
  workflowPostUri,
  "bafkreiworkflowasset"
);

const makeRunRecord = (
  overrides: Partial<EnrichmentRunRecord> = {}
): EnrichmentRunRecord => ({
  id: "run-1",
  workflowInstanceId: "run-1",
  postUri: workflowPostUri,
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
  postUri: workflowPostUri,
  enrichmentType: "vision",
  schemaVersion: "v1",
  decision: "execute",
  captureStage: "picked",
  post: {
    postUri: workflowPostUri,
    did: "did:plc:test" as any,
    handle: null,
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
      assetKey: workflowAssetKey,
      assetType: "image",
      source: "embed",
      index: 0,
      thumb: "https://cdn.bsky.app/thumb-1.jpg",
      fullsize: "https://cdn.bsky.app/full-1.jpg",
      alt: null
    }
  ],
  existingEnrichments: [],
  vision: null,
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
        assetKeys: [workflowAssetKey]
      }
    ]
  },
  assets: [
    {
      assetKey: workflowAssetKey,
      assetType: "image",
      source: "embed",
      index: 0,
      originalAltText: null,
      extractionRoute: "full",
      analysis: {
        mediaType: "chart",
        chartTypes: ["bar-chart"],
        altText: "Bar chart of Alberta pool prices by month.",
        altTextProvenance: "synthetic",
        xAxis: { label: "Month", unit: null },
        yAxis: { label: "Price", unit: "$/MWh" },
        series: [{ legendLabel: "Pool price", unit: "$/MWh" }],
        sourceLines: [{ sourceText: "Source: AESO", datasetName: null }],
        temporalCoverage: {
          startDate: "2024-01",
          endDate: "2024-12"
        },
        keyFindings: ["Prices rose through the summer"],
        visibleUrls: [],
        organizationMentions: [],
        logoText: [],
        title: "Alberta pool prices",
        modelId: "gemini-2.5-flash",
        processedAt: 10
      }
    }
  ],
  modelId: "gemini-2.5-flash",
  promptVersion: "v2.0.0",
  processedAt: 10
});

const makeSourceAttributionEnrichment = (): SourceAttributionEnrichment => ({
  kind: "source-attribution",
  provider: null,
  resolution: "unmatched",
  providerCandidates: [],
  contentSource: null,
  socialProvenance: null,
  processedAt: 20
});

const makeKernelOutcome = (
  postUri = "at://did:plc:test/app.bsky.feed.post/post-1"
): ResolutionOutcome => ({
  _tag: "NoMatch",
  bundle: {
    postUri: asPostUri(postUri),
    postText: ["Stored post text"],
    series: [],
    keyFindings: [],
    sourceLines: [],
    publisherHints: []
  },
  reason: "no checked-in registry match"
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
        listLatestByPostUri: () => Effect.succeed([]),
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
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () =>
                Effect.succeed({
                  runId: "source-attribution-queued",
                  workflowInstanceId: "source-attribution-queued",
                  status: "queued" as const
                }),
              startIfAbsent: () => Effect.succeed(true)
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
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

  it.live("persists data-ref resolution after source attribution when the flag is enabled", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const persisted: Array<unknown> = [];
      const resolverCalls: Array<unknown> = [];
      const completions: Array<unknown> = [];
      const sourcePlan = makePlan({
        enrichmentType: "source-attribution",
        vision: makeVisionEnrichment()
      });

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () =>
          Effect.succeed(
            makeRunRecord({
              enrichmentType: "source-attribution"
            })
          ),
        listRunning: () => Effect.succeed([]),
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        resetForRetry: () => Effect.succeed(false),
        listLatestByPostUri: () => Effect.succeed([]),
        markComplete: (input) =>
          Effect.sync(() => {
            completions.push(input);
          }),
        markFailed: () => Effect.void,
        markNeedsReview: () => Effect.void
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(AppConfig, testConfig({
              enableDataRefResolution: true,
              enableStagingOps: true
            })),
            Layer.succeed(EnrichmentPlanner, {
              plan: () => Effect.succeed(sourcePlan)
            }),
            Layer.succeed(SourceAttributionExecutor, {
              execute: () => Effect.succeed(makeSourceAttributionEnrichment())
            }),
            Layer.succeed(ResolverClient, {
              resolvePost: (input, options) =>
                Effect.sync(() => {
                  resolverCalls.push({ input, options });
                  return {
                    postUri: input.postUri,
                    stage1: {
                      matches: [],
                      residuals: []
                    },
                    kernel: [makeKernelOutcome(input.postUri)],
                    resolverVersion: "resolution-kernel@sky-314",
                    latencyMs: {
                      stage1: 3,
                      kernel: 2,
                      total: 5
                    }
                  };
                }),
              resolveBulk: () =>
                Effect.fail(
                  new ResolverClientError({
                    message: "bulk resolution should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.resolveBulk"
                  })
                ),
              searchCandidates: () =>
                Effect.fail(
                  new ResolverClientError({
                    message:
                      "grouped search-candidates should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.searchCandidates"
                  })
                )
            }),
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () =>
                Effect.succeed({
                  runId: "unused",
                  workflowInstanceId: "unused",
                  status: "queued" as const
                }),
              startIfAbsent: () => Effect.succeed(true)
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "source-attribution",
            schemaVersion: "v2",
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
      expect(resolverCalls).toEqual([
        {
          input: {
            postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
            stage1Input: {
              postContext: {
                postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
                text: "Stored post text",
                links: [],
                linkCards: [],
                threadCoverage: "focus-only"
              },
              vision: makeVisionEnrichment(),
              sourceAttribution: makeSourceAttributionEnrichment()
            }
          },
          options: {
            requestId: "run-1"
          }
        }
      ]);
      expect(persisted).toEqual([
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "source-attribution",
          enrichmentPayload: makeSourceAttributionEnrichment()
        },
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "data-ref-resolution",
          enrichmentPayload: expect.objectContaining({
            kind: "data-ref-resolution",
            stage1: {
              matches: [],
              residuals: []
            },
            kernel: [expect.objectContaining({ _tag: "NoMatch" })],
            resolverVersion: "resolution-kernel@sky-314"
          })
        }
      ]);
      expect(completions).toHaveLength(1);
    })
  );

  it.live("skips resolver persistence when the data-ref flag is off", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const persisted: Array<unknown> = [];
      const resolverCalls: Array<unknown> = [];
      const sourcePlan = makePlan({
        enrichmentType: "source-attribution",
        vision: makeVisionEnrichment()
      });

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () =>
          Effect.succeed(
            makeRunRecord({
              enrichmentType: "source-attribution"
            })
          ),
        listRunning: () => Effect.succeed([]),
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        resetForRetry: () => Effect.succeed(false),
        listLatestByPostUri: () => Effect.succeed([]),
        markComplete: () => Effect.void,
        markFailed: () => Effect.void,
        markNeedsReview: () => Effect.void
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(AppConfig, testConfig({
              enableDataRefResolution: false
            })),
            Layer.succeed(EnrichmentPlanner, {
              plan: () => Effect.succeed(sourcePlan)
            }),
            Layer.succeed(SourceAttributionExecutor, {
              execute: () => Effect.succeed(makeSourceAttributionEnrichment())
            }),
            Layer.succeed(ResolverClient, {
              resolvePost: (input) =>
                Effect.sync(() => {
                  resolverCalls.push(input);
                  return {
                    postUri: input.postUri,
                    stage1: {
                      matches: [],
                      residuals: []
                    },
                    kernel: [makeKernelOutcome(input.postUri)],
                    resolverVersion: "resolution-kernel@sky-314",
                    latencyMs: {
                      stage1: 1,
                      kernel: 1,
                      total: 2
                    }
                  };
                }),
              resolveBulk: () =>
                Effect.fail(
                  new ResolverClientError({
                    message: "bulk resolution should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.resolveBulk"
                  })
                ),
              searchCandidates: () =>
                Effect.fail(
                  new ResolverClientError({
                    message:
                      "grouped search-candidates should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.searchCandidates"
                  })
                )
            }),
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () =>
                Effect.succeed({
                  runId: "unused",
                  workflowInstanceId: "unused",
                  status: "queued" as const
                }),
              startIfAbsent: () => Effect.succeed(true)
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "source-attribution",
            schemaVersion: "v2",
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
      expect(resolverCalls).toEqual([]);
      expect(persisted).toEqual([
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "source-attribution",
          enrichmentPayload: makeSourceAttributionEnrichment()
        }
      ]);
    })
  );

  it.live("keeps the run complete when resolver lookup fails", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const persisted: Array<unknown> = [];
      const failures: Array<unknown> = [];
      const sourcePlan = makePlan({
        enrichmentType: "source-attribution",
        vision: makeVisionEnrichment()
      });

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () =>
          Effect.succeed(
            makeRunRecord({
              enrichmentType: "source-attribution"
            })
          ),
        listRunning: () => Effect.succeed([]),
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        resetForRetry: () => Effect.succeed(false),
        listLatestByPostUri: () => Effect.succeed([]),
        markComplete: () => Effect.void,
        markFailed: (input) =>
          Effect.sync(() => {
            failures.push(input);
          }),
        markNeedsReview: () => Effect.void
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(AppConfig, testConfig({
              enableDataRefResolution: true
            })),
            Layer.succeed(EnrichmentPlanner, {
              plan: () => Effect.succeed(sourcePlan)
            }),
            Layer.succeed(SourceAttributionExecutor, {
              execute: () => Effect.succeed(makeSourceAttributionEnrichment())
            }),
            Layer.succeed(ResolverClient, {
              resolvePost: () =>
                Effect.fail(
                  new ResolverClientError({
                    message: "resolver timed out",
                    status: 503,
                    operation: "ResolverClient.resolvePost"
                  })
                ),
              resolveBulk: () =>
                Effect.fail(
                  new ResolverClientError({
                    message: "bulk resolution should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.resolveBulk"
                  })
                ),
              searchCandidates: () =>
                Effect.fail(
                  new ResolverClientError({
                    message:
                      "grouped search-candidates should not be called in this test",
                    status: 500,
                    operation: "ResolverClient.searchCandidates"
                  })
                )
            }),
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () =>
                Effect.succeed({
                  runId: "unused",
                  workflowInstanceId: "unused",
                  status: "queued" as const
                }),
              startIfAbsent: () => Effect.succeed(true)
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "source-attribution",
            schemaVersion: "v2",
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
      expect(failures).toEqual([]);
      expect(persisted).toEqual([
        {
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          enrichmentType: "source-attribution",
          enrichmentPayload: makeSourceAttributionEnrichment()
        }
      ]);
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
        listLatestByPostUri: () => Effect.succeed([]),
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
        listLatestByPostUri: () => Effect.succeed([]),
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
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

  it.live("marks needs-review when the quality gate rejects a weak vision enrichment", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const phases: Array<EnrichmentRunRecord["phase"]> = [];
      const completions: Array<unknown> = [];
      const persisted: Array<unknown> = [];
      const reviewMarks: Array<unknown> = [];
      const failures: Array<unknown> = [];
      const launcherCalls: Array<unknown> = [];

      const weakVisionEnrichment: VisionEnrichment = {
        kind: "vision",
        summary: {
          text: "A photo.",
          mediaTypes: ["photo"],
          chartTypes: [],
          titles: [],
          keyFindings: []
        },
        assets: [
          {
            assetKey: workflowAssetKey,
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "photo",
              chartTypes: [],
              altText: "A photo.",
              altTextProvenance: "synthetic",
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: [],
              visibleUrls: [],
              organizationMentions: [],
              logoText: [],
              title: null,
              modelId: "gemini-2.5-flash",
              processedAt: 10
            }
          }
        ],
        modelId: "gemini-2.5-flash",
        promptVersion: "v2.0.0",
        processedAt: 10
      };

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
        listLatestByPostUri: () => Effect.succeed([]),
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
              plan: () => Effect.succeed(makePlan())
            }),
            Layer.succeed(VisionEnrichmentExecutor, {
              execute: () => Effect.succeed(weakVisionEnrichment)
            }),
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () =>
                Effect.succeed({
                  runId: "source-attribution-queued",
                  workflowInstanceId: "source-attribution-queued",
                  status: "queued" as const
                }),
              startIfAbsent: (input) =>
                Effect.sync(() => {
                  launcherCalls.push(input);
                  return true;
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
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "vision",
            schemaVersion: "v1",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          } satisfies EnrichmentRunParams
        } as any,
        makeStep()
      );

      // Result status is "needs-review"
      expect(result).toEqual({
        runId: "run-1",
        status: "needs-review"
      });

      // Payload was persisted before the gate rejected it
      expect(persisted).toHaveLength(1);

      // Run was marked needs-review with EnrichmentQualityGateError
      expect(reviewMarks).toHaveLength(1);
      expect(reviewMarks[0]).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            tag: "EnrichmentQualityGateError"
          })
        })
      );

      // The needs-review mark includes resultWrittenAt as a number
      const mark = reviewMarks[0] as { resultWrittenAt?: unknown };
      expect(typeof mark.resultWrittenAt).toBe("number");

      // Source attribution was NOT queued
      expect(launcherCalls).toEqual([]);

      // markComplete was NOT called
      expect(completions).toEqual([]);
    })
  );
});
