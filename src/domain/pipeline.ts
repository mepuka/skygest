import { Schema } from "effect";
import { FlexibleNumber } from "./bi";
import { NonNegativeInt, PlatformCounts } from "./types";

export const PipelineStatusDetail = Schema.Literals(["summary", "full"]);
export type PipelineStatusDetail = Schema.Schema.Type<typeof PipelineStatusDetail>;

export const GetPipelineStatusInput = Schema.Struct({
  detail: Schema.optionalKey(PipelineStatusDetail.annotate({
    description: "Display level for MCP formatting. 'summary' is compact; 'full' includes the latest sweep details."
  }).pipe(
    Schema.withDecodingDefaultKey(() => "summary" as const)
  )),
  since: Schema.optionalKey(FlexibleNumber.annotate({
    description: "Optional freshness filter for lastSweep only. When provided, the latest finished head sweep is included only if its completedAt timestamp is on or after this Unix epoch timestamp (milliseconds)."
  }))
});
export type GetPipelineStatusInput = Schema.Schema.Type<typeof GetPipelineStatusInput>;

export const PipelinePlatformCounts = PlatformCounts;
export type PipelinePlatformCounts = Schema.Schema.Type<typeof PipelinePlatformCounts>;

export const PipelineExpertTierCounts = Schema.Struct({
  energyFocused: NonNegativeInt,
  generalOutlet: NonNegativeInt,
  independent: NonNegativeInt
});
export type PipelineExpertTierCounts = Schema.Schema.Type<typeof PipelineExpertTierCounts>;

export const PipelineExpertCounts = Schema.Struct({
  total: NonNegativeInt,
  ...PipelinePlatformCounts.fields,
  byTier: PipelineExpertTierCounts
});
export type PipelineExpertCounts = Schema.Schema.Type<typeof PipelineExpertCounts>;

export const PipelinePostCounts = Schema.Struct({
  total: NonNegativeInt,
  ...PipelinePlatformCounts.fields
});
export type PipelinePostCounts = Schema.Schema.Type<typeof PipelinePostCounts>;

export const PipelineCurationCounts = Schema.Struct({
  curated: NonNegativeInt,
  rejected: NonNegativeInt,
  flagged: NonNegativeInt,
  uncurated: NonNegativeInt
});
export type PipelineCurationCounts = Schema.Schema.Type<typeof PipelineCurationCounts>;

export const PipelineStoredEnrichmentCounts = Schema.Struct({
  total: NonNegativeInt,
  vision: NonNegativeInt,
  sourceAttribution: NonNegativeInt,
  grounding: NonNegativeInt,
  dataRefResolution: NonNegativeInt
});
export type PipelineStoredEnrichmentCounts = Schema.Schema.Type<typeof PipelineStoredEnrichmentCounts>;

export const PipelineEnrichmentRunCounts = Schema.Struct({
  complete: NonNegativeInt,
  queued: NonNegativeInt,
  running: NonNegativeInt,
  failed: NonNegativeInt,
  needsReview: NonNegativeInt
});
export type PipelineEnrichmentRunCounts = Schema.Schema.Type<typeof PipelineEnrichmentRunCounts>;

export const PipelineEnrichmentCounts = Schema.Struct({
  stored: PipelineStoredEnrichmentCounts,
  runs: PipelineEnrichmentRunCounts
});
export type PipelineEnrichmentCounts = Schema.Schema.Type<typeof PipelineEnrichmentCounts>;

export const PipelineLastSweep = Schema.Struct({
  runId: Schema.String,
  completedAt: Schema.Number,
  postsStored: NonNegativeInt,
  expertsFailed: NonNegativeInt,
  status: Schema.Literals(["complete", "failed"])
});
export type PipelineLastSweep = Schema.Schema.Type<typeof PipelineLastSweep>;

export const PipelineStatusOutput = Schema.Struct({
  asOf: NonNegativeInt,
  experts: PipelineExpertCounts,
  posts: PipelinePostCounts,
  curation: PipelineCurationCounts,
  enrichments: PipelineEnrichmentCounts,
  lastSweep: Schema.NullOr(PipelineLastSweep)
});
export type PipelineStatusOutput = Schema.Schema.Type<typeof PipelineStatusOutput>;
