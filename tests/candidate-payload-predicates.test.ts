import { describe, expect, it } from "@effect/vitest";
import {
  isPickedCandidatePayloadRecord,
  isPickedCandidatePayloadStage
} from "../src/domain/CandidatePayloadPredicates";
import type { CandidatePayloadRecord } from "../src/domain/candidatePayload";
import type { PostUri } from "../src/domain/types";

const makePayload = (
  captureStage: CandidatePayloadRecord["captureStage"]
): CandidatePayloadRecord => ({
  postUri: "at://did:plc:test/app.bsky.feed.post/test" as PostUri,
  captureStage,
  embedType: null,
  embedPayload: null,
  enrichments: [],
  capturedAt: 1,
  updatedAt: 1,
  enrichedAt: null
});

describe("CandidatePayloadPredicates", () => {
  it("recognizes the picked payload stage", () => {
    expect(isPickedCandidatePayloadStage("picked")).toBe(true);
    expect(isPickedCandidatePayloadStage("candidate")).toBe(false);
  });

  it("recognizes picked payload records", () => {
    expect(isPickedCandidatePayloadRecord(makePayload("picked"))).toBe(true);
    expect(isPickedCandidatePayloadRecord(makePayload("candidate"))).toBe(false);
  });
});
