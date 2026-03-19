/**
 * Typed enrichment output schemas for the post_enrichments table.
 *
 * Each enrichment kind produces a discriminated variant keyed on `kind`.
 * The `kind` field maps 1:1 to `enrichment_type` in the D1 table.
 *
 * Enrichment types use media.ts types for chart/vision domain concepts.
 */

import { Schema } from "effect";
import { AtUri } from "./types";
import {
  MediaType,
  ChartType,
  AltTextProvenance,
  ChartAxis,
  ChartSeries,
  ChartSourceLine,
  TemporalCoverage
} from "./media";
import {
  ContentSourceReference,
  ProviderReference,
  SocialProvenance
} from "./source";
import {
  SourceAttributionProviderCandidate,
  SourceAttributionResolution,
  VisionOrganizationMention,
  VisionSourceLineAttribution
} from "./sourceMatching";

// ---------------------------------------------------------------------------
// Enrichment kind discriminator
// ---------------------------------------------------------------------------

export const EnrichmentKind = Schema.Literal(
  "vision",
  "source-attribution",
  "grounding"
);
export type EnrichmentKind = Schema.Schema.Type<typeof EnrichmentKind>;

export const defaultSchemaVersionForEnrichmentKind = (
  kind: EnrichmentKind
) => {
  switch (kind) {
    case "vision":
    case "source-attribution":
      return "v2";
    case "grounding":
      return "v1";
  }
};

const VisionAssetType = Schema.Literal("image", "video");
const VisionAssetSource = Schema.Literal("embed", "media");

// ---------------------------------------------------------------------------
// Vision enrichment (SKY-16: chart analysis + alt text)
// ---------------------------------------------------------------------------

const VisionAssetAnalysisV2 = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  altTextProvenance: AltTextProvenance,
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(VisionSourceLineAttribution),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String),
  visibleUrls: Schema.Array(Schema.String),
  organizationMentions: Schema.Array(VisionOrganizationMention),
  logoText: Schema.Array(Schema.String),
  title: Schema.NullOr(Schema.String),
  modelId: Schema.String,
  processedAt: Schema.Number
});
const LegacyVisionAssetAnalysis = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(ChartType),
  altText: Schema.NullOr(Schema.String),
  altTextProvenance: AltTextProvenance,
  xAxis: Schema.NullOr(ChartAxis),
  yAxis: Schema.NullOr(ChartAxis),
  series: Schema.Array(ChartSeries),
  sourceLines: Schema.Array(ChartSourceLine),
  temporalCoverage: Schema.NullOr(TemporalCoverage),
  keyFindings: Schema.Array(Schema.String),
  title: Schema.NullOr(Schema.String),
  modelId: Schema.String,
  processedAt: Schema.Number
});
const LegacyVisionAssetAnalysisNormalized = Schema.transform(
  LegacyVisionAssetAnalysis,
  VisionAssetAnalysisV2,
  {
    strict: true,
    decode: (legacy) =>
      ({
        ...legacy,
        sourceLines: legacy.sourceLines.map((sourceLine) => ({
          sourceText: sourceLine.sourceText,
          datasetName: null
        })),
        visibleUrls: [],
        organizationMentions: [],
        logoText: []
      }),
    encode: (value) =>
      ({
        mediaType: value.mediaType,
        chartTypes: value.chartTypes,
        altText: value.altText,
        altTextProvenance: value.altTextProvenance,
        xAxis: value.xAxis,
        yAxis: value.yAxis,
        series: value.series,
        sourceLines: value.sourceLines.map((sourceLine) => ({
          sourceText: sourceLine.sourceText
        })),
        temporalCoverage: value.temporalCoverage,
        keyFindings: value.keyFindings,
        title: value.title,
        modelId: value.modelId,
        processedAt: value.processedAt
      })
  }
);
export const VisionAssetAnalysis = Schema.Union(
  VisionAssetAnalysisV2,
  LegacyVisionAssetAnalysisNormalized
);
export type VisionAssetAnalysis = Schema.Schema.Type<typeof VisionAssetAnalysis>;

export const VisionSynthesisFinding = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1)),
  assetKeys: Schema.Array(Schema.String.pipe(Schema.minLength(1)))
});
export type VisionSynthesisFinding = Schema.Schema.Type<
  typeof VisionSynthesisFinding
>;

export const VisionPostSummary = Schema.Struct({
  text: Schema.String.pipe(Schema.minLength(1)),
  mediaTypes: Schema.Array(MediaType),
  chartTypes: Schema.Array(ChartType),
  titles: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  keyFindings: Schema.Array(VisionSynthesisFinding)
});
export type VisionPostSummary = Schema.Schema.Type<typeof VisionPostSummary>;

export const VisionAssetEnrichment = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.minLength(1)),
  assetType: VisionAssetType,
  source: VisionAssetSource,
  index: Schema.NonNegativeInt,
  originalAltText: Schema.NullOr(Schema.String),
  analysis: VisionAssetAnalysis
});
export type VisionAssetEnrichment = Schema.Schema.Type<
  typeof VisionAssetEnrichment
>;

export const VisionEnrichment = Schema.Struct({
  kind: Schema.Literal("vision"),
  summary: VisionPostSummary,
  assets: Schema.Array(VisionAssetEnrichment),
  modelId: Schema.String,
  promptVersion: Schema.String.pipe(Schema.minLength(1)),
  processedAt: Schema.Number
});
export type VisionEnrichment = Schema.Schema.Type<typeof VisionEnrichment>;

// ---------------------------------------------------------------------------
// Source attribution enrichment (SKY-17: provider/content normalization)
// ---------------------------------------------------------------------------

const SourceAttributionEnrichmentV2 = Schema.Struct({
  kind: Schema.Literal("source-attribution"),
  provider: Schema.NullOr(ProviderReference),
  resolution: SourceAttributionResolution,
  providerCandidates: Schema.Array(SourceAttributionProviderCandidate),
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance),
  processedAt: Schema.Number
});
const LegacySourceAttributionEnrichment = Schema.Struct({
  kind: Schema.Literal("source-attribution"),
  provider: Schema.NullOr(ProviderReference),
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance),
  processedAt: Schema.Number
});
const LegacySourceAttributionEnrichmentNormalized = Schema.transform(
  LegacySourceAttributionEnrichment,
  SourceAttributionEnrichmentV2,
  {
    strict: true,
    decode: (
      legacy
    ): Schema.Schema.Type<typeof SourceAttributionEnrichmentV2> => {
      const resolution = legacy.provider === null
        ? "unmatched"
        : "matched";

      return {
        ...legacy,
        resolution,
        providerCandidates: []
      };
    },
    encode: (
      value
    ): Schema.Schema.Type<typeof LegacySourceAttributionEnrichment> => ({
        kind: value.kind,
        provider:
          value.provider as Schema.Schema.Type<
            typeof LegacySourceAttributionEnrichment
          >["provider"],
        contentSource: value.contentSource,
        socialProvenance:
          value.socialProvenance as Schema.Schema.Type<
            typeof LegacySourceAttributionEnrichment
          >["socialProvenance"],
        processedAt: value.processedAt
      })
  }
);
export const SourceAttributionEnrichment = Schema.Union(
  SourceAttributionEnrichmentV2,
  LegacySourceAttributionEnrichmentNormalized
);
export type SourceAttributionEnrichment = Schema.Schema.Type<
  typeof SourceAttributionEnrichment
>;

// ---------------------------------------------------------------------------
// Grounding enrichment (future: claim verification)
// ---------------------------------------------------------------------------

export const SupportingEvidence = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  relevance: Schema.Number
});

export const GroundingEnrichment = Schema.Struct({
  kind: Schema.Literal("grounding"),
  claimText: Schema.String,
  supportingEvidence: Schema.Array(SupportingEvidence),
  processedAt: Schema.Number
});
export type GroundingEnrichment = Schema.Schema.Type<typeof GroundingEnrichment>;

// ---------------------------------------------------------------------------
// EnrichmentOutput union
// ---------------------------------------------------------------------------

export const EnrichmentOutput = Schema.Union(
  VisionEnrichment,
  SourceAttributionEnrichment,
  GroundingEnrichment
);
export type EnrichmentOutput = Schema.Schema.Type<typeof EnrichmentOutput>;

export const VisionPostEnrichmentResult = Schema.Struct({
  kind: Schema.Literal("vision"),
  payload: VisionEnrichment,
  enrichedAt: Schema.Number
});
export type VisionPostEnrichmentResult = Schema.Schema.Type<
  typeof VisionPostEnrichmentResult
>;

export const SourceAttributionPostEnrichmentResult = Schema.Struct({
  kind: Schema.Literal("source-attribution"),
  payload: SourceAttributionEnrichment,
  enrichedAt: Schema.Number
});
export type SourceAttributionPostEnrichmentResult = Schema.Schema.Type<
  typeof SourceAttributionPostEnrichmentResult
>;

export const GroundingPostEnrichmentResult = Schema.Struct({
  kind: Schema.Literal("grounding"),
  payload: GroundingEnrichment,
  enrichedAt: Schema.Number
});
export type GroundingPostEnrichmentResult = Schema.Schema.Type<
  typeof GroundingPostEnrichmentResult
>;

export const PostEnrichmentResult = Schema.Union(
  VisionPostEnrichmentResult,
  SourceAttributionPostEnrichmentResult,
  GroundingPostEnrichmentResult
);
export type PostEnrichmentResult = Schema.Schema.Type<
  typeof PostEnrichmentResult
>;

export const PostEnrichmentsOutput = Schema.Struct({
  postUri: AtUri,
  enrichments: Schema.Array(PostEnrichmentResult)
});
export type PostEnrichmentsOutput = Schema.Schema.Type<
  typeof PostEnrichmentsOutput
>;
