import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import {
  Cardinality,
  ClassEmitSpec,
  DistillFrom,
  EmitSpec,
  ForwardField,
  LiteralPrimitive,
  ReverseField,
  SubjectSelector,
  ValueKind,
  XsdDatatype
} from "../../src/Domain/EmitSpec";

describe("LiteralPrimitive", () => {
  it("accepts string / number / boolean", () => {
    expect(Schema.decodeUnknownSync(LiteralPrimitive)("string")).toBe("string");
    expect(Schema.decodeUnknownSync(LiteralPrimitive)("number")).toBe("number");
    expect(Schema.decodeUnknownSync(LiteralPrimitive)("boolean")).toBe("boolean");
  });
});

describe("XsdDatatype", () => {
  it("accepts the 6 supported xsd types", () => {
    const cases = [
      "xsd:string",
      "xsd:dateTime",
      "xsd:date",
      "xsd:integer",
      "xsd:decimal",
      "xsd:boolean"
    ] as const;
    for (const c of cases) {
      expect(Schema.decodeUnknownSync(XsdDatatype)(c)).toBe(c);
    }
  });

  it("rejects unknown xsd types", () => {
    expect(() => Schema.decodeUnknownSync(XsdDatatype)("xsd:duration")).toThrow();
  });
});

describe("ValueKind", () => {
  it("decodes a literal value kind with xsd:string", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "string",
      xsdDatatype: "xsd:string"
    });
    expect(decoded._tag).toBe("Literal");
    if (decoded._tag === "Literal") {
      expect(decoded.primitive).toBe("string");
      expect(decoded.xsdDatatype).toBe("xsd:string");
    }
  });

  it("decodes a literal value kind with xsd:date (DateLike case)", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "string",
      xsdDatatype: "xsd:date"
    });
    if (decoded._tag === "Literal") {
      expect(decoded.xsdDatatype).toBe("xsd:date");
    }
  });

  it("decodes a literal value kind with xsd:dateTime (IsoTimestamp case)", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "string",
      xsdDatatype: "xsd:dateTime"
    });
    if (decoded._tag === "Literal") {
      expect(decoded.xsdDatatype).toBe("xsd:dateTime");
    }
  });

  it("decodes a numeric literal value kind with xsd:decimal (default)", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "number",
      xsdDatatype: "xsd:decimal"
    });
    if (decoded._tag === "Literal") {
      expect(decoded.primitive).toBe("number");
      expect(decoded.xsdDatatype).toBe("xsd:decimal");
    }
  });

  it("decodes a numeric literal value kind with xsd:integer (explicit)", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "number",
      xsdDatatype: "xsd:integer"
    });
    if (decoded._tag === "Literal") {
      expect(decoded.xsdDatatype).toBe("xsd:integer");
    }
  });

  it("decodes a boolean literal value kind with xsd:boolean", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "Literal",
      primitive: "boolean",
      xsdDatatype: "xsd:boolean"
    });
    if (decoded._tag === "Literal") {
      expect(decoded.primitive).toBe("boolean");
      expect(decoded.xsdDatatype).toBe("xsd:boolean");
    }
  });

  it("rejects a Literal value kind without xsdDatatype", () => {
    expect(() =>
      Schema.decodeUnknownSync(ValueKind)({
        _tag: "Literal",
        primitive: "string"
      })
    ).toThrow();
  });

  it("decodes an IRI value kind", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({ _tag: "Iri" });
    expect(decoded._tag).toBe("Iri");
  });

  it("decodes an enum-literal value kind with values", () => {
    const decoded = Schema.decodeUnknownSync(ValueKind)({
      _tag: "EnumLiteral",
      values: ["annual", "quarterly", "monthly"]
    });
    expect(decoded._tag).toBe("EnumLiteral");
    if (decoded._tag === "EnumLiteral") {
      expect(decoded.values).toHaveLength(3);
    }
  });
});

describe("Cardinality", () => {
  it("accepts single / single-optional / many", () => {
    expect(Schema.decodeUnknownSync(Cardinality)("single")).toBe("single");
    expect(Schema.decodeUnknownSync(Cardinality)("single-optional")).toBe("single-optional");
    expect(Schema.decodeUnknownSync(Cardinality)("many")).toBe("many");
  });
});

describe("DistillFrom", () => {
  it("decodes SubjectIri", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({ _tag: "SubjectIri" });
    expect(decoded._tag).toBe("SubjectIri");
  });

  it("decodes Predicate with a predicate IRI", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({
      _tag: "Predicate",
      predicate: "http://purl.org/dc/terms/title"
    });
    expect(decoded._tag).toBe("Predicate");
    if (decoded._tag === "Predicate") {
      expect(decoded.predicate).toBe("http://purl.org/dc/terms/title");
    }
  });

  it("decodes PredicateWithPrecedence", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({
      _tag: "PredicateWithPrecedence",
      predicate: "http://www.w3.org/2004/02/skos/core#altLabel",
      precedence: "alternateNames-before-display-alias",
      conflictResolution: "preferFirst"
    });
    expect(decoded._tag).toBe("PredicateWithPrecedence");
  });

  it("decodes InverseEdge with forwardOwnerClassIri + forwardPredicate", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({
      _tag: "InverseEdge",
      forwardOwnerClassIri: "http://www.w3.org/ns/dcat#Dataset",
      forwardPredicate: "http://www.w3.org/ns/dcat#distribution"
    });
    expect(decoded._tag).toBe("InverseEdge");
    if (decoded._tag === "InverseEdge") {
      expect(decoded.forwardOwnerClassIri).toBe(
        "http://www.w3.org/ns/dcat#Dataset"
      );
      expect(decoded.forwardPredicate).toBe(
        "http://www.w3.org/ns/dcat#distribution"
      );
    }
  });

  it("decodes Default with a scalar default value", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({
      _tag: "Default",
      defaultValue: null
    });
    expect(decoded._tag).toBe("Default");
    if (decoded._tag === "Default") {
      expect(decoded.defaultValue).toBeNull();
    }
  });

  it("decodes Default with an empty-array default for set-valued fields", () => {
    const decoded = Schema.decodeUnknownSync(DistillFrom)({
      _tag: "Default",
      defaultValue: []
    });
    expect(decoded._tag).toBe("Default");
  });
});

describe("ForwardField", () => {
  it("decodes a mapped field with a predicate and single cardinality", () => {
    const decoded = Schema.decodeUnknownSync(ForwardField)({
      runtimeName: "title",
      predicate: "http://purl.org/dc/terms/title",
      valueKind: { _tag: "Literal", primitive: "string", xsdDatatype: "xsd:string" },
      cardinality: "single"
    });
    expect(decoded.runtimeName).toBe("title");
    expect(decoded.predicate).toBe("http://purl.org/dc/terms/title");
  });

  it("decodes a skipped field with predicate: null and skipEmit: true", () => {
    const decoded = Schema.decodeUnknownSync(ForwardField)({
      runtimeName: "accessRights",
      predicate: null,
      cardinality: "single-optional",
      skipEmit: true
    });
    expect(decoded.predicate).toBeNull();
    expect(decoded.skipEmit).toBe(true);
  });

  it("decodes a field with a deferred-to-iri lossy marker", () => {
    const decoded = Schema.decodeUnknownSync(ForwardField)({
      runtimeName: "themes",
      predicate: "http://www.w3.org/ns/dcat#theme",
      valueKind: { _tag: "Literal", primitive: "string", xsdDatatype: "xsd:string" },
      cardinality: "many",
      lossy: "deferred-to-iri"
    });
    expect(decoded.lossy).toBe("deferred-to-iri");
  });
});

describe("ReverseField", () => {
  it("decodes a SubjectIri id field", () => {
    const decoded = Schema.decodeUnknownSync(ReverseField)({
      runtimeName: "id",
      distillFrom: { _tag: "SubjectIri" },
      cardinality: "single"
    });
    expect(decoded.runtimeName).toBe("id");
    expect(decoded.distillFrom._tag).toBe("SubjectIri");
  });

  it("decodes a runtime-local default field", () => {
    const decoded = Schema.decodeUnknownSync(ReverseField)({
      runtimeName: "createdAt",
      distillFrom: { _tag: "Default", defaultValue: "<inject>" },
      cardinality: "single",
      lossy: "runtime-local"
    });
    expect(decoded.lossy).toBe("runtime-local");
  });
});

describe("SubjectSelector", () => {
  it("decodes a TypedSubject selector", () => {
    const decoded = Schema.decodeUnknownSync(SubjectSelector)({
      _tag: "TypedSubject",
      classIri: "http://www.w3.org/ns/dcat#Dataset"
    });
    expect(decoded._tag).toBe("TypedSubject");
    expect(decoded.classIri).toBe("http://www.w3.org/ns/dcat#Dataset");
  });
});

describe("ClassEmitSpec", () => {
  it("decodes a minimal Dataset-like class spec", () => {
    const decoded = Schema.decodeUnknownSync(ClassEmitSpec)({
      primaryClassIri: "http://www.w3.org/ns/dcat#Dataset",
      additionalClassIris: ["https://schema.org/Dataset"],
      forward: {
        fields: [
          {
            runtimeName: "title",
            predicate: "http://purl.org/dc/terms/title",
            valueKind: { _tag: "Literal", primitive: "string", xsdDatatype: "xsd:string" },
            cardinality: "single"
          }
        ]
      },
      reverse: {
        subjectSelector: {
          _tag: "TypedSubject",
          classIri: "http://www.w3.org/ns/dcat#Dataset"
        },
        fields: [
          {
            runtimeName: "id",
            distillFrom: { _tag: "SubjectIri" },
            cardinality: "single"
          },
          {
            runtimeName: "title",
            distillFrom: {
              _tag: "Predicate",
              predicate: "http://purl.org/dc/terms/title"
            },
            cardinality: "single"
          }
        ]
      }
    });
    expect(decoded.primaryClassIri).toBe("http://www.w3.org/ns/dcat#Dataset");
    expect(decoded.additionalClassIris).toHaveLength(1);
    expect(decoded.forward.fields).toHaveLength(1);
    expect(decoded.reverse.fields).toHaveLength(2);
  });
});

describe("EmitSpec", () => {
  // Minimal ClassEmitSpec fixture reused across the 9 required keys.
  const minimalClassSpec = {
    primaryClassIri: "https://example.org/TestClass",
    additionalClassIris: [],
    forward: { fields: [] },
    reverse: {
      subjectSelector: {
        _tag: "TypedSubject" as const,
        classIri: "https://example.org/TestClass"
      },
      fields: []
    }
  };

  const allNineClasses = {
    Agent: minimalClassSpec,
    Catalog: minimalClassSpec,
    CatalogRecord: minimalClassSpec,
    DataService: minimalClassSpec,
    Dataset: minimalClassSpec,
    DatasetSeries: minimalClassSpec,
    Distribution: minimalClassSpec,
    Variable: minimalClassSpec,
    Series: minimalClassSpec
  };

  it("decodes a top-level spec with all 9 required class keys", () => {
    const decoded = Schema.decodeUnknownSync(EmitSpec)({
      version: "0.1.0",
      generatedFrom: "test-fixture",
      classes: allNineClasses
    });
    expect(decoded.version).toBe("0.1.0");
    expect(Object.keys(decoded.classes).sort()).toEqual([
      "Agent",
      "Catalog",
      "CatalogRecord",
      "DataService",
      "Dataset",
      "DatasetSeries",
      "Distribution",
      "Series",
      "Variable"
    ]);
  });

  it("rejects a top-level spec missing one of the 9 required class keys", () => {
    // The classes field is an explicit 9-key Struct; omitting any key
    // should fail decode. This pins the generator's class coverage.
    const { Agent: _agent, ...partial } = allNineClasses;
    expect(() =>
      Schema.decodeUnknownSync(EmitSpec)({
        version: "0.1.0",
        generatedFrom: "test-fixture",
        classes: partial
      })
    ).toThrow();
  });
});
