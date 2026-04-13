import { Result, Schema } from "effect";
import {
  Aggregation,
  StatisticType,
  UnitFamily
} from "../../domain/data-layer/variable";
import {
  VocabularyCollisionError,
  VocabularyLoadError
} from "../../domain/errors";
import { makeSurfaceFormEntry } from "../../domain/surfaceForm";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../../platform/Json";
import { normalizeLookupText } from "../normalize";
import { CompoundSurfaceFormEntry } from "./compoundConcepts";
import { buildVocabularyIndex } from "./SurfaceFormEntry";

type VocabularyEntryCodec = Schema.Codec<any, any, never, never>;

export type VocabularyFacetDescriptor = {
  readonly facet: string;
  readonly filename: string;
  readonly codec: VocabularyEntryCodec;
};

export const VOCABULARY_FACETS: ReadonlyArray<VocabularyFacetDescriptor> = [
  {
    facet: "statistic-type",
    filename: "statistic-type.json",
    codec: makeSurfaceFormEntry(StatisticType)
  },
  {
    facet: "aggregation",
    filename: "aggregation.json",
    codec: makeSurfaceFormEntry(Aggregation)
  },
  {
    facet: "unit-family",
    filename: "unit-family.json",
    codec: makeSurfaceFormEntry(UnitFamily)
  },
  {
    facet: "technology-or-fuel",
    filename: "technology-or-fuel.json",
    codec: makeSurfaceFormEntry(Schema.String)
  },
  {
    facet: "measured-property",
    filename: "measured-property.json",
    codec: makeSurfaceFormEntry(Schema.String)
  },
  {
    facet: "domain-object",
    filename: "domain-object.json",
    codec: makeSurfaceFormEntry(Schema.String)
  },
  {
    facet: "policy-instrument",
    filename: "policy-instrument.json",
    codec: makeSurfaceFormEntry(Schema.String)
  },
  // Compound concepts use a distinct entry shape (per-facet assignments
  // object instead of a single `canonical`). They reuse the same validate →
  // sync pipeline by exposing a compatible codec; the collision-detection
  // step operates on the stringified assignments object which is the
  // correct behaviour — two compound entries with the same normalized
  // surface form but different facet assignments is a curation bug.
  {
    facet: "compound-concepts",
    filename: "compound-concepts.json",
    codec: CompoundSurfaceFormEntry
  }
];

export type VocabularyValidationOk = {
  readonly facet: string;
  readonly filename: string;
  readonly entryCount: number;
};

const formatNormalizationIssue = (
  surfaceForm: string,
  normalizedSurfaceForm: string
) => {
  const expected = normalizeLookupText(surfaceForm);
  return `"${surfaceForm}": normalizedSurfaceForm is "${normalizedSurfaceForm}" but resolver expects "${expected}"`;
};

export const validateVocabularyJson = (
  descriptor: VocabularyFacetDescriptor,
  jsonString: string
): Result.Result<
  VocabularyValidationOk,
  VocabularyLoadError | VocabularyCollisionError
> => {
  const decode = decodeJsonStringEitherWith(Schema.Array(descriptor.codec));
  const decoded = decode(jsonString);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      new VocabularyLoadError({
        facet: descriptor.facet,
        path: descriptor.filename,
        issues: [formatSchemaParseError(decoded.failure)]
      })
    );
  }

  const normalizationIssues = decoded.success.flatMap((entry) =>
    entry.normalizedSurfaceForm === normalizeLookupText(entry.surfaceForm)
      ? []
      : [formatNormalizationIssue(entry.surfaceForm, entry.normalizedSurfaceForm)]
  );

  if (normalizationIssues.length > 0) {
    return Result.fail(
      new VocabularyLoadError({
        facet: descriptor.facet,
        path: descriptor.filename,
        issues: normalizationIssues
      })
    );
  }

  // Compound entries expose their per-facet payload as `assignments`, not
  // `canonical`. Project them into the shape the index builder expects so
  // collision detection still runs (two entries with the same normalized
  // surface form but different assignments is a curation bug).
  const indexEntries = decoded.success.map((entry: any) => ({
    normalizedSurfaceForm: entry.normalizedSurfaceForm,
    canonical:
      entry.canonical ?? stringifyUnknown(entry.assignments ?? entry)
  }));
  const indexResult = buildVocabularyIndex(descriptor.facet, indexEntries);
  if (Result.isFailure(indexResult)) {
    return Result.fail(indexResult.failure);
  }

  return Result.succeed({
    facet: descriptor.facet,
    filename: descriptor.filename,
    entryCount: decoded.success.length
  });
};
