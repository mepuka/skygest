import { Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import {
  PARTIAL_VARIABLE_FIELDS,
  type PartialVariableShape
} from "../../domain/partialVariableAlgebra";
import { IsoTimestamp } from "../../domain/types";
import { SurfaceFormProvenance } from "../../domain/surfaceForm";
import { normalizeLookupText } from "../normalize";
import {
  buildSurfaceFormLookup,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

// Compound concepts represent surface forms that legitimately span multiple
// facets at once. Per the 2026-04-12 algebra review (Gap 2), phrases like
// "spot price" or "battery price spread" are single lexical units that carry
// two or three facet assignments simultaneously — a shape the per-facet
// lexicon structurally cannot represent (one JSON file per facet, one
// canonical per entry).
//
// The compound lexicon is an additional matcher that runs BEFORE per-facet
// matchers on an identity site. When a compound fires, its assignments are
// unioned into the site's partial and per-facet matching on the same site
// is short-circuited — the compound is authoritative for that site.
//
// Overlap resolution: the underlying surface-form lookup orders matchers
// longest-first, so "wholesale electricity price" wins over "wholesale
// price" on the same text. When multiple distinct compound entries still
// match (non-overlapping, or overlapping but equally long), ALL of them
// contribute assignments and they are joined by the normal
// `joinPartials` fold downstream.

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

// The assignments shape is exactly the kernel's PartialVariableShape — every
// facet is optional, and closed-enum facets (statisticType, aggregation,
// unitFamily) are validated against their literal members so the lexicon
// cannot drift from the kernel's value partition.
export const CompoundConceptAssignments = Schema.Struct(
  PARTIAL_VARIABLE_FIELDS
).annotate({
  description:
    "Compound concept facet assignments — validated against the kernel's PartialVariableShape"
});
export type CompoundConceptAssignments = Schema.Schema.Type<
  typeof CompoundConceptAssignments
>;

export const CompoundSurfaceFormEntry = Schema.Struct({
  surfaceForm: NonEmptyString,
  normalizedSurfaceForm: NonEmptyString,
  assignments: CompoundConceptAssignments,
  provenance: SurfaceFormProvenance,
  notes: Schema.optionalKey(NonEmptyString),
  addedAt: IsoTimestamp,
  source: Schema.optionalKey(NonEmptyString)
}).annotate({
  description:
    "Compound surface-form entry: one surface form that carries multiple facet assignments"
});
export type CompoundSurfaceFormEntry = Schema.Schema.Type<
  typeof CompoundSurfaceFormEntry
>;

export const CompoundConceptsVocabulary = Schema.Array(CompoundSurfaceFormEntry);
export type CompoundConceptsVocabulary = Schema.Schema.Type<
  typeof CompoundConceptsVocabulary
>;

// SurfaceFormLookup requires an entry to expose `canonical`. Compound entries
// carry `assignments` instead; we project onto a structural row type that
// reuses the same lookup machinery (longest-first matcher, word-boundary
// matching, collision detection) without duplicating code.
export type CompoundConceptLookupEntry = {
  readonly surfaceForm: string;
  readonly normalizedSurfaceForm: string;
  readonly canonical: CompoundConceptAssignments;
  readonly notes?: string;
};

export type CompoundConceptsLookup = SurfaceFormLookup<CompoundConceptLookupEntry>;

const toLookupEntry = (
  entry: CompoundSurfaceFormEntry
): CompoundConceptLookupEntry => ({
  surfaceForm: entry.surfaceForm,
  normalizedSurfaceForm: entry.normalizedSurfaceForm,
  canonical: entry.assignments,
  ...(entry.notes !== undefined ? { notes: entry.notes } : {})
});

export const buildCompoundConceptsLookup = (
  entries: ReadonlyArray<CompoundSurfaceFormEntry>
): Result.Result<CompoundConceptsLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("compound-concepts", entries.map(toLookupEntry));

export type CompoundConceptMatch = {
  readonly entry: CompoundConceptLookupEntry;
  readonly assignments: PartialVariableShape;
};

// Returns every compound concept whose normalized surface form appears in
// the given text, preserving longest-first order from the underlying
// lookup. An empty array means no compound fired and the caller should fall
// through to per-facet matching.
export const matchCompoundConcepts = (
  lookup: CompoundConceptsLookup,
  text: string
): ReadonlyArray<CompoundConceptMatch> => {
  const normalizedText = normalizeLookupText(text);
  const exact = lookup.entryByNormalizedSurfaceForm.get(normalizedText);
  if (exact !== undefined) {
    return [{ entry: exact, assignments: exact.canonical }];
  }

  const matches: Array<CompoundConceptMatch> = [];
  for (const matcher of lookup.orderedMatchers) {
    if (matcher.matches(normalizedText)) {
      matches.push({
        entry: matcher.entry,
        assignments: matcher.entry.canonical
      });
    }
  }
  return matches;
};
