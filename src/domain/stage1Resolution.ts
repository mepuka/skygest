import { Schema } from "effect";
import { LinkRecord } from "./bi";
import { SourceAttributionEnrichment, VisionEnrichment } from "./enrichment";
import { PostUri } from "./types";
import { PostLinkCard, ThreadCoverage } from "./postContext";
import { Stage1Match } from "./stage1Match";
import { Stage1Residual } from "./stage1Residual";

const DeferredVisionEnrichment = Schema.suspend(() => VisionEnrichment);
const DeferredSourceAttributionEnrichment = Schema.suspend(
  () => SourceAttributionEnrichment
);
export * from "./stage1Shared";
export * from "./stage1Evidence";
export * from "./stage1Match";
export * from "./stage1Residual";
export { MatchEvidence } from "./matchEvidence";

export const Stage1PostContext = Schema.Struct({
  postUri: PostUri,
  text: Schema.String,
  links: Schema.Array(LinkRecord),
  linkCards: Schema.Array(PostLinkCard),
  threadCoverage: ThreadCoverage
}).annotate({
  description: "Narrow post context consumed by deterministic Stage 1 resolution"
});
export type Stage1PostContext = Schema.Schema.Type<typeof Stage1PostContext>;

export const stage1InputFields = {
  postContext: Stage1PostContext,
  vision: Schema.NullOr(DeferredVisionEnrichment),
  sourceAttribution: Schema.NullOr(DeferredSourceAttributionEnrichment)
} as const;

export const Stage1Input = Schema.Struct(stage1InputFields).annotate({
  description: "All deterministic inputs consumed by the Stage 1 resolver"
});
export type Stage1Input = Schema.Schema.Type<typeof Stage1Input>;

export const Stage1Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),
  residuals: Schema.Array(Stage1Residual)
}).annotate({
  description: "Deterministic Stage 1 output: accepted direct-grain matches plus unresolved residuals"
});
export type Stage1Result = Schema.Schema.Type<typeof Stage1Result>;
