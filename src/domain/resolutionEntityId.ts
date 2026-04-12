import { Schema } from "effect";
import {
  AgentId,
  DatasetId,
  DistributionId,
  VariableId
} from "./data-layer/ids";

export const ResolutionEntityId = Schema.Union([
  DistributionId,
  DatasetId,
  AgentId,
  VariableId
]);
export type ResolutionEntityId = Schema.Schema.Type<typeof ResolutionEntityId>;
