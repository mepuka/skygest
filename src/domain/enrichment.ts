/**
 * Typed enrichment output schemas for the post_enrichments table.
 *
 * Each enrichment kind produces a discriminated variant keyed on `kind`.
 * The `kind` field maps 1:1 to `enrichment_type` in the D1 table.
 *
 * Enrichment types use media.ts types for chart/vision domain concepts.
 */

import { Schema } from "effect";
import { Did } from "./types";
import {
  MediaType,
  ChartType,
  AltTextProvenance,
  ChartAxis,
  ChartSeries,
  ChartSourceLine,
  TemporalCoverage
} from "./media";

// ---------------------------------------------------------------------------
// Enrichment kind discriminator
// ---------------------------------------------------------------------------

export const EnrichmentKind = Schema.Literal(
  "vision",
  "source-attribution",
  "grounding"
);
export type EnrichmentKind = Schema.Schema.Type<typeof EnrichmentKind>;

const VisionAssetType = Schema.Literal("image", "video");
const VisionAssetSource = Schema.Literal("embed", "media");

// ---------------------------------------------------------------------------
// Vision enrichment (SKY-16: chart analysis + alt text)
// ---------------------------------------------------------------------------

export const VisionAssetAnalysis = Schema.Struct({
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
// Source attribution enrichment (SKY-17: data source registry)
// ---------------------------------------------------------------------------

export const ImageSource = Schema.Struct({
  did: Did,
  handle: Schema.NullOr(Schema.String)
});

export const ContentSource = Schema.Struct({
  url: Schema.String,
  title: Schema.NullOr(Schema.String),
  publication: Schema.NullOr(Schema.String)
});

export const DataSource = Schema.Struct({
  providerId: Schema.NullOr(Schema.String),
  providerLabel: Schema.NullOr(Schema.String),
  datasetLabel: Schema.NullOr(Schema.String)
});

export const SourceAttributionEnrichment = Schema.Struct({
  kind: Schema.Literal("source-attribution"),
  imageSource: Schema.NullOr(ImageSource),
  contentSource: Schema.NullOr(ContentSource),
  dataSource: Schema.NullOr(DataSource),
  processedAt: Schema.Number
});
export type SourceAttributionEnrichment = Schema.Schema.Type<typeof SourceAttributionEnrichment>;

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
