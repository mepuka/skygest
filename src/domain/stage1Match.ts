import { Schema } from "effect";
import {
  AgentId,
  DatasetId,
  DistributionId,
  VariableId
} from "./data-layer/ids";
import { MatchEvidence } from "./matchEvidence";
import { Stage1Rank } from "./stage1Shared";

export const DistributionMatch = Schema.TaggedStruct("DistributionMatch", {
  distributionId: DistributionId,
  title: Schema.NullOr(Schema.String),
  bestRank: Stage1Rank,
  evidence: Schema.Array(MatchEvidence)
});
export type DistributionMatch = Schema.Schema.Type<typeof DistributionMatch>;

export const DatasetMatch = Schema.TaggedStruct("DatasetMatch", {
  datasetId: DatasetId,
  title: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(MatchEvidence)
});
export type DatasetMatch = Schema.Schema.Type<typeof DatasetMatch>;

export const AgentMatch = Schema.TaggedStruct("AgentMatch", {
  agentId: AgentId,
  name: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(MatchEvidence)
});
export type AgentMatch = Schema.Schema.Type<typeof AgentMatch>;

export const VariableMatch = Schema.TaggedStruct("VariableMatch", {
  variableId: VariableId,
  label: Schema.String,
  bestRank: Stage1Rank,
  evidence: Schema.Array(MatchEvidence)
});
export type VariableMatch = Schema.Schema.Type<typeof VariableMatch>;

export const Stage1Match = Schema.Union([
  DistributionMatch,
  DatasetMatch,
  AgentMatch,
  VariableMatch
]);
export type Stage1Match = Schema.Schema.Type<typeof Stage1Match>;
