import { Result, Schema } from "effect";
import {
  VocabularyCollisionError
} from "../../domain/errors";
import { IsoTimestamp } from "../../domain/types";
import { stringifyUnknown } from "../../platform/Json";

const NonEmptyString = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1))
);

export const SurfaceFormProvenance = Schema.Literals([
  "cold-start-corpus",
  "hand-curated",
  "oeo-derived",
  "ucum-derived",
  "agent-curated",
  "eval-feedback"
]);
export type SurfaceFormProvenance = Schema.Schema.Type<
  typeof SurfaceFormProvenance
>;

const NotesRequiredProvenances = new Set<SurfaceFormProvenance>([
  "agent-curated",
  "eval-feedback"
]);

const validateSurfaceFormEntry = (entry: {
  readonly provenance?: string;
  readonly notes?: string;
}) =>
  entry.provenance !== undefined &&
  NotesRequiredProvenances.has(entry.provenance as SurfaceFormProvenance) &&
  (entry.notes == null || entry.notes.length === 0)
    ? `notes are required when provenance is ${entry.provenance}`
    : undefined;

export const makeSurfaceFormEntry = <Canonical>(
  canonical: Schema.Decoder<Canonical> & Schema.Encoder<Canonical>
) =>
  Schema.Struct({
    surfaceForm: NonEmptyString,
    normalizedSurfaceForm: NonEmptyString,
    canonical,
    provenance: SurfaceFormProvenance,
    notes: Schema.optionalKey(NonEmptyString),
    addedAt: IsoTimestamp,
    source: Schema.optionalKey(NonEmptyString)
  }).pipe(Schema.check(Schema.makeFilter(validateSurfaceFormEntry)));

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
