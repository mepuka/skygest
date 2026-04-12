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
  formatSchemaParseError
} from "../../platform/Json";
import { normalizeLookupText } from "../normalize";
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

  const indexResult = buildVocabularyIndex(descriptor.facet, decoded.success);
  if (Result.isFailure(indexResult)) {
    return Result.fail(indexResult.failure);
  }

  return Result.succeed({
    facet: descriptor.facet,
    filename: descriptor.filename,
    entryCount: decoded.success.length
  });
};
