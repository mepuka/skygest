import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";
import { buildJsonSchema } from "../../scripts/codegen/buildJsonSchema";
import type { ClassTable } from "../../scripts/codegen/parseTtl";

describe("buildJsonSchema", () => {
  it("emits $defs entry per class with type=object", () => {
    const table: ClassTable = {
      classes: [
        {
          iri: "https://w3id.org/energy-intel/Expert",
          label: "Expert",
          superClasses: [],
          disjointWith: [],
          equivalentClassRestrictions: [],
          properties: []
        }
      ],
      prefixes: { ei: "https://w3id.org/energy-intel/" }
    };
    const schema = buildJsonSchema(table);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    const expert = schema.$defs.Expert;
    expect(expert).toBeDefined();
    expect(expert!.type).toBe("object");
    expect(expert!.properties).toEqual({});
  });

  it("maps xsd ranges to JSON Schema primitive types", () => {
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
              range: "http://www.w3.org/2001/XMLSchema#string",
              optional: true,
              list: false
            },
            {
              iri: "https://w3id.org/energy-intel/age",
              range: "http://www.w3.org/2001/XMLSchema#integer",
              optional: true,
              list: false
            },
            {
              iri: "https://w3id.org/energy-intel/joinedAt",
              range: "http://www.w3.org/2001/XMLSchema#dateTime",
              optional: true,
              list: false
            }
          ]
        }
      ],
      prefixes: {}
    };
    const schema = buildJsonSchema(table);
    const expert = schema.$defs.Expert!;
    expect(expert.properties.name).toEqual({ type: "string" });
    expect(expert.properties.age).toEqual({ type: "integer" });
    expect(expert.properties.joinedAt).toEqual({
      type: "string",
      format: "date-time"
    });
  });

  it("emits $ref for cross-class object property ranges", () => {
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
              iri: "http://purl.obolibrary.org/obo/BFO_0000053",
              range: "https://w3id.org/energy-intel/EnergyExpertRole",
              optional: true,
              list: false
            }
          ]
        },
        {
          iri: "https://w3id.org/energy-intel/EnergyExpertRole",
          label: "EnergyExpertRole",
          superClasses: [],
          disjointWith: [],
          equivalentClassRestrictions: [],
          properties: []
        }
      ],
      prefixes: {}
    };
    const schema = buildJsonSchema(table);
    const expert = schema.$defs.Expert!;
    expect(expert.properties.BFO_0000053).toEqual({
      $ref: "#/$defs/EnergyExpertRole"
    });
  });

  it("falls back to string + warning when range IRI is unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
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
                iri: "https://w3id.org/energy-intel/mystery",
                range: "https://example.org/UnknownRange",
                optional: true,
                list: false
              }
            ]
          }
        ],
        prefixes: {}
      };
      const schema = buildJsonSchema(table);
      expect(schema.$defs.Expert!.properties.mystery).toEqual({
        type: "string"
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
