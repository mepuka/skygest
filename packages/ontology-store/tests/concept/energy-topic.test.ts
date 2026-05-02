import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  EnergyTopic,
  EnergyTopicUnifiedProjection,
  energyTopicFromTriples,
  energyTopicToTriples
} from "../../src/concept/energy-topic";

const sampleTopic = (): EnergyTopic =>
  Schema.decodeUnknownSync(EnergyTopic)({
    iri: "http://example.org/ontology/energy-news#Hydrogen",
    slug: "Hydrogen",
    label: "hydrogen",
    altLabels: ["green hydrogen", "H2"],
    description: "A skos:Concept representing hydrogen as an energy carrier.",
    canonicalTopicSlug: "hydrogen",
    topConcept: true,
    broaderSlugs: [],
    narrowerSlugs: ["FuelCell", "GreenHydrogen"]
  });

describe("EnergyTopic", () => {
  it("round-trips through RDF as an EnergyTopic SKOS concept", async () => {
    const topic = sampleTopic();
    const triples = energyTopicToTriples(topic);
    const decoded = await Effect.runPromise(
      energyTopicFromTriples(triples, topic.iri)
    );

    expect(decoded).toEqual(topic);
    expect(
      triples.some(
        (quad) =>
          quad.predicate.value ===
            "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
          quad.object.value ===
            "http://example.org/ontology/energy-news#EnergyTopic"
      )
    ).toBe(true);
    expect(
      triples.some(
        (quad) =>
          quad.predicate.value ===
            "http://www.w3.org/2004/02/skos/core#narrower" &&
          quad.object.value ===
            "http://example.org/ontology/energy-news#FuelCell"
      )
    ).toBe(true);
  });

  it("projects to the unified search metadata shape", () => {
    const metadata = EnergyTopicUnifiedProjection.toMetadata(sampleTopic());

    expect(Object.keys(metadata).sort()).toEqual([
      "authority",
      "entity_type",
      "iri",
      "time_bucket",
      "topic"
    ]);
    expect(metadata.entity_type).toBe("EnergyTopic");
    expect(metadata.topic).toBe("hydrogen");
    expect(metadata.authority).toBe("ontology");
  });
});
