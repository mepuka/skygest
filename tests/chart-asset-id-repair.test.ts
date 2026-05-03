import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { parseChartAssetId } from "../src/domain/data-layer/post-ids";
import { type PostUri, PostUri as PostUriSchema } from "../src/domain/types";
import {
  repairChartAssetIdsForBlueskyPost,
  repairChartAssetIdsForTwitterPost
} from "../src/enrichment/ChartAssetIdRepair";

const decodePostUri = Schema.decodeUnknownSync(PostUriSchema);

const postUri = decodePostUri(
  "at://did:plc:testdid123/app.bsky.feed.post/post-1"
);
const oldAssetKey =
  "embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:testdid123/bafkreitestblob@jpeg";

describe("repairChartAssetIdsForBlueskyPost", () => {
  it("repairs legacy asset keys inside vision enrichments", () => {
    const result = repairChartAssetIdsForBlueskyPost({
      postUri,
      payload: {
        kind: "vision",
        summary: {
          text: "Solar chart",
          mediaTypes: ["chart"],
          chartTypes: ["line-chart"],
          titles: ["Solar output"],
          keyFindings: [
            {
              text: "Solar output rose",
              assetKeys: [oldAssetKey]
            }
          ]
        },
        assets: [
          {
            assetKey: oldAssetKey,
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "chart",
              chartTypes: ["line-chart"],
              altText: "Solar chart",
              altTextProvenance: "synthetic",
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: ["Solar output rose"],
              visibleUrls: [],
              organizationMentions: [],
              logoText: [],
              title: "Solar output",
              modelId: "gemini-test",
              processedAt: 1
            }
          }
        ],
        modelId: "gemini-test",
        promptVersion: "v2",
        processedAt: 1
      }
    });

    expect(result._tag).toBe("repaired");
    if (result._tag !== "repaired") {
      return;
    }
    expect(result.payload.kind).toBe("vision");
    if (result.payload.kind !== "vision") {
      return;
    }

    expect(result.replacements).toHaveLength(1);
    expect(parseChartAssetId(result.replacements[0]!.chartAssetId)).toEqual({
      platform: "bluesky",
      did: "did:plc:testdid123" as any,
      rkey: "post-1",
      blobCid: "bafkreitestblob"
    });
    expect(result.payload.summary.keyFindings[0]?.assetKeys).toEqual([
      result.replacements[0]!.chartAssetId
    ]);
    expect(result.payload.assets[0]?.assetKey).toBe(
      result.replacements[0]!.chartAssetId
    );
  });

  it("repairs legacy asset keys inside source-attribution evidence", () => {
    const result = repairChartAssetIdsForBlueskyPost({
      postUri,
      payload: {
        kind: "source-attribution",
        provider: {
          providerId: "example-provider",
          providerLabel: "Example Provider",
          sourceFamily: "research"
        },
        resolution: "matched",
        providerCandidates: [
          {
            providerId: "example-provider",
            providerLabel: "Example Provider",
            sourceFamily: "research",
            bestRank: 1,
            evidence: [
              {
                signal: "source-line-alias",
                rank: 1,
                assetKey: oldAssetKey,
                sourceText: "Source: Example Provider",
                matchedAlias: "Example Provider"
              }
            ]
          }
        ],
        contentSource: null,
        socialProvenance: null,
        processedAt: 1
      }
    });

    expect(result._tag).toBe("repaired");
    if (result._tag !== "repaired") {
      return;
    }
    expect(result.payload.kind).toBe("source-attribution");
    if (result.payload.kind !== "source-attribution") {
      return;
    }

    expect(
      result.payload.providerCandidates[0]?.evidence[0]
    ).toEqual(
      expect.objectContaining({
        assetKey: result.replacements[0]!.chartAssetId
      })
    );
  });

  it("fails cleanly when a legacy asset key cannot be parsed into a Bluesky image id", () => {
    const result = repairChartAssetIdsForBlueskyPost({
      postUri,
      payload: {
        kind: "vision",
        summary: {
          text: "Video chart",
          mediaTypes: ["video"],
          chartTypes: [],
          titles: [],
          keyFindings: []
        },
        assets: [
          {
            assetKey: "embed:0:https://example.com/video.m3u8",
            assetType: "video",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "video",
              chartTypes: [],
              altText: null,
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
              modelId: "gemini-test",
              processedAt: 1
            }
          }
        ],
        modelId: "gemini-test",
        promptVersion: "v2",
        processedAt: 1
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        _tag: "failed",
        reason: "unparseable-legacy-asset-key"
      })
    );
  });
});

describe("repairChartAssetIdsForTwitterPost", () => {
  it("repairs legacy Twitter asset keys inside vision enrichments", () => {
    const twitterPostUri = decodePostUri("x://user42/status/1870000000001");
    const twitterAssetKey =
      "embed:0:https://pbs.twimg.com/media/GT2AbCdWgAAefgh?format=jpg&name=large";

    const result = repairChartAssetIdsForTwitterPost({
      postUri: twitterPostUri,
      payload: {
        kind: "vision",
        summary: {
          text: "Solar chart",
          mediaTypes: ["chart"],
          chartTypes: ["line-chart"],
          titles: ["Solar output"],
          keyFindings: [
            {
              text: "Solar output rose",
              assetKeys: [twitterAssetKey]
            }
          ]
        },
        assets: [
          {
            assetKey: twitterAssetKey,
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            extractionRoute: "full",
            analysis: {
              mediaType: "chart",
              chartTypes: ["line-chart"],
              altText: "Solar chart",
              altTextProvenance: "synthetic",
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: ["Solar output rose"],
              visibleUrls: [],
              organizationMentions: [],
              logoText: [],
              title: "Solar output",
              modelId: "gemini-test",
              processedAt: 1
            }
          }
        ],
        modelId: "gemini-test",
        promptVersion: "v2",
        processedAt: 1
      }
    });

    expect(result._tag).toBe("repaired");
    if (result._tag !== "repaired") {
      return;
    }

    expect(parseChartAssetId(result.replacements[0]!.chartAssetId)).toEqual({
      platform: "twitter",
      tweetId: "1870000000001",
      mediaId: "GT2AbCdWgAAefgh"
    });
    expect(result.payload.kind).toBe("vision");
    if (result.payload.kind !== "vision") {
      return;
    }

    expect(result.payload.summary.keyFindings[0]?.assetKeys).toEqual([
      result.replacements[0]!.chartAssetId
    ]);
    expect(result.payload.assets[0]?.assetKey).toBe(
      result.replacements[0]!.chartAssetId
    );
  });

});
