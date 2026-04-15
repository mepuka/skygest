import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import { ResolutionEvidenceBundle } from "../src/domain/resolutionKernel";
import { Stage1Input } from "../src/domain/stage1Resolution";
import {
  buildResolutionEvidenceBundles,
  listBundleEvidenceSources
} from "../src/resolution/kernel/BundleAdapter";

const decodeStage1Input = Schema.decodeUnknownSync(Stage1Input);
const decodeBundle = Schema.decodeUnknownSync(ResolutionEvidenceBundle);
const assetKeyOne = chartAssetIdFromBluesky(
  "at://did:plc:test/app.bsky.feed.post/sky-313" as any,
  "asset-1"
);
const assetKeyTwo = chartAssetIdFromBluesky(
  "at://did:plc:test/app.bsky.feed.post/sky-315" as any,
  "asset-2"
);

describe("buildResolutionEvidenceBundles", () => {
  it("builds one bundle per vision asset and preserves chart evidence", () => {
    const input = decodeStage1Input({
      postContext: {
        postUri: "at://did:plc:test/app.bsky.feed.post/sky-313",
        text: "New chart on solar generation in Germany",
        links: [],
        linkCards: [],
        threadCoverage: "focus-only"
      },
      vision: {
        kind: "vision",
        summary: {
          text: "Solar generation chart",
          mediaTypes: ["chart"],
          chartTypes: ["line-chart"],
          titles: ["German solar generation"],
          keyFindings: []
        },
        assets: [
          {
            assetKey: assetKeyOne,
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "chart",
              chartTypes: ["line-chart"],
              altText: null,
              altTextProvenance: "synthetic",
              xAxis: {
                label: "Month",
                unit: null
              },
              yAxis: {
                label: "Generation",
                unit: "TWh"
              },
              series: [
                {
                  legendLabel: "Solar",
                  unit: "TWh"
                }
              ],
              sourceLines: [
                {
                  sourceText: "Source: Fraunhofer ISE",
                  datasetName: "Energy Charts"
                }
              ],
              temporalCoverage: {
                startDate: "2024-01",
                endDate: "2024-12"
              },
              keyFindings: ["Solar output peaked in July"],
              visibleUrls: ["https://energy-charts.info"],
              organizationMentions: [
                {
                  name: "Fraunhofer ISE",
                  location: "footer"
                }
              ],
              logoText: ["Energy Charts"],
              title: "German solar generation",
              modelId: "gemini-test",
              processedAt: 1712900000000
            }
          }
        ],
        modelId: "gemini-test",
        promptVersion: "v2",
        processedAt: 1712900000000
      },
      sourceAttribution: {
        kind: "source-attribution",
        provider: {
          providerId: "fraunhofer-ise",
          providerLabel: "Fraunhofer ISE",
          sourceFamily: "research"
        },
        resolution: "matched",
        providerCandidates: [
          {
            providerId: "energy-charts",
            providerLabel: "Energy Charts",
            sourceFamily: "research",
            bestRank: 1,
            evidence: []
          }
        ],
        contentSource: {
          url: "https://energy-charts.info/charts/solar",
          title: "German solar generation",
          domain: "energy-charts.info",
          publication: "Energy Charts"
        },
        socialProvenance: null,
        processedAt: 1712900000000
      }
    });

    const bundles = buildResolutionEvidenceBundles(input);

    expect(bundles).toHaveLength(1);
    expect(() => decodeBundle(bundles[0])).not.toThrow();
    expect(bundles[0]).toEqual({
      postUri: input.postContext.postUri,
      assetKey: assetKeyOne,
      postText: ["New chart on solar generation in Germany"],
      chartTitle: "German solar generation",
      xAxis: {
        label: "Month",
        unit: null
      },
      yAxis: {
        label: "Generation",
        unit: "TWh"
      },
      series: [
        {
          itemKey: `${assetKeyOne}:series:0`,
          legendLabel: "Solar",
          unit: "TWh"
        }
      ],
      keyFindings: ["Solar output peaked in July"],
      sourceLines: [
        {
          sourceText: "Source: Fraunhofer ISE",
          datasetName: "Energy Charts"
        }
      ],
      publisherHints: [
        { label: "Fraunhofer ISE", confidence: 1 },
        { label: "Energy Charts", confidence: 0.8 },
        { label: "energy-charts.info", confidence: 0.6 },
        { label: "German solar generation", confidence: 0.4 }
      ],
      temporalCoverage: {
        startDate: "2024-01",
        endDate: "2024-12"
      }
    });
    expect(listBundleEvidenceSources(bundles[0]!)).toEqual([
      "series-label",
      "x-axis",
      "y-axis",
      "chart-title",
      "key-finding",
      "post-text",
      "source-line",
      "publisher-hint"
    ]);
  });

  it("assigns stable item keys for multi-series assets", () => {
    const input = decodeStage1Input({
      postContext: {
        postUri: "at://did:plc:test/app.bsky.feed.post/sky-315",
        text: "Solar and wind generation both increased",
        links: [],
        linkCards: [],
        threadCoverage: "focus-only"
      },
      vision: {
        kind: "vision",
        summary: {
          text: "Two-series chart",
          mediaTypes: ["chart"],
          chartTypes: ["bar-chart"],
          titles: ["EU Solar and Wind Generation"],
          keyFindings: []
        },
        assets: [
          {
            assetKey: assetKeyTwo,
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "chart",
              chartTypes: ["bar-chart"],
              altText: null,
              altTextProvenance: "synthetic",
              xAxis: { label: "Year", unit: null },
              yAxis: { label: "Generation", unit: "TWh" },
              series: [
                { legendLabel: "Solar", unit: "TWh" },
                { legendLabel: "Wind", unit: "TWh" }
              ],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: ["Both technologies rose year over year"],
              visibleUrls: [],
              organizationMentions: [],
              logoText: [],
              title: "EU Solar and Wind Generation",
              modelId: "gemini-test",
              processedAt: 1712900000000
            }
          }
        ],
        modelId: "gemini-test",
        promptVersion: "v2",
        processedAt: 1712900000000
      },
      sourceAttribution: null
    });

    const bundles = buildResolutionEvidenceBundles(input);

    expect(bundles[0]?.series).toEqual([
      {
        itemKey: `${assetKeyTwo}:series:0`,
        legendLabel: "Solar",
        unit: "TWh"
      },
      {
        itemKey: `${assetKeyTwo}:series:1`,
        legendLabel: "Wind",
        unit: "TWh"
      }
    ]);
  });

  it("falls back to a post-level bundle when no vision assets exist", () => {
    const input = decodeStage1Input({
      postContext: {
        postUri: "at://did:plc:test/app.bsky.feed.post/sky-314",
        text: "Wholesale power prices fell again",
        links: [],
        linkCards: [],
        threadCoverage: "focus-only"
      },
      vision: null,
      sourceAttribution: {
        kind: "source-attribution",
        provider: {
          providerId: "eia",
          providerLabel: "U.S. Energy Information Administration",
          sourceFamily: "government"
        },
        resolution: "matched",
        providerCandidates: [],
        contentSource: null,
        socialProvenance: null,
        processedAt: 1712900000000
      }
    });

    const bundles = buildResolutionEvidenceBundles(input);

    expect(bundles).toEqual([
      {
        postUri: input.postContext.postUri,
        postText: ["Wholesale power prices fell again"],
        series: [],
        keyFindings: [],
        sourceLines: [],
        publisherHints: [
          {
            label: "U.S. Energy Information Administration",
            confidence: 1
          }
        ]
      }
    ]);
  });
});
