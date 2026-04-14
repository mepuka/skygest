import { describe, expect, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";
import { CompoundSurfaceFormEntry } from "../src/resolution/facetVocabulary/compoundConcepts";

// SKIPPED: compound concepts are part of the facet vocabulary shelf, deprecated under SKY-348 (OEO + prompt-layer extraction).
describe.skip("CompoundSurfaceFormEntry schema", () => {
  it("decodes a minimal hand-curated entry", () => {
    const decoded = Schema.decodeUnknownSync(CompoundSurfaceFormEntry)({
      surfaceForm: "spot price",
      normalizedSurfaceForm: "spot price",
      assignments: {
        measuredProperty: "price",
        statisticType: "price"
      },
      provenance: "hand-curated",
      addedAt: "2026-04-12T00:00:00.000Z"
    });

    expect(decoded.surfaceForm).toBe("spot price");
    expect(decoded.assignments.measuredProperty).toBe("price");
    expect(decoded.assignments.statisticType).toBe("price");
  });

  it("rejects an entry whose statisticType is not a closed-enum value", () => {
    const decode = Schema.decodeUnknownResult(CompoundSurfaceFormEntry);
    const result = decode({
      surfaceForm: "bogus",
      normalizedSurfaceForm: "bogus",
      assignments: {
        // 'spot' is NOT a StatisticType enum member
        statisticType: "spot"
      },
      provenance: "hand-curated",
      addedAt: "2026-04-12T00:00:00.000Z"
    });

    expect(Result.isFailure(result)).toBe(true);
  });
});

describe.skip("matchCompoundConcepts", () => {
  it.effect("returns the compound entry for 'spot price' with statisticType=price (no measuredProperty per CD-008)", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const matches = vocab.matchCompoundConcepts(
        "day-ahead spot price on the interconnector"
      );
      expect(matches.length).toBeGreaterThan(0);
      const spot = matches.find(
        (match) => match.entry.surfaceForm === "spot price"
      );
      expect(spot).toBeDefined();
      // CD-008: price-compound surface forms are statistical transformations,
      // not measuredProperty assignments. The underlying measuredProperty is
      // whatever the price is priced in (e.g. energy, capacity) and is not
      // pinned by the compound itself.
      expect(spot?.assignments.measuredProperty).toBeUndefined();
      expect(spot?.assignments.statisticType).toBe("price");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("fires 'battery price spread' with measuredProperty=price + technologyOrFuel=battery", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const matches = vocab.matchCompoundConcepts(
        "Battery price spreads rose sharply in March"
      );
      expect(matches.length).toBeGreaterThan(0);
      const entry = matches[0];
      expect(entry?.assignments.measuredProperty).toBe("price");
      expect(entry?.assignments.technologyOrFuel).toBe("battery");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("returns no compound match for plain narrative prose", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const matches = vocab.matchCompoundConcepts(
        "renewable capacity additions year over year"
      );
      expect(matches).toHaveLength(0);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("prefers longer compound 'wholesale electricity price' over 'wholesale price'", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const matches = vocab.matchCompoundConcepts(
        "wholesale electricity price trends"
      );
      // Longest-first ordering guarantees the 3-facet entry is first.
      const first = matches[0];
      expect(first?.entry.surfaceForm).toBe("wholesale electricity price");
      expect(first?.assignments.domainObject).toBe("electricity");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});

describe.skip("interpret — compound precedence over per-facet matches", () => {
  it.effect(
    "compound 'spot price' suppresses per-facet matches on the same chart title",
    () =>
      Effect.gen(function* () {
        const vocab = yield* FacetVocabulary;

        // Per-facet would normally fire measuredProperty via the price
        // lexicon OR statisticType via the CD-008 "spot price" reroute.
        // With the compound active, matchSite short-circuits and returns
        // the compound's assignments verbatim. Per CD-008, the spot-price
        // compound pins only statisticType=price; measuredProperty is left
        // open so the underlying priced quantity is not overwritten.
        const { interpretBundle } = yield* Effect.promise(() =>
          import("../src/resolution/kernel/Interpret")
        );

        const bundle = {
          postUri: "test://compound-precedence",
          assetKey: "test:spot-price",
          postText: [],
          chartTitle: "Electricity spot price",
          xAxis: { label: null, unit: null },
          yAxis: { label: null, unit: null },
          series: [],
          keyFindings: [],
          sourceLines: [],
          publisherHints: [],
          temporalCoverage: { startDate: null, endDate: null }
        } as const;

        const outcome = interpretBundle(bundle as any, vocab);
        expect(outcome._tag).toBe("Hypothesis");
        if (outcome._tag !== "Hypothesis") return;
        expect(outcome.hypothesis.sharedPartial.measuredProperty).toBeUndefined();
        expect(outcome.hypothesis.sharedPartial.statisticType).toBe("price");
      }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect(
    "compound 'battery spread' pins price + battery on a noisy chart title",
    () =>
      Effect.gen(function* () {
        const vocab = yield* FacetVocabulary;
        const { interpretBundle } = yield* Effect.promise(() =>
          import("../src/resolution/kernel/Interpret")
        );

        const bundle = {
          postUri: "test://battery-spread",
          assetKey: "test:battery-spread",
          postText: [],
          chartTitle: "Battery spreads rose sharply in March",
          xAxis: { label: null, unit: null },
          yAxis: { label: null, unit: null },
          series: [],
          keyFindings: [],
          sourceLines: [],
          publisherHints: [],
          temporalCoverage: { startDate: null, endDate: null }
        } as const;

        const outcome = interpretBundle(bundle as any, vocab);
        expect(outcome._tag).toBe("Hypothesis");
        if (outcome._tag !== "Hypothesis") return;
        expect(outcome.hypothesis.sharedPartial.measuredProperty).toBe("price");
        expect(outcome.hypothesis.sharedPartial.technologyOrFuel).toBe("battery");
      }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});
