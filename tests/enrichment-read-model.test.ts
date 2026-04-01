import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  EnrichmentReadiness,
  GetPostEnrichmentsInput,
  PostEnrichmentRunSummary,
  GetPostEnrichmentsOutput,
  type PostEnrichmentResult
} from "../src/domain/enrichment";
import {
  validateStoredEnrichment,
  computeReadiness
} from "../src/enrichment/PostEnrichmentReadModel";
import { PostEnrichmentReadService } from "../src/services/PostEnrichmentReadService";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";
import { EnrichmentRunsRepoD1 } from "../src/services/d1/EnrichmentRunsRepoD1";
import { makeBiLayer, seedKnowledgeBase, sampleDid } from "./support/runtime";
import { runMigrations } from "../src/db/migrate";
import { formatEnrichments } from "../src/mcp/Fmt";

describe("enrichment read model domain schemas", () => {
  it("decodes EnrichmentReadiness literals", () => {
    const decode = Schema.decodeUnknownSync(EnrichmentReadiness);
    expect(decode("none")).toBe("none");
    expect(decode("pending")).toBe("pending");
    expect(decode("complete")).toBe("complete");
    expect(decode("failed")).toBe("failed");
    expect(decode("needs-review")).toBe("needs-review");
    expect(() => decode("invalid")).toThrow();
  });

  it("decodes GetPostEnrichmentsInput", () => {
    const decode = Schema.decodeUnknownSync(GetPostEnrichmentsInput);
    const input = decode({ postUri: "at://did:plc:abc/app.bsky.feed.post/xyz" });
    expect(input.postUri).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");
  });

  it("decodes PostEnrichmentRunSummary", () => {
    const decode = Schema.decodeUnknownSync(PostEnrichmentRunSummary);
    const summary = decode({
      enrichmentType: "vision",
      status: "complete",
      phase: "complete",
      lastProgressAt: 1710000000000,
      finishedAt: 1710000000000
    });
    expect(summary.enrichmentType).toBe("vision");
    expect(summary.status).toBe("complete");
  });

  it("decodes GetPostEnrichmentsOutput", () => {
    const decode = Schema.decodeUnknownSync(GetPostEnrichmentsOutput);
    const output = decode({
      postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      readiness: "none",
      enrichments: [],
      latestRuns: []
    });
    expect(output.readiness).toBe("none");
    expect(output.enrichments).toHaveLength(0);
    expect(output.latestRuns).toHaveLength(0);
  });
});
