import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { ExternalIdentifier, Aliases } from "../src/domain/data-layer";

describe("ExternalIdentifier", () => {
  it("decodes a valid alias", () => {
    const input = {
      scheme: "oeo",
      value: "OEO_00000001",
      uri: "http://openenergy-platform.org/ontology/oeo/OEO_00000001",
      relation: "exactMatch"
    };
    const decoded = Schema.decodeUnknownSync(ExternalIdentifier)(input);
    expect(decoded.scheme).toBe("oeo");
    expect(decoded.relation).toBe("exactMatch");
  });

  it("accepts alias without optional uri", () => {
    const input = { scheme: "eia-route", value: "electricity/operating-generator-capacity", relation: "closeMatch" };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).value).toBe("electricity/operating-generator-capacity");
  });

  it("rejects unknown scheme", () => {
    const input = { scheme: "not-a-scheme", value: "x", relation: "exactMatch" };
    expect(() => Schema.decodeUnknownSync(ExternalIdentifier)(input)).toThrow();
  });

  it("rejects unknown relation", () => {
    const input = { scheme: "oeo", value: "x", relation: "notRelated" };
    expect(() => Schema.decodeUnknownSync(ExternalIdentifier)(input)).toThrow();
  });

  it("accepts methodologyVariant (Skygest extension)", () => {
    const input = { scheme: "eia-series", value: "ELEC.GEN.ALL-99.A", relation: "methodologyVariant" };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).relation).toBe("methodologyVariant");
  });

  it("accepts the eia-bulk-id scheme (legacy bulk-manifest top-level codes)", () => {
    const input = { scheme: "eia-bulk-id", value: "EBA", relation: "exactMatch" };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).scheme).toBe("eia-bulk-id");
  });

  it("accepts the energy-charts-endpoint scheme for Fraunhofer endpoint merges", () => {
    const input = {
      scheme: "energy-charts-endpoint",
      value: "public_power",
      relation: "exactMatch"
    };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).scheme).toBe(
      "energy-charts-endpoint"
    );
  });

  it("accepts the ember-route scheme for Ember endpoint merges", () => {
    const input = {
      scheme: "ember-route",
      value: "electricity-generation/monthly",
      relation: "exactMatch"
    };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).scheme).toBe(
      "ember-route"
    );
  });

  it("accepts the gridstatus-dataset-id scheme for gridstatus dataset merges", () => {
    const input = {
      scheme: "gridstatus-dataset-id",
      value: "pjm_load_forecast",
      relation: "exactMatch"
    };
    expect(Schema.decodeUnknownSync(ExternalIdentifier)(input).scheme).toBe(
      "gridstatus-dataset-id"
    );
  });
});

describe("Aliases (unique (scheme, value) enforcement)", () => {
  it("accepts list with distinct (scheme, value) pairs", () => {
    const aliases = [
      { scheme: "oeo", value: "OEO_001", relation: "exactMatch" },
      { scheme: "oeo", value: "OEO_002", relation: "closeMatch" },
      { scheme: "wikidata", value: "OEO_001", relation: "exactMatch" }
    ];
    expect(Schema.decodeUnknownSync(Aliases)(aliases)).toHaveLength(3);
  });

  it("rejects list with duplicate (scheme, value) pair", () => {
    const aliases = [
      { scheme: "oeo", value: "OEO_001", relation: "exactMatch" },
      { scheme: "oeo", value: "OEO_001", relation: "closeMatch" }
    ];
    expect(() => Schema.decodeUnknownSync(Aliases)(aliases)).toThrow();
  });
});
