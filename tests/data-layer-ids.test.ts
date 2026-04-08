import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  VariableId, SeriesId, ObservationId, AgentId, CatalogId,
  CatalogRecordId, DatasetId, DistributionId, DataServiceId,
  DatasetSeriesId, CandidateId
} from "../src/domain/data-layer";

describe("data-layer branded IDs", () => {
  const validCases: Array<[string, Schema.Decoder<string>, string]> = [
    ["VariableId", VariableId, "https://id.skygest.io/variable/var_01JR8X2K9ABCDEFGH"],
    ["SeriesId", SeriesId, "https://id.skygest.io/series/ser_01JR8X3M2ABCDEFGH"],
    ["ObservationId", ObservationId, "https://id.skygest.io/observation/obs_01JR8X4N5ABCDEFGH"],
    ["AgentId", AgentId, "https://id.skygest.io/agent/ag_01JR8X5P8ABCDEFGH"],
    ["CatalogId", CatalogId, "https://id.skygest.io/catalog/cat_01JR8X6Q3ABCDEFGH"],
    ["CatalogRecordId", CatalogRecordId, "https://id.skygest.io/catalog-record/cr_01JR8X7R6ABCDEFGH"],
    ["DatasetId", DatasetId, "https://id.skygest.io/dataset/ds_01JR8X8S9ABCDEFGH"],
    ["DistributionId", DistributionId, "https://id.skygest.io/distribution/dist_01JR8X9T2ABCDEFGH"],
    ["DataServiceId", DataServiceId, "https://id.skygest.io/data-service/svc_01JR8XAU5ABCDEFGH"],
    ["DatasetSeriesId", DatasetSeriesId, "https://id.skygest.io/dataset-series/dser_01JR8XBV8ABCDEFGH"],
    ["CandidateId", CandidateId, "https://id.skygest.io/candidate/cand_01JR8XCW1ABCDEFGH"]
  ];

  for (const [name, schema, valid] of validCases) {
    it(`${name} accepts valid URI`, () => {
      expect(String(Schema.decodeSync(schema)(valid))).toBe(valid);
    });

    it(`${name} rejects wrong entity-kind path`, () => {
      expect(() => Schema.decodeSync(schema)("https://id.skygest.io/wrong/var_01JR8X2K9ABC")).toThrow();
    });

    it(`${name} rejects plain string`, () => {
      expect(() => Schema.decodeSync(schema)("just-a-string")).toThrow();
    });
  }

  it("VariableId and SeriesId are not interchangeable", () => {
    const validVar = "https://id.skygest.io/variable/var_01JR8X2K9ABCDEFGH";
    expect(() => Schema.decodeSync(SeriesId)(validVar)).toThrow();
  });

  it("rejects too-short suffix (e.g., var_x)", () => {
    expect(() => Schema.decodeSync(VariableId)("https://id.skygest.io/variable/var_x")).toThrow();
  });

  it("rejects single-char suffix", () => {
    expect(() => Schema.decodeSync(AgentId)("https://id.skygest.io/agent/ag_A")).toThrow();
  });
});
