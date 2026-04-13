import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import aggregationJson from "../references/vocabulary/aggregation.json";
import compoundConceptsJson from "../references/vocabulary/compound-concepts.json";
import domainObjectJson from "../references/vocabulary/domain-object.json";
import measuredPropertyJson from "../references/vocabulary/measured-property.json";
import policyInstrumentJson from "../references/vocabulary/policy-instrument.json";
import technologyOrFuelJson from "../references/vocabulary/technology-or-fuel.json";
import unitFamilyJson from "../references/vocabulary/unit-family.json";
import {
  FacetVocabulary,
  makeFacetVocabularyLayer
} from "../src/resolution/facetVocabulary";

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

  it.effect("fails fast when a vocabulary file is malformed", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        yield* FacetVocabulary;
      }).pipe(
        Effect.provide(
          makeFacetVocabularyLayer({
            statisticType: [
              {
                normalizedSurfaceForm: "generation",
                canonical: "flow"
              }
            ],
            aggregation: aggregationJson,
            unitFamily: unitFamilyJson,
            technologyOrFuel: technologyOrFuelJson,
            measuredProperty: measuredPropertyJson,
            domainObject: domainObjectJson,
            policyInstrument: policyInstrumentJson,
            compoundConcepts: compoundConceptsJson
          })
        ),
        Effect.flip
      );

      expect(error._tag).toBe("VocabularyLoadError");
      if (error._tag === "VocabularyLoadError") {
        expect(error.facet).toBe("statistic-type");
        expect(error.path).toBe("references/vocabulary/statistic-type.json");
      }
    })
  );

  it.effect("fails fast when a vocabulary file contains conflicting duplicates", () =>
    Effect.gen(function* () {
      const error = yield* Effect.gen(function* () {
        yield* FacetVocabulary;
      }).pipe(
        Effect.provide(
          makeFacetVocabularyLayer({
            statisticType: [
              {
                surfaceForm: "generation",
                normalizedSurfaceForm: "generation",
                canonical: "flow",
                provenance: "cold-start-corpus",
                addedAt: "2026-04-11T00:00:00.000Z"
              },
              {
                surfaceForm: "generation",
                normalizedSurfaceForm: "generation",
                canonical: "stock",
                provenance: "cold-start-corpus",
                addedAt: "2026-04-11T00:00:00.000Z"
              }
            ],
            aggregation: aggregationJson,
            unitFamily: unitFamilyJson,
            technologyOrFuel: technologyOrFuelJson,
            measuredProperty: measuredPropertyJson,
            domainObject: domainObjectJson,
            policyInstrument: policyInstrumentJson,
            compoundConcepts: compoundConceptsJson
          })
        ),
        Effect.flip
      );

      expect(error._tag).toBe("VocabularyCollisionError");
      if (error._tag === "VocabularyCollisionError") {
        expect(error.facet).toBe("statistic-type");
        expect(error.normalizedSurfaceForm).toBe("generation");
      }
    })
  );
});
