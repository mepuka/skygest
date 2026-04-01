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

describe("validateStoredEnrichment", () => {
  it("returns typed result for valid vision enrichment", () => {
    const result = validateStoredEnrichment({
      enrichmentType: "vision",
      enrichmentPayload: {
        kind: "vision",
        summary: {
          text: "Chart shows solar growth",
          mediaTypes: ["chart"],
          chartTypes: ["line-chart"],
          titles: ["Solar Capacity"],
          keyFindings: []
        },
        assets: [],
        modelId: "gemini-2.5-flash",
        promptVersion: "v2",
        processedAt: 1710000000000
      },
      enrichedAt: 1710000000000
    });
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("vision");
  });

  it("returns null for decode failure", () => {
    const result = validateStoredEnrichment({
      enrichmentType: "vision",
      enrichmentPayload: { kind: "vision", garbage: true },
      enrichedAt: 1710000000000
    });
    expect(result).toBeNull();
  });

  it("returns null for kind mismatch", () => {
    const result = validateStoredEnrichment({
      enrichmentType: "source-attribution",
      enrichmentPayload: {
        kind: "vision",
        summary: {
          text: "test",
          mediaTypes: ["chart"],
          chartTypes: ["line-chart"],
          titles: [],
          keyFindings: []
        },
        assets: [],
        modelId: "gemini-2.5-flash",
        promptVersion: "v2",
        processedAt: 1710000000000
      },
      enrichedAt: 1710000000000
    });
    expect(result).toBeNull();
  });
});

describe("computeReadiness", () => {
  it("returns complete when validated enrichments exist and no active runs", () => {
    const enrichments = [{ kind: "vision" }] as ReadonlyArray<PostEnrichmentResult>;
    const runs: ReadonlyArray<PostEnrichmentRunSummary> = [];
    expect(computeReadiness(enrichments, runs)).toBe("complete");
  });

  it("returns needs-review when any run is needs-review", () => {
    const enrichments: ReadonlyArray<PostEnrichmentResult> = [];
    const runs = [
      { enrichmentType: "vision", status: "needs-review", phase: "needs-review", lastProgressAt: null, finishedAt: null }
    ] as ReadonlyArray<PostEnrichmentRunSummary>;
    expect(computeReadiness(enrichments, runs)).toBe("needs-review");
  });

  it("returns failed when any run is failed and none are needs-review", () => {
    const enrichments: ReadonlyArray<PostEnrichmentResult> = [];
    const runs = [
      { enrichmentType: "vision", status: "failed", phase: "failed", lastProgressAt: null, finishedAt: null }
    ] as ReadonlyArray<PostEnrichmentRunSummary>;
    expect(computeReadiness(enrichments, runs)).toBe("failed");
  });

  it("returns pending when any run is queued or running", () => {
    const enrichments: ReadonlyArray<PostEnrichmentResult> = [];
    const runs = [
      { enrichmentType: "vision", status: "queued", phase: "queued", lastProgressAt: null, finishedAt: null }
    ] as ReadonlyArray<PostEnrichmentRunSummary>;
    expect(computeReadiness(enrichments, runs)).toBe("pending");
  });

  it("returns none when no enrichments and no runs", () => {
    expect(computeReadiness([], [])).toBe("none");
  });

  it("returns pending when enrichments exist but a run is still active", () => {
    const enrichments = [{ kind: "vision" }] as ReadonlyArray<PostEnrichmentResult>;
    const runs = [
      { enrichmentType: "source-attribution", status: "queued", phase: "queued", lastProgressAt: null, finishedAt: null }
    ] as ReadonlyArray<PostEnrichmentRunSummary>;
    expect(computeReadiness(enrichments, runs)).toBe("pending");
  });

  it("returns complete only when enrichments exist and no runs are active", () => {
    const enrichments = [{ kind: "vision" }] as ReadonlyArray<PostEnrichmentResult>;
    const runs = [
      { enrichmentType: "vision", status: "complete", phase: "complete", lastProgressAt: 1710000000000, finishedAt: 1710000000000 }
    ] as ReadonlyArray<PostEnrichmentRunSummary>;
    expect(computeReadiness(enrichments, runs)).toBe("complete");
  });
});

describe("PostEnrichmentReadService", () => {
  const makeServiceLayer = () => {
    const base = makeBiLayer();
    const enrichmentRunsLayer = EnrichmentRunsRepoD1.layer.pipe(
      Layer.provideMerge(base)
    );
    return PostEnrichmentReadService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(base, enrichmentRunsLayer))
    );
  };

  it.effect("returns none readiness for a post with no enrichments or runs", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* PostEnrichmentReadService;
      const result = yield* service.getPost(
        `at://${sampleDid}/app.bsky.feed.post/post-solar`
      );
      expect(result.readiness).toBe("none");
      expect(result.enrichments).toHaveLength(0);
      expect(result.latestRuns).toHaveLength(0);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("returns none readiness for a post that does not exist", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const service = yield* PostEnrichmentReadService;
      const result = yield* service.getPost(
        "at://did:plc:nonexistent/app.bsky.feed.post/fake"
      );
      expect(result.readiness).toBe("none");
      expect(result.enrichments).toHaveLength(0);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("works without EnrichmentRunsRepo in the environment", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* PostEnrichmentReadService;
      const result = yield* service.getPost(
        `at://${sampleDid}/app.bsky.feed.post/post-solar`
      );
      expect(result.readiness).toBe("none");
      expect(result.latestRuns).toHaveLength(0);
    }).pipe(
      Effect.provide(
        PostEnrichmentReadService.layer.pipe(
          Layer.provideMerge(makeBiLayer())
        )
      )
    )
  );
});
