import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  mergeConceptSchemeTables,
  parseConceptSchemeTtl
} from "../../scripts/codegen/parseConceptSchemes";

describe("parseConceptSchemeTtl", () => {
  it.effect("extracts SKOS concepts and schemes from Turtle", () =>
    Effect.gen(function* () {
      const table = yield* parseConceptSchemeTtl(`
        @prefix ei-concept: <https://w3id.org/energy-intel/concept/> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix skos: <http://www.w3.org/2004/02/skos/core#> .

        ei-concept:solar a owl:NamedIndividual, skos:Concept ;
          rdfs:label "solar"@en ;
          skos:definition "Solar-based energy technology."@en ;
          skos:inScheme ei-concept:technology ;
          skos:narrower ei-concept:solar-pv ;
          skos:prefLabel "solar"@en ;
          skos:topConceptOf ei-concept:technology .

        ei-concept:solar-pv a owl:NamedIndividual, skos:Concept ;
          skos:broader ei-concept:solar ;
          skos:prefLabel "solar photovoltaic"@en .

        ei-concept:technology a owl:NamedIndividual, skos:ConceptScheme ;
          skos:definition "Technology scheme."@en ;
          skos:hasTopConcept ei-concept:solar ;
          skos:prefLabel "energy technology concepts"@en .
      `);

      expect(table.schemes).toEqual([
        {
          iri: "https://w3id.org/energy-intel/concept/technology",
          slug: "technology",
          label: "energy technology concepts",
          definition: "Technology scheme.",
          topConcepts: ["https://w3id.org/energy-intel/concept/solar"]
        }
      ]);
      expect(table.concepts).toEqual([
        {
          iri: "https://w3id.org/energy-intel/concept/solar",
          slug: "solar",
          label: "solar",
          altLabels: [],
          definition: "Solar-based energy technology.",
          inScheme: "https://w3id.org/energy-intel/concept/technology",
          topConcept: true,
          broader: [],
          narrower: ["https://w3id.org/energy-intel/concept/solar-pv"]
        },
        {
          iri: "https://w3id.org/energy-intel/concept/solar-pv",
          slug: "solar-pv",
          label: "solar photovoltaic",
          altLabels: [],
          topConcept: false,
          broader: ["https://w3id.org/energy-intel/concept/solar"],
          narrower: []
        }
      ]);
    })
  );

  it("dedupes merged concept tables by IRI", () => {
    const table = {
      concepts: [
        {
          iri: "https://w3id.org/energy-intel/concept/solar",
          slug: "solar",
          label: "solar",
          altLabels: [],
          topConcept: true,
          broader: [],
          narrower: []
        }
      ],
      schemes: []
    };

    expect(mergeConceptSchemeTables([table, table]).concepts).toHaveLength(1);
  });
});
