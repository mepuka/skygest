import { Result, Schema } from "effect";
import {
  makeSurfaceFormEntry,
  SurfaceFormEntryAny,
  SurfaceFormProvenance
} from "../../domain/surfaceForm";
import {
  VocabularyCollisionError
} from "../../domain/errors";
import { stringifyUnknown } from "../../platform/Json";
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
