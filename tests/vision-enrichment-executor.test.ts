import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { VisionExecutionPlan } from "../src/domain/enrichmentPlan";
import type { PostUri } from "../src/domain/types";
import { GeminiApiError } from "../src/domain/errors";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import { GeminiVisionService } from "../src/enrichment/GeminiVisionService";
import {
  fullExtractionEligible,
  VisionEnrichmentExecutor
} from "../src/enrichment/VisionEnrichmentExecutor";

const asPostUri = (value: string) => value as PostUri;
const planPostUri = asPostUri("at://did:plc:test/app.bsky.feed.post/post-1");
const assetKeyOne = chartAssetIdFromBluesky(planPostUri, "bafkreiassetone");
const assetKeyTwo = chartAssetIdFromBluesky(planPostUri, "bafkreiassettwo");

const makePlan = (): VisionExecutionPlan => ({
  postUri: planPostUri,
  enrichmentType: "vision",
  schemaVersion: "v1",
  decision: "execute",
  captureStage: "picked",
  post: {
    postUri: planPostUri,
    did: "did:plc:test" as any,
    handle: null,
    text: "Stored post text",
    createdAt: 1,
    threadCoverage: "focus-only"
  },
  embedType: "img",
  embedPayload: null,
  links: [],
  topicMatches: [],
  quote: null,
  linkCards: [],
  assets: [
    {
      assetKey: assetKeyOne,
      assetType: "image",
      source: "embed",
      index: 0,
      thumb: "https://cdn.bsky.app/thumb-1.jpg",
      fullsize: "https://cdn.bsky.app/full-1.jpg",
      alt: null
    },
    {
      assetKey: assetKeyTwo,
      assetType: "image",
      source: "embed",
      index: 1,
      thumb: "https://cdn.bsky.app/thumb-2.jpg",
      fullsize: "https://cdn.bsky.app/full-2.jpg",
      alt: "Original alt"
    }
  ],
  existingEnrichments: [],
  vision: null
});

// ---------------------------------------------------------------------------
// 4a. Unit tests for fullExtractionEligible predicate
// ---------------------------------------------------------------------------

describe("fullExtractionEligible", () => {
  it("single chart with data points → true (full extraction)", () => {
    expect(
      fullExtractionEligible({
        mediaType: "chart",
        chartTypes: ["bar-chart"],
        hasDataPoints: true,
        isCompound: false
      })
    ).toBe(true);
  });

  it("compound dashboard → false (lightweight)", () => {
    expect(
      fullExtractionEligible({
        mediaType: "chart",
        chartTypes: ["bar-chart", "line-chart"],
        hasDataPoints: true,
        isCompound: true
      })
    ).toBe(false);
  });

  it("photo → false (mediaType !== 'chart')", () => {
    expect(
      fullExtractionEligible({
        mediaType: "photo",
        chartTypes: [],
        hasDataPoints: false,
        isCompound: false
      })
    ).toBe(false);
  });

  it("document-excerpt → false", () => {
    expect(
      fullExtractionEligible({
        mediaType: "document-excerpt",
        chartTypes: [],
        hasDataPoints: false,
        isCompound: false
      })
    ).toBe(false);
  });

  it("infographic with single embedded chart → false (mediaType !== 'chart')", () => {
    expect(
      fullExtractionEligible({
        mediaType: "infographic",
        chartTypes: ["bar-chart"],
        hasDataPoints: true,
        isCompound: false
      })
    ).toBe(false);
  });

  it("chart without data points (flow chart) → false", () => {
    expect(
      fullExtractionEligible({
        mediaType: "chart",
        chartTypes: ["flow-chart"],
        hasDataPoints: false,
        isCompound: false
      })
    ).toBe(false);
  });

  it("video → false", () => {
    expect(
      fullExtractionEligible({
        mediaType: "video",
        chartTypes: [],
        hasDataPoints: false,
        isCompound: false
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VisionEnrichmentExecutor integration tests
// ---------------------------------------------------------------------------

describe("VisionEnrichmentExecutor", () => {
  it.effect("builds an asset-level vision enrichment and post summary", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: {
              "content-type": "image/jpeg"
            }
          })
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array([4, 5, 6]), {
            status: 200,
            headers: {
              "content-type": "image/png"
            }
          })
        );

      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        let uploadIndex = 0;
        let analysisIndex = 0;
        const executorLayer = VisionEnrichmentExecutor.layer.pipe(
          Layer.provideMerge(
            Layer.succeed(GeminiVisionService, {
              uploadImage: (_data, _mimeType) =>
                Effect.sync(() => {
                  uploadIndex += 1;
                  return {
                    uri: `gemini://asset-${uploadIndex}`,
                    name: `files/${uploadIndex}`
                  };
                }),
              classifyImage: () =>
                Effect.succeed({
                  mediaType: "chart" as const,
                  chartTypes: ["bar-chart" as const],
                  hasDataPoints: true,
                  isCompound: false
                }),
              extractImageSummary: () =>
                Effect.die("extractImageSummary should not run for eligible charts"),
              extractChartData: (_imageUri, _mimeType) =>
                Effect.sync(() => {
                  analysisIndex += 1;
                  return analysisIndex === 1
                    ? {
                        mediaType: "chart" as const,
                        chartTypes: ["bar-chart" as const],
                        altText: "Bar chart of Alberta pool prices by month.",
                        altTextProvenance: "synthetic" as const,
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
                        modelId: "test-model",
                        processedAt: 100
                      }
                    : {
                        mediaType: "chart" as const,
                        chartTypes: ["line-chart" as const],
                        altText: "Line chart of battery storage additions.",
                        altTextProvenance: "synthetic" as const,
                        xAxis: { label: "Year", unit: null },
                        yAxis: { label: "MW", unit: "MW" },
                        series: [{ legendLabel: "Storage", unit: "MW" }],
                        sourceLines: [
                          { sourceText: "Source: GridStatus", datasetName: null }
                        ],
                        temporalCoverage: {
                          startDate: "2021",
                          endDate: "2025"
                        },
                        keyFindings: [
                          "Prices rose through the summer",
                          "Battery storage additions accelerated"
                        ],
                        visibleUrls: [],
                        organizationMentions: [],
                        logoText: [],
                        title: "Battery storage additions",
                        modelId: "test-model",
                        processedAt: 200
                      };
                })
            })
          )
        );

        const executor = yield* Effect.service(VisionEnrichmentExecutor).pipe(
          Effect.provide(executorLayer)
        );
        const result = yield* executor.execute(makePlan());

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.kind).toBe("vision");
        expect(result.assets).toHaveLength(2);
        expect(result.assets[1]?.originalAltText).toBe("Original alt");
        expect(result.summary.chartTypes).toEqual(["bar-chart", "line-chart"]);
        expect(result.summary.keyFindings).toEqual(
          expect.arrayContaining([
            {
              text: "Prices rose through the summer",
              assetKeys: [
                assetKeyOne,
                assetKeyTwo
              ]
            },
            {
              text: "Battery storage additions accelerated",
              assetKeys: [assetKeyTwo]
            }
          ])
        );
        expect(result.modelId).toBe("test-model");
        expect(result.promptVersion).toBe("v3.2.0");
        expect(result.processedAt).toBe(200);
      } finally {
        globalThis.fetch = originalFetch;
      }
    })
  );

  it.effect("fails with an asset fetch error when the source image cannot be loaded", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response("boom", { status: 503 })
      );
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      try {
        const executorLayer = VisionEnrichmentExecutor.layer.pipe(
          Layer.provideMerge(
            Layer.succeed(GeminiVisionService, {
              uploadImage: () => Effect.die("uploadImage should not run"),
              classifyImage: () => Effect.die("classifyImage should not run"),
              extractImageSummary: () =>
                Effect.die("extractImageSummary should not run"),
              extractChartData: () =>
                Effect.die("extractChartData should not run")
            })
          )
        );

        const executor = yield* Effect.service(VisionEnrichmentExecutor).pipe(
          Effect.provide(executorLayer)
        );
        const exit = yield* Effect.exit(
          executor.execute(makePlan())
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          expect(error).toMatchObject({
            _tag: "EnrichmentAssetFetchError",
            assetKey: assetKeyOne,
            status: 503
          });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    })
  );

  // -------------------------------------------------------------------------
  // 4c. Classification fallback path
  // -------------------------------------------------------------------------

  it.effect(
    "falls back to full extraction when classifyImage fails",
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/jpeg" }
          })
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
          const extractChartDataMock = vi.fn();
          const extractImageSummaryMock = vi.fn();

          const executorLayer = VisionEnrichmentExecutor.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(GeminiVisionService, {
                uploadImage: () =>
                  Effect.succeed({
                    uri: "gemini://fallback-asset",
                    name: "files/fallback"
                  }),
                classifyImage: () => {
                  return Effect.fail(
                    new GeminiApiError({ message: "rate limited" })
                  );
                },
                extractImageSummary: (...args: any[]) => {
                  extractImageSummaryMock(...args);
                  return Effect.die(
                    "extractImageSummary should not run on fallback"
                  );
                },
                extractChartData: (...args: any[]) => {
                  extractChartDataMock(...args);
                  return Effect.succeed({
                    mediaType: "chart" as const,
                    chartTypes: ["bar-chart" as const],
                    altText: "Fallback chart analysis.",
                    altTextProvenance: "synthetic" as const,
                    xAxis: { label: "X", unit: null },
                    yAxis: { label: "Y", unit: null },
                    series: [],
                    sourceLines: [],
                    temporalCoverage: null,
                    keyFindings: ["Fallback finding"],
                    visibleUrls: [],
                    organizationMentions: [],
                    logoText: [],
                    title: "Fallback chart",
                    modelId: "test-model",
                    processedAt: 300
                  });
                }
              })
            )
          );

          const singleAssetPlan: VisionExecutionPlan = {
            ...makePlan(),
            assets: [makePlan().assets[0]!]
          };

          const executor = yield* Effect.service(VisionEnrichmentExecutor).pipe(
            Effect.provide(executorLayer)
          );
          const result = yield* executor.execute(singleAssetPlan);

          // The executor should succeed despite classification failure
          expect(result.kind).toBe("vision");
          expect(result.assets).toHaveLength(1);

          // It should route to extractChartData (full extraction — the safe default)
          expect(extractChartDataMock).toHaveBeenCalledOnce();
          expect(extractImageSummaryMock).not.toHaveBeenCalled();

          // The result should include extractionRoute: "full"
          expect(result.assets[0]?.extractionRoute).toBe("full");
        } finally {
          globalThis.fetch = originalFetch;
        }
      })
  );

  // -------------------------------------------------------------------------
  // 4d. Lightweight extraction routing
  // -------------------------------------------------------------------------

  it.effect(
    "routes to extractImageSummary for compound dashboard classification",
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
          new Response(new Uint8Array([7, 8, 9]), {
            status: 200,
            headers: { "content-type": "image/png" }
          })
        );
        const originalFetch = globalThis.fetch;
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        try {
          const extractChartDataMock = vi.fn();
          const extractImageSummaryMock = vi.fn();

          const executorLayer = VisionEnrichmentExecutor.layer.pipe(
            Layer.provideMerge(
              Layer.succeed(GeminiVisionService, {
                uploadImage: () =>
                  Effect.succeed({
                    uri: "gemini://compound-asset",
                    name: "files/compound"
                  }),
                classifyImage: () =>
                  Effect.succeed({
                    mediaType: "chart" as const,
                    chartTypes: ["bar-chart" as const, "line-chart" as const],
                    hasDataPoints: true,
                    isCompound: true
                  }),
                extractChartData: (...args: any[]) => {
                  extractChartDataMock(...args);
                  return Effect.die(
                    "extractChartData should not run for compound"
                  );
                },
                extractImageSummary: (...args: any[]) => {
                  extractImageSummaryMock(...args);
                  return Effect.succeed({
                    mediaType: "chart" as const,
                    chartTypes: ["bar-chart" as const, "line-chart" as const],
                    altText:
                      "Dashboard showing energy prices and generation mix.",
                    altTextProvenance: "synthetic" as const,
                    xAxis: null,
                    yAxis: null,
                    series: [],
                    sourceLines: [
                      { sourceText: "Source: AESO", datasetName: null }
                    ],
                    temporalCoverage: null,
                    keyFindings: ["Multiple panels show regional trends"],
                    visibleUrls: [],
                    organizationMentions: [],
                    logoText: [],
                    title: "Energy Dashboard",
                    modelId: "test-model",
                    processedAt: 400
                  });
                }
              })
            )
          );

          const singleAssetPlan: VisionExecutionPlan = {
            ...makePlan(),
            assets: [makePlan().assets[0]!]
          };

          const executor = yield* Effect.service(VisionEnrichmentExecutor).pipe(
            Effect.provide(executorLayer)
          );
          const result = yield* executor.execute(singleAssetPlan);

          expect(result.kind).toBe("vision");
          expect(result.assets).toHaveLength(1);

          // It should route to extractImageSummary (not extractChartData)
          expect(extractImageSummaryMock).toHaveBeenCalledOnce();
          expect(extractChartDataMock).not.toHaveBeenCalled();

          // The result should include extractionRoute: "lightweight"
          expect(result.assets[0]?.extractionRoute).toBe("lightweight");

          // Lightweight results have null chart-specific fields
          expect(result.assets[0]?.analysis.xAxis).toBeNull();
          expect(result.assets[0]?.analysis.yAxis).toBeNull();
          expect(result.assets[0]?.analysis.series).toEqual([]);
          expect(result.assets[0]?.analysis.temporalCoverage).toBeNull();

          // But real metadata fields are present
          expect(result.assets[0]?.analysis.altText).toBe(
            "Dashboard showing energy prices and generation mix."
          );
          expect(result.assets[0]?.analysis.sourceLines).toEqual([
            { sourceText: "Source: AESO", datasetName: null }
          ]);
          expect(result.assets[0]?.analysis.title).toBe("Energy Dashboard");
        } finally {
          globalThis.fetch = originalFetch;
        }
      })
  );
});
