import { Schema } from "effect";
import { AliasScheme } from "./data-layer/alias";
import { MatchTextSource, Stage1Rank, UrlSource } from "./stage1Shared";

export const ExactDistributionUrlEvidence = Schema.TaggedStruct(
  "ExactDistributionUrlEvidence",
  {
    signal: Schema.Literal("distribution-url-exact"),
    rank: Stage1Rank,
    source: UrlSource,
    url: Schema.String,
    normalizedUrl: Schema.String
  }
);
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
  }
);
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
  }
);
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
