import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { OntologyCatalog } from "../src/services/OntologyCatalog";

describe("ontology catalog", () => {
  it.effect("matches preferred and alternate labels deterministically", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match(
        "Photovoltaic battery storage is expanding on the electric grid.",
        ["Transmission planning remains the bottleneck."]
      );

      expect(matches).toEqual([
        { topicSlug: "solar", matchedTerm: "photovoltaic" },
        { topicSlug: "energy-storage", matchedTerm: "battery storage" },
        { topicSlug: "grid-and-infrastructure", matchedTerm: "grid" }
      ]);
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );
});
