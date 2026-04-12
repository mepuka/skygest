import { Effect, Layer, Result, Schema, ServiceMap } from "effect";
import aggregationJson from "../../../references/vocabulary/aggregation.json";
import statisticTypeJson from "../../../references/vocabulary/statistic-type.json";
import technologyOrFuelJson from "../../../references/vocabulary/technology-or-fuel.json";
import unitFamilyJson from "../../../references/vocabulary/unit-family.json";
import {
  VocabularyCollisionError,
  VocabularyLoadError
} from "../../domain/errors";
import {
  decodeUnknownEitherWith,
  formatSchemaParseError
} from "../../platform/Json";
import {
  AggregationSurfaceForm,
  AggregationVocabulary,
  buildAggregationLookup,
  matchAggregation,
  parseAggregation,
  type AggregationLookup,
} from "./aggregation";
import {
  buildStatisticTypeLookup,
  matchStatisticType,
  parseStatisticType,
  StatisticTypeSurfaceForm,
  StatisticTypeVocabulary,
  type StatisticTypeLookup
} from "./statisticType";
import {
  buildTechnologyOrFuelLookup,
  matchTechnologyOrFuel,
  parseTechnologyOrFuel,
  TechnologyOrFuelSurfaceForm,
  TechnologyOrFuelVocabulary,
  type TechnologyOrFuelLookup
} from "./technologyOrFuel";
import {
  buildUnitFamilyLookup,
  matchUnitFamily,
  parseUnitFamily,
  UnitFamilySurfaceForm,
  UnitFamilyVocabulary,
  type UnitFamilyLookup
} from "./unitFamily";

const VOCABULARY_PATHS = {
  statisticType: "references/vocabulary/statistic-type.json",
  aggregation: "references/vocabulary/aggregation.json",
  unitFamily: "references/vocabulary/unit-family.json",
  technologyOrFuel: "references/vocabulary/technology-or-fuel.json"
} as const;

export type FacetVocabularyJsonSources = {
  readonly statisticType: unknown;
  readonly aggregation: unknown;
  readonly unitFamily: unknown;
  readonly technologyOrFuel: unknown;
};

const DEFAULT_VOCABULARY_JSON_SOURCES: FacetVocabularyJsonSources = {
  statisticType: statisticTypeJson,
  aggregation: aggregationJson,
  unitFamily: unitFamilyJson,
  technologyOrFuel: technologyOrFuelJson
};

const decodeVocabulary = <S extends Schema.Decoder<unknown>>(
  facet: string,
  path: string,
  schema: S,
  json: unknown
): Effect.Effect<S["Type"], VocabularyLoadError> => {
  const decoded = decodeUnknownEitherWith(schema)(json);
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new VocabularyLoadError({
        facet,
        path,
        issues: [formatSchemaParseError(decoded.failure)]
      })
    );
  }

  return Effect.succeed(decoded.success);
};

const buildLookup = <A>(
  lookup: Result.Result<A, VocabularyCollisionError>
): Effect.Effect<A, VocabularyCollisionError | VocabularyLoadError> =>
  Result.isFailure(lookup)
    ? Effect.fail(lookup.failure)
    : Effect.succeed(lookup.success);

export type FacetVocabularyShape = {
  readonly parseStatisticType: (
    text: string
  ) => ReturnType<typeof parseStatisticType>;
  readonly matchStatisticType: (
    text: string
  ) => ReturnType<typeof matchStatisticType>;
  readonly parseAggregation: (text: string) => ReturnType<typeof parseAggregation>;
  readonly matchAggregation: (text: string) => ReturnType<typeof matchAggregation>;
  readonly parseUnitFamily: (text: string) => ReturnType<typeof parseUnitFamily>;
  readonly matchUnitFamily: (text: string) => ReturnType<typeof matchUnitFamily>;
  readonly parseTechnologyOrFuel: (
    text: string
  ) => ReturnType<typeof parseTechnologyOrFuel>;
  readonly matchTechnologyOrFuel: (
    text: string
  ) => ReturnType<typeof matchTechnologyOrFuel>;
};

type FacetVocabularyLookups = {
  readonly statisticType: StatisticTypeLookup;
  readonly aggregation: AggregationLookup;
  readonly unitFamily: UnitFamilyLookup;
  readonly technologyOrFuel: TechnologyOrFuelLookup;
};

const makeFacetVocabulary = (
  lookups: FacetVocabularyLookups
): FacetVocabularyShape => ({
  parseStatisticType: (text) => parseStatisticType(lookups.statisticType, text),
  matchStatisticType: (text) => matchStatisticType(lookups.statisticType, text),
  parseAggregation: (text) => parseAggregation(lookups.aggregation, text),
  matchAggregation: (text) => matchAggregation(lookups.aggregation, text),
  parseUnitFamily: (text) => parseUnitFamily(lookups.unitFamily, text),
  matchUnitFamily: (text) => matchUnitFamily(lookups.unitFamily, text),
  parseTechnologyOrFuel: (text) =>
    parseTechnologyOrFuel(lookups.technologyOrFuel, text),
  matchTechnologyOrFuel: (text) =>
    matchTechnologyOrFuel(lookups.technologyOrFuel, text)
});

export const loadFacetVocabularyLookups = (
  sources: FacetVocabularyJsonSources = DEFAULT_VOCABULARY_JSON_SOURCES
): Effect.Effect<
  FacetVocabularyLookups,
  VocabularyCollisionError | VocabularyLoadError
> =>
  Effect.gen(function* () {
    const statisticTypeEntries = yield* decodeVocabulary(
      "statistic-type",
      VOCABULARY_PATHS.statisticType,
      StatisticTypeVocabulary,
      sources.statisticType
    );
    const aggregationEntries = yield* decodeVocabulary(
      "aggregation",
      VOCABULARY_PATHS.aggregation,
      AggregationVocabulary,
      sources.aggregation
    );
    const unitFamilyEntries = yield* decodeVocabulary(
      "unit-family",
      VOCABULARY_PATHS.unitFamily,
      UnitFamilyVocabulary,
      sources.unitFamily
    );
    const technologyOrFuelEntries = yield* decodeVocabulary(
      "technology-or-fuel",
      VOCABULARY_PATHS.technologyOrFuel,
      TechnologyOrFuelVocabulary,
      sources.technologyOrFuel
    );

    return {
      statisticType: yield* buildLookup(
        buildStatisticTypeLookup(statisticTypeEntries)
      ),
      aggregation: yield* buildLookup(
        buildAggregationLookup(aggregationEntries)
      ),
      unitFamily: yield* buildLookup(
        buildUnitFamilyLookup(unitFamilyEntries)
      ),
      technologyOrFuel: yield* buildLookup(
        buildTechnologyOrFuelLookup(technologyOrFuelEntries)
      )
    };
  });

export class FacetVocabulary extends ServiceMap.Service<
  FacetVocabulary,
  FacetVocabularyShape
>()("@skygest/FacetVocabulary") {
  static readonly layer = Layer.effect(
    FacetVocabulary,
    Effect.map(loadFacetVocabularyLookups(), (lookups) =>
      FacetVocabulary.of(makeFacetVocabulary(lookups))
    )
  );
}

export const makeFacetVocabularyLayer = (
  sources: FacetVocabularyJsonSources = DEFAULT_VOCABULARY_JSON_SOURCES
) =>
  Layer.effect(
    FacetVocabulary,
    Effect.map(loadFacetVocabularyLookups(sources), (lookups) =>
      FacetVocabulary.of(makeFacetVocabulary(lookups))
    )
  );

export type {
  AggregationLookup,
  StatisticTypeLookup,
  TechnologyOrFuelLookup,
  UnitFamilyLookup
};

export {
  parseAggregation,
  matchAggregation,
  parseStatisticType,
  matchStatisticType,
  parseTechnologyOrFuel,
  matchTechnologyOrFuel,
  parseUnitFamily,
  matchUnitFamily,
  AggregationSurfaceForm,
  AggregationVocabulary,
  StatisticTypeSurfaceForm,
  StatisticTypeVocabulary,
  TechnologyOrFuelSurfaceForm,
  TechnologyOrFuelVocabulary,
  UnitFamilySurfaceForm,
  UnitFamilyVocabulary
};
