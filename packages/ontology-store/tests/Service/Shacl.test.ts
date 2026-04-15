import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { RdfStoreService } from "../../src/Service/RdfStore";
import { ShaclService } from "../../src/Service/Shacl";

const TestLayer = Layer.mergeAll(RdfStoreService.Default, ShaclService.Default);

const shapesFixture = `
  @prefix ex: <https://example.org/shapes/> .
  @prefix sh: <http://www.w3.org/ns/shacl#> .
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .

  ex:AgentShape
    a sh:NodeShape ;
    sh:targetClass foaf:Agent ;
    sh:property ex:AgentNameShape .

  ex:AgentNameShape
    a sh:PropertyShape ;
    sh:path foaf:name ;
    sh:minCount 1 ;
    sh:message "foaf:name is required" .
`;

const passingDataFixture = `
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .

  <https://example.org/agent/alice>
    a foaf:Agent ;
    foaf:name "Alice" .
`;

const failingDataFixture = `
  @prefix foaf: <http://xmlns.com/foaf/0.1/> .

  <https://example.org/agent/alice>
    a foaf:Agent .
`;

describe("ShaclService", () => {
  it("loadShapes parses Turtle shapes into a store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shacl = yield* ShaclService;
        const rdf = yield* RdfStoreService;

        const shapesStore = yield* shacl.loadShapes(shapesFixture);
        const size = yield* rdf.size(shapesStore);

        expect(size).toBeGreaterThan(0);
      }).pipe(Effect.provide(TestLayer), Effect.scoped)
    ));

  it("validate returns a conforming report for valid data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shacl = yield* ShaclService;
        const rdf = yield* RdfStoreService;

        const shapesStore = yield* shacl.loadShapes(shapesFixture);
        const dataStore = yield* rdf.makeStore;
        yield* rdf.parseTurtle(dataStore, passingDataFixture);

        const report = yield* shacl.validate(dataStore, shapesStore);

        expect(report).toEqual({
          conforms: true,
          violations: []
        });
      }).pipe(Effect.provide(TestLayer), Effect.scoped)
    ));

  it("validate returns a populated violation for invalid data", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shacl = yield* ShaclService;
        const rdf = yield* RdfStoreService;

        const shapesStore = yield* shacl.loadShapes(shapesFixture);
        const dataStore = yield* rdf.makeStore;
        yield* rdf.parseTurtle(dataStore, failingDataFixture);

        const report = yield* shacl.validate(dataStore, shapesStore);

        expect(report.conforms).toBe(false);
        expect(report.violations).toHaveLength(1);
        expect(report.violations[0]).toEqual({
          focusNode: "https://example.org/agent/alice",
          sourceShape: "https://example.org/shapes/AgentNameShape",
          sourceConstraint:
            "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
          severity: "Violation",
          message: "foaf:name is required",
          path: "http://xmlns.com/foaf/0.1/name"
        });
      }).pipe(Effect.provide(TestLayer), Effect.scoped)
    ));
});
