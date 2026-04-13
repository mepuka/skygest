import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import manifestJson from "../references/data-layer-spine/manifest.json";
import { Agent, Dataset } from "../src/domain/data-layer/catalog";
import { Series, Variable } from "../src/domain/data-layer/variable";
import {
  DataLayerSpineManifest,
  type SpineClassKey,
  type SpineClassSpec,
  type SpineFieldSpec
} from "../src/domain/dataLayerSpineManifest";

const decodeManifest = Schema.decodeUnknownResult(DataLayerSpineManifest);
const decodeManifestSync = Schema.decodeUnknownSync(DataLayerSpineManifest);

/**
 * Runtime fields that the manifest intentionally describes before the
 * runtime schema grows them. Each entry MUST carry a ticket reference so
 * the test catches unexpected drift.
 */
const FORWARD_LOOKING_MANIFEST_FIELDS: {
  readonly [K in SpineClassKey]?: ReadonlyArray<{ readonly name: string; readonly reason: string }>;
} = {
  Series: [
    {
      name: "datasetId",
      reason: "SKY-317 will add datasetId to the runtime Series struct; manifest records it as optional in v1."
    }
  ]
};

const runtimeFieldKeys = {
  Agent: Object.keys(Agent.fields),
  Dataset: Object.keys(Dataset.fields),
  Variable: Object.keys(Variable.fields),
  Series: Object.keys(Series.fields)
} as const;

describe("data layer spine manifest", () => {
  it("decodes the checked-in manifest", () => {
    const result = decodeManifest(manifestJson);
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("locks the manifest version, ontology IRI, and ontology version", () => {
    const manifest = decodeManifestSync(manifestJson);
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.ontologyIri).toBe("https://skygest.dev/vocab/energy");
    expect(manifest.ontologyVersion).toBe("0.2.0");
  });

  it("covers exactly the four spine classes", () => {
    const manifest = decodeManifestSync(manifestJson);
    expect(Object.keys(manifest.classes).sort()).toEqual([
      "Agent",
      "Dataset",
      "Series",
      "Variable"
    ]);
  });

  it("every runtime field of every spine class appears in the manifest (drift guard)", () => {
    const manifest = decodeManifestSync(manifestJson);
    const drift: Array<{ class: SpineClassKey; missing: string }> = [];

    for (const key of ["Agent", "Dataset", "Variable", "Series"] as const) {
      const manifestFieldNames = new Set(
        manifest.classes[key].fields.map((f) => f.runtimeName)
      );
      for (const runtimeName of runtimeFieldKeys[key]) {
        if (!manifestFieldNames.has(runtimeName)) {
          drift.push({ class: key, missing: runtimeName });
        }
      }
    }

    expect(drift).toEqual([]);
  });

  it("every manifest field exists on the runtime struct OR is an approved forward-looking entry", () => {
    const manifest = decodeManifestSync(manifestJson);
    const unexpected: Array<{ class: SpineClassKey; extra: string }> = [];

    for (const key of ["Agent", "Dataset", "Variable", "Series"] as const) {
      const runtimeSet = new Set<string>(runtimeFieldKeys[key]);
      const forwardSet = new Set<string>(
        (FORWARD_LOOKING_MANIFEST_FIELDS[key] ?? []).map((f) => f.name)
      );
      for (const field of manifest.classes[key].fields) {
        if (!runtimeSet.has(field.runtimeName) && !forwardSet.has(field.runtimeName)) {
          unexpected.push({ class: key, extra: field.runtimeName });
        }
      }
    }

    expect(unexpected).toEqual([]);
  });

  it("Series.datasetId is optional in v1 and carries a deferredTightening hint", () => {
    const manifest = decodeManifestSync(manifestJson);
    const datasetIdField = manifest.classes.Series.fields.find(
      (f: SpineFieldSpec) => f.runtimeName === "datasetId"
    );

    expect(datasetIdField).toBeDefined();
    expect(datasetIdField!.optional).toBe(true);
    expect(datasetIdField!.type).toEqual({ _tag: "brandedId", ref: "DatasetId" });
    expect(datasetIdField!.ontologyIri).toBe(
      "https://skygest.dev/vocab/energy/publishedInDataset"
    );
    expect(datasetIdField!.deferredTightening).toBeDefined();
    expect(datasetIdField!.deferredTightening).toMatch(/SKY-317/);
  });

  it("Series.variableId is required in v1 and points at sevocab:implementsVariable", () => {
    const manifest = decodeManifestSync(manifestJson);
    const variableIdField = manifest.classes.Series.fields.find(
      (f: SpineFieldSpec) => f.runtimeName === "variableId"
    );

    expect(variableIdField).toBeDefined();
    expect(variableIdField!.optional).toBe(false);
    expect(variableIdField!.type).toEqual({ _tag: "brandedId", ref: "VariableId" });
    expect(variableIdField!.ontologyIri).toBe(
      "https://skygest.dev/vocab/energy/implementsVariable"
    );
  });

  it("hasVariable is recorded as a derived relationship over hasSeries + implementsVariable", () => {
    const manifest = decodeManifestSync(manifestJson);
    const hasVariable = manifest.derivedRelationships.find(
      (r) => r.runtimeName === "hasVariable"
    );

    expect(hasVariable).toBeDefined();
    expect(hasVariable!.ontologyIri).toBe(
      "https://skygest.dev/vocab/energy/hasVariable"
    );
    expect([...hasVariable!.derivedFrom].sort()).toEqual([
      "https://skygest.dev/vocab/energy/hasSeries",
      "https://skygest.dev/vocab/energy/implementsVariable"
    ]);
  });

  it("every spine class has an Ontology IRI pointing at the sevocab namespace", () => {
    const manifest = decodeManifestSync(manifestJson);
    for (const key of ["Agent", "Dataset", "Variable", "Series"] as const) {
      expect(manifest.classes[key].ontologyIri).toMatch(
        /^https:\/\/skygest\.dev\/vocab\/energy\//
      );
    }
  });

  it("every generated field has a non-null ontology IRI (fragment-composition rule)", () => {
    const manifest = decodeManifestSync(manifestJson);
    const violations: Array<{ class: SpineClassKey; field: string }> = [];

    for (const key of ["Agent", "Dataset", "Variable", "Series"] as const) {
      for (const field of manifest.classes[key].fields) {
        if (field.generation === "generated" && field.ontologyIri === null) {
          violations.push({ class: key, field: field.runtimeName });
        }
      }
    }

    // Note: alternateNames is intentionally generated-without-IRI on Agent in
    // this slice (runtime-local field promoted into the Agent fragment for
    // symmetry with name). If that call changes, update the allowlist below.
    const allowlisted = new Set<string>(["Agent:alternateNames"]);
    const unexpected = violations.filter(
      (v) => !allowlisted.has(`${v.class}:${v.field}`)
    );
    expect(unexpected).toEqual([]);
  });

  it("rejects malformed manifest payloads", () => {
    const malformed = {
      manifestVersion: 1,
      sourceCommit: "abc123",
      generatedAt: "2026-04-13T12:00:00.000Z",
      inputHash: "sha256:test",
      ontologyIri: "https://skygest.dev/vocab/energy",
      ontologyVersion: "0.2.0",
      classes: {
        Agent: {
          runtimeName: "Agent",
          ontologyIri: "https://skygest.dev/vocab/energy/EnergyAgent",
          fields: [
            {
              runtimeName: "name",
              ontologyIri: "http://xmlns.com/foaf/0.1/name",
              // Missing required "type" field.
              optional: false,
              generation: "generated"
            }
          ]
        }
      },
      derivedRelationships: []
    };

    const result = decodeManifest(malformed);
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects manifests whose manifestVersion is not 1", () => {
    const result = decodeManifest({ ...manifestJson, manifestVersion: 2 });
    expect(Result.isFailure(result)).toBe(true);
  });

  it("rejects unknown branded-ID refs", () => {
    const tampered = structuredClone(manifestJson as object) as typeof manifestJson;
    // Replace the first brandedId field in Agent with an unknown ref.
    const agentFields = (tampered.classes as { Agent: { fields: Array<Record<string, unknown>> } }).Agent.fields;
    for (const f of agentFields) {
      if ((f.type as { _tag: string })._tag === "brandedId") {
        (f.type as { ref: string }).ref = "NotARealId";
        break;
      }
    }
    const result = decodeManifest(tampered);
    expect(Result.isFailure(result)).toBe(true);
  });
});
