import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { Candidate, DataLayerRecord } from "../src/domain/data-layer";

const partialCandidate = {
  _tag: "Candidate" as const,
  id: "https://id.skygest.io/candidate/cand_01JR8XCPARTIALTEST",
  sourceRef: { contentId: "at://did:plc:abc/app.bsky.feed.post/123" },
  referencedDistributionId:
    "https://id.skygest.io/distribution/dist_01JR8X9T2ABCDEFGH",
  resolutionState: "partially_resolved" as const,
  createdAt: "2026-04-08T00:00:00.000Z"
};

const podcastCandidate = {
  _tag: "Candidate" as const,
  id: "https://id.skygest.io/candidate/cand_01JR8XCPODCASTTEST",
  sourceRef: {
    contentId:
      "podcast-segment://catalyst-canary-media/2026-04-04/segment-3"
  },
  resolutionState: "source_only" as const,
  createdAt: "2026-04-08T00:00:00.000Z"
};

describe("Candidate", () => {
  it("decodes a partially resolved candidate from a post", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(partialCandidate);
    expect(decoded.resolutionState).toBe("partially_resolved");
    expect(decoded.referencedVariableId).toBeUndefined();
  });

  it("decodes a candidate from a podcast segment", () => {
    const decoded = Schema.decodeUnknownSync(Candidate)(podcastCandidate);
    expect(decoded.sourceRef.contentId).toContain("podcast-segment://");
  });

  it("rejects candidate with invalid resolution state", () => {
    expect(() =>
      Schema.decodeUnknownSync(Candidate)({
        ...partialCandidate,
        resolutionState: "invalid"
      })
    ).toThrow();
  });
});

describe("DataLayerRecord (Candidate | Observation union)", () => {
  it("discriminates candidate by _tag", () => {
    const decoded =
      Schema.decodeUnknownSync(DataLayerRecord)(partialCandidate);
    expect(decoded._tag).toBe("Candidate");
  });

  it("discriminates observation by _tag", () => {
    const obs = {
      _tag: "Observation" as const,
      id: "https://id.skygest.io/observation/obs_01JR8X4N5ABCDEFGH",
      seriesId: "https://id.skygest.io/series/ser_01JR8X3M2ABCDEFGH",
      time: { start: "2025-12-31" },
      value: 41250,
      unit: "MW",
      sourceDistributionId:
        "https://id.skygest.io/distribution/dist_01JR8X9T2ABCDEFGH"
    };
    const decoded = Schema.decodeUnknownSync(DataLayerRecord)(obs);
    expect(decoded._tag).toBe("Observation");
  });

  it("exhaustive switch compiles", () => {
    const describe = (r: typeof DataLayerRecord.Type): string => {
      switch (r._tag) {
        case "Candidate":
          return `candidate:${r.resolutionState}`;
        case "Observation":
          return `observation:${r.value}`;
      }
    };
    expect(
      describe(Schema.decodeUnknownSync(DataLayerRecord)(partialCandidate))
    ).toBe("candidate:partially_resolved");
  });
});
