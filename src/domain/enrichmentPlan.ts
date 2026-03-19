import { Schema } from "effect";
import { LinkRecord, StoredTopicMatch, ThreadEmbedType } from "./bi";
import { EmbedPayload, QuoteRef } from "./embed";
import {
  EnrichmentKind,
  EnrichmentOutput,
  VisionEnrichment
} from "./enrichment";
import { AtUri, Did } from "./types";

export const EnrichmentPlannerDecision = Schema.Literal("execute", "skip");
export type EnrichmentPlannerDecision = Schema.Schema.Type<
  typeof EnrichmentPlannerDecision
>;

export const EnrichmentPlannerStopReason = Schema.Literal(
  "no-visual-assets",
  "no-source-signals",
  "no-grounding-signals",
  "awaiting-vision"
);
export type EnrichmentPlannerStopReason = Schema.Schema.Type<
  typeof EnrichmentPlannerStopReason
>;

export const EnrichmentPlannerInput = Schema.Struct({
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.minLength(1))
});
export type EnrichmentPlannerInput = Schema.Schema.Type<
  typeof EnrichmentPlannerInput
>;

export const EnrichmentPlannedPostContext = Schema.Struct({
  postUri: AtUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.NonNegativeInt,
  threadCoverage: Schema.Literal("focus-only")
});
export type EnrichmentPlannedPostContext = Schema.Schema.Type<
  typeof EnrichmentPlannedPostContext
>;

export const EnrichmentPlannedLinkCardContext = Schema.Struct({
  source: Schema.Literal("embed", "media"),
  uri: Schema.String,
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  thumb: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedLinkCardContext = Schema.Schema.Type<
  typeof EnrichmentPlannedLinkCardContext
>;

export const EnrichmentPlannedQuoteContext = Schema.extend(
  QuoteRef,
  Schema.Struct({
    source: Schema.Literal("embed", "media")
  })
);
export type EnrichmentPlannedQuoteContext = Schema.Schema.Type<
  typeof EnrichmentPlannedQuoteContext
>;

export const EnrichmentPlannedImageAsset = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.minLength(1)),
  assetType: Schema.Literal("image"),
  source: Schema.Literal("embed", "media"),
  index: Schema.NonNegativeInt,
  thumb: Schema.String,
  fullsize: Schema.String,
  alt: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedImageAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedImageAsset
>;

export const EnrichmentPlannedVideoAsset = Schema.Struct({
  assetKey: Schema.String.pipe(Schema.minLength(1)),
  assetType: Schema.Literal("video"),
  source: Schema.Literal("embed", "media"),
  index: Schema.NonNegativeInt,
  playlist: Schema.NullOr(Schema.String),
  thumbnail: Schema.NullOr(Schema.String),
  alt: Schema.NullOr(Schema.String)
});
export type EnrichmentPlannedVideoAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedVideoAsset
>;

export const EnrichmentPlannedAsset = Schema.Union(
  EnrichmentPlannedImageAsset,
  EnrichmentPlannedVideoAsset
);
export type EnrichmentPlannedAsset = Schema.Schema.Type<
  typeof EnrichmentPlannedAsset
>;

export const EnrichmentPlannedExistingEnrichment = Schema.Struct({
  output: EnrichmentOutput,
  updatedAt: Schema.NonNegativeInt,
  enrichedAt: Schema.NonNegativeInt
});
export type EnrichmentPlannedExistingEnrichment = Schema.Schema.Type<
  typeof EnrichmentPlannedExistingEnrichment
>;

export const EnrichmentExecutionPlan = Schema.Struct({
  postUri: AtUri,
  enrichmentType: EnrichmentKind,
  schemaVersion: Schema.String.pipe(Schema.minLength(1)),
  decision: EnrichmentPlannerDecision,
  stopReason: Schema.optional(EnrichmentPlannerStopReason),
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
  Schema.filter(isVisionExecutionPlan)
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
  Schema.filter(isSourceAttributionExecutionPlan)
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
