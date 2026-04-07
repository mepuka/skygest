import { Schema } from "effect";
import { ProviderId } from "../source";
import { Did, IsoTimestamp } from "../types";

// Narrative frontmatter mirrors markdown keys, so this domain slice intentionally
// keeps snake_case field names rather than the repo's usual camelCase shape.

const DATE_STAMP_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const validateTrimmedNarrativeText = (value: string) => {
  if (value.trim().length === 0) {
    return "expected non-empty text";
  }

  return value === value.trim()
    ? undefined
    : "expected text without leading or trailing whitespace";
};

const validateDateStamp = (value: string) => {
  if (!DATE_STAMP_PATTERN.test(value)) {
    return "expected a YYYY-MM-DD date";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? undefined
    : "expected a real calendar date in YYYY-MM-DD format";
};

const validateRelativeDocumentStem = (value: string) => {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.endsWith(".md") ||
    value.includes("\\") ||
    /\s/u.test(value)
  ) {
    return "expected a relative document reference without a .md suffix";
  }

  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  )
    ? undefined
    : "expected a relative document reference without empty, '.' or '..' segments";
};

const validateUniqueStoryPosts = (value: {
  readonly posts: ReadonlyArray<{ readonly annotation: string }>;
}) => {
  const annotations = value.posts.map((post) => post.annotation);
  return new Set(annotations).size === annotations.length
    ? undefined
    : "story posts must not repeat annotation references";
};

const validateUniqueNarrativeArcs = (value: {
  readonly narrative_arcs: ReadonlyArray<string>;
}) =>
  new Set(value.narrative_arcs).size === value.narrative_arcs.length
    ? undefined
    : "narrative_arcs must not repeat values";

export const NonEmptyNarrativeText = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateTrimmedNarrativeText))
);
export type NonEmptyNarrativeText = Schema.Schema.Type<
  typeof NonEmptyNarrativeText
>;

export const DateStamp = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateDateStamp))
);
export type DateStamp = Schema.Schema.Type<typeof DateStamp>;

export const RelativeDocumentStem = Schema.String.pipe(
  Schema.check(Schema.makeFilter(validateRelativeDocumentStem))
);
export type RelativeDocumentStem = Schema.Schema.Type<
  typeof RelativeDocumentStem
>;

export const StoryStatus = Schema.Literals(["draft", "assembled", "published"]);
export type StoryStatus = Schema.Schema.Type<typeof StoryStatus>;

export const StoryPostRole = Schema.Literals([
  "lead",
  "supporting",
  "counter",
  "context"
]);
export type StoryPostRole = Schema.Schema.Type<typeof StoryPostRole>;

export const StoryPostRef = Schema.Struct({
  // [hydratable] relative path into post-annotations/, without .md suffix
  annotation: RelativeDocumentStem,
  // [editorial] editor-assigned role within the story scaffold
  role: StoryPostRole
});
export type StoryPostRef = Schema.Schema.Type<typeof StoryPostRef>;

const StoryHeadline = Schema.String.pipe(
  Schema.check(Schema.isLengthBetween(10, 160)),
  Schema.check(Schema.makeFilter(validateTrimmedNarrativeText))
);

const NarrativeArcRef = NonEmptyNarrativeText;
const ArgumentPatternRef = NonEmptyNarrativeText;
const StoryNarrativeArcs = Schema.NonEmptyArray(NarrativeArcRef);
const StoryPosts = Schema.NonEmptyArray(StoryPostRef);

const StoryFrontmatterBase = Schema.Struct({
  // [editorial] working headline for the story
  headline: StoryHeadline,
  // [editorial] core question this story is answering
  question: NonEmptyNarrativeText,
  // [editorial] primary narrative arc references
  narrative_arcs: StoryNarrativeArcs,
  // [editorial] argument-pattern slug or reference
  argument_pattern: ArgumentPatternRef,
  // [editorial] optional trigger note for why this story now exists
  trigger: Schema.optionalKey(NonEmptyNarrativeText),
  // [editorial] current lifecycle state for the story
  status: StoryStatus,
  // [editorial] optional note from the editor
  editor_note: Schema.optionalKey(NonEmptyNarrativeText),

  // [hydratable] ordered annotation references used to assemble the story
  posts: StoryPosts,

  // [cache] denormalized set of expert author DIDs
  experts: Schema.Array(Did),
  // [cache] early entity cache, plain strings until structured extraction lands
  entities: Schema.Array(Schema.String),
  // [cache] denormalized source provider ids rolled up from annotations
  source_providers: Schema.Array(ProviderId),
  // [cache] early data references cache, normalized later
  data_refs: Schema.Array(Schema.String),

  // [hydratable] pick date used to bucket related annotations
  curation_date: DateStamp,
  // [hydratable] creation timestamp for the story scaffold
  created: IsoTimestamp
});

export const StoryFrontmatter = StoryFrontmatterBase.pipe(
  Schema.check(Schema.makeFilter(validateUniqueNarrativeArcs)),
  Schema.check(Schema.makeFilter(validateUniqueStoryPosts))
);
export type StoryFrontmatter = Schema.Schema.Type<typeof StoryFrontmatter>;
