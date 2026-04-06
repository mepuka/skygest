import { Schema } from "effect";
import { Did, IsoTimestamp, PostUri } from "./types";
import { FlexibleNumber, KnowledgePostResult } from "./bi";
import {
  EnrichmentReadiness,
  GetPostEnrichmentsOutput,
  GroundingEnrichment,
  SourceAttributionEnrichment,
  VisionEnrichment
} from "./enrichment";
import { ProviderId } from "./source";

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

export const GetEditorialPickBundleInput = Schema.Struct({
  postUri: PostUri.annotate({
    description: "Post URI (at:// or x://) of an active editorial pick"
  })
});
export type GetEditorialPickBundleInput = Schema.Schema.Type<
  typeof GetEditorialPickBundleInput
>;

export const EditorialPickSourcePost = Schema.Struct({
  author: Did,
  text: Schema.String,
  createdAt: Schema.Number
});
export type EditorialPickSourcePost = Schema.Schema.Type<
  typeof EditorialPickSourcePost
>;

export const EditorialPickBundlePost = Schema.Struct({
  author: Did,
  text: Schema.String,
  captured_at: IsoTimestamp
});
export type EditorialPickBundlePost = Schema.Schema.Type<
  typeof EditorialPickBundlePost
>;

export const EditorialPickBundleEditorialPick = Schema.Struct({
  score: EditorialScore,
  curator: Schema.String,
  picked_at: IsoTimestamp,
  reason: Schema.String,
  category: Schema.optionalKey(EditorialPickCategory),
  expires_at: Schema.optionalKey(IsoTimestamp)
});
export type EditorialPickBundleEditorialPick = Schema.Schema.Type<
  typeof EditorialPickBundleEditorialPick
>;

export const EditorialPickBundleEnrichments = Schema.Struct({
  readiness: EnrichmentReadiness,
  vision: Schema.optionalKey(VisionEnrichment),
  source_attribution: Schema.optionalKey(SourceAttributionEnrichment),
  grounding: Schema.optionalKey(GroundingEnrichment),
  entities: Schema.Array(Schema.String)
});
export type EditorialPickBundleEnrichments = Schema.Schema.Type<
  typeof EditorialPickBundleEnrichments
>;

export const EditorialPickBundle = Schema.Struct({
  post_uri: PostUri,
  post: EditorialPickBundlePost,
  editorial_pick: EditorialPickBundleEditorialPick,
  enrichments: EditorialPickBundleEnrichments,
  source_providers: Schema.Array(ProviderId),
  resolved_expert: Schema.optionalKey(Schema.String)
});
export type EditorialPickBundle = Schema.Schema.Type<typeof EditorialPickBundle>;

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

export class EditorialPickNotFoundError extends Schema.TaggedErrorClass<EditorialPickNotFoundError>()(
  "EditorialPickNotFoundError",
  {
    postUri: PostUri
  }
) {}

export class EditorialPickNotReadyError extends Schema.TaggedErrorClass<EditorialPickNotReadyError>()(
  "EditorialPickNotReadyError",
  {
    postUri: PostUri,
    readiness: GetPostEnrichmentsOutput.fields.readiness
  }
) {}
