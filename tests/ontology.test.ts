import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { OntologyCatalog } from "../src/services/OntologyCatalog";

describe("ontology catalog", () => {
  it.effect("matches preferred and alternate labels deterministically", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const matches = yield* ontology.match({
        text: "Photovoltaic battery storage is expanding on the electric grid.",
        metadataTexts: ["Transmission planning remains the bottleneck."]
      });

      expect(matches.map((match) => match.topicSlug)).toEqual([
        "energy-storage",
        "grid-and-infrastructure",
        "solar"
      ]);
      expect(matches.find((match) => match.topicSlug === "solar")?.matchedTerm).toBe("photovoltaic");
      expect(matches.find((match) => match.topicSlug === "energy-storage")?.matchScore).toBe(2);
      expect(matches.find((match) => match.topicSlug === "grid-and-infrastructure")?.matchSignal).toBe("term");
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );

  it.effect("lists curated facets and expands structural concepts to canonical topics", () =>
    Effect.gen(function* () {
      const ontology = yield* OntologyCatalog;
      const facets = yield* ontology.listTopics("facets");
      const concepts = yield* ontology.listTopics("concepts");
      const expanded = yield* ontology.expandTopics(["Renewable"], "descendants");

      expect(facets).toHaveLength(30);
      expect(concepts).toHaveLength(92);
      expect(facets.some((item) => item.slug === "energy-justice")).toBe(true);
      expect(expanded.canonicalTopicSlugs).toEqual([
        "geothermal",
        "hydro",
        "offshore-wind",
        "solar",
        "wind"
      ]);
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );
});
