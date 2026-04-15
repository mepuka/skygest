import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  ShaclSeverity,
  ShaclValidationError,
  ShaclValidationReport,
  ShaclViolation,
  ShapesLoadError
} from "../../src/Domain/Shacl";

describe("ShaclSeverity", () => {
  it("accepts the three SHACL severity literals", () => {
    expect(Schema.decodeUnknownSync(ShaclSeverity)("Violation")).toBe("Violation");
    expect(Schema.decodeUnknownSync(ShaclSeverity)("Warning")).toBe("Warning");
    expect(Schema.decodeUnknownSync(ShaclSeverity)("Info")).toBe("Info");
  });

  it("rejects arbitrary strings", () => {
    expect(() => Schema.decodeUnknownSync(ShaclSeverity)("Error")).toThrow();
  });
});

describe("ShaclViolation", () => {
  it("decodes a minimal property-scoped violation", () => {
    const decoded = Schema.decodeUnknownSync(ShaclViolation)({
      focusNode: "https://id.skygest.io/agent/ag_01",
      sourceShape: "sky-sh:AgentShape",
      sourceConstraint: "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
      severity: "Violation",
      message: "foaf:name is required",
      path: "http://xmlns.com/foaf/0.1/name"
    });
    expect(decoded.focusNode).toBe("https://id.skygest.io/agent/ag_01");
    expect(decoded.path).toBe("http://xmlns.com/foaf/0.1/name");
    expect(decoded.value).toBeUndefined();
  });

  it("decodes a violation with a serialized offending value", () => {
    const decoded = Schema.decodeUnknownSync(ShaclViolation)({
      focusNode: "https://id.skygest.io/dataset/ds_01",
      sourceShape: "sky-sh:DatasetShape",
      sourceConstraint: "http://www.w3.org/ns/shacl#ClassConstraintComponent",
      severity: "Violation",
      message: "publisher must be a foaf:Agent",
      path: "http://purl.org/dc/terms/publisher",
      value: "https://id.skygest.io/catalog/cat_01"
    });
    expect(decoded.value).toBe("https://id.skygest.io/catalog/cat_01");
  });
});

describe("ShaclValidationReport", () => {
  it("decodes a conforming report with no violations", () => {
    const decoded = Schema.decodeUnknownSync(ShaclValidationReport)({
      conforms: true,
      violations: []
    });
    expect(decoded.conforms).toBe(true);
    expect(decoded.violations).toHaveLength(0);
  });

  it("decodes a non-conforming report carrying one violation", () => {
    const decoded = Schema.decodeUnknownSync(ShaclValidationReport)({
      conforms: false,
      violations: [
        {
          focusNode: "https://id.skygest.io/agent/ag_01",
          sourceShape: "sky-sh:AgentShape",
          sourceConstraint: "http://www.w3.org/ns/shacl#MinCountConstraintComponent",
          severity: "Violation",
          message: "missing foaf:name"
        }
      ]
    });
    expect(decoded.conforms).toBe(false);
    expect(decoded.violations).toHaveLength(1);
    expect(decoded.violations[0]?.severity).toBe("Violation");
  });
});

describe("ShapesLoadError", () => {
  it("constructs with operation and message", () => {
    const err = new ShapesLoadError({
      operation: "loadShapes",
      message: "Turtle parse failed"
    });
    expect(err._tag).toBe("ShapesLoadError");
    expect(err.operation).toBe("loadShapes");
  });
});

describe("ShaclValidationError", () => {
  it("constructs with operation and message", () => {
    const err = new ShaclValidationError({
      operation: "validate",
      message: "shapes graph rejected by engine"
    });
    expect(err._tag).toBe("ShaclValidationError");
  });
});
