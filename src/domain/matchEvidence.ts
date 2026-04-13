import { Schema } from "effect";
import { Stage1Evidence } from "./stage1Evidence";

export const MatchEvidence = Stage1Evidence;
export type MatchEvidence = Schema.Schema.Type<typeof MatchEvidence>;
