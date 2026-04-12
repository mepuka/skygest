import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { EnrichmentExecutionPlan } from "../src/domain/enrichmentPlan";
import type { SourceAttributionEnrichment } from "../src/domain/enrichment";
import {
  EnrichmentSchemaDecodeError,
  ResolverSourceAttributionMissingError
} from "../src/domain/errors";
import type { ResolveBulkRequest, ResolvePostRequest } from "../src/domain/resolution";
import type { PostUri } from "../src/domain/types";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import {
  CloudflareEnv,
  type EnvBindings,
  type ResolverWorkerEnvBindings
} from "../src/platform/Env";
import type { Stage1Input, Stage1Result } from "../src/domain/stage1Resolution";
import type { Stage2Result, Stage3Input } from "../src/domain/stage2Resolution";
import { Stage1Resolver } from "../src/resolution/Stage1Resolver";
import { Stage2Resolver } from "../src/resolution/Stage2Resolver";
import { ResolverService } from "../src/resolver/ResolverService";

const asPostUri = (value: string) => value as PostUri;

const makeSourceAttribution = (processedAt: number): SourceAttributionEnrichment => ({
  kind: "source-attribution",
  provider: null,
  resolution: "unmatched",
  providerCandidates: [],
  contentSource: null,
  socialProvenance: null,
  processedAt
});

const makePlan = (
  overrides: Partial<EnrichmentExecutionPlan> = {}
): EnrichmentExecutionPlan => ({
  postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
  enrichmentType: "source-attribution",
  schemaVersion: "v2",
  decision: "execute",
  captureStage: "picked",
  post: {
    postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
    did: "did:plc:test" as any,
    handle: null,
    text: "Stored post text",
    createdAt: 1,
    threadCoverage: "focus-only"
  },
  embedType: null,
  embedPayload: null,
  links: [],
  topicMatches: [],
  quote: null,
  linkCards: [],
  assets: [],
  existingEnrichments: [],
  vision: null,
  ...overrides
});

const makeStage1Input = (
  postUri = "at://did:plc:test/app.bsky.feed.post/post-1"
): Stage1Input => ({
  postContext: {
    postUri: asPostUri(postUri),
    text: "Stored post text",
    links: [],
    linkCards: [],
    threadCoverage: "focus-only"
  },
  vision: null,
  sourceAttribution: makeSourceAttribution(10)
});

const makeStage1Result = (
  residuals: Stage1Result["residuals"] = []
): Stage1Result => ({
  matches: [],
  residuals
});

const makeStage2Result = (
  overrides: Partial<Stage2Result> = {}
): Stage2Result => ({
  matches: [],
  corroborations: [],
  escalations: [],
  ...overrides
});

const makeStage3Input = (
  postUri = "at://did:plc:test/app.bsky.feed.post/post-1"
): Stage3Input => ({
  _tag: "Stage3Input",
  postUri: asPostUri(postUri),
  originalResidual: {
    _tag: "UnmatchedTextResidual",
    source: "post-text",
    text: "ERCOT",
    normalizedText: "ercot"
  },
  stage2Lane: "fuzzy-agent-label",
  candidateSet: [],
  matchedSurfaceForms: [],
  unmatchedSurfaceForms: ["ercot"],
  reason: "best fuzzy score 0.20 below 0.60 threshold"
});

const makeEnv = (
  overrides: Partial<EnvBindings> = {}
): EnvBindings => ({
  DB: {} as D1Database,
  OPERATOR_SECRET: "resolver-secret",
  ...overrides
});

const makeServiceLayer = (options?: {
  readonly env?: Partial<EnvBindings>;
  readonly plan?: EnrichmentExecutionPlan;
  readonly resolveStage1?: (input: Stage1Input) => Effect.Effect<Stage1Result>;
  readonly resolveStage2?: (
    postContext: Stage1Input["postContext"],
    stage1: Stage1Result
  ) => Effect.Effect<Stage2Result>;
}) =>
  ResolverService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CloudflareEnv.layer(makeEnv(options?.env)),
        Layer.succeed(EnrichmentPlanner, {
          plan: () => Effect.succeed(options?.plan ?? makePlan())
        }),
        Layer.succeed(Stage1Resolver, {
          resolve: (input) =>
            options?.resolveStage1?.(input as Stage1Input) ??
            Effect.succeed(makeStage1Result())
        }),
        Layer.succeed(Stage2Resolver, {
          resolve: (postContext, stage1) =>
            options?.resolveStage2?.(
              postContext as Stage1Input["postContext"],
              stage1 as Stage1Result
            ) ?? Effect.succeed(makeStage2Result())
        })
      )
    )
  );

describe("ResolverService", () => {
  it.effect("rejects postUri mismatches between the request and inline stage1 input", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const error = yield* service.resolvePost({
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1Input: makeStage1Input(
          "at://did:plc:test/app.bsky.feed.post/post-2"
        )
      } satisfies ResolvePostRequest).pipe(Effect.flip);

      expect(error).toBeInstanceOf(EnrichmentSchemaDecodeError);
      expect(error.message).toContain("postUri does not match");
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("uses the latest stored source-attribution enrichment when rebuilding stage1 input", () =>
    (() => {
      const resolvedInputs: Array<Stage1Input> = [];
      const latest = makeSourceAttribution(30);
      const older = makeSourceAttribution(10);

      return Effect.gen(function* () {
        const service = yield* ResolverService;

        const result = yield* service.resolvePost({
          postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1")
        });

        expect(result.stage1.matches).toEqual([]);
        expect(resolvedInputs).toHaveLength(1);
        expect(resolvedInputs[0]?.sourceAttribution?.processedAt).toBe(30);
        expect(resolvedInputs[0]?.postContext.postUri).toBe(
          "at://did:plc:test/app.bsky.feed.post/post-1"
        );
      }).pipe(
        Effect.provide(
          makeServiceLayer({
            plan: makePlan({
              existingEnrichments: [
                {
                  output: older,
                  updatedAt: 10,
                  enrichedAt: 10
                },
                {
                  output: latest,
                  updatedAt: 30,
                  enrichedAt: 30
                }
              ]
            }),
            resolveStage1: (input) =>
              Effect.sync(() => {
                resolvedInputs.push(input);
                return makeStage1Result();
              })
          })
        )
      );
    })()
  );

  it.effect("queues stage3 when requested and residuals remain", () =>
    (() => {
      const createdJobs: Array<{ readonly id: string; readonly params: unknown }> = [];
      const workflow = {
        create: async (input: any) => {
          createdJobs.push(input);
          return { id: input.id } as any;
        },
        get: async () => ({ id: "unused" } as any),
        createBatch: async () => []
      } as unknown as ResolverWorkerEnvBindings["RESOLVER_RUN_WORKFLOW"];

      return Effect.gen(function* () {
        const service = yield* ResolverService;

        const result = yield* service.resolvePost({
          postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
          stage1Input: makeStage1Input(),
          dispatchStage3: true
        });

        expect(result.stage3?.status).toBe("queued");
        expect(result.stage2?.escalations).toHaveLength(1);
        expect(createdJobs).toHaveLength(1);
        expect(createdJobs[0]?.params).toEqual({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
          stage3Inputs: [makeStage3Input()]
        });
      }).pipe(
        Effect.provide(
          makeServiceLayer({
            env: {
              RESOLVER_RUN_WORKFLOW: workflow
            },
            resolveStage1: () =>
              Effect.succeed(
                makeStage1Result([
                  {
                    _tag: "UnmatchedTextResidual",
                    source: "post-text",
                    text: "ERCOT",
                    normalizedText: "ercot"
                  }
                ])
              )
            ,
            resolveStage2: () =>
              Effect.succeed(
                makeStage2Result({
                  escalations: [makeStage3Input()]
                })
              )
          })
        )
      );
    })()
  );

  it.effect("keeps the fast response intact when stage3 dispatch fails", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const result = yield* service.resolvePost({
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1Input: makeStage1Input(),
        dispatchStage3: true
      });

      expect(result.stage1.residuals).toHaveLength(1);
      expect(result.stage2?.escalations).toHaveLength(1);
      expect(result.stage3).toBeUndefined();
    }).pipe(
      Effect.provide(
        makeServiceLayer({
          env: {
            RESOLVER_RUN_WORKFLOW: {
              create: async () => {
                throw new Error("workflow unavailable");
              },
              get: async () => ({ id: "unused" } as any),
              createBatch: async () => []
            } as unknown as ResolverWorkerEnvBindings["RESOLVER_RUN_WORKFLOW"]
          },
          resolveStage1: () =>
            Effect.succeed(
              makeStage1Result([
                {
                  _tag: "UnmatchedTextResidual",
                  source: "post-text",
                  text: "ERCOT",
                  normalizedText: "ercot"
                }
              ])
            ),
          resolveStage2: () =>
            Effect.succeed(
              makeStage2Result({
                escalations: [makeStage3Input()]
              })
            )
        })
      )
    )
  );

  it.effect("returns keyed successes and keyed failures from bulk resolution", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const successKey = asPostUri("at://did:plc:test/app.bsky.feed.post/post-1");
      const errorKey = asPostUri("at://did:plc:test/app.bsky.feed.post/post-2");
      const result = yield* service.resolveBulk({
        posts: [
          {
            postUri: successKey,
            stage1Input: makeStage1Input()
          },
          {
            postUri: errorKey,
            stage1Input: makeStage1Input(
              "at://did:plc:test/app.bsky.feed.post/post-1"
            )
          }
        ]
      } satisfies ResolveBulkRequest);

      expect(result.results[successKey]?.postUri).toBe(successKey);
      expect(result.errors[errorKey]?.tag).toBe("EnrichmentSchemaDecodeError");
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("fails when no stored source-attribution enrichment is available", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const error = yield* service.resolvePost({
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1")
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ResolverSourceAttributionMissingError);
    }).pipe(
      Effect.provide(
        makeServiceLayer({
          plan: makePlan({
            existingEnrichments: []
          })
        })
      )
    )
  );
});
