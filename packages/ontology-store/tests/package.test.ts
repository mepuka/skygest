import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  BFO,
  EI,
  EXPERT_METADATA_KEYS,
  Expert,
  ExpertIri,
  ExpertModule,
  FOAF,
  IRI,
  RDF,
  RdfError,
  RdfMappingError,
  RdfStoreService,
  ShaclService,
  ShaclValidationReport,
  ShaclViolation,
  expertFromLegacyRow,
  expertFromTriples,
  expertToTriples
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

  it("exposes RdfMappingError tagged error", () => {
    const error = new RdfMappingError({
      direction: "forward",
      entity: "Expert",
      iri: "https://example.org/iri",
      message: "boom"
    });
    expect(error._tag).toBe("RdfMappingError");
  });

  it("exposes Expert agent module surface", () => {
    expect(Expert).toBeDefined();
    expect(ExpertIri).toBeDefined();
    expect(ExpertModule).toBeDefined();
    expect(expertToTriples).toBeDefined();
    expect(expertFromTriples).toBeDefined();
    expect(expertFromLegacyRow).toBeDefined();
    expect([...EXPERT_METADATA_KEYS]).toContain("entity_type");
  });

  it("exposes namespace IRI constants", () => {
    expect(EI.Expert).toBeDefined();
    expect(BFO.bearerOf).toBeDefined();
    expect(FOAF.name).toBeDefined();
    expect(RDF.type).toBeDefined();
  });
});
