import { Schema } from "effect";
import { PostUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";
import { EnrichmentReadiness } from "./enrichment";

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

export const ListCurationCandidatesInput = Schema.Struct({
  status: Schema.optionalKey(CurationStatus.annotate({ description: "Filter by curation status (default: flagged)" })),
  minScore: Schema.optionalKey(Schema.Union([CurationSignalScore, Schema.NumberFromString.pipe(Schema.decodeTo(CurationSignalScore))]).annotate({ description: "Minimum signal score (0-100) to include" })),
  topic: Schema.optionalKey(Schema.String.annotate({ description: "Topic slug to filter by" })),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter posts flagged after this Unix epoch timestamp (milliseconds)" })),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type ListCurationCandidatesInput = Schema.Schema.Type<typeof ListCurationCandidatesInput>;

export const CuratePostInput = Schema.Struct({
  postUri: PostUri.annotate({ description: "Post URI (at:// or x://) of the post to curate" }),
  action: CurationAction.annotate({ description: "Action: 'curate' to approve for enrichment, 'reject' to dismiss" }),
  note: Schema.optionalKey(Schema.String.annotate({ description: "Optional review note explaining the curation decision" }))
});
export type CuratePostInput = Schema.Schema.Type<typeof CuratePostInput>;

export const CurationCandidateOutput = Schema.Struct({
  ...KnowledgePostResult.fields,
  signalScore: CurationSignalScore,
  curationStatus: CurationStatus,
  predicatesApplied: Schema.Array(Schema.String),
  flaggedAt: Schema.Number,
  enrichmentReadiness: EnrichmentReadiness.pipe(Schema.withDecodingDefaultKey(() => "none" as const))
});
export type CurationCandidateOutput = typeof CurationCandidateOutput.Type;

export const CurationCandidatesOutput = Schema.Struct({
  items: Schema.Array(CurationCandidateOutput)
});
export type CurationCandidatesOutput = Schema.Schema.Type<typeof CurationCandidatesOutput>;

export const CuratePostOutput = Schema.Struct({
  postUri: PostUri,
  action: CurationAction,
  previousStatus: Schema.NullOr(CurationStatus),
  newStatus: CurationStatus
});
export type CuratePostOutput = Schema.Schema.Type<typeof CuratePostOutput>;

export class CurationPostNotFoundError extends Schema.TaggedErrorClass<CurationPostNotFoundError>()(
  "CurationPostNotFoundError",
  {
    postUri: PostUri
  }
) {}
