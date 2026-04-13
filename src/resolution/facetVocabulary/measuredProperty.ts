import { Option, Result, Schema } from "effect";
import type { VocabularyCollisionError } from "../../domain/errors";
import { normalizeLookupText } from "../normalize";
import {
  buildSurfaceFormLookup,
  makeSurfaceFormEntry,
  matchSurfaceForm,
  type SurfaceFormLookup
} from "./SurfaceFormEntry";

export const MeasuredPropertySurfaceForm = makeSurfaceFormEntry(Schema.String);
export type MeasuredPropertySurfaceForm = Schema.Schema.Type<
  typeof MeasuredPropertySurfaceForm
>;

export const MeasuredPropertyVocabulary = Schema.Array(
  MeasuredPropertySurfaceForm
);
export type MeasuredPropertyVocabulary = Schema.Schema.Type<
  typeof MeasuredPropertyVocabulary
>;

export type MeasuredPropertyLookup =
  SurfaceFormLookup<MeasuredPropertySurfaceForm>;

export const buildMeasuredPropertyLookup = (
  entries: ReadonlyArray<MeasuredPropertySurfaceForm>
): Result.Result<MeasuredPropertyLookup, VocabularyCollisionError> =>
  buildSurfaceFormLookup("measured-property", entries);

// CD-008 cross-facet suppression list.
//
// These phrases mark the text as "about" a statistical transformation
// (price/share/count expressed as a compound). When any such phrase appears
// in the text, the measuredProperty match is suppressed entirely -- the
// statisticType facet owns the semantics and the measuredProperty stays
// attached to whatever underlying quantity the transformation operates on
// (inferred elsewhere in the pipeline).
//
// Longest-match-first within a single vocabulary cannot express this
// cross-facet rule; symmetric routing is maintained explicitly here.
// Compound-qualified forms added to
// references/vocabulary/statistic-type.json for the CD-008 dual-facet
// concepts should be mirrored in this list.
const CD008_COMPOUND_SUPPRESSORS: ReadonlyArray<string> = [
  // price (dual with sevocab:Price)
  "spot price",
  "strike price",
  "wholesale price",
  "contract price",
  "day-ahead price",
  "settlement price",
  "clearing price",
  "locational marginal price",
  "lmp",
  "lcoe",
  "levelized cost",
  // share (dual with sevocab:Share)
  "share of",
  "proportion of",
  "percent of total",
  "percentage",
  // count (dual with sevocab:Count)
  "number of",
  "tally"
];

const containsCompoundSuppressor = (normalizedText: string): boolean =>
  CD008_COMPOUND_SUPPRESSORS.some((phrase) => normalizedText.includes(phrase));

export const matchMeasuredProperty = (
  lookup: MeasuredPropertyLookup,
  text: string
): Option.Option<MeasuredPropertySurfaceForm> => {
  const matched = matchSurfaceForm(lookup, text);
  if (Option.isNone(matched)) {
    return matched;
  }

  const normalizedText = normalizeLookupText(text);
  if (containsCompoundSuppressor(normalizedText)) {
    return Option.none();
  }

  return matched;
};

export const parseMeasuredProperty = (
  lookup: MeasuredPropertyLookup,
  text: string
): Option.Option<string> =>
  Option.map(matchMeasuredProperty(lookup, text), (entry) => entry.canonical);
