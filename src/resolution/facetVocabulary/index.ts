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

const decodeVocabulary = <A>(
  facet: string,
  path: string,
  schema: Schema.Schema<ReadonlyArray<A>>,
  json: unknown
): Effect.Effect<ReadonlyArray<A>, VocabularyLoadError> => {
  const decoded = decodeUnknownEitherWith(
    schema as unknown as Schema.Decoder<unknown>
  )(json) as Result.Result<ReadonlyArray<A>, unknown>;
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      new VocabularyLoadError({
        facet,
        path,
        issues: [formatSchemaParseError(decoded.failure as any)]
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

type LoadedLookups = {
  readonly statisticType: StatisticTypeLookup;
  readonly aggregation: AggregationLookup;
  readonly unitFamily: UnitFamilyLookup;
  readonly technologyOrFuel: TechnologyOrFuelLookup;
};

const loadLookups = () =>
  Effect.gen(function* () {
  const statisticTypeEntries = yield* decodeVocabulary(
    "statistic-type",
    VOCABULARY_PATHS.statisticType,
    StatisticTypeVocabulary,
    statisticTypeJson
  );
  const aggregationEntries = yield* decodeVocabulary(
    "aggregation",
    VOCABULARY_PATHS.aggregation,
    AggregationVocabulary,
    aggregationJson
  );
  const unitFamilyEntries = yield* decodeVocabulary(
    "unit-family",
    VOCABULARY_PATHS.unitFamily,
    UnitFamilyVocabulary,
    unitFamilyJson
  );
  const technologyOrFuelEntries = yield* decodeVocabulary(
    "technology-or-fuel",
    VOCABULARY_PATHS.technologyOrFuel,
    TechnologyOrFuelVocabulary,
    technologyOrFuelJson
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
    Effect.gen(function* () {
      const lookups = yield* loadLookups();

      return FacetVocabulary.of({
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
    })
  );
}

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
