import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { SourceAttributionEnrichment } from "../src/domain/enrichment";
import type { EnrichmentExecutionPlan } from "../src/domain/enrichmentPlan";
import {
  EnrichmentSchemaDecodeError,
  ResolverSourceAttributionMissingError
} from "../src/domain/errors";
import type { ResolutionOutcome } from "../src/domain/resolutionKernel";
import type { ResolveBulkRequest, ResolvePostRequest } from "../src/domain/resolution";
import type { Stage1Input, Stage1Result } from "../src/domain/stage1Resolution";
import type { PostUri } from "../src/domain/types";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import { ResolutionKernel } from "../src/resolution/ResolutionKernel";
import { Stage1Resolver } from "../src/resolution/Stage1Resolver";
import { ResolverService } from "../src/resolver/ResolverService";

const asPostUri = (value: string) => value as PostUri;

const makeSourceAttribution = (
  processedAt: number
): SourceAttributionEnrichment => ({
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

const makeEnv = (): EnvBindings => ({
  DB: {} as D1Database,
  OPERATOR_SECRET: "resolver-secret"
});

const makeServiceLayer = (options?: {
  readonly plan?: EnrichmentExecutionPlan;
  readonly resolveStage1?: (input: Stage1Input) => Effect.Effect<Stage1Result>;
  readonly resolveKernel?: (
    input: Stage1Input
  ) => Effect.Effect<ReadonlyArray<ResolutionOutcome>>;
}) =>
  ResolverService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        CloudflareEnv.layer(makeEnv()),
        Layer.succeed(EnrichmentPlanner, {
          plan: () => Effect.succeed(options?.plan ?? makePlan())
        }),
        Layer.succeed(Stage1Resolver, {
          resolve: (input) =>
            options?.resolveStage1?.(input as Stage1Input) ??
            Effect.succeed(makeStage1Result())
        }),
        Layer.succeed(ResolutionKernel, {
          resolve: (input) =>
            options?.resolveKernel?.(input as Stage1Input) ??
            Effect.succeed([makeKernelOutcome()])
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
        expect(result.kernel[0]?._tag).toBe("NoMatch");
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

  it.effect("returns kernel outcomes and kernel latency in the live response", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const result = yield* service.resolvePost({
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1Input: makeStage1Input()
      });

      expect(result.kernel).toEqual([makeKernelOutcome()]);
      expect(result.latencyMs.kernel).toBeGreaterThanOrEqual(0);
    }).pipe(
      Effect.provide(
        makeServiceLayer({
          resolveKernel: () => Effect.succeed([makeKernelOutcome()])
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
