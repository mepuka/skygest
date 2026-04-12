import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import manifestJson from "../references/energy-profile/shacl-manifest.json";
import { EnergyProfileManifest } from "../src/domain/energyProfileManifest";
import {
  AggregationMembers,
  FACET_KEYS,
  REQUIRED_FACET_KEYS,
  StatisticTypeMembers,
  UnitFamilyMembers
} from "../src/domain/generated/energyVariableProfile";

const decodeManifest = Schema.decodeUnknownResult(EnergyProfileManifest);

describe("energy profile manifest", () => {
  it("decodes the checked-in manifest", () => {
    const result = decodeManifest(manifestJson);
    expect(Result.isSuccess(result)).toBe(true);
  });

  it("locks the checked-in manifest to the current profile contract", () => {
    const manifest = Schema.decodeUnknownSync(EnergyProfileManifest)(manifestJson);

    expect(manifest.facetKeys).toEqual(FACET_KEYS);
    expect(manifest.requiredFacetKeys).toEqual(REQUIRED_FACET_KEYS);
    expect(manifest.closedEnums.StatisticType.values).toEqual(StatisticTypeMembers);
    expect(manifest.closedEnums.Aggregation.values).toEqual(AggregationMembers);
    expect(manifest.closedEnums.UnitFamily.values).toEqual(UnitFamilyMembers);
    expect(Object.keys(manifest.closedEnums)).not.toContain("Frequency");
  });

  it("rejects malformed manifest payloads", () => {
    const result = decodeManifest({
      manifestVersion: 1,
      sourceCommit: "abc123",
      generatedAt: "2026-04-12T20:00:00.000Z",
      inputHash: "sha256:test",
      facetKeys: FACET_KEYS,
      requiredFacetKeys: REQUIRED_FACET_KEYS,
      closedEnums: {
        StatisticType: {
          shapeIri: "https://example.com/statistic",
          values: ["stock"]
        },
        Aggregation: {
          shapeIri: "https://example.com/aggregation",
          values: ["point"]
        }
      }
    });

    expect(Result.isFailure(result)).toBe(true);
  });
});
