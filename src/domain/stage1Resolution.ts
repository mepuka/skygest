import { Schema } from "effect";
import { LinkRecord } from "./bi";
import {
  AgentId,
  DatasetId,
  DistributionId,
  VariableId
} from "./data-layer/ids";
import { AliasScheme } from "./data-layer/alias";
import { SourceAttributionEnrichment, VisionEnrichment } from "./enrichment";
import { PostUri } from "./types";
import { PostLinkCard, ThreadCoverage } from "./postContext";

export const Stage1Rank = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(1))
);
export type Stage1Rank = Schema.Schema.Type<typeof Stage1Rank>;

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
  vision: Schema.NullOr(VisionEnrichment),
  sourceAttribution: Schema.NullOr(SourceAttributionEnrichment)
} as const;

export const Stage1Input = Schema.Struct(stage1InputFields).annotate({
  description: "All deterministic inputs consumed by the Stage 1 resolver"
});
export type Stage1Input = Schema.Schema.Type<typeof Stage1Input>;

const MatchTextSource = Schema.Literals([
  "post-text",
  "chart-title",
  "organization-mention",
  "logo-text",
  "source-line",
  "axis-label"
]);

const UrlSource = Schema.Literals([
  "post-link",
  "link-card",
  "visible-url",
  "source-line",
  "provider-homepage"
]);

export const Stage1MatchGrain = Schema.Literals([
  "Distribution",
  "Dataset",
  "Agent",
  "Variable"
]);
export type Stage1MatchGrain = Schema.Schema.Type<typeof Stage1MatchGrain>;

export const ExactDistributionUrlEvidence = Schema.TaggedStruct(
  "ExactDistributionUrlEvidence",
  {
  signal: Schema.Literal("distribution-url-exact"),
  rank: Stage1Rank,
  source: UrlSource,
  url: Schema.String,
  normalizedUrl: Schema.String
});
export type ExactDistributionUrlEvidence = Schema.Schema.Type<
  typeof ExactDistributionUrlEvidence
>;

export const DistributionUrlPrefixEvidence = Schema.TaggedStruct(
  "DistributionUrlPrefixEvidence",
  {
  signal: Schema.Literal("distribution-url-prefix"),
  rank: Stage1Rank,
  source: UrlSource,
  url: Schema.String,
  normalizedPrefix: Schema.String
});
export type DistributionUrlPrefixEvidence = Schema.Schema.Type<
  typeof DistributionUrlPrefixEvidence
>;

export const DistributionHostnameEvidence = Schema.TaggedStruct(
  "DistributionHostnameEvidence",
  {
  signal: Schema.Literal("distribution-hostname"),
  rank: Stage1Rank,
  source: UrlSource,
  url: Schema.String,
  hostname: Schema.String
});
export type DistributionHostnameEvidence = Schema.Schema.Type<
  typeof DistributionHostnameEvidence
>;

export const DatasetTitleEvidence = Schema.TaggedStruct("DatasetTitleEvidence", {
  signal: Schema.Literal("dataset-title"),
  rank: Stage1Rank,
  assetKey: Schema.optionalKey(Schema.String),
  datasetName: Schema.String,
  normalizedTitle: Schema.String
});
export type DatasetTitleEvidence = Schema.Schema.Type<typeof DatasetTitleEvidence>;

export const DatasetAliasEvidence = Schema.TaggedStruct("DatasetAliasEvidence", {
  signal: Schema.Literal("dataset-alias"),
  rank: Stage1Rank,
  aliasScheme: AliasScheme,
  aliasValue: Schema.String,
  source: Schema.String
});
export type DatasetAliasEvidence = Schema.Schema.Type<typeof DatasetAliasEvidence>;

export const AgentProviderEvidence = Schema.TaggedStruct("AgentProviderEvidence", {
  signal: Schema.Literal("agent-provider"),
  rank: Stage1Rank,
  providerLabel: Schema.String,
  providerId: Schema.optionalKey(Schema.String),
  sourceFamily: Schema.NullOr(Schema.String)
});
export type AgentProviderEvidence = Schema.Schema.Type<
  typeof AgentProviderEvidence
>;

export const AgentHomepageEvidence = Schema.TaggedStruct("AgentHomepageEvidence", {
  signal: Schema.Literal("agent-homepage-domain"),
  rank: Stage1Rank,
  providerLabel: Schema.String,
  homepageDomain: Schema.String
});
export type AgentHomepageEvidence = Schema.Schema.Type<
  typeof AgentHomepageEvidence
>;

export const AgentLabelEvidence = Schema.TaggedStruct("AgentLabelEvidence", {
  signal: Schema.Literal("agent-label"),
  rank: Stage1Rank,
  source: MatchTextSource,
  text: Schema.String,
  normalizedLabel: Schema.String,
  assetKey: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.String)
});
export type AgentLabelEvidence = Schema.Schema.Type<typeof AgentLabelEvidence>;

export const VariableAliasEvidence = Schema.TaggedStruct("VariableAliasEvidence", {
  signal: Schema.Literal("variable-alias"),
  rank: Stage1Rank,
  aliasScheme: AliasScheme,
  aliasValue: Schema.String,
  source: Schema.String
});
export type VariableAliasEvidence = Schema.Schema.Type<
  typeof VariableAliasEvidence
>;

export const Stage1Evidence = Schema.Union([
  ExactDistributionUrlEvidence,
  DistributionUrlPrefixEvidence,
  DistributionHostnameEvidence,
  DatasetTitleEvidence,
  DatasetAliasEvidence,
  AgentProviderEvidence,
  AgentHomepageEvidence,
  AgentLabelEvidence,
  VariableAliasEvidence
]);
export type Stage1Evidence = Schema.Schema.Type<typeof Stage1Evidence>;

export const DistributionMatch = Schema.TaggedStruct("DistributionMatch", {
  distributionId: DistributionId,
  title: Schema.NullOr(Schema.String),
  bestRank: Stage1Rank,
  evidence: Schema.Array(Stage1Evidence)
});
export type DistributionMatch = Schema.Schema.Type<typeof DistributionMatch>;

export const DatasetMatch = Schema.TaggedStruct("DatasetMatch", {
  datasetId: DatasetId,
  title: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(Stage1Evidence)
});
export type DatasetMatch = Schema.Schema.Type<typeof DatasetMatch>;

export const AgentMatch = Schema.TaggedStruct("AgentMatch", {
  agentId: AgentId,
  name: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(Stage1Evidence)
});
export type AgentMatch = Schema.Schema.Type<typeof AgentMatch>;

export const VariableMatch = Schema.TaggedStruct("VariableMatch", {
  variableId: VariableId,
  label: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(Stage1Evidence)
});
export type VariableMatch = Schema.Schema.Type<typeof VariableMatch>;

export const Stage1Match = Schema.Union([
  DistributionMatch,
  DatasetMatch,
  AgentMatch,
  VariableMatch
]);
export type Stage1Match = Schema.Schema.Type<typeof Stage1Match>;

export const UnmatchedUrlResidual = Schema.TaggedStruct("UnmatchedUrlResidual", {
  source: UrlSource,
  url: Schema.String,
  normalizedUrl: Schema.optionalKey(Schema.String),
  hostname: Schema.optionalKey(Schema.String)
});
export type UnmatchedUrlResidual = Schema.Schema.Type<typeof UnmatchedUrlResidual>;

export const UnmatchedDatasetTitleResidual = Schema.TaggedStruct(
  "UnmatchedDatasetTitleResidual",
  {
  datasetName: Schema.String,
  normalizedTitle: Schema.String,
  assetKey: Schema.optionalKey(Schema.String)
});
export type UnmatchedDatasetTitleResidual = Schema.Schema.Type<
  typeof UnmatchedDatasetTitleResidual
>;

export const UnmatchedTextResidual = Schema.TaggedStruct("UnmatchedTextResidual", {
  source: MatchTextSource,
  text: Schema.String,
  normalizedText: Schema.String,
  assetKey: Schema.optionalKey(Schema.String),
  location: Schema.optionalKey(Schema.String)
});
export type UnmatchedTextResidual = Schema.Schema.Type<
  typeof UnmatchedTextResidual
>;

export const AmbiguousCandidate = Schema.Struct({
  entityId: Schema.String,
  label: Schema.String
});
export type AmbiguousCandidate = Schema.Schema.Type<typeof AmbiguousCandidate>;

export const AmbiguousCandidatesResidual = Schema.TaggedStruct(
  "AmbiguousCandidatesResidual",
  {
  grain: Stage1MatchGrain,
  bestRank: Stage1Rank,
  candidates: Schema.Array(AmbiguousCandidate),
  evidence: Schema.Array(Stage1Evidence)
});
export type AmbiguousCandidatesResidual = Schema.Schema.Type<
  typeof AmbiguousCandidatesResidual
>;

export const DeferredToStage2Residual = Schema.TaggedStruct(
  "DeferredToStage2Residual",
  {
  source: MatchTextSource,
  text: Schema.String,
  reason: Schema.String,
  assetKey: Schema.optionalKey(Schema.String)
});
export type DeferredToStage2Residual = Schema.Schema.Type<
  typeof DeferredToStage2Residual
>;

export const Stage1Residual = Schema.Union([
  UnmatchedUrlResidual,
  UnmatchedDatasetTitleResidual,
  UnmatchedTextResidual,
  AmbiguousCandidatesResidual,
  DeferredToStage2Residual
]);
export type Stage1Residual = Schema.Schema.Type<typeof Stage1Residual>;

export const Stage1Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),
  residuals: Schema.Array(Stage1Residual)
}).annotate({
  description: "Deterministic Stage 1 output: accepted direct-grain matches plus unresolved residuals"
});
export type Stage1Result = Schema.Schema.Type<typeof Stage1Result>;
