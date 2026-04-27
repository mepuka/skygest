import { describe, expect, it } from "@effect/vitest";
import { emitIrisModule } from "../../scripts/codegen/emitIrisModule";
import type { ClassTable } from "../../scripts/codegen/parseTtl";

describe("emitIrisModule", () => {
  it("emits namespace constants for EI, BFO, FOAF, RDF, OWL, etc.", () => {
    const table: ClassTable = {
      classes: [
        {
          iri: "https://w3id.org/energy-intel/Expert",
          label: "Expert",
          superClasses: [],
          disjointWith: [],
          equivalentClassRestrictions: [],
          properties: [
            {
              iri: "http://xmlns.com/foaf/0.1/name",
              optional: true,
              list: false
            },
            {
              iri: "http://purl.obolibrary.org/obo/BFO_0000053",
              optional: true,
              list: false
            }
          ]
        }
      ],
      prefixes: {}
    };
    const source = emitIrisModule(table);
    expect(source).toContain("export const EI");
    expect(source).toContain(
      'Expert: namedNode("https://w3id.org/energy-intel/Expert")'
    );
    expect(source).toContain("export const BFO");
    expect(source).toContain(
      'BFO_0000053: namedNode("http://purl.obolibrary.org/obo/BFO_0000053")'
    );
    expect(source).toContain("export const FOAF");
    expect(source).toContain('name: namedNode("http://xmlns.com/foaf/0.1/name")');
    expect(source).toContain("export const RDF");
    expect(source).toContain("export const RDFS");
    expect(source).toContain("export const OWL");
    expect(source).toContain("export const SKOS");
    expect(source).toContain("export const XSD");
    expect(source).toContain('from "n3"');
    expect(source).toContain("as const");
  });

  it("includes ei:* properties (not just classes) in the EI bucket", () => {
    const table: ClassTable = {
      classes: [
        {
          iri: "https://w3id.org/energy-intel/Expert",
          label: "Expert",
          superClasses: [],
          disjointWith: [],
          equivalentClassRestrictions: [],
          properties: [
            {
              iri: "https://w3id.org/energy-intel/age",
              optional: true,
              list: false
            }
          ]
        }
      ],
      prefixes: {}
    };
    const source = emitIrisModule(table);
    expect(source).toContain(
      'age: namedNode("https://w3id.org/energy-intel/age")'
    );
    expect(source).toContain(
      'Expert: namedNode("https://w3id.org/energy-intel/Expert")'
    );
  });

  it("emits the always-on FOAF terms even when not present in the table", () => {
    const table: ClassTable = {
      classes: [],
      prefixes: {}
    };
    const source = emitIrisModule(table);
    expect(source).toContain('name: namedNode("http://xmlns.com/foaf/0.1/name")');
    expect(source).toContain(
      'Person: namedNode("http://xmlns.com/foaf/0.1/Person")'
    );
    expect(source).toContain(
      'Organization: namedNode("http://xmlns.com/foaf/0.1/Organization")'
    );
  });

  it("emits the standard RDF/RDFS/OWL/SKOS/XSD predicates the writer needs", () => {
    const table: ClassTable = { classes: [], prefixes: {} };
    const source = emitIrisModule(table);
    expect(source).toContain(
      'type: namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type")'
    );
    expect(source).toContain(
      'subClassOf: namedNode("http://www.w3.org/2000/01/rdf-schema#subClassOf")'
    );
    expect(source).toContain(
      'Class: namedNode("http://www.w3.org/2002/07/owl#Class")'
    );
    expect(source).toContain(
      'definition: namedNode("http://www.w3.org/2004/02/skos/core#definition")'
    );
    expect(source).toContain(
      'dateTime: namedNode("http://www.w3.org/2001/XMLSchema#dateTime")'
    );
  });
});
