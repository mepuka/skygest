import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { buildJsonSchema } from "../../scripts/codegen/buildJsonSchema";
import {
  CodegenAstError,
  postProcessAst
} from "../../scripts/codegen/postProcessAst";
import type { ClassTable } from "../../scripts/codegen/parseTtl";

describe("postProcessAst", () => {
  it.effect("returns metadata for branded IRI substitution per class", () =>
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
        prefixes: {}
      };
      const jsonSchema = yield* buildJsonSchema(table);
      const result = yield* postProcessAst(jsonSchema, table);
      expect(result.brandedIris).toHaveLength(1);
      expect(result.brandedIris[0]).toMatchObject({
        className: "Expert",
        classIri: "https://w3id.org/energy-intel/Expert",
        brandName: "ExpertIri",
        equivalentClassDoc: []
      });
      expect(result.brandedIris[0]!.pattern).toBe(
        "^https://w3id\\.org/energy-intel/expert/[A-Za-z0-9_-]+$"
      );
    })
  );

  it.effect("topologically orders dependents after dependencies", () =>
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
      const jsonSchema = yield* buildJsonSchema(table);
      const result = yield* postProcessAst(jsonSchema, table);
      const roleIdx = result.emitOrder.indexOf(
        "https://w3id.org/energy-intel/EnergyExpertRole"
      );
      const expertIdx = result.emitOrder.indexOf(
        "https://w3id.org/energy-intel/Expert"
      );
      expect(roleIdx).toBeGreaterThanOrEqual(0);
      expect(expertIdx).toBeGreaterThanOrEqual(0);
      expect(roleIdx).toBeLessThan(expertIdx);
    })
  );

  it.effect("renders equivalentClass restrictions as JSDoc-ready strings", () =>
    Effect.gen(function* () {
      const table: ClassTable = {
        classes: [
          {
            iri: "https://w3id.org/energy-intel/Expert",
            label: "Expert",
            superClasses: [],
            disjointWith: [],
            equivalentClassRestrictions: [
              {
                onProperty: "http://purl.obolibrary.org/obo/BFO_0000053",
                someValuesFrom:
                  "https://w3id.org/energy-intel/EnergyExpertRole"
              }
            ],
            properties: []
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
      const jsonSchema = yield* buildJsonSchema(table);
      const result = yield* postProcessAst(jsonSchema, table);
      const expertMeta = result.brandedIris.find(
        (b) => b.className === "Expert"
      );
      expect(expertMeta).toBeDefined();
      expect(expertMeta!.equivalentClassDoc).toHaveLength(1);
      expect(expertMeta!.equivalentClassDoc[0]).toContain("Expert");
      expect(expertMeta!.equivalentClassDoc[0]).toContain("BFO_0000053");
      expect(expertMeta!.equivalentClassDoc[0]).toContain("EnergyExpertRole");
    })
  );

  it.effect(
    "raises CodegenAstError(DependencyCycle) with the offending path",
    () =>
      Effect.gen(function* () {
        // Two classes with a `range` cycle: A -> B -> A. The slice ontology
        // has none, but the post-processor must refuse to emit a wrong-but-
        // plausible order rather than fall back silently.
        const table: ClassTable = {
          classes: [
            {
              iri: "https://w3id.org/energy-intel/A",
              label: "A",
              superClasses: [],
              disjointWith: [],
              equivalentClassRestrictions: [],
              properties: [
                {
                  iri: "https://w3id.org/energy-intel/aRefsB",
                  range: "https://w3id.org/energy-intel/B",
                  optional: true,
                  list: false
                }
              ]
            },
            {
              iri: "https://w3id.org/energy-intel/B",
              label: "B",
              superClasses: [],
              disjointWith: [],
              equivalentClassRestrictions: [],
              properties: [
                {
                  iri: "https://w3id.org/energy-intel/bRefsA",
                  range: "https://w3id.org/energy-intel/A",
                  optional: true,
                  list: false
                }
              ]
            }
          ],
          prefixes: {}
        };
        const jsonSchema = yield* buildJsonSchema(table);
        const error = yield* postProcessAst(jsonSchema, table).pipe(
          Effect.flip
        );
        expect(error).toBeInstanceOf(CodegenAstError);
        expect((error as CodegenAstError).kind).toBe("DependencyCycle");
        expect((error as CodegenAstError).cyclePath).toBeDefined();
        const cyclePath = (error as CodegenAstError).cyclePath ?? [];
        // Cycle path is a closed loop, so the first and last entries match.
        expect(cyclePath.length).toBeGreaterThanOrEqual(2);
        expect(cyclePath[0]).toBe(cyclePath[cyclePath.length - 1]);
        expect(cyclePath).toContain("https://w3id.org/energy-intel/A");
        expect(cyclePath).toContain("https://w3id.org/energy-intel/B");
      })
  );

  it.effect(
    "raises CodegenAstError(UnknownNamespace) for non-energy-intel class IRIs",
    () =>
      Effect.gen(function* () {
        // A class outside the energy-intel namespace. The slice ontology
        // never produces these, but the brand pattern must not silently
        // degrade to a permissive `^.+$`.
        const table: ClassTable = {
          classes: [
            {
              iri: "http://xmlns.com/foaf/0.1/Person",
              label: "Person",
              superClasses: [],
              disjointWith: [],
              equivalentClassRestrictions: [],
              properties: []
            }
          ],
          prefixes: {}
        };
        const jsonSchema = yield* buildJsonSchema(table);
        const error = yield* postProcessAst(jsonSchema, table).pipe(
          Effect.flip
        );
        expect(error).toBeInstanceOf(CodegenAstError);
        expect((error as CodegenAstError).kind).toBe("UnknownNamespace");
        expect((error as CodegenAstError).classIri).toBe(
          "http://xmlns.com/foaf/0.1/Person"
        );
      })
  );

  it.effect("produces a MultiDocument whose references include every class", () =>
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
      const jsonSchema = yield* buildJsonSchema(table);
      const result = yield* postProcessAst(jsonSchema, table);
      const refKeys = Object.keys(result.multiDocument.references);
      expect(refKeys).toContain("Expert");
      expect(refKeys).toContain("EnergyExpertRole");
    })
  );
});
