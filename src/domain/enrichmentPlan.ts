import { Schema } from "effect";
import { LinkRecord, StoredTopicMatch, ThreadEmbedType } from "./bi";
import { EmbedPayload, QuoteRef } from "./embed";
import {
  EnrichmentKind,
  EnrichmentOutput,
  VisionEnrichment
} from "./enrichment";
import { Did, PostUri } from "./types";

export const EnrichmentPlannerDecision = Schema.Literals(["execute", "skip"]);
export type EnrichmentPlannerDecision = Schema.Schema.Type<
  typeof EnrichmentPlannerDecision
>;

export const EnrichmentPlannerStopReason = Schema.Literals([
  "no-visual-assets",
  "no-source-signals",
  "no-grounding-signals",
  "awaiting-vision"
]);
export type EnrichmentPlannerStopReason = Schema.Schema.Type<
  typeof EnrichmentPlannerStopReason
>;

export const EnrichmentPlannerInput = Schema.Struct({
  postUri: PostUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
});
export type EnrichmentPlannerInput = Schema.Schema.Type<
  typeof EnrichmentPlannerInput
>;

export const EnrichmentPlannedPostContext = Schema.Struct({
  postUri: PostUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  threadCoverage: Schema.Literal("focus-only")
});
export type EnrichmentPlannedPostContext = Schema.Schema.Type<
  typeof EnrichmentPlannedPostContext
>;

export const EnrichmentPlannedLinkCardContext = Schema.Struct({
  source: Schema.Literals(["embed", "media"]),
  uri: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumb: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedLinkCardContext = Schema.Schema.Type<
  typeof EnrichmentPlannedLinkCardContext
>;

export const EnrichmentPlannedQuoteContext = Schema.Struct({
  ...QuoteRef.fields,
  source: Schema.Literals(["embed", "media"])
});
export type EnrichmentPlannedQuoteContext = typeof EnrichmentPlannedQuoteContext.Type;

export const EnrichmentPlannedImageAsset = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  assetType: Schema.Literal("image"),
  source: Schema.Literals(["embed", "media"]),
  index: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedImageAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedImageAsset
>;

export const EnrichmentPlannedVideoAsset = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  assetType: Schema.Literal("video"),
  source: Schema.Literals(["embed", "media"]),
  index: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  playlist: Schema.NullOr(Schema.String),
  thumbnail: Schema.NullOr(Schema.String),
  alt: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedVideoAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedVideoAsset
>;

export const EnrichmentPlannedAsset = Schema.Union([
  EnrichmentPlannedImageAsset,
  EnrichmentPlannedVideoAsset
]);
export type EnrichmentPlannedAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedAsset
>;

export const EnrichmentPlannedExistingEnrichment = Schema.Struct({
  output: EnrichmentOutput,
  updatedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  enrichedAt: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
});
export type EnrichmentPlannedExistingEnrichment = Schema.Schema.Type<
  typeof EnrichmentPlannedExistingEnrichment
>;

export const EnrichmentExecutionPlan = Schema.Struct({
  postUri: PostUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  decision: EnrichmentPlannerDecision,
  stopReason: Schema.optionalKey(EnrichmentPlannerStopReason),
  captureStage: Schema.Literal("picked"),
  post: EnrichmentPlannedPostContext,
  embedType: Schema.NullOr(ThreadEmbedType),
  embedPayload: Schema.NullOr(EmbedPayload),
  links: Schema.Array(LinkRecord),
  topicMatches: Schema.Array(StoredTopicMatch),
  quote: Schema.NullOr(EnrichmentPlannedQuoteContext),
  linkCards: Schema.Array(EnrichmentPlannedLinkCardContext),
  assets: Schema.Array(EnrichmentPlannedAsset),
  existingEnrichments: Schema.Array(EnrichmentPlannedExistingEnrichment),
  vision: Schema.NullOr(VisionEnrichment)
});
export type EnrichmentExecutionPlan = Schema.Schema.Type<
  typeof EnrichmentExecutionPlan
>;

export const isVisionExecutionPlan = (
  plan: EnrichmentExecutionPlan
): plan is EnrichmentExecutionPlan & {
  readonly enrichmentType: "vision";
  readonly decision: "execute";
} => plan.enrichmentType === "vision" && plan.decision === "execute";

export const VisionExecutionPlan = EnrichmentExecutionPlan.pipe(
  Schema.check(Schema.makeFilter(isVisionExecutionPlan))
);
export type VisionExecutionPlan = Schema.Schema.Type<typeof VisionExecutionPlan>;

export const isSourceAttributionExecutionPlan = (
  plan: EnrichmentExecutionPlan
): plan is EnrichmentExecutionPlan & {
  readonly enrichmentType: "source-attribution";
  readonly decision: "execute";
} =>
  plan.enrichmentType === "source-attribution" &&
  plan.decision === "execute" &&
  (plan.assets.length === 0 || plan.vision !== null);

export const SourceAttributionExecutionPlan = EnrichmentExecutionPlan.pipe(
  Schema.check(Schema.makeFilter(isSourceAttributionExecutionPlan))
);
export type SourceAttributionExecutionPlan = Schema.Schema.Type<
  typeof SourceAttributionExecutionPlan
>;

export const describeEnrichmentPlanStopReason = (
  reason: EnrichmentPlannerStopReason
) => {
  switch (reason) {
    case "no-visual-assets":
      return "the stored post has no visual assets to analyze";
    case "no-source-signals":
      return "the stored post has no durable source signals to attribute";
    case "no-grounding-signals":
      return "the stored post does not have enough durable grounding signals";
    case "awaiting-vision":
      return "the stored post has visual assets and source attribution is waiting on vision enrichment";
  }
};
