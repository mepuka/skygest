import { Option, Result } from "effect";
import {
  makeSurfaceFormEntry,
  SurfaceFormEntryAny,
  SurfaceFormProvenance
} from "../../domain/surfaceForm";
import {
  VocabularyCollisionError
} from "../../domain/errors";
import { stringifyUnknown } from "../../platform/Json";
import { normalizeLookupText } from "../normalize";
export {
  makeSurfaceFormEntry,
  SurfaceFormEntryAny,
  SurfaceFormProvenance
} from "../../domain/surfaceForm";

export const buildVocabularyIndex = <Canonical>(
  facet: string,
  entries: ReadonlyArray<{
    readonly normalizedSurfaceForm: string;
    readonly canonical: Canonical;
  }>
): Result.Result<ReadonlyMap<string, Canonical>, VocabularyCollisionError> => {
  const index = new Map<string, Canonical>();

  for (const entry of entries) {
    const existing = index.get(entry.normalizedSurfaceForm);
    if (existing === undefined) {
      index.set(entry.normalizedSurfaceForm, entry.canonical);
      continue;
    }

    if (stringifyUnknown(existing) !== stringifyUnknown(entry.canonical)) {
      return Result.fail(
        new VocabularyCollisionError({
          facet,
          normalizedSurfaceForm: entry.normalizedSurfaceForm,
          canonicalA: stringifyUnknown(existing),
          canonicalB: stringifyUnknown(entry.canonical)
        })
      );
    }
  }

  return Result.succeed(index);
};

export type SurfaceFormLookup<
  Entry extends {
    readonly normalizedSurfaceForm: string;
    readonly canonical: unknown;
  }
> = {
  readonly canonicalByNormalizedSurfaceForm: ReadonlyMap<
    string,
    Entry["canonical"]
  >;
  readonly entryByNormalizedSurfaceForm: ReadonlyMap<string, Entry>;
  readonly orderedMatchers: ReadonlyArray<{
    readonly entry: Entry;
    readonly matches: (normalizedText: string) => boolean;
  }>;
};

const ALNUM_PATTERN = /[\p{L}\p{N}]/u;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// CD-008 + word-boundary matcher.
//
// Surface forms match only at non-alphanumeric word boundaries -- never as
// substrings inside larger alphanumeric tokens. Additionally, single-word
// forms that do not already end in "s" tolerate an optional trailing "s" so
// that "price" naturally matches both "price" and "prices" without having to
// enumerate every plural in the lexicon. Multi-word forms and forms already
// ending in "s" are matched verbatim.
//
// Simple `s?` suffix for plurals. Handles regular plurals only -- words
// ending in `-y` (subsidy -> subsidies), `-s`/`-x`/`-ch`/`-sh` (tax -> taxes),
// `-f`/`-fe` (leaf -> leaves), and irregulars (man -> men) are NOT expanded.
// Works for the current lexicon because every multi-char single-word form is
// a regular plural. If you add a word with a non-regular plural, either
// expand this logic or register both surface forms explicitly in the JSON.
const buildSurfaceFormMatcher = (
  normalizedSurfaceForm: string
): ((normalizedText: string) => boolean) => {
  if (!ALNUM_PATTERN.test(normalizedSurfaceForm)) {
    return (normalizedText) => normalizedText.includes(normalizedSurfaceForm);
  }

  const allowsPluralSuffix =
    !normalizedSurfaceForm.includes(" ") &&
    !normalizedSurfaceForm.endsWith("s");

  const core = escapeRegExp(normalizedSurfaceForm);
  const pattern = new RegExp(
    allowsPluralSuffix
      ? `(^|[^\\p{L}\\p{N}])${core}s?(?=$|[^\\p{L}\\p{N}])`
      : `(^|[^\\p{L}\\p{N}])${core}(?=$|[^\\p{L}\\p{N}])`,
    "u"
  );

  return (normalizedText) => pattern.test(normalizedText);
};

export const buildSurfaceFormLookup = <
  Entry extends {
    readonly normalizedSurfaceForm: string;
    readonly canonical: unknown;
  }
>(
  facet: string,
  entries: ReadonlyArray<Entry>
): Result.Result<SurfaceFormLookup<Entry>, VocabularyCollisionError> => {
  const canonicalIndex = buildVocabularyIndex(facet, entries);
  if (Result.isFailure(canonicalIndex)) {
    return Result.fail(canonicalIndex.failure);
  }

  const entryByNormalizedSurfaceForm = new Map<string, Entry>();
  for (const entry of entries) {
    if (!entryByNormalizedSurfaceForm.has(entry.normalizedSurfaceForm)) {
      entryByNormalizedSurfaceForm.set(entry.normalizedSurfaceForm, entry);
    }
  }

  const orderedEntries = [...entryByNormalizedSurfaceForm.values()].sort(
    (left, right) =>
      right.normalizedSurfaceForm.length - left.normalizedSurfaceForm.length ||
      left.normalizedSurfaceForm.localeCompare(right.normalizedSurfaceForm)
  );
  const orderedMatchers = orderedEntries.map((entry) => ({
    entry,
    matches: buildSurfaceFormMatcher(entry.normalizedSurfaceForm)
  }));

  return Result.succeed({
    canonicalByNormalizedSurfaceForm: canonicalIndex.success,
    entryByNormalizedSurfaceForm,
    orderedMatchers
  });
};

export const matchSurfaceForm = <
  Entry extends {
    readonly normalizedSurfaceForm: string;
    readonly canonical: unknown;
  }
>(
  lookup: SurfaceFormLookup<Entry>,
  text: string
): Option.Option<Entry> => {
  const normalizedText = normalizeLookupText(text);
  const exact = lookup.entryByNormalizedSurfaceForm.get(normalizedText);
  if (exact !== undefined) {
    return Option.some(exact);
  }

  return Option.fromNullishOr(
    lookup.orderedMatchers.find((matcher) => matcher.matches(normalizedText))?.entry
  );
};

export const matchAllSurfaceForms = <
  Entry extends {
    readonly normalizedSurfaceForm: string;
    readonly canonical: unknown;
  }
>(
  lookup: SurfaceFormLookup<Entry>,
  text: string
): ReadonlyArray<Entry> => {
  const normalizedText = normalizeLookupText(text);
  const exact = lookup.entryByNormalizedSurfaceForm.get(normalizedText);
  if (exact !== undefined) {
    return [exact];
  }

  return lookup.orderedMatchers
    .filter((matcher) => matcher.matches(normalizedText))
    .map((matcher) => matcher.entry);
};

export const parseSurfaceForm = <
  Entry extends {
    readonly normalizedSurfaceForm: string;
    readonly canonical: unknown;
  }
>(
  lookup: SurfaceFormLookup<Entry>,
  text: string
): Option.Option<Entry["canonical"]> =>
  Option.map(matchSurfaceForm(lookup, text), (entry) => entry.canonical);
