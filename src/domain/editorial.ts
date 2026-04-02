import { Schema } from "effect";
import { PostUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";

export const EditorialScore = Schema.Number.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
  Schema.check(Schema.isLessThanOrEqualTo(100)),
  Schema.brand("EditorialScore")
);
export type EditorialScore = Schema.Schema.Type<typeof EditorialScore>;

export const EditorialPickCategory = Schema.Literals(["breaking", "analysis", "discussion", "data", "opinion"]);
export type EditorialPickCategory = Schema.Schema.Type<typeof EditorialPickCategory>;

export const EditorialPickStatus = Schema.Literals(["active", "expired", "retracted"]);
export type EditorialPickStatus = Schema.Schema.Type<typeof EditorialPickStatus>;

export const EditorialPickRecord = Schema.Struct({
  postUri: PostUri,
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
  postUri: PostUri,
  score: EditorialScore,
  reason: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  category: Schema.optionalKey(EditorialPickCategory),
  expiresInHours: Schema.optionalKey(Schema.Number.pipe(Schema.check(Schema.isGreaterThan(0))))
});
export type SubmitEditorialPickInput = Schema.Schema.Type<typeof SubmitEditorialPickInput>;

export const SubmitEditorialPickMcpInput = Schema.Struct({
  postUri: PostUri.annotate({ description: "Post URI (at:// or x://) of the post to pick" }),
  score: Schema.Union([EditorialScore, Schema.NumberFromString.pipe(Schema.decodeTo(EditorialScore))]).annotate({ description: "Editorial quality score (0-100). 80+=must-read, 60-79=strong, 40-59=notable" }),
  reason: Schema.String.pipe(Schema.check(Schema.isMinLength(1))).annotate({ description: "1-2 sentence explanation of why this post was selected" }),
  category: Schema.optionalKey(EditorialPickCategory.annotate({ description: "Pick category: breaking, analysis, discussion, data, or opinion" })),
  expiresInHours: Schema.optionalKey(FlexibleNumber.annotate({ description: "Auto-expire pick after N hours (default: configured default)" }))
});
export type SubmitEditorialPickMcpInput = Schema.Schema.Type<typeof SubmitEditorialPickMcpInput>;

export const RemoveEditorialPickInput = Schema.Struct({
  postUri: PostUri
});
export type RemoveEditorialPickInput = Schema.Schema.Type<typeof RemoveEditorialPickInput>;

export const ListEditorialPicksInput = Schema.Struct({
  minScore: Schema.optionalKey(Schema.Union([EditorialScore, Schema.NumberFromString.pipe(Schema.decodeTo(EditorialScore))]).annotate({ description: "Minimum editorial score (0-100) to include" })),
  since: Schema.optionalKey(FlexibleNumber.annotate({ description: "Filter picks created after this Unix epoch timestamp (milliseconds)" })),
  limit: Schema.optionalKey(FlexibleNumber.annotate({ description: "Maximum number of results to return" }))
});
export type ListEditorialPicksInput = Schema.Schema.Type<typeof ListEditorialPicksInput>;

export const GetCuratedFeedInput = Schema.Struct({
  topic: Schema.optionalKey(Schema.String),
  minScore: Schema.optionalKey(EditorialScore),
  since: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(Schema.Number)
});
export type GetCuratedFeedInput = Schema.Schema.Type<typeof GetCuratedFeedInput>;

export const EditorialPickOutput = Schema.Struct({
  postUri: PostUri,
  score: EditorialScore,
  reason: Schema.String,
  category: Schema.NullOr(EditorialPickCategory),
  curator: Schema.String,
  pickedAt: Schema.Number
});
export type EditorialPickOutput = Schema.Schema.Type<typeof EditorialPickOutput>;

export const SubmitEditorialPickOutput = Schema.Struct({
  postUri: PostUri,
  created: Schema.Boolean
});
export type SubmitEditorialPickOutput = Schema.Schema.Type<typeof SubmitEditorialPickOutput>;

export const RemoveEditorialPickOutput = Schema.Struct({
  postUri: PostUri,
  removed: Schema.Boolean
});
export type RemoveEditorialPickOutput = Schema.Schema.Type<typeof RemoveEditorialPickOutput>;

export const EditorialPicksOutput = Schema.Struct({
  items: Schema.Array(EditorialPickOutput)
});
export type EditorialPicksOutput = Schema.Schema.Type<typeof EditorialPicksOutput>;

export const CuratedPostResult = Schema.Struct({
  ...KnowledgePostResult.fields,
  editorialScore: EditorialScore,
  editorialReason: Schema.String,
  editorialCategory: Schema.NullOr(EditorialPickCategory)
});
export type CuratedPostResult = typeof CuratedPostResult.Type;

export class EditorialPostNotFoundError extends Schema.TaggedErrorClass<EditorialPostNotFoundError>()(
  "EditorialPostNotFoundError",
  {
    postUri: PostUri
  }
) {}
