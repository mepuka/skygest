import { Schema } from "effect";
import { NonEmptyNarrativeText } from "./story";

export const ArgumentPatternStatus = Schema.Literals([
  "active",
  "draft",
  "deprecated"
]);
export type ArgumentPatternStatus = Schema.Schema.Type<
  typeof ArgumentPatternStatus
>;

const ArgumentPatternRef = NonEmptyNarrativeText;

export const ArgumentPatternFrontmatter = Schema.Struct({
  // [editorial] display title for the argument pattern
  title: NonEmptyNarrativeText,
  // [editorial] lifecycle state for the pattern definition
  status: ArgumentPatternStatus,
  // [editorial] explanation of the pattern and when it applies
  description: NonEmptyNarrativeText,
  // [editorial] alternate phrasings or sub-variants of the pattern
  variants: Schema.Array(NonEmptyNarrativeText),
  // [editorial] why this pattern matters editorially
  editorial_value: NonEmptyNarrativeText,
  // [editorial] pattern references related to this one
  related_patterns: Schema.Array(ArgumentPatternRef)
});
export type ArgumentPatternFrontmatter = Schema.Schema.Type<
  typeof ArgumentPatternFrontmatter
>;
