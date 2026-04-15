import { describe, expect, it } from "@effect/vitest";
import { existsSync, readFileSync } from "node:fs";
import { Candidate } from "../src/domain/data-layer";
import { Schema } from "effect";
import { checkedInDataLayerRegistryRoot } from "../src/bootstrap/CheckedInDataLayerRegistry";

const ROOT = checkedInDataLayerRegistryRoot;
const pjmCapacitySeriesPath = `${ROOT}/series/us-pjm-capacity-auction-annual.json`;
const pjmCapacityCandidatePath =
  `${ROOT}/candidates/cand-256-tf7gldn_app_bsky_feed_post_3mijrwbak6p2j.json`;

describe("SKY-324 cold-start series hygiene", () => {
  it("retracts the fabricated PJM capacity-auction series from checked-in series", () => {
    expect(existsSync(pjmCapacitySeriesPath)).toBe(false);
  });

  it("keeps the PJM capacity candidate partial until an honest series exists", () => {
    const candidate = Schema.decodeUnknownSync(Candidate)(
      JSON.parse(readFileSync(pjmCapacityCandidatePath, "utf-8"))
    );

    expect(candidate.resolutionState).toBe("partially_resolved");
    expect(candidate.referencedDatasetId).toBe(
      "https://id.skygest.io/dataset/ds_01KNQEZ5VRA0G6PMJAY725QSPF"
    );
    expect(candidate.referencedDistributionId).toBe(
      "https://id.skygest.io/distribution/dist_01KNQEZ5VRKANWZWK2B1VYDRBK"
    );
    expect(candidate.referencedVariableId).toBeUndefined();
    expect(candidate.referencedSeriesId).toBeUndefined();
  });
});
