import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  IRI,
  RdfError,
  RdfStoreService,
  ShaclService,
  ShaclValidationReport,
  ShaclViolation
} from "../src/index";

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

  it("exposes the RDF and SHACL service tags", () => {
    expect(RdfStoreService).toBeDefined();
    expect(ShaclService).toBeDefined();
  });
});
