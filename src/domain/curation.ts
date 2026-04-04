import { Schema } from "effect";
import { PostUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";
import { EnrichmentReadiness } from "./enrichment";

const NonNegativeInt = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);

export const CurationStatus = Schema.Literals(["flagged", "curated", "rejected"]);
export type CurationStatus = Schema.Schema.Type<typeof CurationStatus>;

export const CurationAction = Schema.Literals(["curate", "reject"]);
export type CurationAction = Schema.Schema.Type<typeof CurationAction>;

export const CurationSignalScore = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.check(Schema.isLessThanOrEqualTo(100)),
  Schema.brand("CurationSignalScore")
);
export type CurationSignalScore = Schema.Schema.Type<typeof CurationSignalScore>;

export const CurationRecord = Schema.Struct({
  postUri: PostUri,
  status: CurationStatus,
  signalScore: CurationSignalScore,
  predicatesApplied: Schema.Array(Schema.String),
  flaggedAt: Schema.Number,
  curatedAt: Schema.NullOr(Schema.Number),
  curatedBy: Schema.NullOr(Schema.String),
  reviewNote: Schema.NullOr(Schema.String)
});
export type CurationRecord = Schema.Schema.Type<typeof CurationRecord>;

export const CurationPlatform = Schema.Literals(["bluesky", "twitter"]);
export type CurationPlatform = Schema.Schema.Type<typeof CurationPlatform>;

export const CurationPlatformFilter = Schema.Literals(["bluesky", "twitter", "all"]);
export type CurationPlatformFilter = Schema.Schema.Type<typeof CurationPlatformFilter>;

export const CurationCandidateCursor = Schema.Struct({
  signalScore: CurationSignalScore,
  flaggedAt: Schema.Number,
  postUri: PostUri
});
export type CurationCandidateCursor = Schema.Schema.Type<typeof CurationCandidateCursor>;

export const ListCurationCandidatesInput = Schema.Struct({
  status: Schema.optionalKey(CurationStatus.annotate({ description: "Filter by curation status (default: flagged)" })),
  minScore: Schema.optionalKey(Schema.Union([CurationSignalScore, Schema.NumberFromString.pipe(Schema.decodeTo(CurationSignalScore))]).annotate({ description: "Minimum signal score (0-100) to include" })),
  topic: Schema.optionalKey(Schema.String.annotate({ description: "Topic slug to filter by" })),
  platform: Schema.optionalKey(CurationPlatformFilter.annotate({ description: "Filter by platform: bluesky, twitter, or all (default all)" })),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts flagged after this Unix epoch timestamp (milliseconds)" })),
  cursor: Schema.optionalKey(CurationCandidateCursor),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type ListCurationCandidatesInput = Schema.Schema.Type<typeof ListCurationCandidatesInput>;

export const CuratePostInput = Schema.Struct({
  postUri: PostUri.annotate({ description: "Post URI (at:// or x://) of the post to curate" }),
  action: CurationAction.annotate({ description: "Action: 'curate' to approve for enrichment, 'reject' to dismiss" }),
  note: Schema.optionalKey(Schema.String.annotate({ description: "Optional review note explaining the curation decision" }))
});
export type CuratePostInput = Schema.Schema.Type<typeof CuratePostInput>;

export const BulkCurateDecision = CuratePostInput;
export type BulkCurateDecision = Schema.Schema.Type<typeof BulkCurateDecision>;

export const CurationCandidateOutput = Schema.Struct({
  ...KnowledgePostResult.fields,
  signalScore: CurationSignalScore,
  curationStatus: CurationStatus,
  predicatesApplied: Schema.Array(Schema.String),
  flaggedAt: Schema.Number,
  enrichmentReadiness: EnrichmentReadiness.pipe(Schema.withDecodingDefaultKey(() => "none" as const))
});
export type CurationCandidateOutput = typeof CurationCandidateOutput.Type;

export const CurationCandidateExportItem = Schema.Struct({
  uri: KnowledgePostResult.fields.uri,
  handle: KnowledgePostResult.fields.handle,
  text: KnowledgePostResult.fields.text,
  createdAt: KnowledgePostResult.fields.createdAt,
  topics: KnowledgePostResult.fields.topics,
  embedType: KnowledgePostResult.fields.embedType,
  tier: KnowledgePostResult.fields.tier,
  platform: CurationPlatform,
  signalScore: CurationSignalScore
});
export type CurationCandidateExportItem = Schema.Schema.Type<typeof CurationCandidateExportItem>;

export const CurationCandidatePageOutput = Schema.Struct({
  items: Schema.Array(CurationCandidateOutput),
  total: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  nextCursor: Schema.NullOr(CurationCandidateCursor)
});
export type CurationCandidatePageOutput = Schema.Schema.Type<typeof CurationCandidatePageOutput>;

export const CurationCandidateExportPageOutput = Schema.Struct({
  items: Schema.Array(CurationCandidateExportItem),
  total: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  nextCursor: Schema.NullOr(CurationCandidateCursor)
});
export type CurationCandidateExportPageOutput = Schema.Schema.Type<typeof CurationCandidateExportPageOutput>;

export const CurationCandidatePlatformCounts = Schema.Struct({
  bluesky: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  twitter: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});
export type CurationCandidatePlatformCounts = Schema.Schema.Type<typeof CurationCandidatePlatformCounts>;

export const CurationCandidateCountOutput = Schema.Struct({
  total: NonNegativeInt,
  byPlatform: CurationCandidatePlatformCounts
});
export type CurationCandidateCountOutput = Schema.Schema.Type<typeof CurationCandidateCountOutput>;

export const CurationCandidatesMode = Schema.Literals(["full", "export", "count"]);
export type CurationCandidatesMode = Schema.Schema.Type<typeof CurationCandidatesMode>;

export const CurationCandidatesOutput = Schema.Struct({
  mode: CurationCandidatesMode,
  total: NonNegativeInt,
  nextCursor: Schema.NullOr(Schema.String),
  byPlatform: Schema.NullOr(CurationCandidatePlatformCounts),
  items: Schema.Array(CurationCandidateOutput),
  exportItems: Schema.Array(CurationCandidateExportItem)
});
export type CurationCandidatesOutput = Schema.Schema.Type<typeof CurationCandidatesOutput>;

export const CuratePostOutput = Schema.Struct({
  postUri: PostUri,
  action: CurationAction,
  previousStatus: Schema.NullOr(CurationStatus),
  newStatus: CurationStatus
});
export type CuratePostOutput = Schema.Schema.Type<typeof CuratePostOutput>;

export const BulkCurateInput = Schema.Struct({
  decisions: Schema.Array(BulkCurateDecision).annotate({
    description: "Batch of curate or reject decisions. Recommended maximum 1000 items per call."
  })
});
export type BulkCurateInput = Schema.Schema.Type<typeof BulkCurateInput>;

export const BulkCurateError = Schema.Struct({
  postUri: PostUri,
  error: Schema.String
});
export type BulkCurateError = Schema.Schema.Type<typeof BulkCurateError>;

export const BulkCurateOutput = Schema.Struct({
  curated: NonNegativeInt,
  rejected: NonNegativeInt,
  skipped: NonNegativeInt,
  errors: Schema.Array(BulkCurateError)
});
export type BulkCurateOutput = Schema.Schema.Type<typeof BulkCurateOutput>;

export class CurationPostNotFoundError extends Schema.TaggedErrorClass<CurationPostNotFoundError>()(
  "CurationPostNotFoundError",
  {
    postUri: PostUri
  }
) {}
