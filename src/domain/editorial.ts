import { Schema } from "effect";
import { AtUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";

export const EditorialScore = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(100),
  Schema.brand("EditorialScore")
);
export type EditorialScore = Schema.Schema.Type<typeof EditorialScore>;

export const EditorialPickCategory = Schema.Literal("breaking", "analysis", "discussion", "data", "opinion");
export type EditorialPickCategory = Schema.Schema.Type<typeof EditorialPickCategory>;

export const EditorialPickStatus = Schema.Literal("active", "expired", "retracted");
export type EditorialPickStatus = Schema.Schema.Type<typeof EditorialPickStatus>;

export const EditorialPickRecord = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String,
  category: Schema.NullOr(EditorialPickCategory),
  curator: Schema.String,
  status: EditorialPickStatus,
  pickedAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number)
});
export type EditorialPickRecord = Schema.Schema.Type<typeof EditorialPickRecord>;

export const SubmitEditorialPickInput = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String.pipe(Schema.minLength(1)),
  category: Schema.optional(EditorialPickCategory),
  expiresInHours: Schema.optional(Schema.Number.pipe(Schema.greaterThan(0)))
});
export type SubmitEditorialPickInput = Schema.Schema.Type<typeof SubmitEditorialPickInput>;

export const SubmitEditorialPickMcpInput = Schema.Struct({
  postUri: AtUri.annotations({ description: "AT Protocol URI of the post to pick" }),
  score: Schema.Union(EditorialScore, Schema.compose(Schema.NumberFromString, EditorialScore)).annotations({ description: "Editorial quality score (0-100). 80+=must-read, 60-79=strong, 40-59=notable" }),
  reason: Schema.String.pipe(Schema.minLength(1)).annotations({ description: "1-2 sentence explanation of why this post was selected" }),
  category: Schema.optional(EditorialPickCategory.annotations({ description: "Pick category: breaking, analysis, discussion, data, or opinion" })),
  expiresInHours: Schema.optional(FlexibleNumber.annotations({ description: "Auto-expire pick after N hours (default: configured default)" }))
});
export type SubmitEditorialPickMcpInput = Schema.Schema.Type<typeof SubmitEditorialPickMcpInput>;

export const RemoveEditorialPickInput = Schema.Struct({
  postUri: AtUri
});
export type RemoveEditorialPickInput = Schema.Schema.Type<typeof RemoveEditorialPickInput>;

export const ListEditorialPicksInput = Schema.Struct({
  minScore: Schema.optional(Schema.Union(EditorialScore, Schema.compose(Schema.NumberFromString, EditorialScore)).annotations({ description: "Minimum editorial score (0-100) to include" })),
  since: Schema.optional(FlexibleNumber.annotations({ description: "Filter picks created after this Unix epoch timestamp (milliseconds)" })),
  limit: Schema.optional(FlexibleNumber.annotations({ description: "Maximum number of results to return" }))
});
export type ListEditorialPicksInput = Schema.Schema.Type<typeof ListEditorialPicksInput>;

export const GetCuratedFeedInput = Schema.Struct({
  topic: Schema.optional(Schema.String),
  minScore: Schema.optional(EditorialScore),
  since: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number)
});
export type GetCuratedFeedInput = Schema.Schema.Type<typeof GetCuratedFeedInput>;

export const EditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  score: EditorialScore,
  reason: Schema.String,
  category: Schema.NullOr(EditorialPickCategory),
  curator: Schema.String,
  pickedAt: Schema.Number
});
export type EditorialPickOutput = Schema.Schema.Type<typeof EditorialPickOutput>;

export const SubmitEditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  created: Schema.Boolean
});
export type SubmitEditorialPickOutput = Schema.Schema.Type<typeof SubmitEditorialPickOutput>;

export const RemoveEditorialPickOutput = Schema.Struct({
  postUri: AtUri,
  removed: Schema.Boolean
});
export type RemoveEditorialPickOutput = Schema.Schema.Type<typeof RemoveEditorialPickOutput>;

export const EditorialPicksOutput = Schema.Struct({
  items: Schema.Array(EditorialPickOutput)
});
export type EditorialPicksOutput = Schema.Schema.Type<typeof EditorialPicksOutput>;

export const CuratedPostResult = Schema.extend(
  KnowledgePostResult,
  Schema.Struct({
    editorialScore: EditorialScore,
    editorialReason: Schema.String,
    editorialCategory: Schema.NullOr(EditorialPickCategory)
  })
);
export type CuratedPostResult = Schema.Schema.Type<typeof CuratedPostResult>;

export class EditorialPostNotFoundError extends Schema.TaggedError<EditorialPostNotFoundError>()(
  "EditorialPostNotFoundError",
  {
    postUri: AtUri
  }
) {}
