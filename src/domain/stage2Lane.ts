import { Schema } from "effect";

export const Stage2Lane = Schema.Literals([
  "pending",
  "facet-decomposition",
  "fuzzy-dataset-title",
  "fuzzy-agent-label",
  "tie-breaker",
  "no-op"
]);
export type Stage2Lane = Schema.Schema.Type<typeof Stage2Lane>;
