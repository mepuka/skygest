/**
 * Typed enrichment output schemas for the post_enrichments table.
 *
 * Each enrichment kind produces a discriminated variant keyed on `kind`.
 * The `kind` field maps 1:1 to `enrichment_type` in the D1 table.
 *
 * Enrichment types use media.ts types for chart/vision domain concepts.
 */

import { Schema, SchemaGetter } from "effect";
import { FlexibleNumber } from "./bi";
import { NonNegativeInt, PlatformSchema, PostUri } from "./types";
import { EnrichmentErrorEnvelope } from "./errors";
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
import { Stage1Result } from "./stage1Resolution";

const DeferredStage1Result = Schema.suspend(() => Stage1Result);

// ---------------------------------------------------------------------------
// Enrichment kind discriminator
// ---------------------------------------------------------------------------

export const WorkflowEnrichmentKind = Schema.Literals([
  "vision",
  "source-attribution",
  "grounding"
]);
export type WorkflowEnrichmentKind = Schema.Schema.Type<
  typeof WorkflowEnrichmentKind
>;

export const EnrichmentKind = Schema.Literals([
  ...WorkflowEnrichmentKind.literals,
  "data-ref-resolution"
]);
export type EnrichmentKind = Schema.Schema.Type<typeof EnrichmentKind>;

export const defaultSchemaVersionForEnrichmentKind = (
  kind: EnrichmentKind
) => {
  switch (kind) {
    case "vision":
    case "source-attribution":
      return "v2";
    case "grounding":
    case "data-ref-resolution":
      return "v1";
  }
};

const VisionAssetType = Schema.Literals(["image", "video"]);
const VisionAssetSource = Schema.Literals(["embed", "media"]);

export const ExtractionRoute = Schema.Literals(["full", "lightweight"]);
export type ExtractionRoute = Schema.Schema.Type<typeof ExtractionRoute>;

// ---------------------------------------------------------------------------
// Vision enrichment (SKY-16: chart analysis + alt text)
// ---------------------------------------------------------------------------

const VisionAssetAnalysisV2 = Schema.Struct({
  mediaType: MediaType,
  chartTypes: Schema.Array(Schema.String),
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
  chartTypes: Schema.Array(Schema.String),
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
const LegacyVisionAssetAnalysisNormalized = LegacyVisionAssetAnalysis.pipe(
  Schema.decodeTo(VisionAssetAnalysisV2, {
    decode: SchemaGetter.transform((legacy: Schema.Schema.Type<typeof LegacyVisionAssetAnalysis>) =>
      ({
        ...legacy,
        sourceLines: legacy.sourceLines.map((sourceLine) => ({
          sourceText: sourceLine.sourceText,
          datasetName: null
        })),
        visibleUrls: [],
        organizationMentions: [],
        logoText: []
      })),
    encode: SchemaGetter.transform((value: Schema.Schema.Type<typeof VisionAssetAnalysisV2>) =>
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
      }))
  })
);
export const VisionAssetAnalysis = Schema.Union([
  VisionAssetAnalysisV2,
  LegacyVisionAssetAnalysisNormalized
]);
export type VisionAssetAnalysis = Schema.Schema.Type<typeof VisionAssetAnalysis>;

export const VisionSynthesisFinding = Schema.Struct({
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  assetKeys: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1))))
});
export type VisionSynthesisFinding = Schema.Schema.Type<
  typeof VisionSynthesisFinding
>;

export const VisionPostSummary = Schema.Struct({
  text: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  mediaTypes: Schema.Array(MediaType),
  chartTypes: Schema.Array(ChartType),
  titles: Schema.Array(Schema.String.pipe(Schema.check(Schema.isMinLength(1)))),
  keyFindings: Schema.Array(VisionSynthesisFinding)
});
export type VisionPostSummary = Schema.Schema.Type<typeof VisionPostSummary>;

export const VisionAssetEnrichment = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  assetType: VisionAssetType,
  source: VisionAssetSource,
  index: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  originalAltText: Schema.NullOr(Schema.String),
  extractionRoute: ExtractionRoute.pipe(
    Schema.withDecodingDefaultKey(() => "full" as const)
  ),
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
  promptVersion: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
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
const LegacySourceAttributionEnrichmentNormalized = LegacySourceAttributionEnrichment.pipe(
  Schema.decodeTo(SourceAttributionEnrichmentV2, {
    decode: SchemaGetter.transform((
      legacy: Schema.Schema.Type<typeof LegacySourceAttributionEnrichment>
    ): Schema.Schema.Type<typeof SourceAttributionEnrichmentV2> => {
      const resolution = legacy.provider === null
        ? "unmatched" as const
        : "matched" as const;

      return {
        ...legacy,
        resolution,
        providerCandidates: []
      };
    }),
    encode: SchemaGetter.transform((
      value: Schema.Schema.Type<typeof SourceAttributionEnrichmentV2>
    ) => ({
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
      })) as any
  })
);
export const SourceAttributionEnrichment = Schema.Union([
  SourceAttributionEnrichmentV2,
  LegacySourceAttributionEnrichmentNormalized
]);
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
// Data-ref resolution enrichment (SKY-238: persisted Stage 1 resolver result)
// ---------------------------------------------------------------------------

export const DataRefResolutionStage3 = Schema.Struct({
  status: Schema.Literal("queued"),
  jobId: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
});
export type DataRefResolutionStage3 = Schema.Schema.Type<
  typeof DataRefResolutionStage3
>;

export const DataRefResolutionEnrichment = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  stage1: DeferredStage1Result,
  stage2: Schema.optionalKey(Schema.Unknown),
  stage3: Schema.optionalKey(DataRefResolutionStage3),
  resolverVersion: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  processedAt: Schema.Number
});
export type DataRefResolutionEnrichment = Schema.Schema.Type<
  typeof DataRefResolutionEnrichment
>;

// ---------------------------------------------------------------------------
// EnrichmentOutput union
// ---------------------------------------------------------------------------

export const EnrichmentOutput = Schema.Union([
  VisionEnrichment,
  SourceAttributionEnrichment,
  GroundingEnrichment,
  DataRefResolutionEnrichment
]);
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

export const DataRefResolutionPostEnrichmentResult = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  payload: DataRefResolutionEnrichment,
  enrichedAt: Schema.Number
});
export type DataRefResolutionPostEnrichmentResult = Schema.Schema.Type<
  typeof DataRefResolutionPostEnrichmentResult
>;

export const PostEnrichmentResult = Schema.Union([
  VisionPostEnrichmentResult,
  SourceAttributionPostEnrichmentResult,
  GroundingPostEnrichmentResult,
  DataRefResolutionPostEnrichmentResult
]);
export type PostEnrichmentResult = Schema.Schema.Type<
  typeof PostEnrichmentResult
>;

export const PostEnrichmentsOutput = Schema.Struct({
  postUri: PostUri,
  enrichments: Schema.Array(PostEnrichmentResult)
});
export type PostEnrichmentsOutput = Schema.Schema.Type<
  typeof PostEnrichmentsOutput
>;

// ---------------------------------------------------------------------------
// Enrichment readiness (SKY-77: shared read model)
// ---------------------------------------------------------------------------

export const EnrichmentReadiness = Schema.Literals([
  "none",
  "pending",
  "complete",
  "failed",
  "needs-review"
]);
export type EnrichmentReadiness = Schema.Schema.Type<typeof EnrichmentReadiness>;

export const GetPostEnrichmentsInput = Schema.Struct({
  postUri: PostUri.annotate({ description: "Post URI (at:// or x://) of the post to inspect" })
});
export type GetPostEnrichmentsInput = Schema.Schema.Type<typeof GetPostEnrichmentsInput>;

/**
 * Run summary status/phase literals mirror enrichmentRun.ts values.
 * Declared inline to avoid a circular import (enrichmentRun -> enrichment).
 */
export const PostEnrichmentRunSummary = Schema.Struct({
  enrichmentType: WorkflowEnrichmentKind,
  status: Schema.Literals(["queued", "running", "complete", "failed", "needs-review"]),
  phase: Schema.Literals([
    "queued", "assembling", "planning", "executing",
    "validating", "persisting", "complete", "failed", "needs-review"
  ]),
  lastProgressAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number)
});
export type PostEnrichmentRunSummary = Schema.Schema.Type<typeof PostEnrichmentRunSummary>;

export const GetPostEnrichmentsOutput = Schema.Struct({
  postUri: PostUri,
  readiness: EnrichmentReadiness,
  enrichments: Schema.Array(PostEnrichmentResult),
  latestRuns: Schema.Array(PostEnrichmentRunSummary)
});
export type GetPostEnrichmentsOutput = Schema.Schema.Type<typeof GetPostEnrichmentsOutput>;

export const GapEnrichmentType = Schema.Literals(["vision", "source-attribution"]);
export type GapEnrichmentType = Schema.Schema.Type<typeof GapEnrichmentType>;

export const EnrichmentGapPlatform = PlatformSchema;
export type EnrichmentGapPlatform = Schema.Schema.Type<typeof EnrichmentGapPlatform>;

export const ListEnrichmentGapsInput = Schema.Struct({
  platform: Schema.optionalKey(EnrichmentGapPlatform.annotate({
    description: "Filter by platform."
  })),
  enrichmentType: Schema.optionalKey(GapEnrichmentType.annotate({
    description: "Filter to only one enrichment type."
  })),
  since: Schema.optionalKey(FlexibleNumber.annotate({
    description: "Only include posts curated after this Unix epoch timestamp (milliseconds)."
  })),
  limit: Schema.optionalKey(Schema.Union([
    NonNegativeInt,
    Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt))
  ]).annotate({
    description: "Maximum number of post URIs to return per enrichment type bucket."
  }))
});
export type ListEnrichmentGapsInput = Schema.Schema.Type<typeof ListEnrichmentGapsInput>;

export const EnrichmentGapBucket = Schema.Struct({
  count: NonNegativeInt,
  postUris: Schema.Array(PostUri)
});
export type EnrichmentGapBucket = Schema.Schema.Type<typeof EnrichmentGapBucket>;

export const ListEnrichmentGapsOutput = Schema.Struct({
  vision: EnrichmentGapBucket,
  sourceAttribution: EnrichmentGapBucket
});
export type ListEnrichmentGapsOutput = Schema.Schema.Type<typeof ListEnrichmentGapsOutput>;

export const ListEnrichmentIssuesInput = Schema.Struct({
  status: Schema.optionalKey(Schema.Literals(["failed", "needs-review"]).annotate({
    description: "Filter by run status."
  })),
  limit: Schema.optionalKey(Schema.Union([
    NonNegativeInt,
    Schema.NumberFromString.pipe(Schema.decodeTo(NonNegativeInt))
  ]).annotate({
    description: "Maximum number of issue rows to return."
  }))
});
export type ListEnrichmentIssuesInput = Schema.Schema.Type<typeof ListEnrichmentIssuesInput>;

export const EnrichmentIssueItem = Schema.Struct({
  runId: Schema.String,
  postUri: PostUri,
  enrichmentType: WorkflowEnrichmentKind,
  status: Schema.Literals(["failed", "needs-review"]),
  error: Schema.NullOr(EnrichmentErrorEnvelope),
  lastProgressAt: Schema.NullOr(Schema.Number)
});
export type EnrichmentIssueItem = Schema.Schema.Type<typeof EnrichmentIssueItem>;

export const ListEnrichmentIssuesOutput = Schema.Struct({
  items: Schema.Array(EnrichmentIssueItem)
});
export type ListEnrichmentIssuesOutput = Schema.Schema.Type<typeof ListEnrichmentIssuesOutput>;

export const BulkStartEnrichmentPost = Schema.Struct({
  postUri: PostUri,
  enrichmentType: Schema.optionalKey(GapEnrichmentType.annotate({
    description: "If omitted, auto-detect from the stored embed."
  }))
});
export type BulkStartEnrichmentPost = Schema.Schema.Type<typeof BulkStartEnrichmentPost>;

export const BulkStartEnrichmentInput = Schema.Struct({
  posts: Schema.optionalKey(Schema.Array(BulkStartEnrichmentPost).annotate({
    description: "Explicit posts to queue for enrichment. Recommended maximum 500 items."
  })),
  gaps: Schema.optionalKey(ListEnrichmentGapsOutput.annotate({
    description: "Optional direct output from list_enrichment_gaps."
  }))
});
export type BulkStartEnrichmentInput = Schema.Schema.Type<typeof BulkStartEnrichmentInput>;

export const BULK_START_ENRICHMENT_MAX_POSTS = 500;

export const BulkStartEnrichmentError = Schema.Struct({
  postUri: PostUri,
  error: Schema.String
});
export type BulkStartEnrichmentError = Schema.Schema.Type<typeof BulkStartEnrichmentError>;

export const BulkStartEnrichmentOutput = Schema.Struct({
  queued: NonNegativeInt,
  skipped: NonNegativeInt,
  failed: NonNegativeInt,
  errors: Schema.Array(BulkStartEnrichmentError)
});
export type BulkStartEnrichmentOutput = Schema.Schema.Type<typeof BulkStartEnrichmentOutput>;
