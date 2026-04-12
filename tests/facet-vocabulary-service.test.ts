import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";

describe("FacetVocabulary", () => {
  it.effect("loads the checked-in vocabularies and resolves seeded examples", () =>
    Effect.gen(function* () {
      const vocabulary = yield* FacetVocabulary;

      expect(
        Option.getOrNull(vocabulary.parseStatisticType("Installed wind capacity"))
      ).toBe("stock");
      expect(
        Option.getOrNull(vocabulary.parseAggregation("year-end installed wind capacity"))
      ).toBe("end_of_period");
      expect(Option.getOrNull(vocabulary.parseUnitFamily("Output (MW)"))).toBe(
        "power"
      );
      expect(
        Option.getOrNull(
          vocabulary.parseTechnologyOrFuel(
            "Offshore wind energy capacity additions"
          )
        )
      ).toBe("offshore wind");
      expect(
        Option.getOrNull(
          vocabulary.matchTechnologyOrFuel(
            "Offshore wind energy capacity additions"
          )
        )?.surfaceForm
      ).toBe("offshore wind energy");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});
