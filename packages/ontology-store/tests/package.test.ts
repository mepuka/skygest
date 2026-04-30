import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  BFO,
  ENTITY_GRAPH_SCHEMA_STATEMENTS,
  ENTITY_METADATA_FIELDS,
  EI,
  EXPERT_METADATA_KEYS,
  AiSearchClient,
  Expert,
  EntityContextService,
  EntityProjectionDrainService,
  EntityProjectionRegistry,
  EntitySearchService,
  EntitySnapshotStore,
  ExpertEntity,
  ExpertIri,
  ExpertModule,
  ExpertUnifiedProjection,
  FOAF,
  IRI,
  PREDICATES,
  PredicateIri,
  RDF,
  RdfError,
  RdfMappingError,
  RdfStoreService,
  ShaclService,
  ShaclValidationReport,
  ShaclViolation,
  asPredicateIri,
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
    expect(ExpertEntity.tag).toBe("Expert");
    expect(ExpertUnifiedProjection.entityType).toBe("Expert");
  });

  it("exposes namespace IRI constants", () => {
    expect(EI.Expert).toBeDefined();
    expect(BFO.bearerOf).toBeDefined();
    expect(FOAF.name).toBeDefined();
    expect(RDF.type).toBeDefined();
    expect(EI.mentions).toBeDefined();
  });

  it("exposes entity graph and projection primitives", () => {
    expect(Schema.decodeUnknownSync(PredicateIri)(BFO.bearerOf.value)).toBe(
      BFO.bearerOf.value
    );
    expect(asPredicateIri(PREDICATES["ei:mentions"].iri)).toBe(
      "https://w3id.org/energy-intel/mentions"
    );
    expect(ENTITY_GRAPH_SCHEMA_STATEMENTS.length).toBeGreaterThan(0);
    expect(ENTITY_METADATA_FIELDS.map((field) => field.field_name)).toEqual([
      "entity_type",
      "iri",
      "topic",
      "authority",
      "time_bucket"
    ]);
    expect(AiSearchClient).toBeDefined();
    expect(EntitySearchService).toBeDefined();
    expect(EntityContextService).toBeDefined();
    expect(EntitySnapshotStore).toBeDefined();
    expect(EntityProjectionRegistry).toBeDefined();
    expect(EntityProjectionDrainService).toBeDefined();
  });
});
