import { describe, expect, it } from "vitest";
import {
  hasAssets,
  hasFindings,
  hasAnalysisSignal,
  isUsable,
  assessVisionQuality
} from "../src/enrichment/EnrichmentQualityGate";
import type { VisionEnrichment, VisionAssetEnrichment } from "../src/domain/enrichment";

const makeAsset = (
  overrides: Partial<VisionAssetEnrichment["analysis"]> = {}
): VisionAssetEnrichment => ({
  assetKey: "a1" as any,
  assetType: "image",
  source: "embed",
  index: 0,
  originalAltText: null,
  extractionRoute: "full",
  analysis: {
    mediaType: "chart",
    chartTypes: ["line-chart"],
    altText: "A line chart",
    altTextProvenance: "synthetic",
    xAxis: null,
    yAxis: null,
    series: [],
    sourceLines: [],
    temporalCoverage: null,
    keyFindings: ["Production increased"],
    visibleUrls: [],
    organizationMentions: [],
    logoText: [],
    title: "Energy Production",
    modelId: "gemini-2.5-flash",
    processedAt: 1,
    ...overrides
  }
});

const makeEnrichment = (
  overrides: Partial<{
    assets: VisionEnrichment["assets"];
    summary: Partial<VisionEnrichment["summary"]>;
  }> = {}
): VisionEnrichment => ({
  kind: "vision",
  summary: {
    text: "Analyzed 2 visual assets",
    mediaTypes: ["chart"],
    chartTypes: ["line-chart"],
    titles: ["Energy Production"],
    keyFindings: [{ text: "Production rose 10%", assetKeys: ["a1" as any] }],
    ...(overrides.summary ?? {})
  },
  assets: overrides.assets ?? [makeAsset()],
  modelId: "gemini-2.5-flash",
  promptVersion: "v2",
  processedAt: 1
});

describe("EnrichmentQualityGate", () => {
  describe("hasAssets", () => {
    it("passes when assets present", () => {
      expect(hasAssets(makeEnrichment())).toBe(true);
    });
    it("fails when assets empty", () => {
      expect(hasAssets(makeEnrichment({ assets: [] }))).toBe(false);
    });
  });

  describe("hasFindings", () => {
    it("passes when asset has findings", () => {
      expect(hasFindings(makeEnrichment())).toBe(true);
    });
    it("passes when only summary has findings", () => {
      const e = makeEnrichment({ assets: [makeAsset({ keyFindings: [] })] });
      expect(hasFindings(e)).toBe(true);
    });
    it("fails when no findings anywhere", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ keyFindings: [] })],
        summary: { keyFindings: [] }
      });
      expect(hasFindings(e)).toBe(false);
    });
  });

  describe("hasAnalysisSignal", () => {
    it("passes with chart types", () => {
      expect(hasAnalysisSignal(makeEnrichment())).toBe(true);
    });
    it("passes with visible URLs but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], visibleUrls: ["https://eia.gov/report"] })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });
    it("passes with org mentions but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          organizationMentions: [{ name: "EIA", location: "title" }]
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });
    it("passes with source lines but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          sourceLines: [{ sourceText: "Source: AESO", datasetName: null }]
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });
    it("passes with logo text but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], logoText: ["Bloomberg NEF"] })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });
    it("passes with title but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], title: "Screenshot of AESO report" })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });
    it("fails when no analysis signal at all", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [], visibleUrls: [], organizationMentions: [],
          sourceLines: [], logoText: [], title: null
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(false);
    });
  });

  describe("isUsable", () => {
    it("passes when all predicates pass", () => {
      expect(isUsable(makeEnrichment())).toBe(true);
    });
    it("fails when any predicate fails", () => {
      expect(isUsable(makeEnrichment({ assets: [] }))).toBe(false);
    });
  });

  describe("assessVisionQuality", () => {
    it("returns usable for good chart enrichment", () => {
      expect(assessVisionQuality(makeEnrichment())).toEqual({ outcome: "usable" });
    });
    it("returns usable for screenshot with source clues", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          mediaType: "photo",
          chartTypes: [],
          visibleUrls: ["https://eia.gov"],
          organizationMentions: [{ name: "EIA", location: "body" }]
        })]
      });
      expect(assessVisionQuality(e)).toEqual({ outcome: "usable" });
    });
    it("returns needs-review for empty assets", () => {
      const result = assessVisionQuality(makeEnrichment({ assets: [] }));
      expect(result).toEqual({
        outcome: "needs-review",
        reason: "vision produced zero asset analyses"
      });
    });
    it("returns usable when no findings but has analysis signal", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ keyFindings: [] })],
        summary: { keyFindings: [] }
      });
      // hasFindings is NOT part of the gate — analysis signal (chart types,
      // URLs, org mentions, etc.) is sufficient for source attribution
      expect(assessVisionQuality(e)).toEqual({ outcome: "usable" });
    });
    it("returns needs-review for no analysis signal", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [], visibleUrls: [], organizationMentions: [],
          sourceLines: [], logoText: [], title: null
        })]
      });
      expect(assessVisionQuality(e).outcome).toBe("needs-review");
    });
  });
});
