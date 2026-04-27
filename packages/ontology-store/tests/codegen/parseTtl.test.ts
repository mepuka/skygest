import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { parseTtlToClassTable } from "../../scripts/codegen/parseTtl";

describe("parseTtlToClassTable", () => {
  it.effect("emits Expert class with foaf:Person + role-bearer pattern", () =>
    Effect.gen(function* () {
      const ttl = `
        @prefix ei: <https://w3id.org/energy-intel/> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix bfo: <http://purl.obolibrary.org/obo/BFO_> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .
        @prefix skos: <http://www.w3.org/2004/02/skos/core#> .

        ei:Expert a owl:Class ;
          rdfs:label "Expert"@en ;
          owl:disjointWith ei:Organization ;
          skos:definition "An energy expert."@en ;
          owl:equivalentClass [
            a owl:Class ;
            owl:intersectionOf (
              foaf:Person
              [
                a owl:Restriction ;
                owl:onProperty bfo:0000053 ;
                owl:someValuesFrom ei:EnergyExpertRole
              ]
            )
          ] .

        ei:Organization a owl:Class ;
          rdfs:label "Organization"@en .

        ei:EnergyExpertRole a owl:Class ;
          rdfs:label "energy expert role"@en ;
          rdfs:subClassOf bfo:0000023 .
      `;
      const table = yield* parseTtlToClassTable(ttl);
      const expert = table.classes.find(
        (c) => c.iri === "https://w3id.org/energy-intel/Expert"
      );
      expect(expert).toMatchObject({
        iri: "https://w3id.org/energy-intel/Expert",
        label: "Expert",
        definition: "An energy expert.",
        disjointWith: ["https://w3id.org/energy-intel/Organization"]
      });
      expect(expert?.equivalentClassRestrictions).toEqual([
        {
          onProperty: "http://purl.obolibrary.org/obo/BFO_0000053",
          someValuesFrom: "https://w3id.org/energy-intel/EnergyExpertRole"
        }
      ]);
      expect(
        table.classes.find(
          (c) => c.iri === "https://w3id.org/energy-intel/EnergyExpertRole"
        )
      ).toMatchObject({
        superClasses: ["http://purl.obolibrary.org/obo/BFO_0000023"]
      });
      expect(table.prefixes["ei"]).toBe("https://w3id.org/energy-intel/");
    })
  );

  it.effect("extracts data + object properties for a class", () =>
    Effect.gen(function* () {
      const ttl = `
        @prefix ei: <https://w3id.org/energy-intel/> .
        @prefix foaf: <http://xmlns.com/foaf/0.1/> .
        @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
        @prefix bfo: <http://purl.obolibrary.org/obo/BFO_> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
        @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix owl: <http://www.w3.org/2002/07/owl#> .

        ei:Expert a owl:Class .
        foaf:name a owl:DatatypeProperty ;
          rdfs:domain ei:Expert ;
          rdfs:range xsd:string .
        ei:bio a owl:DatatypeProperty ;
          rdfs:domain ei:Expert ;
          rdfs:range xsd:string .
        bfo:0000053 a owl:ObjectProperty ;
          rdfs:domain ei:Expert ;
          rdfs:range bfo:0000023 .
      `;
      const table = yield* parseTtlToClassTable(ttl);
      const expert = table.classes.find(
        (c) => c.iri === "https://w3id.org/energy-intel/Expert"
      )!;
      expect(expert.properties.length).toBeGreaterThan(0);
      const namesProp = expert.properties.find(
        (p) => p.iri === "http://xmlns.com/foaf/0.1/name"
      );
      expect(namesProp).toMatchObject({
        iri: "http://xmlns.com/foaf/0.1/name",
        range: "http://www.w3.org/2001/XMLSchema#string"
      });
    })
  );
});
