import { Cause, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import type { VisionExecutionPlan } from "../src/domain/enrichmentPlan";
import type { PostUri } from "../src/domain/types";
import { GeminiVisionService } from "../src/enrichment/GeminiVisionService";
import { VisionEnrichmentExecutor } from "../src/enrichment/VisionEnrichmentExecutor";

const asPostUri = (value: string) => value as PostUri;

const makePlan = (): VisionExecutionPlan => ({
  postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
  enrichmentType: "vision",
  schemaVersion: "v1",
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
  embedType: "img",
  embedPayload: null,
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
    },
    {
      assetKey: "embed:1:https://cdn.bsky.app/full-2.jpg",
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
                Effect.die("classification is not used in SKY-40"),
              extractImageSummary: () =>
                Effect.die("extractImageSummary is not used in SKY-40"),
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
                "embed:0:https://cdn.bsky.app/full-1.jpg",
                "embed:1:https://cdn.bsky.app/full-2.jpg"
              ]
            },
            {
              text: "Battery storage additions accelerated",
              assetKeys: ["embed:1:https://cdn.bsky.app/full-2.jpg"]
            }
          ])
        );
        expect(result.modelId).toBe("test-model");
        expect(result.promptVersion).toBe("v3.0.0");
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
            assetKey: "embed:0:https://cdn.bsky.app/full-1.jpg",
            status: 503
          });
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    })
  );
});
