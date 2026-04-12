import { Schema } from "effect";
import { Stage1Match } from "./stage1Match";
import { Stage2Evidence } from "./stage2Evidence";
import { Stage3Input } from "./stage2Core";
import { Stage1MatchGrain } from "./stage1Shared";

export const Stage2CorroborationMatchKey = Schema.Struct({
  grain: Stage1MatchGrain,
  entityId: Schema.String
});
export type Stage2CorroborationMatchKey = Schema.Schema.Type<
  typeof Stage2CorroborationMatchKey
>;

export const Stage2Corroboration = Schema.Struct({
  matchKey: Stage2CorroborationMatchKey,
  evidence: Schema.Array(Stage2Evidence)
});
export type Stage2Corroboration = Schema.Schema.Type<
  typeof Stage2Corroboration
>;

export const Stage2Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),
  corroborations: Schema.Array(Stage2Corroboration),
  escalations: Schema.Array(Stage3Input)
}).annotate({
  description:
    "Stage 2 output: new matches, corroborations to merge with Stage 1 matches, and Stage 3 escalations"
});
export type Stage2Result = Schema.Schema.Type<typeof Stage2Result>;
