import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  BuildJsonSchemaError,
  buildJsonSchema
} from "../../scripts/codegen/buildJsonSchema";
import type { ClassTable } from "../../scripts/codegen/parseTtl";

describe("buildJsonSchema", () => {
  it.effect("emits $defs entry per class with type=object", () =>
    Effect.gen(function* () {
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
      const schema = yield* buildJsonSchema(table);
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      const expert = schema.$defs.Expert;
      expect(expert).toBeDefined();
      expect(expert!.type).toBe("object");
      expect(expert!.properties).toEqual({});
    })
  );

  it.effect("maps xsd ranges to JSON Schema primitive types", () =>
    Effect.gen(function* () {
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
      const schema = yield* buildJsonSchema(table);
      const expert = schema.$defs.Expert!;
      expect(expert.properties.name).toEqual({ type: "string" });
      expect(expert.properties.age).toEqual({ type: "integer" });
      expect(expert.properties.joinedAt).toEqual({
        type: "string",
        format: "date-time"
      });
    })
  );

  it.effect("emits $ref for cross-class object property ranges", () =>
    Effect.gen(function* () {
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
      const schema = yield* buildJsonSchema(table);
      const expert = schema.$defs.Expert!;
      expect(expert.properties.BFO_0000053).toEqual({
        $ref: "#/$defs/EnergyExpertRole"
      });
    })
  );

  it.effect("allows cross-module energy-intel class ranges as IRIs", () =>
    Effect.gen(function* () {
      const table: ClassTable = {
        classes: [
          {
            iri: "https://w3id.org/energy-intel/Post",
            label: "Post",
            superClasses: [],
            disjointWith: [],
            equivalentClassRestrictions: [],
            properties: [
              {
                iri: "https://w3id.org/energy-intel/presents",
                range:
                  "https://w3id.org/energy-intel/CanonicalMeasurementClaim",
                optional: true,
                list: false
              }
            ]
          }
        ],
        prefixes: {}
      };
      const rangeTable: ClassTable = {
        classes: [
          ...table.classes,
          {
            iri: "https://w3id.org/energy-intel/CanonicalMeasurementClaim",
            label: "CanonicalMeasurementClaim",
            superClasses: [],
            disjointWith: [],
            equivalentClassRestrictions: [],
            properties: []
          }
        ],
        prefixes: {}
      };
      const schema = yield* buildJsonSchema(table, { rangeTable });
      expect(schema.$defs.Post!.properties.presents).toEqual({
        type: "string"
      });
    })
  );

  it.effect("allows pinned external ontology ranges as IRIs", () =>
    Effect.gen(function* () {
      const table: ClassTable = {
        classes: [
          {
            iri: "https://w3id.org/energy-intel/Excerpt",
            label: "Excerpt",
            superClasses: [],
            disjointWith: [],
            equivalentClassRestrictions: [],
            properties: [
              {
                iri: "https://w3id.org/energy-intel/excerptFrom",
                range: "http://purl.obolibrary.org/obo/IAO_0000030",
                optional: true,
                list: false
              }
            ]
          }
        ],
        prefixes: {}
      };
      const schema = yield* buildJsonSchema(table);
      expect(schema.$defs.Excerpt!.properties.excerptFrom).toEqual({
        type: "string"
      });
    })
  );

  it.effect("emits anyOf for ontology union ranges", () =>
    Effect.gen(function* () {
      const table: ClassTable = {
        classes: [
          {
            iri: "https://w3id.org/energy-intel/CanonicalMeasurementClaim",
            label: "CanonicalMeasurementClaim",
            superClasses: [],
            disjointWith: [],
            equivalentClassRestrictions: [],
            properties: [
              {
                iri: "https://w3id.org/energy-intel/assertedValue",
                rangeUnion: [
                  "http://www.w3.org/2001/XMLSchema#decimal",
                  "http://www.w3.org/2001/XMLSchema#string"
                ],
                optional: true,
                list: false
              }
            ]
          }
        ],
        prefixes: {}
      };
      const schema = yield* buildJsonSchema(table);
      expect(
        schema.$defs.CanonicalMeasurementClaim!.properties.assertedValue
      ).toEqual({
        anyOf: [{ type: "number" }, { type: "string" }]
      });
    })
  );

  it.effect(
    "raises BuildJsonSchemaError(UnknownRange) when range IRI is unknown",
    () =>
      Effect.gen(function* () {
        // Previous behavior was a console.warn + permissive
        // `{ type: "string" }` fallback that let ontology typos sail
        // through. Now any range IRI not in XSD_TYPE_MAP and not matching
        // a class IRI must raise.
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
        const error = yield* buildJsonSchema(table).pipe(Effect.flip);
        expect(error).toBeInstanceOf(BuildJsonSchemaError);
        expect(error.kind).toBe("UnknownRange");
        expect(error.propertyIri).toBe(
          "https://w3id.org/energy-intel/mystery"
        );
        expect(error.rangeIri).toBe("https://example.org/UnknownRange");
      })
  );

  it.effect(
    "keeps Schema.String fallback for properties with no declared range",
    () =>
      Effect.gen(function* () {
        // Distinct from "unknown IRI" — a property with no rdfs:range is
        // an incomplete-ontology condition, not a typo. The slice's
        // agent.ttl has classes with no properties at all, so this path
        // exists for forward compatibility.
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
                  iri: "https://w3id.org/energy-intel/unspecified",
                  optional: true,
                  list: false
                }
              ]
            }
          ],
          prefixes: {}
        };
        const schema = yield* buildJsonSchema(table);
        expect(schema.$defs.Expert!.properties.unspecified).toEqual({
          type: "string"
        });
      })
  );
});
