import { Schema } from "effect";
import { DateStamp, NonEmptyNarrativeText } from "./story";

export const NarrativeStatus = Schema.Literals(["active", "dormant", "archived"]);
export type NarrativeStatus = Schema.Schema.Type<typeof NarrativeStatus>;

const NarrativeRelationRef = NonEmptyNarrativeText;

export const NarrativeFrontmatter = Schema.Struct({
  // [editorial] human title for the narrative cluster
  title: NonEmptyNarrativeText,
  // [editorial] stable framing question for the narrative
  core_question: NonEmptyNarrativeText,
  // [editorial] lifecycle state for the narrative
  status: NarrativeStatus,
  // [editorial] narrative slugs or references related to this one
  related: Schema.Array(NarrativeRelationRef),
  // [hydratable] last date the narrative was materially updated
  last_updated: DateStamp
});
export type NarrativeFrontmatter = Schema.Schema.Type<
  typeof NarrativeFrontmatter
>;
