import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";

describe("CD-008 price/share/count surface-form routing", () => {
  it.effect("routes unqualified 'price' to measuredProperty only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("retail electricity prices");
      const st = vocab.matchStatisticType("retail electricity prices");
      expect(Option.getOrUndefined(mp)?.canonical).toBe("price");
      expect(Option.isNone(st)).toBe(true);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes compound 'spot price' to statisticType only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("day-ahead spot price");
      const st = vocab.matchStatisticType("day-ahead spot price");
      expect(Option.isNone(mp)).toBe(true);
      expect(Option.getOrUndefined(st)?.canonical).toBe("price");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes unqualified 'share' to measuredProperty only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("market share by region");
      expect(Option.getOrUndefined(mp)?.canonical).toBe("share");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes compound 'share of X' to statisticType only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("share of new installations");
      const st = vocab.matchStatisticType("share of new installations");
      expect(Option.isNone(mp)).toBe(true);
      expect(Option.getOrUndefined(st)?.canonical).toBe("share");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("does not substring-match 'price' inside unrelated words", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      // Word-boundary discipline: "enterprise" contains "prise" not "price",
      // so no match. This is a regression fence for the matcher change.
      const mp = vocab.matchMeasuredProperty("enterprise value creation");
      expect(Option.isNone(mp)).toBe(true);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});
