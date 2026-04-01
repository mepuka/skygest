import { Schema } from "effect";
import { AtUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";
import { EnrichmentReadiness } from "./enrichment";

export const CurationStatus = Schema.Literal("flagged", "curated", "rejected");
export type CurationStatus = Schema.Schema.Type<typeof CurationStatus>;

export const CurationAction = Schema.Literal("curate", "reject");
export type CurationAction = Schema.Schema.Type<typeof CurationAction>;

export const CurationSignalScore = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(100),
  Schema.brand("CurationSignalScore")
);
export type CurationSignalScore = Schema.Schema.Type<typeof CurationSignalScore>;

export const CurationRecord = Schema.Struct({
  postUri: AtUri,
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
  status: Schema.optional(CurationStatus.annotations({ description: "Filter by curation status (default: flagged)" })),
  minScore: Schema.optional(Schema.Union(CurationSignalScore, Schema.compose(Schema.NumberFromString, CurationSignalScore)).annotations({ description: "Minimum signal score (0-100) to include" })),
  topic: Schema.optional(Schema.String.annotations({ description: "Topic slug to filter by" })),
  since: Schema.optional(FlexibleNumber.annotations({ description: "Filter posts flagged after this Unix epoch timestamp (milliseconds)" })),
  limit: Schema.optional(FlexibleNumber.annotations({ description: "Maximum number of results to return" }))
});
export type ListCurationCandidatesInput = Schema.Schema.Type<typeof ListCurationCandidatesInput>;

export const CuratePostInput = Schema.Struct({
  postUri: AtUri.annotations({ description: "AT Protocol URI of the post to curate" }),
  action: CurationAction.annotations({ description: "Action: 'curate' to approve for enrichment, 'reject' to dismiss" }),
  note: Schema.optional(Schema.String.annotations({ description: "Optional review note explaining the curation decision" }))
});
export type CuratePostInput = Schema.Schema.Type<typeof CuratePostInput>;

export const CurationCandidateOutput = Schema.extend(
  KnowledgePostResult,
  Schema.Struct({
    signalScore: CurationSignalScore,
    curationStatus: CurationStatus,
    predicatesApplied: Schema.Array(Schema.String),
    flaggedAt: Schema.Number,
    enrichmentReadiness: Schema.optionalWith(EnrichmentReadiness, { default: () => "none" as const })
  })
);
export type CurationCandidateOutput = Schema.Schema.Type<typeof CurationCandidateOutput>;

export const CurationCandidatesOutput = Schema.Struct({
  items: Schema.Array(CurationCandidateOutput)
});
export type CurationCandidatesOutput = Schema.Schema.Type<typeof CurationCandidatesOutput>;

export const CuratePostOutput = Schema.Struct({
  postUri: AtUri,
  action: CurationAction,
  previousStatus: Schema.NullOr(CurationStatus),
  newStatus: CurationStatus
});
export type CuratePostOutput = Schema.Schema.Type<typeof CuratePostOutput>;

export class CurationPostNotFoundError extends Schema.TaggedError<CurationPostNotFoundError>()(
  "CurationPostNotFoundError",
  {
    postUri: AtUri
  }
) {}
