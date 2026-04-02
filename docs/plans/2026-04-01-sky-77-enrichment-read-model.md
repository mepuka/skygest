# SKY-77: Brief and Claim Read Model Exposure

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose enrichment state and readiness through a shared read model used by both MCP (`get_post_enrichments`) and the public API (`/api/posts/:uri/enrichments`).

**Architecture:** Extract enrichment payload validation from `src/api/Router.ts` into a pure read model. Create a `PostEnrichmentReadService` that combines payload data from `CandidatePayloadService` with run state from `EnrichmentRunsRepo` (optional — environments without workflow bindings still work). Add `get_post_enrichments` as a read tool on all MCP toolkit variants. Readiness is computed from a priority-ordered rule set: active runs always take precedence (a post is only `complete` when no runs are still active).

**Tech Stack:** Effect.ts (Context.Tag, Layer.effect, Schema, Effect.serviceOption), D1 SQL, @effect/ai Tool/Toolkit, @effect/printer Doc

---

## Task 1: Domain Schemas

**Files:**
- Modify: `src/domain/enrichment.ts`
- Test: `tests/enrichment-read-model.test.ts`

### Step 1: Write the failing test

Create `tests/enrichment-read-model.test.ts` with **all imports for Tasks 1, 2, 4, and 5 at the top** — later tasks will add `describe` blocks but NOT new imports mid-file:

```ts
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
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: FAIL — `EnrichmentReadiness` is not exported from `../src/domain/enrichment`

### Step 3: Add domain schemas

In `src/domain/enrichment.ts`, add these schemas after the `PostEnrichmentsOutput` schema (before end of file):

```ts
// ---------------------------------------------------------------------------
// Enrichment readiness (SKY-77: shared read model)
// ---------------------------------------------------------------------------

export const EnrichmentReadiness = Schema.Literal(
  "none",
  "pending",
  "complete",
  "failed",
  "needs-review"
);
export type EnrichmentReadiness = Schema.Schema.Type<typeof EnrichmentReadiness>;

export const GetPostEnrichmentsInput = Schema.Struct({
  postUri: AtUri
});
export type GetPostEnrichmentsInput = Schema.Schema.Type<typeof GetPostEnrichmentsInput>;

export const PostEnrichmentRunSummary = Schema.Struct({
  enrichmentType: EnrichmentKind,
  status: EnrichmentRunStatus,
  phase: EnrichmentRunPhase,
  lastProgressAt: Schema.NullOr(Schema.Number),
  finishedAt: Schema.NullOr(Schema.Number)
});
export type PostEnrichmentRunSummary = Schema.Schema.Type<typeof PostEnrichmentRunSummary>;

export const GetPostEnrichmentsOutput = Schema.Struct({
  postUri: AtUri,
  readiness: EnrichmentReadiness,
  enrichments: Schema.Array(PostEnrichmentResult),
  latestRuns: Schema.Array(PostEnrichmentRunSummary)
});
export type GetPostEnrichmentsOutput = Schema.Schema.Type<typeof GetPostEnrichmentsOutput>;
```

Note: This imports `EnrichmentRunStatus` and `EnrichmentRunPhase` from `./enrichmentRun`. Add this import at the top of the file:

```ts
import { EnrichmentRunStatus, EnrichmentRunPhase } from "./enrichmentRun";
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/domain/enrichment.ts tests/enrichment-read-model.test.ts
git commit -m "feat(domain): add enrichment readiness schemas (SKY-77)"
```

---

## Task 2: Pure Read Model — Payload Validation + Readiness Computation

**Files:**
- Create: `src/enrichment/PostEnrichmentReadModel.ts`
- Modify: `tests/enrichment-read-model.test.ts`

### Step 1: Write the failing tests

Append these `describe` blocks to `tests/enrichment-read-model.test.ts` (all imports are already at the top from Task 1):

```ts
describe("validateStoredEnrichment", () => {
  it("returns typed result for valid vision enrichment", () => {
    const result = validateStoredEnrichment({
      enrichmentType: "vision",
      enrichmentPayload: {
        kind: "vision",
        summary: {
          text: "Chart shows solar growth",
          mediaTypes: ["chart"],
          chartTypes: ["line"],
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
          chartTypes: ["line"],
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
  it("returns complete when validated enrichments exist", () => {
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
```

Note: The imports for `validateStoredEnrichment`, `computeReadiness`, and `PostEnrichmentResult` are already at the top of the file from Task 1. The `import` lines will show type errors until you create the module in Step 3 — that's expected and part of TDD.

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: FAIL — `validateStoredEnrichment` is not exported / module not found

### Step 3: Implement the read model

Create `src/enrichment/PostEnrichmentReadModel.ts`:

```ts
import { Either, Schema } from "effect";
import {
  EnrichmentOutput,
  type PostEnrichmentResult,
  type EnrichmentReadiness,
  type PostEnrichmentRunSummary
} from "../domain/enrichment";

/**
 * Validate a stored enrichment record by decoding the payload and
 * verifying the kind discriminator matches the stored enrichment type.
 *
 * Returns null for decode failures or kind mismatches — these are
 * filtered out rather than surfaced as errors.
 */
export const validateStoredEnrichment = (enrichment: {
  readonly enrichmentType: string;
  readonly enrichmentPayload: unknown;
  readonly enrichedAt: number;
}): PostEnrichmentResult | null => {
  const decoded = Schema.decodeUnknownEither(EnrichmentOutput)(
    enrichment.enrichmentPayload
  );

  if (Either.isLeft(decoded)) {
    return null;
  }

  if (decoded.right.kind !== enrichment.enrichmentType) {
    return null;
  }

  return {
    kind: decoded.right.kind,
    payload: decoded.right,
    enrichedAt: enrichment.enrichedAt
  } as PostEnrichmentResult;
};

/**
 * Compute enrichment readiness from validated enrichments and latest
 * run summaries. Active runs always take precedence — a post is only
 * `complete` when enrichments exist AND no runs are still active.
 *
 * Priority order:
 * 1. any run is needs-review                        → needs-review
 * 2. any run is failed                              → failed
 * 3. any run is queued/running                      → pending
 * 4. validated enrichments exist (no active runs)   → complete
 * 5. else                                           → none
 *
 * This matches the glossary definition: a post is Reviewable only
 * when ALL enrichments are finished successfully.
 */
export const computeReadiness = (
  enrichments: ReadonlyArray<PostEnrichmentResult>,
  latestRuns: ReadonlyArray<PostEnrichmentRunSummary>
): EnrichmentReadiness => {
  if (latestRuns.some((r) => r.status === "needs-review")) return "needs-review";
  if (latestRuns.some((r) => r.status === "failed")) return "failed";
  if (latestRuns.some((r) => r.status === "queued" || r.status === "running")) return "pending";
  if (enrichments.length > 0) return "complete";
  return "none";
};
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/enrichment/PostEnrichmentReadModel.ts tests/enrichment-read-model.test.ts
git commit -m "feat(enrichment): extract shared payload validation and readiness computation (SKY-77)"
```

---

## Task 3: EnrichmentRunsRepo — Post-Oriented Run Lookup

**Files:**
- Modify: `src/services/EnrichmentRunsRepo.ts`
- Modify: `src/services/d1/EnrichmentRunsRepoD1.ts`
- Modify: `tests/enrichment-runs-repo.test.ts`

### Step 1: Write the failing test

Add to `tests/enrichment-runs-repo.test.ts` (in the existing `describe` block):

```ts
it("listLatestByPostUri returns latest run per enrichment type", () =>
  Effect.gen(function* () {
    yield* runMigrations;
    yield* seedPickedPayload();
    const repo = yield* EnrichmentRunsRepo;
    const postUri = "at://did:plc:test/app.bsky.feed.post/post1" as AtUri;
    const now = Date.now();

    // Create two vision runs with different schema versions so the
    // unique index (post_uri, enrichment_type, schema_version) allows both.
    // The older run uses "v1", the newer uses "v2".
    yield* repo.createQueuedIfAbsent({
      id: "run-v1",
      workflowInstanceId: "wf-v1",
      postUri,
      enrichmentType: "vision",
      schemaVersion: "v1",
      triggeredBy: "pick",
      requestedBy: null,
      modelLane: null,
      promptVersion: null,
      inputFingerprint: null,
      startedAt: now - 10_000
    });
    yield* repo.createQueuedIfAbsent({
      id: "run-v2",
      workflowInstanceId: "wf-v2",
      postUri,
      enrichmentType: "vision",
      schemaVersion: "v2",
      triggeredBy: "repair",
      requestedBy: null,
      modelLane: null,
      promptVersion: null,
      inputFingerprint: null,
      startedAt: now
    });

    // Create a source-attribution run
    yield* repo.createQueuedIfAbsent({
      id: "run-sa1",
      workflowInstanceId: "wf-sa1",
      postUri,
      enrichmentType: "source-attribution",
      schemaVersion: "v2",
      triggeredBy: "pick",
      requestedBy: null,
      modelLane: null,
      promptVersion: null,
      inputFingerprint: null,
      startedAt: now
    });

    const results = yield* repo.listLatestByPostUri(postUri);
    expect(results).toHaveLength(2);

    const visionRun = results.find((r) => r.enrichmentType === "vision");
    expect(visionRun?.id).toBe("run-v2");

    const saRun = results.find((r) => r.enrichmentType === "source-attribution");
    expect(saRun?.id).toBe("run-sa1");
  }).pipe(Effect.provide(makeLayer()), Effect.runPromise)
);
```

You may need to add imports: `import { AtUri } from "../src/domain/types"` and `import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo"` if not already present in the test file.

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-runs-repo.test.ts`
Expected: FAIL — `repo.listLatestByPostUri` is not a function

### Step 3: Add the method to the interface

In `src/services/EnrichmentRunsRepo.ts`, add to the service interface (after `resetForRetry`):

```ts
    readonly listLatestByPostUri: (
      postUri: string
    ) => Effect.Effect<ReadonlyArray<EnrichmentRunRecord>, SqlError | DbError>;
```

### Step 4: Implement in D1

In `src/services/d1/EnrichmentRunsRepoD1.ts`, add the query implementation (after `resetForRetry` and before `return EnrichmentRunsRepo.of({`):

```ts
    const listLatestByPostUri = (postUri: string) =>
      sql<any>`
        SELECT ${selectColumns}
        FROM post_enrichment_runs
        WHERE (post_uri, enrichment_type, started_at) IN (
          SELECT post_uri, enrichment_type, MAX(started_at)
          FROM post_enrichment_runs
          WHERE post_uri = ${postUri}
          GROUP BY post_uri, enrichment_type
        )
        ORDER BY enrichment_type ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeRows(rows, `Failed to decode latest enrichment runs for ${postUri}`)
        )
      );
```

Then add `listLatestByPostUri` to the `EnrichmentRunsRepo.of({...})` object.

### Step 5: Run test to verify it passes

Run: `bun run test tests/enrichment-runs-repo.test.ts`
Expected: PASS

### Step 6: Commit

```bash
git add src/services/EnrichmentRunsRepo.ts src/services/d1/EnrichmentRunsRepoD1.ts tests/enrichment-runs-repo.test.ts
git commit -m "feat(enrichment): add post-oriented run lookup method (SKY-77)"
```

---

## Task 4: PostEnrichmentReadService

**Files:**
- Create: `src/services/PostEnrichmentReadService.ts`
- Modify: `tests/enrichment-read-model.test.ts`

### Step 1: Write the failing test

Append this `describe` block to `tests/enrichment-read-model.test.ts` (all imports are already at the top from Task 1):

```ts
describe("PostEnrichmentReadService", () => {
  const makeLayer = () => {
    const base = makeBiLayer();
    const enrichmentRunsLayer = EnrichmentRunsRepoD1.layer.pipe(
      Layer.provideMerge(base)
    );
    return PostEnrichmentReadService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(base, enrichmentRunsLayer))
    );
  };

  it("returns none readiness for a post with no enrichments or runs", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* PostEnrichmentReadService;
      const result = yield* service.getPost(
        `at://${sampleDid}/app.bsky.feed.post/post-solar`
      );
      expect(result.readiness).toBe("none");
      expect(result.enrichments).toHaveLength(0);
      expect(result.latestRuns).toHaveLength(0);
    }).pipe(Effect.provide(makeLayer()), Effect.runPromise)
  );

  it("returns none readiness for a post that does not exist", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const service = yield* PostEnrichmentReadService;
      const result = yield* service.getPost(
        "at://did:plc:nonexistent/app.bsky.feed.post/fake"
      );
      expect(result.readiness).toBe("none");
      expect(result.enrichments).toHaveLength(0);
    }).pipe(Effect.provide(makeLayer()), Effect.runPromise)
  );

  it("works without EnrichmentRunsRepo in the environment", () =>
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
      ),
      Effect.runPromise
    )
  );
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: FAIL — `PostEnrichmentReadService` module not found

### Step 3: Implement the service

Create `src/services/PostEnrichmentReadService.ts`:

```ts
import { Context, Effect, Layer, Option } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  GetPostEnrichmentsOutput,
  PostEnrichmentRunSummary
} from "../domain/enrichment";
import { CandidatePayloadService } from "./CandidatePayloadService";
import { EnrichmentRunsRepo } from "./EnrichmentRunsRepo";
import {
  validateStoredEnrichment,
  computeReadiness
} from "../enrichment/PostEnrichmentReadModel";

export class PostEnrichmentReadService extends Context.Tag(
  "@skygest/PostEnrichmentReadService"
)<
  PostEnrichmentReadService,
  {
    readonly getPost: (
      postUri: string
    ) => Effect.Effect<GetPostEnrichmentsOutput, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(
    PostEnrichmentReadService,
    Effect.gen(function* () {
      const payloadService = yield* CandidatePayloadService;
      const runsRepoOption = yield* Effect.serviceOption(EnrichmentRunsRepo);

      const getPost = Effect.fn("PostEnrichmentReadService.getPost")(
        function* (postUri: string) {
          const payload = yield* payloadService.getPayload(postUri);

          const enrichments =
            payload === null
              ? []
              : payload.enrichments.flatMap((e) => {
                  const result = validateStoredEnrichment(e);
                  return result === null ? [] : [result];
                });

          const latestRuns: ReadonlyArray<PostEnrichmentRunSummary> =
            Option.isSome(runsRepoOption)
              ? yield* runsRepoOption.value
                  .listLatestByPostUri(postUri)
                  .pipe(
                    Effect.map((runs) =>
                      runs.map((r) => ({
                        enrichmentType: r.enrichmentType,
                        status: r.status,
                        phase: r.phase,
                        lastProgressAt: r.lastProgressAt,
                        finishedAt: r.finishedAt
                      }))
                    )
                  )
              : [];

          const readiness = computeReadiness(enrichments, latestRuns);

          return {
            postUri: postUri as GetPostEnrichmentsOutput["postUri"],
            readiness,
            enrichments,
            latestRuns
          };
        }
      );

      return PostEnrichmentReadService.of({ getPost });
    })
  );
}
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/services/PostEnrichmentReadService.ts tests/enrichment-read-model.test.ts
git commit -m "feat(enrichment): add PostEnrichmentReadService with optional run state (SKY-77)"
```

---

## Task 5: MCP Tool Definition + Output Schema + Formatter

**Files:**
- Modify: `src/domain/enrichment.ts` (no change needed — `GetPostEnrichmentsInput` already added in Task 1)
- Modify: `src/mcp/OutputSchemas.ts`
- Modify: `src/mcp/Fmt.ts`
- Modify: `src/mcp/Toolkit.ts` (tool definition only, handlers in Task 6)
- Modify: `tests/enrichment-read-model.test.ts`

### Step 1: Write the failing test for the formatter

Append this `describe` block to `tests/enrichment-read-model.test.ts` (all imports are already at the top from Task 1):

```ts
describe("formatEnrichments", () => {
  it("formats empty enrichments with none readiness", () => {
    const result = formatEnrichments({
      postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      readiness: "none",
      enrichments: [],
      latestRuns: []
    });
    expect(result).toContain("at://did:plc:abc/app.bsky.feed.post/xyz");
    expect(result).toContain("Readiness: none");
    expect(result).toContain("No enrichments");
  });

  it("formats vision enrichment with complete readiness", () => {
    const result = formatEnrichments({
      postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      readiness: "complete",
      enrichments: [{
        kind: "vision",
        payload: {
          kind: "vision",
          summary: {
            text: "Chart shows solar capacity growth in 2025",
            mediaTypes: ["chart"],
            chartTypes: ["line"],
            titles: ["US Solar Capacity"],
            keyFindings: [{ text: "Solar up 30%", assetKeys: ["a1"] }]
          },
          assets: [
            {
              assetKey: "a1",
              assetType: "image",
              source: "embed",
              index: 0,
              originalAltText: null,
              analysis: {
                mediaType: "chart",
                chartTypes: ["line"],
                altText: "Solar capacity line chart",
                altTextProvenance: "generated",
                xAxis: null,
                yAxis: null,
                series: [],
                sourceLines: [],
                temporalCoverage: null,
                keyFindings: ["Solar up 30%"],
                visibleUrls: [],
                organizationMentions: [],
                logoText: [],
                title: "US Solar Capacity",
                modelId: "gemini-2.5-flash",
                processedAt: 1710000000000
              }
            }
          ],
          modelId: "gemini-2.5-flash",
          promptVersion: "v2",
          processedAt: 1710000000000
        },
        enrichedAt: 1710000000000
      }],
      latestRuns: []
    });
    expect(result).toContain("Readiness: complete");
    expect(result).toContain("[V] vision");
    expect(result).toContain("1 asset");
    expect(result).toContain("Solar capacity");
  });

  it("formats pending runs", () => {
    const result = formatEnrichments({
      postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
      readiness: "pending",
      enrichments: [],
      latestRuns: [
        {
          enrichmentType: "vision",
          status: "queued",
          phase: "queued",
          lastProgressAt: 1710000000000,
          finishedAt: null
        }
      ]
    });
    expect(result).toContain("Readiness: pending");
    expect(result).toContain("vision: queued");
  });
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: FAIL — `formatEnrichments` is not exported from `../src/mcp/Fmt`

### Step 3: Add MCP output schema

In `src/mcp/OutputSchemas.ts`, add import and schema:

```ts
// Add to imports:
import { GetPostEnrichmentsOutput } from "../domain/enrichment.ts";

// Add at end of file:
export const PostEnrichmentsMcpOutput = Schema.extend(GetPostEnrichmentsOutput, DisplayField);
export type PostEnrichmentsMcpOutput = Schema.Schema.Type<typeof PostEnrichmentsMcpOutput>;
```

### Step 4: Add the formatter

In `src/mcp/Fmt.ts`, add at the end (before any closing exports):

```ts
// Add to imports at top of file:
import type { GetPostEnrichmentsOutput } from "../domain/enrichment.ts";

// Add formatter function:

/**
 * Format enrichment state and readiness for MCP display.
 *
 * Shows readiness status, validated enrichments (kind, key details),
 * and active run summaries.
 */
export const formatEnrichments = (
  output: GetPostEnrichmentsOutput
): string => {
  const lines: string[] = [
    `Post: ${output.postUri}`,
    `Readiness: ${output.readiness}`
  ];

  if (output.enrichments.length === 0 && output.latestRuns.length === 0) {
    lines.push("No enrichments or active runs.");
    return lines.join("\n");
  }

  if (output.enrichments.length > 0) {
    lines.push("");
    for (const e of output.enrichments) {
      const date = formatTimestamp(e.enrichedAt);
      switch (e.kind) {
        case "vision": {
          const assetCount = e.payload.assets.length;
          const summary = truncate(collapse(e.payload.summary.text), 120);
          lines.push(`[V] vision \u00B7 ${assetCount} asset${assetCount !== 1 ? "s" : ""} \u00B7 ${date}`);
          lines.push(`    ${summary}`);
          break;
        }
        case "source-attribution": {
          const provider = e.payload.provider?.name ?? "no provider";
          const resolution = e.payload.resolution;
          lines.push(`[S] source-attribution \u00B7 ${resolution} \u00B7 ${provider} \u00B7 ${date}`);
          break;
        }
        case "grounding": {
          const evidenceCount = e.payload.supportingEvidence.length;
          const claim = truncate(collapse(e.payload.claimText), 100);
          lines.push(`[G] grounding \u00B7 ${evidenceCount} evidence \u00B7 ${date}`);
          lines.push(`    ${claim}`);
          break;
        }
      }
    }
  }

  if (output.latestRuns.length > 0) {
    lines.push("");
    lines.push("Runs:");
    for (const r of output.latestRuns) {
      const progress = r.lastProgressAt !== null ? ` \u00B7 ${formatTimestamp(r.lastProgressAt)}` : "";
      lines.push(`  ${r.enrichmentType}: ${r.status} (${r.phase})${progress}`);
    }
  }

  return lines.join("\n");
};
```

### Step 5: Add tool definition

In `src/mcp/Toolkit.ts`, add the tool definition (after existing tool definitions, before the toolkit variants section):

```ts
// Add to imports at top:
import { GetPostEnrichmentsInput } from "../domain/bi"; // NO — this is in enrichment.ts
// Actually add:
import { GetPostEnrichmentsInput } from "../domain/enrichment";
// And add to OutputSchemas import:
import { PostEnrichmentsMcpOutput } from "./OutputSchemas.ts";
// And add to Fmt import:
import { formatEnrichments } from "./Fmt.ts";

// Tool definition:
export const GetPostEnrichmentsTool = Tool.make("get_post_enrichments", {
  description: "Inspect enrichment state and readiness for a post. Returns validated enrichment payloads (vision, source-attribution, grounding) and latest enrichment run summaries. Readiness values: none, pending, complete, failed, needs-review.",
  parameters: GetPostEnrichmentsInput.fields,
  success: PostEnrichmentsMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Enrichments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);
```

Then add `GetPostEnrichmentsTool` to **all four** toolkit variants (it's a read tool):

- `ReadOnlyMcpToolkit` — add after `ListCurationCandidatesTool`
- `CurationWriteMcpToolkit` — add after `ListCurationCandidatesTool` (before `CuratePostTool`)
- `EditorialWriteMcpToolkit` — add after `ListCurationCandidatesTool` (before `SubmitEditorialPickTool`)
- `WorkflowWriteMcpToolkit` — add after `ListCurationCandidatesTool` (before `CuratePostTool`)

### Step 6: Run test to verify formatter passes

Run: `bun run test tests/enrichment-read-model.test.ts`
Expected: PASS

### Step 7: Commit

```bash
git add src/mcp/OutputSchemas.ts src/mcp/Fmt.ts src/mcp/Toolkit.ts tests/enrichment-read-model.test.ts
git commit -m "feat(mcp): add get_post_enrichments tool definition, output schema, and formatter (SKY-77)"
```

---

## Task 6: MCP Handlers Wiring + Service Import

**Files:**
- Modify: `src/mcp/Toolkit.ts` (handler implementations)
- Modify: `tests/mcp.test.ts` (tool count assertions)

### Step 1: Write the failing test

In `tests/mcp.test.ts`, the read-only tool list assertion uses an exact sorted array of tool names (line ~38). Add `"get_post_enrichments"` to this sorted array:

```ts
expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
  "expand_topics",
  "explain_post_topics",
  "get_post_enrichments",  // ADD THIS
  "get_post_links",
  "get_post_thread",
  "get_recent_posts",
  "get_thread_document",
  "get_topic",
  "list_curation_candidates",
  "list_editorial_picks",
  "list_experts",
  "list_topics",
  "search_posts"
]);
```

Also add a new test in `tests/mcp.test.ts` at the end (after the "MCP prompts by profile" describe block):

```ts
describe("MCP get_post_enrichments", () => {
  it.live("returns readiness for a post with no enrichments", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const seedLayer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(seedLayer)));

        const { client, close } = await createMcpClient(makeBiLayer({ filename }));

        try {
          const result = await client.callTool({
            name: "get_post_enrichments",
            arguments: { postUri: `at://${sampleDid}/app.bsky.feed.post/post-solar` }
          });
          expect(result.isError).toBe(false);
          const text = result.content.find(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          expect(text).toBeDefined();
          expect(text!.text).toContain("Readiness: none");
        } finally {
          await close();
        }
      })
    )
  );
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/mcp.test.ts`
Expected: FAIL — `get_post_enrichments` not in tool list / handler missing

### Step 3: Wire the handler

In `src/mcp/Toolkit.ts`:

1. Add `PostEnrichmentReadService` import:

```ts
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
```

2. Add the service type:

```ts
type PostEnrichmentReadServiceI = Context.Tag.Service<typeof PostEnrichmentReadService>;
```

3. Update `makeReadOnlyHandlers` to accept the new service and add the handler:

```ts
const makeReadOnlyHandlers = (
  queryService: KnowledgeQueryServiceI,
  editorialService: EditorialServiceI,
  curationService: CurationServiceI,
  bskyClient: BlueskyClientI,
  enrichmentReadService: PostEnrichmentReadServiceI
) => ({
  // ... existing handlers unchanged ...
  get_post_enrichments: (input: typeof GetPostEnrichmentsInput.Type) =>
    enrichmentReadService.getPost(input.postUri).pipe(
      Effect.map((result) => ({
        ...result,
        _display: formatEnrichments(result)
      })),
      Effect.mapError(toQueryError("get_post_enrichments"))
    )
});
```

4. Update all four handler layer `Effect.gen` blocks to yield the new service and pass it:

```ts
// In all four handler layers, add:
const enrichmentReadService = yield* PostEnrichmentReadService;

// And update the makeReadOnlyHandlers call to include it:
makeReadOnlyHandlers(queryService, editorialService, curationService, bskyClient, enrichmentReadService)
```

### Step 4: Run test to verify it passes

Run: `bun run test tests/mcp.test.ts`
Expected: PASS — but may fail on layer resolution if `PostEnrichmentReadService` is not in the test layer

### Step 5: Update test support if needed

If tests fail because `PostEnrichmentReadService` is not in the layer, update `tests/support/runtime.ts`:

In `makeBiLayer`, add `PostEnrichmentReadService` to the returned layer:

```ts
// Add import:
import { PostEnrichmentReadService } from "../../src/services/PostEnrichmentReadService";

// In makeBiLayer, add after candidatePayloadServiceLayer:
const enrichmentReadServiceLayer = PostEnrichmentReadService.layer.pipe(
  Layer.provideMerge(candidatePayloadServiceLayer)
);

// Add to the returned Layer.mergeAll:
enrichmentReadServiceLayer,
```

### Step 6: Run tests to verify

Run: `bun run test tests/mcp.test.ts`
Expected: PASS

### Step 7: Commit

```bash
git add src/mcp/Toolkit.ts tests/mcp.test.ts tests/support/runtime.ts
git commit -m "feat(mcp): wire get_post_enrichments handler into all toolkit variants (SKY-77)"
```

---

## Task 7: API Router Reuse

**Files:**
- Modify: `src/api/Router.ts`

### Step 1: Update the API route to use the shared service

In `src/api/Router.ts`, replace the inline `toPostEnrichmentResult` function and the `/api/posts/:uri/enrichments` handler with the shared service:

1. Remove the `toPostEnrichmentResult` function (lines ~169-206).
2. Remove the `EnrichmentOutputSchema` import if it was only used by that function (the import may be named `EnrichmentOutput`).
3. Remove the `Either` import if only used by that function.
4. Add import:

```ts
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
```

5. Replace the `enrichments` handler:

```ts
.handle("enrichments", ({ path }) =>
  withReadErrors(
    "/api/posts/:uri/enrichments",
    Effect.flatMap(PostEnrichmentReadService, (service) =>
      service.getPost(path.uri)
    ).pipe(
      Effect.map((result) => ({
        postUri: result.postUri,
        enrichments: result.enrichments
      } satisfies PostEnrichmentsOutputShape))
    )
  )
)
```

This preserves backward compatibility — the API output shape stays the same (postUri + enrichments), but now uses the same validated read path as MCP.

### Step 2: Run tests

Run: `bun run test`
Expected: PASS — all existing tests should pass since the API shape didn't change

### Step 3: Commit

```bash
git add src/api/Router.ts
git commit -m "refactor(api): use PostEnrichmentReadService for /api/posts/:uri/enrichments (SKY-77)"
```

---

## Task 8: Edge Layer Wiring

**Files:**
- Modify: `src/edge/Layer.ts`

### Step 1: Add the service to shared worker parts

In `src/edge/Layer.ts`:

1. Add import:

```ts
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
```

2. In `buildSharedWorkerParts`, after `candidatePayloadServiceLayer`, add:

```ts
const enrichmentReadServiceLayer =
  enrichmentRunsLayer === null
    ? PostEnrichmentReadService.layer.pipe(
        Layer.provideMerge(candidatePayloadServiceLayer)
      )
    : PostEnrichmentReadService.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(candidatePayloadServiceLayer, enrichmentRunsLayer)
        )
      );
```

3. Add `enrichmentReadServiceLayer` to the `queryLayer`:

```ts
const queryLayer = Layer.mergeAll(
  queryRepositoriesLayer,
  configLayer,
  providerRegistryLayer,
  blueskyLayer,
  postHydrationLayer,
  candidatePayloadServiceLayer,
  enrichmentReadServiceLayer,  // ADD THIS
  KnowledgeQueryService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(queryRepositoriesLayer, configLayer))
  ),
  editorialServiceLayer,
  curationServiceLayer
);
```

4. Add `enrichmentReadServiceLayer` to the `adminLayer` (both branches):

In both the `enrichmentLauncherLayer === null` and non-null branches, add `enrichmentReadServiceLayer` to `Layer.mergeAll(...)`.

5. Add `enrichmentReadServiceLayer` to the returned object so it's accessible if needed:

```ts
return {
  // ... existing ...
  enrichmentReadServiceLayer,
  // ... rest ...
};
```

### Step 2: Run full test suite

Run: `bun run test`
Expected: PASS

### Step 3: Run typecheck

Run: `bunx tsc --noEmit`
Expected: No errors

### Step 4: Commit

```bash
git add src/edge/Layer.ts
git commit -m "feat(edge): wire PostEnrichmentReadService into shared worker layers (SKY-77)"
```

---

## Task 9: Update MCP Glossary

**Files:**
- Modify: `src/mcp/glossary.ts`

### Step 1: Add get_post_enrichments to glossary

In `src/mcp/glossary.ts`, add a section for the new read tool in the appropriate place:

```
**Read Tools:**
- \`get_post_enrichments\` — Inspect enrichment state and readiness for a post. Returns validated enrichment payloads and run summaries. Use to verify a candidate is Reviewable before accepting as a brief.
```

### Step 2: Run tests

Run: `bun run test`
Expected: PASS (glossary tests may check for consistency)

### Step 3: Commit

```bash
git add src/mcp/glossary.ts
git commit -m "docs(mcp): add get_post_enrichments to glossary (SKY-77)"
```

---

## Verification Checklist

Before considering SKY-77 done:

1. `bunx tsc --noEmit` — no type errors
2. `bun run test` — all tests pass
3. Verify `get_post_enrichments` appears in all toolkit profiles:
   - read-only: 13 tools
   - curation-write: 14 tools
   - editorial-write: 14 tools
   - workflow-write: 15 tools
4. Verify `get_post_enrichments` distinguishes: none, pending, failed, needs-review, complete
5. Verify `/api/posts/:uri/enrichments` still returns the same shape
6. Verify environments without `ENRICHMENT_RUN_WORKFLOW` binding still work (runs come back empty)

## Explicitly Out of Scope

- Batch enrichment lookup for `list_curation_candidates` (that's SKY-81)
- `curation_decisions` audit table (that's SKY-71/SKY-80)
- Enrichment retry from MCP (existing admin endpoints handle this)
