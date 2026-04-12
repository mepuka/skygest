import { Schema } from "effect";
import { Stage1Evidence } from "./stage1Evidence";
import { Stage2Evidence } from "./stage2Evidence";

export const MatchEvidence = Schema.Union([Stage1Evidence, Stage2Evidence]);
export type MatchEvidence = Schema.Schema.Type<typeof MatchEvidence>;
