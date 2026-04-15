import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, References, Schema } from "effect";

import {
  distill,
  emit,
  IRI,
  RdfError,
  RdfStoreService,
  ShaclService,
  ShaclValidationReport,
  ShaclViolation
} from "../src/index";

const TestLayer = Layer.mergeAll(RdfStoreService.Default, ShaclService.Default);

describe("@skygest/ontology-store", () => {
  it("exports the RDF and SHACL domain helpers", () => {
    expect(Schema.decodeUnknownSync(IRI)("https://example.org/iri")).toBe(
      "https://example.org/iri"
    );

    const violation = Schema.decodeUnknownSync(ShaclViolation)({
      focusNode: "https://example.org/focus",
      sourceShape: "https://example.org/shape",
      sourceConstraint: "https://example.org/constraint",
      severity: "Violation",
      message: "broken"
    });
    expect(violation.severity).toBe("Violation");

    const report = Schema.decodeUnknownSync(ShaclValidationReport)({
      conforms: false,
      violations: [violation]
    });
    expect(report.violations).toHaveLength(1);

    const error = new RdfError({
      operation: "test",
      message: "boom"
    });
    expect(error._tag).toBe("RdfError");
  });

  it("emits and distills a simple entity through the public API", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const rdf = yield* RdfStoreService;
        const store = yield* rdf.makeStore;

        yield* emit(
          {
            _tag: "Agent",
            id: "https://id.skygest.io/agent/ag_01TESTENTITY12345",
            kind: "organization",
            name: "Example Agent",
            alternateNames: ["EA"],
            createdAt: "2026-04-15T00:00:00.000Z",
            updatedAt: "2026-04-15T00:00:00.000Z",
            aliases: []
          },
          store
        );

        const distilled = yield* distill(store);

        expect(distilled).toHaveLength(1);
        expect(distilled[0]).toMatchObject({
          _tag: "Agent",
          id: "https://id.skygest.io/agent/ag_01TESTENTITY12345",
          name: "Example Agent",
          alternateNames: ["EA"]
        });
      }).pipe(
        Effect.provide(TestLayer),
        Effect.provideService(References.MinimumLogLevel, "Error"),
        Effect.scoped
      )
    ));
});
