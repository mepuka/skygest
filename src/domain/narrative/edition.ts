import { Schema } from "effect";
import { DateStamp, NonEmptyNarrativeText, RelativeDocumentStem } from "./story";

const validateEditionStories = (value: {
  readonly lead_story: string;
  readonly stories: ReadonlyArray<{ readonly story: string }>;
}) => {
  const storyRefs = value.stories.map((story) => story.story);

  if (!storyRefs.includes(value.lead_story)) {
    return "lead_story must reference one of the listed stories";
  }

  return new Set(storyRefs).size === storyRefs.length
    ? undefined
    : "edition stories must not repeat story references";
};

export const EditionStatus = Schema.Literals(["draft", "published"]);
export type EditionStatus = Schema.Schema.Type<typeof EditionStatus>;

export const EditionStoryPosition = Schema.Literals([
  "lead",
  "feature",
  "supporting"
]);
export type EditionStoryPosition = Schema.Schema.Type<
  typeof EditionStoryPosition
>;

export const EditionStoryRef = Schema.Struct({
  // [editorial] narrative path reference that contains the story
  narrative: RelativeDocumentStem,
  // [editorial] story path reference within the edition
  story: RelativeDocumentStem,
  // [editorial] intended slot for the story inside the edition
  position: EditionStoryPosition
});
export type EditionStoryRef = Schema.Schema.Type<typeof EditionStoryRef>;

const EditionStories = Schema.NonEmptyArray(EditionStoryRef);

const EditionFrontmatterBase = Schema.Struct({
  // [editorial] edition title
  title: NonEmptyNarrativeText,
  // [hydratable] publication date for the edition
  publication_date: DateStamp,
  // [editorial] edition lifecycle state
  status: EditionStatus,
  // [editorial] canonical lead story reference
  lead_story: RelativeDocumentStem,
  // [editorial] ordered story lineup for the edition
  stories: EditionStories
});

export const EditionFrontmatter = EditionFrontmatterBase.pipe(
  Schema.check(Schema.makeFilter(validateEditionStories))
);
export type EditionFrontmatter = Schema.Schema.Type<typeof EditionFrontmatter>;
