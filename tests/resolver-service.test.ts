import { Chunk, Effect, Layer, Option } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { SourceAttributionEnrichment } from "../src/domain/enrichment";
import type { EnrichmentExecutionPlan } from "../src/domain/enrichmentPlan";
import {
  EnrichmentSchemaDecodeError,
  ResolverSourceAttributionMissingError
} from "../src/domain/errors";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import type { ResolveBulkRequest, ResolvePostRequest } from "../src/domain/resolution";
import type { Stage1Input, Stage1Result } from "../src/domain/stage1Resolution";
import type { PostUri } from "../src/domain/types";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import { Stage1Resolver } from "../src/resolution/Stage1Resolver";
import { ResolverService } from "../src/resolver/ResolverService";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";
import { EntitySearchService } from "../src/services/EntitySearchService";

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

const makeStage1InputWithVision = (
  postUri = "at://did:plc:test/app.bsky.feed.post/post-1"
): Stage1Input => {
  const typedPostUri = asPostUri(postUri);

  return {
    ...makeStage1Input(postUri),
    vision: {
      kind: "vision",
      summary: {
        text: "Example chart",
        mediaTypes: ["chart"],
        chartTypes: ["line-chart"],
        titles: ["Example dataset"],
        keyFindings: []
      },
      assets: [
        {
          assetKey: chartAssetIdFromBluesky(
            typedPostUri,
            "bafkreiresolverserviceasset"
          ),
          assetType: "image",
          source: "embed",
          index: 0,
          originalAltText: null,
          extractionRoute: "full",
          analysis: {
            mediaType: "chart",
            chartTypes: ["line-chart"],
            altText: "Example chart",
            altTextProvenance: "synthetic",
            xAxis: {
              label: "Month",
              unit: null
            },
            yAxis: {
              label: "Load",
              unit: "MWh"
            },
            series: [
              {
                legendLabel: "Load",
                unit: "MWh"
              }
            ],
            sourceLines: [
              {
                sourceText: "Source: Example Provider",
                datasetName: "Example dataset"
              }
            ],
            temporalCoverage: null,
            keyFindings: [],
            visibleUrls: [],
            organizationMentions: [],
            logoText: ["Example Provider"],
            title: "Example dataset",
            modelId: "gemini-test",
            processedAt: 10
          }
        }
      ],
      modelId: "gemini-test",
      promptVersion: "v2",
      processedAt: 10
    }
  };
};

const makeStage1Result = (
  residuals: Stage1Result["residuals"] = []
): Stage1Result => ({
  matches: [],
  residuals
});

const makeEnv = (): EnvBindings => ({
  DB: {} as D1Database,
  OPERATOR_SECRET: "resolver-secret"
});

const makeSearchCandidatesResponse = () => ({
  bundles: []
});

const makeEntitySearchBundleCandidates = () => ({
  plan: {
    exactCanonicalUrls: [],
    exactHostnames: [],
    agentText: [],
    datasetText: [],
    distributionText: [],
    seriesText: [],
    variableText: []
  },
  agents: [],
  datasets: [],
  distributions: [],
  series: [],
  variables: []
});

const makeServiceLayer = (options?: {
  readonly plan?: EnrichmentExecutionPlan;
  readonly resolveStage1?: (input: Stage1Input) => Effect.Effect<Stage1Result>;
  readonly searchAgents?: (
    input: unknown
  ) => Effect.Effect<ReadonlyArray<any>>;
  readonly searchDatasets?: (
    input: unknown
  ) => Effect.Effect<ReadonlyArray<any>>;
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
        Layer.succeed(DataLayerRegistry, {
          prepared: {} as never,
          lookup: {
            entities: Chunk.empty(),
            findByCanonicalUri: () => Option.none(),
            findAgentByLabel: () => Option.none(),
            findAgentByHomepageDomain: () => Option.none(),
            findDatasetByTitle: () => Option.none(),
            findDatasetByAlias: () => Option.none(),
            findDatasetsByAgentId: () => Chunk.empty(),
            findDatasetsByVariableId: () => Chunk.empty(),
            findVariablesByAgentId: () => Chunk.empty(),
            findVariablesByDatasetId: () => Chunk.empty(),
            findDistributionByUrl: () => Option.none(),
            findDatasetByLandingPage: () => Option.none(),
            findDistributionsByHostname: () => Chunk.empty(),
            findDistributionsByUrlPrefix: () => Chunk.empty(),
            findVariableByAlias: () => Option.none()
          } as never
        }),
        Layer.succeed(EntitySearchService, {
          search: () => Effect.succeed([]),
          searchAgents: (input) =>
            options?.searchAgents?.(input) ?? Effect.succeed([]),
          searchDatasets: (input) =>
            options?.searchDatasets?.(input) ?? Effect.succeed([]),
          searchDistributions: () => Effect.succeed([]),
          searchSeries: () => Effect.succeed([]),
          searchVariables: () => Effect.succeed([]),
          searchBundleCandidates: () =>
            Effect.succeed(makeEntitySearchBundleCandidates() as any)
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
        expect(result.resolution).toEqual([]);
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

  it.effect("routes resolvePost and searchCandidates through the same bundle-resolution seam", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const input = {
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1Input: makeStage1InputWithVision()
      } satisfies ResolvePostRequest;

      const postResult = yield* service.resolvePost(input);
      const searchResult = yield* service.searchCandidates(input);

      expect(postResult.resolution).toEqual(searchResult.bundles);
      expect(postResult.resolution[0]?.resolution.agents[0]?.entityId).toBe(
        "https://id.skygest.io/agent/ag_TESTDATAREF01"
      );
      expect(postResult.resolution[0]?.resolution.datasets[0]?.entityId).toBe(
        "https://id.skygest.io/dataset/ds_TESTDATAREF01"
      );
      expect(postResult.latencyMs.resolution).toBeGreaterThanOrEqual(0);
    }).pipe(
      Effect.provide(
        makeServiceLayer({
          searchAgents: () =>
            Effect.succeed([
              {
                document: {
                  entityId: "https://id.skygest.io/agent/ag_TESTDATAREF01",
                  entityType: "Agent",
                  primaryLabel: "Example Provider"
                },
                score: 0.97,
                rank: 1,
                matchKind: "lexical",
                snippet: null
              } as any
            ]),
          searchDatasets: () =>
            Effect.succeed([
              {
                document: {
                  entityId: "https://id.skygest.io/dataset/ds_TESTDATAREF01",
                  entityType: "Dataset",
                  primaryLabel: "Example dataset"
                },
                score: 0.91,
                rank: 1,
                matchKind: "lexical",
                snippet: null
              } as any
            ])
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

  it.effect("returns grouped search candidates through the resolver-facing seam", () =>
    Effect.gen(function* () {
      const service = yield* ResolverService;
      const result = yield* service.searchCandidates({
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1Input: makeStage1Input()
      });

      expect(result).toEqual(makeSearchCandidatesResponse());
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
