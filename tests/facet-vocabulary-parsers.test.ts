import { describe, expect, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import aggregationJson from "../references/vocabulary/aggregation.json";
import statisticTypeJson from "../references/vocabulary/statistic-type.json";
import technologyOrFuelJson from "../references/vocabulary/technology-or-fuel.json";
import unitFamilyJson from "../references/vocabulary/unit-family.json";
import {
  AggregationVocabulary,
  buildAggregationLookup,
  matchAggregation,
  parseAggregation
} from "../src/resolution/facetVocabulary/aggregation";
import {
  buildStatisticTypeLookup,
  matchStatisticType,
  parseStatisticType,
  StatisticTypeVocabulary
} from "../src/resolution/facetVocabulary/statisticType";
import {
  buildTechnologyOrFuelLookup,
  matchTechnologyOrFuel,
  parseTechnologyOrFuel,
  TechnologyOrFuelVocabulary
} from "../src/resolution/facetVocabulary/technologyOrFuel";
import {
  buildUnitFamilyLookup,
  matchUnitFamily,
  parseUnitFamily,
  UnitFamilyVocabulary
} from "../src/resolution/facetVocabulary/unitFamily";

const decodeStatisticTypeVocabulary = Schema.decodeUnknownSync(
  StatisticTypeVocabulary
);
const decodeAggregationVocabulary = Schema.decodeUnknownSync(AggregationVocabulary);
const decodeUnitFamilyVocabulary = Schema.decodeUnknownSync(UnitFamilyVocabulary);
const decodeTechnologyOrFuelVocabulary = Schema.decodeUnknownSync(
  TechnologyOrFuelVocabulary
);

const buildLookup = <A>(result: Result.Result<A, unknown>) => {
  if (Result.isFailure(result)) {
    throw result.failure;
  }

  return result.success;
};

const statisticTypeLookup = buildLookup(
  buildStatisticTypeLookup(decodeStatisticTypeVocabulary(statisticTypeJson))
);
const aggregationLookup = buildLookup(
  buildAggregationLookup(decodeAggregationVocabulary(aggregationJson))
);
const unitFamilyLookup = buildLookup(
  buildUnitFamilyLookup(decodeUnitFamilyVocabulary(unitFamilyJson))
);
const technologyOrFuelLookup = buildLookup(
  buildTechnologyOrFuelLookup(
    decodeTechnologyOrFuelVocabulary(technologyOrFuelJson)
  )
);

describe("facet vocabulary parsers", () => {
  it("decodes all four checked-in vocabularies", () => {
    expect(decodeStatisticTypeVocabulary(statisticTypeJson).length).toBeGreaterThan(
      0
    );
    expect(decodeAggregationVocabulary(aggregationJson).length).toBeGreaterThan(0);
    expect(decodeUnitFamilyVocabulary(unitFamilyJson).length).toBeGreaterThan(0);
    expect(
      decodeTechnologyOrFuelVocabulary(technologyOrFuelJson).length
    ).toBeGreaterThan(0);
  });

  it("parses statistic type from embedded surface forms", () => {
    expect(
      Option.getOrNull(parseStatisticType(statisticTypeLookup, "Installed wind capacity"))
    ).toBe("stock");
    expect(
      Option.getOrNull(
        matchStatisticType(statisticTypeLookup, "  INSTALLED   wind capacity  ")
      )?.surfaceForm
    ).toBe("installed");
  });

  it("parses aggregation and prefers longer surface forms", () => {
    expect(
      Option.getOrNull(parseAggregation(aggregationLookup, "annual total"))
    ).toBe("sum");
    expect(
      Option.getOrNull(matchAggregation(aggregationLookup, "annual total"))?.surfaceForm
    ).toBe("annual total");
  });

  it("parses unit families from inline symbols", () => {
    expect(
      Option.getOrNull(parseUnitFamily(unitFamilyLookup, "Output (MW)"))
    ).toBe("power");
    expect(
      Option.getOrNull(matchUnitFamily(unitFamilyLookup, "Price reached $/MWh"))?.canonical
    ).toBe("currency_per_energy");
  });

  it("parses technology or fuel and prefers the most specific surface form", () => {
    expect(
      Option.getOrNull(
        parseTechnologyOrFuel(
          technologyOrFuelLookup,
          "Offshore wind energy capacity additions"
        )
      )
    ).toBe("offshore wind");
    expect(
      Option.getOrNull(
        matchTechnologyOrFuel(
          technologyOrFuelLookup,
          "Offshore wind energy capacity additions"
        )
      )?.surfaceForm
    ).toBe("offshore wind energy");
  });

  it("returns Option.none for unrelated text", () => {
    expect(
      Option.isNone(parseStatisticType(statisticTypeLookup, "merit order stack"))
    ).toBe(true);
    expect(
      Option.isNone(parseTechnologyOrFuel(technologyOrFuelLookup, "merit order stack"))
    ).toBe(true);
  });
});
