import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { EmitSpec } from "../../src/Domain/EmitSpec";
import emitSpecJson from "../../generated/emit-spec.json" with { type: "json" };

/**
 * Integration test for the committed emit-spec.json artifact.
 *
 * Every field assertion here is a locked contract between the generator
 * (scripts/generate-emit-spec.ts) and the runtime consumers
 * (mapping/forward.ts, mapping/reverse.ts, tests/catalog-round-trip.test.ts
 * in later commits). Regenerate the spec with `bun run gen:emit-spec` and
 * re-run this suite if the domain model changes.
 */

describe("generated/emit-spec.json", () => {
  const decoded = Schema.decodeUnknownSync(EmitSpec)(emitSpecJson);

  it("decodes cleanly against the EmitSpec schema", () => {
    expect(decoded.version).toBeTypeOf("string");
    expect(decoded.generatedFrom).toBeTypeOf("string");
  });

  it("covers all 9 DCAT domain classes", () => {
    expect(Object.keys(decoded.classes).sort()).toEqual(
      [
        "Agent",
        "Catalog",
        "CatalogRecord",
        "DataService",
        "Dataset",
        "DatasetSeries",
        "Distribution",
        "Series",
        "Variable"
      ].sort()
    );
  });

  describe("Agent", () => {
    const agent = decoded.classes.Agent!;

    it("primaryClassIri is foaf:Agent", () => {
      expect(agent.primaryClassIri).toBe("http://xmlns.com/foaf/0.1/Agent");
    });

    it("name emits as foaf:name literal", () => {
      const field = agent.forward.fields.find((f) => f.runtimeName === "name");
      expect(field?.predicate).toBe("http://xmlns.com/foaf/0.1/name");
      expect(field?.valueKind).toEqual({ _tag: "Literal", primitive: "string" });
    });

    it("homepage emits as foaf:homepage IRI (WebUrl detection)", () => {
      const field = agent.forward.fields.find(
        (f) => f.runtimeName === "homepage"
      );
      expect(field?.predicate).toBe("http://xmlns.com/foaf/0.1/homepage");
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
      expect(field?.cardinality).toBe("single-optional");
    });

    it("alternateNames emits as skos:altLabel with many cardinality", () => {
      const field = agent.forward.fields.find(
        (f) => f.runtimeName === "alternateNames"
      );
      expect(field?.predicate).toBe(
        "http://www.w3.org/2004/02/skos/core#altLabel"
      );
      expect(field?.cardinality).toBe("many");
    });

    it("alternateNames reverse uses PredicateWithPrecedence", () => {
      const field = agent.reverse.fields.find(
        (f) => f.runtimeName === "alternateNames"
      );
      expect(field?.distillFrom._tag).toBe("PredicateWithPrecedence");
    });

    it("id reverse uses SubjectIri", () => {
      const field = agent.reverse.fields.find((f) => f.runtimeName === "id");
      expect(field?.distillFrom).toEqual({ _tag: "SubjectIri" });
    });

    it("_tag and kind are runtime-local on reverse (Default)", () => {
      const tag = agent.reverse.fields.find((f) => f.runtimeName === "_tag");
      const kind = agent.reverse.fields.find((f) => f.runtimeName === "kind");
      expect(tag?.distillFrom._tag).toBe("Default");
      expect(tag?.lossy).toBe("runtime-local");
      expect(kind?.distillFrom._tag).toBe("Default");
      expect(kind?.lossy).toBe("runtime-local");
    });
  });

  describe("CatalogRecord", () => {
    const cr = decoded.classes.CatalogRecord!;

    it("primaryClassIri is dcat:CatalogRecord (annotation read via last-check path)", () => {
      expect(cr.primaryClassIri).toBe("http://www.w3.org/ns/dcat#CatalogRecord");
    });

    it("primaryTopicId emits as foaf:primaryTopic IRI (field override)", () => {
      const field = cr.forward.fields.find(
        (f) => f.runtimeName === "primaryTopicId"
      );
      expect(field?.predicate).toBe("http://xmlns.com/foaf/0.1/primaryTopic");
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
    });

    it("primaryTopicType is skipped on forward (no DcatProperty)", () => {
      const field = cr.forward.fields.find(
        (f) => f.runtimeName === "primaryTopicType"
      );
      expect(field?.predicate).toBeNull();
      expect(field?.skipEmit).toBe(true);
    });
  });

  describe("Dataset", () => {
    const ds = decoded.classes.Dataset!;

    it("primaryClassIri is dcat:Dataset with schema:Dataset additional", () => {
      expect(ds.primaryClassIri).toBe("http://www.w3.org/ns/dcat#Dataset");
      expect(ds.additionalClassIris).toContain("https://schema.org/Dataset");
    });

    it("publisherAgentId emits as dcterms:publisher IRI (branded AgentId)", () => {
      const field = ds.forward.fields.find(
        (f) => f.runtimeName === "publisherAgentId"
      );
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
    });

    it("wasDerivedFrom emits as prov:wasDerivedFrom IRI array", () => {
      const field = ds.forward.fields.find(
        (f) => f.runtimeName === "wasDerivedFrom"
      );
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
      expect(field?.cardinality).toBe("many");
    });

    it("themes carry deferred-to-iri lossy marker", () => {
      const field = ds.forward.fields.find((f) => f.runtimeName === "themes");
      expect(field?.lossy).toBe("deferred-to-iri");
    });

    it("variableIds forward carries derived-from-series lossy marker", () => {
      const field = ds.forward.fields.find(
        (f) => f.runtimeName === "variableIds"
      );
      expect(field?.lossy).toBe("derived-from-series");
    });

    it("variableIds reverse uses Default + derived-from-series lossy", () => {
      const field = ds.reverse.fields.find(
        (f) => f.runtimeName === "variableIds"
      );
      expect(field?.distillFrom._tag).toBe("Default");
      expect(field?.lossy).toBe("derived-from-series");
    });
  });

  describe("Distribution", () => {
    const dist = decoded.classes.Distribution!;

    it("accessURL and downloadURL both emit as IRI (WebUrl)", () => {
      const access = dist.forward.fields.find(
        (f) => f.runtimeName === "accessURL"
      );
      const download = dist.forward.fields.find(
        (f) => f.runtimeName === "downloadURL"
      );
      expect(access?.valueKind).toEqual({ _tag: "Iri" });
      expect(download?.valueKind).toEqual({ _tag: "Iri" });
    });

    it("byteSize is a numeric literal", () => {
      const field = dist.forward.fields.find(
        (f) => f.runtimeName === "byteSize"
      );
      expect(field?.valueKind).toEqual({ _tag: "Literal", primitive: "number" });
    });
  });

  describe("DataService", () => {
    const svc = decoded.classes.DataService!;

    it("endpointURLs emits as IRI array (WebUrl[] detection)", () => {
      const field = svc.forward.fields.find(
        (f) => f.runtimeName === "endpointURLs"
      );
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
      expect(field?.cardinality).toBe("many");
    });
  });

  describe("DatasetSeries", () => {
    const dser = decoded.classes.DatasetSeries!;

    it("cadence is an EnumLiteral with deferred-to-iri lossy marker", () => {
      const field = dser.forward.fields.find(
        (f) => f.runtimeName === "cadence"
      );
      expect(field?.valueKind?._tag).toBe("EnumLiteral");
      const valueKind = field?.valueKind;
      if (valueKind && valueKind._tag === "EnumLiteral") {
        expect(valueKind.values).toContain("annual");
        expect(valueKind.values).toContain("monthly");
      }
      expect(field?.lossy).toBe("deferred-to-iri");
    });
  });

  describe("Variable", () => {
    const variable = decoded.classes.Variable!;

    it("primaryClassIri falls back to sevocab:EnergyVariable (no DcatClass)", () => {
      expect(variable.primaryClassIri).toBe(
        "https://skygest.dev/vocab/energy/EnergyVariable"
      );
    });

    it("open-string facets carry deferred-to-iri lossy markers", () => {
      const openFacets = [
        "measuredProperty",
        "domainObject",
        "technologyOrFuel",
        "policyInstrument"
      ];
      for (const facet of openFacets) {
        const field = variable.forward.fields.find(
          (f) => f.runtimeName === facet
        );
        expect(field?.lossy, `${facet} should be deferred-to-iri`).toBe(
          "deferred-to-iri"
        );
      }
    });

    it("statisticType / aggregation / unitFamily emit as EnumLiteral", () => {
      const closed = ["statisticType", "aggregation", "unitFamily"];
      for (const name of closed) {
        const field = variable.forward.fields.find(
          (f) => f.runtimeName === name
        );
        expect(field?.valueKind?._tag, `${name} valueKind`).toBe("EnumLiteral");
      }
    });
  });

  describe("Series", () => {
    const series = decoded.classes.Series!;

    it("primaryClassIri falls back to sevocab:Series (no DcatClass)", () => {
      expect(series.primaryClassIri).toBe(
        "https://skygest.dev/vocab/energy/Series"
      );
    });

    it("variableId emits as sevocab:implementsVariable IRI", () => {
      const field = series.forward.fields.find(
        (f) => f.runtimeName === "variableId"
      );
      expect(field?.predicate).toBe(
        "https://skygest.dev/vocab/energy/implementsVariable"
      );
      expect(field?.valueKind).toEqual({ _tag: "Iri" });
    });

    it("datasetId is single-optional (pre-work checklist item 4)", () => {
      const field = series.forward.fields.find(
        (f) => f.runtimeName === "datasetId"
      );
      expect(field?.cardinality).toBe("single-optional");
    });
  });
});
