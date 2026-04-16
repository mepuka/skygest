# Brief Publishability Gate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent weak vision enrichment output from being marked `complete` — gate it to `needs-review` instead, using composable Effect predicates.

**Architecture:** A pure function in `src/enrichment/EnrichmentQualityGate.ts` defines composable `Predicate.Predicate<VisionEnrichment>` checks. The `EnrichmentRunWorkflow` calls it after persisting the enrichment payload, before deciding `markComplete` vs `markNeedsReview`. No retry — vision output quality is deterministic for a given input, so retrying the same image with the same prompt produces the same result. Real quality improvement comes from prompt tuning (SKY-42/SKY-51) and manual retry via the existing repair service. Pipeline stage: this gates the Enriching → Reviewable transition.

**Cloudflare platform fit:**
- No workflow-level restarts or step retries. The gate is classification only.
- No new workflow bindings, Worker exports, or D1 migrations.
- `result_written_at` already exists on `post_enrichment_runs` (migration #15).
- Persist step runs before validation (upsert, idempotent). Payload is always inspectable regardless of gate outcome.
- Manual retry after prompt tuning uses the existing `EnrichmentRepairService.retryRun()` path.

**Tech Stack:** Effect `Predicate` module, existing `VisionEnrichment` domain type, new `EnrichmentQualityGateError` (Schema.TaggedError), existing `MarkEnrichmentRunNeedsReview` schema (extended with optional `resultWrittenAt`).

---

### Task 1: Quality Gate Error Type

**Files:**
- Modify: `src/domain/errors.ts`

**Step 1: Add `EnrichmentQualityGateError`**

Add to `src/domain/errors.ts` alongside the other enrichment errors:

```ts
export class EnrichmentQualityGateError extends Schema.TaggedError<EnrichmentQualityGateError>()(
  "EnrichmentQualityGateError",
  {
    postUri: AtUri,
    reason: Schema.String
  }
) {}
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/domain/errors.ts
git commit -m "feat(enrichment): add EnrichmentQualityGateError tagged error (SKY-41)"
```

---

### Task 2: Quality Gate Predicates

**Files:**
- Create: `src/enrichment/EnrichmentQualityGate.ts`
- Test: `tests/enrichment-quality-gate.test.ts`

**Step 1: Write the failing tests**

```ts
// tests/enrichment-quality-gate.test.ts
import { describe, expect, it } from "vitest";
import {
  hasAssets,
  hasFindings,
  hasAnalysisSignal,
  isUsable,
  assessVisionQuality
} from "../src/enrichment/EnrichmentQualityGate";
import type { VisionEnrichment, VisionAssetEnrichment } from "../src/domain/enrichment";

const makeAsset = (
  overrides: Partial<VisionAssetEnrichment["analysis"]> = {}
): VisionAssetEnrichment => ({
  assetKey: "a1",
  assetType: "image",
  source: "embed",
  index: 0,
  originalAltText: null,
  analysis: {
    mediaType: "chart",
    chartTypes: ["line-chart"],
    altText: "A line chart",
    altTextProvenance: "synthetic",
    xAxis: null,
    yAxis: null,
    series: [],
    sourceLines: [],
    temporalCoverage: null,
    keyFindings: ["Production increased"],
    visibleUrls: [],
    organizationMentions: [],
    logoText: [],
    title: "Energy Production",
    modelId: "gemini-2.5-flash",
    processedAt: 1,
    ...overrides
  }
});

const makeEnrichment = (
  overrides: Partial<{
    assets: VisionEnrichment["assets"];
    summary: Partial<VisionEnrichment["summary"]>;
  }> = {}
): VisionEnrichment => ({
  kind: "vision",
  summary: {
    text: "Analyzed 2 visual assets",
    mediaTypes: ["chart"],
    chartTypes: ["line-chart"],
    titles: ["Energy Production"],
    keyFindings: [{ text: "Production rose 10%", assetKeys: ["a1"] }],
    ...(overrides.summary ?? {})
  },
  assets: overrides.assets ?? [makeAsset()],
  modelId: "gemini-2.5-flash",
  promptVersion: "v2",
  processedAt: 1
});

describe("EnrichmentQualityGate", () => {
  describe("hasAssets", () => {
    it("passes when assets present", () => {
      expect(hasAssets(makeEnrichment())).toBe(true);
    });

    it("fails when assets empty", () => {
      expect(hasAssets(makeEnrichment({ assets: [] }))).toBe(false);
    });
  });

  describe("hasFindings", () => {
    it("passes when asset has findings", () => {
      expect(hasFindings(makeEnrichment())).toBe(true);
    });

    it("passes when only summary has findings", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ keyFindings: [] })]
      });
      expect(hasFindings(e)).toBe(true);
    });

    it("fails when no findings anywhere", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ keyFindings: [] })],
        summary: { keyFindings: [] }
      });
      expect(hasFindings(e)).toBe(false);
    });
  });

  describe("hasAnalysisSignal", () => {
    it("passes with chart types", () => {
      expect(hasAnalysisSignal(makeEnrichment())).toBe(true);
    });

    it("passes with visible URLs but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], visibleUrls: ["https://eia.gov/report"] })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });

    it("passes with org mentions but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          organizationMentions: [{ name: "EIA", location: "title" }]
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });

    it("passes with source lines but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          sourceLines: [{ sourceText: "Source: AESO", datasetName: null }]
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });

    it("passes with logo text but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], logoText: ["Bloomberg NEF"] })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });

    it("passes with title but no chart types", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ chartTypes: [], title: "Screenshot of AESO report" })]
      });
      expect(hasAnalysisSignal(e)).toBe(true);
    });

    it("fails when no analysis signal at all", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          visibleUrls: [],
          organizationMentions: [],
          sourceLines: [],
          logoText: [],
          title: null
        })]
      });
      expect(hasAnalysisSignal(e)).toBe(false);
    });
  });

  describe("isUsable", () => {
    it("passes when all predicates pass", () => {
      expect(isUsable(makeEnrichment())).toBe(true);
    });

    it("fails when any predicate fails", () => {
      expect(isUsable(makeEnrichment({ assets: [] }))).toBe(false);
    });
  });

  describe("assessVisionQuality", () => {
    it("returns usable for good chart enrichment", () => {
      expect(assessVisionQuality(makeEnrichment())).toEqual({ outcome: "usable" });
    });

    it("returns usable for screenshot with source clues", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          mediaType: "photograph",
          chartTypes: [],
          visibleUrls: ["https://eia.gov"],
          organizationMentions: [{ name: "EIA", location: "body" }]
        })]
      });
      expect(assessVisionQuality(e)).toEqual({ outcome: "usable" });
    });

    it("returns needs-review for empty assets", () => {
      const result = assessVisionQuality(makeEnrichment({ assets: [] }));
      expect(result).toEqual({
        outcome: "needs-review",
        reason: "vision produced zero asset analyses"
      });
    });

    it("returns needs-review for no findings", () => {
      const e = makeEnrichment({
        assets: [makeAsset({ keyFindings: [] })],
        summary: { keyFindings: [] }
      });
      expect(assessVisionQuality(e).outcome).toBe("needs-review");
    });

    it("returns needs-review for no analysis signal", () => {
      const e = makeEnrichment({
        assets: [makeAsset({
          chartTypes: [],
          visibleUrls: [],
          organizationMentions: [],
          sourceLines: [],
          logoText: [],
          title: null
        })]
      });
      expect(assessVisionQuality(e).outcome).toBe("needs-review");
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/enrichment-quality-gate.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the quality gate**

```ts
// src/enrichment/EnrichmentQualityGate.ts
import { Predicate } from "effect";
import type { VisionEnrichment } from "../domain/enrichment";

// ---------------------------------------------------------------------------
// Individual quality predicates
// ---------------------------------------------------------------------------

/** At least one asset was analyzed. */
export const hasAssets: Predicate.Predicate<VisionEnrichment> =
  (e) => e.assets.length > 0;

/** At least one key finding exists (asset-level or summary-level). */
export const hasFindings: Predicate.Predicate<VisionEnrichment> =
  (e) =>
    e.assets.some((a) => a.analysis.keyFindings.length > 0) ||
    e.summary.keyFindings.length > 0;

/**
 * At least one asset produced a useful analysis signal.
 * Charts, screenshots with source clues, and images with org/logo
 * identification all count — not just chart type detection.
 */
export const hasAnalysisSignal: Predicate.Predicate<VisionEnrichment> =
  (e) =>
    e.assets.some((a) =>
      a.analysis.chartTypes.length > 0 ||
      a.analysis.visibleUrls.length > 0 ||
      a.analysis.organizationMentions.length > 0 ||
      a.analysis.sourceLines.length > 0 ||
      a.analysis.logoText.length > 0 ||
      a.analysis.title !== null
    );

// ---------------------------------------------------------------------------
// Composed gate
// ---------------------------------------------------------------------------

/** All three checks must pass for the enrichment to be considered usable. */
export const isUsable: Predicate.Predicate<VisionEnrichment> = Predicate.and(
  hasAssets,
  Predicate.and(hasFindings, hasAnalysisSignal)
);

// ---------------------------------------------------------------------------
// Verdict with reason (for workflow needs-review path)
// ---------------------------------------------------------------------------

export type GateVerdict =
  | { readonly outcome: "usable" }
  | { readonly outcome: "needs-review"; readonly reason: string };

type QualityCheck = {
  readonly predicate: Predicate.Predicate<VisionEnrichment>;
  readonly reason: string;
};

const qualityChecks: ReadonlyArray<QualityCheck> = [
  { predicate: hasAssets, reason: "vision produced zero asset analyses" },
  {
    predicate: hasFindings,
    reason: "vision produced no key findings across all assets"
  },
  {
    predicate: hasAnalysisSignal,
    reason: "vision produced no analysis signal (no chart types, URLs, organizations, sources, logos, or titles)"
  }
];

export const assessVisionQuality = (
  enrichment: VisionEnrichment
): GateVerdict => {
  for (const check of qualityChecks) {
    if (!check.predicate(enrichment)) {
      return { outcome: "needs-review", reason: check.reason };
    }
  }
  return { outcome: "usable" };
};
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/enrichment-quality-gate.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/enrichment/EnrichmentQualityGate.ts tests/enrichment-quality-gate.test.ts
git commit -m "feat(enrichment): composable vision quality gate predicates (SKY-41)"
```

---

### Task 3: Extend MarkEnrichmentRunNeedsReview with resultWrittenAt

**Files:**
- Modify: `src/domain/enrichmentRun.ts:109-116`
- Modify: `src/services/d1/EnrichmentRunsRepoD1.ts` (markNeedsReview SQL)

**Step 1: Add `resultWrittenAt` to `MarkEnrichmentRunNeedsReview`**

In `src/domain/enrichmentRun.ts`, change:

```ts
export const MarkEnrichmentRunNeedsReview = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis,
  error: Schema.NullOr(EnrichmentErrorEnvelope)
});
```

To:

```ts
export const MarkEnrichmentRunNeedsReview = Schema.Struct({
  id: Schema.String,
  lastProgressAt: EpochMillis,
  resultWrittenAt: Schema.optional(Schema.NullOr(EpochMillis)),
  error: Schema.NullOr(EnrichmentErrorEnvelope)
});
```

**Step 2: Update the repo implementation**

In `src/services/d1/EnrichmentRunsRepoD1.ts`, find the `markNeedsReview` SQL UPDATE and add to the SET clause:

```sql
result_written_at = COALESCE(${input.resultWrittenAt ?? null}, result_written_at)
```

`COALESCE` preserves any existing `result_written_at` when the caller doesn't pass one — backward compatible with planning-stage needs-review calls.

**Step 3: Run tests**

Run: `bun run test tests/enrichment-runs-repo.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/domain/enrichmentRun.ts src/services/d1/EnrichmentRunsRepoD1.ts
git commit -m "feat(enrichment): add resultWrittenAt to MarkEnrichmentRunNeedsReview (SKY-41)"
```

---

### Task 4: Wire Gate into Enrichment Workflow

**Files:**
- Modify: `src/enrichment/EnrichmentRunWorkflow.ts`
- Modify: `tests/enrichment-run-workflow.test.ts`

#### Workflow Semantics

The gate is classification only. No retry — vision output is deterministic for a given input, and retrying the same image with the same prompt produces the same result. Quality improvement comes from prompt tuning (SKY-42/SKY-51) and manual retry via `EnrichmentRepairService.retryRun()`.

The workflow flow after execution becomes:

```
persist enrichment (upsert, idempotent)
  ↓
if vision: validate quality
  ↓ usable                    ↓ needs-review
  queue source-attribution    markNeedsReview(resultWrittenAt) + return early
  ↓
markComplete
```

Key properties:
- Persist runs before validation — payload is always inspectable
- `resultWrittenAt` from the persist step is passed to `markNeedsReview` (not a fresh `Date.now()`)
- Source-attribution is NOT queued on gate failure — intentional, because weak vision output makes downstream attribution unreliable
- No throw/catch dance — the validation step handles its own outcome via early return
- Existing error catch block is unchanged — it only handles real errors

**Step 1: Add workflow integration test**

Add to `tests/enrichment-run-workflow.test.ts`, after the existing test cases. Import `assessVisionQuality` is not needed — the test drives the workflow end-to-end.

```ts
  it.live("marks vision run needs-review when quality gate fails", () =>
    Effect.promise(async () => {
      const { EnrichmentRunWorkflow } = await import(
        "../src/enrichment/EnrichmentRunWorkflow"
      );

      const reviewMarks: Array<unknown> = [];
      const persisted: Array<unknown> = [];
      const completions: Array<unknown> = [];
      const launcherCalls: Array<unknown> = [];

      const weakVisionEnrichment: VisionEnrichment = {
        kind: "vision",
        summary: {
          text: "Analyzed 1 visual assets",
          mediaTypes: ["photograph"],
          chartTypes: [],
          titles: [],
          keyFindings: []
        },
        assets: [
          {
            assetKey: "a1",
            assetType: "image",
            source: "embed",
            index: 0,
            originalAltText: null,
            analysis: {
              mediaType: "photograph",
              chartTypes: [],
              altText: "A photo",
              altTextProvenance: "synthetic",
              xAxis: null,
              yAxis: null,
              series: [],
              sourceLines: [],
              temporalCoverage: null,
              keyFindings: [],
              visibleUrls: [],
              organizationMentions: [],
              logoText: [],
              title: null,
              modelId: "gemini-2.5-flash",
              processedAt: 10
            }
          }
        ],
        modelId: "gemini-2.5-flash",
        promptVersion: "v2.0.0",
        processedAt: 10
      };

      currentLayer = Layer.succeed(EnrichmentRunsRepo, {
        createQueuedIfAbsent: () => Effect.succeed(true),
        getById: () => Effect.succeed(makeRunRecord()),
        listRunning: () => Effect.succeed([]),
        listRecent: () => Effect.succeed([]),
        listActive: () => Effect.succeed([]),
        listStaleActive: () => Effect.succeed([]),
        markPhase: () => Effect.void,
        resetForRetry: () => Effect.succeed(false),
        markComplete: (input) =>
          Effect.sync(() => { completions.push(input); }),
        markFailed: () => Effect.void,
        markNeedsReview: (input) =>
          Effect.sync(() => { reviewMarks.push(input); })
      }).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            Layer.succeed(EnrichmentPlanner, {
              plan: () => Effect.succeed(makePlan())
            }),
            Layer.succeed(VisionEnrichmentExecutor, {
              execute: () => Effect.succeed(weakVisionEnrichment)
            }),
            Layer.succeed(EnrichmentWorkflowLauncher, {
              start: () => Effect.succeed({
                runId: "unused",
                workflowInstanceId: "unused",
                status: "queued" as const
              }),
              startIfAbsent: (input) =>
                Effect.sync(() => { launcherCalls.push(input); return true; })
            }),
            Layer.succeed(CandidatePayloadRepo, {
              upsertCapture: () => Effect.succeed(false),
              getByPostUri: () => Effect.succeed(null),
              markPicked: () => Effect.succeed(false),
              saveEnrichment: (input) =>
                Effect.sync(() => { persisted.push(input); return true; })
            })
          )
        )
      );

      const workflow = new EnrichmentRunWorkflow(
        {} as ExecutionContext,
        makeEnv()
      );
      const result = await workflow.run(
        {
          instanceId: "run-1",
          payload: {
            postUri: asAtUri("at://did:plc:test/app.bsky.feed.post/post-1"),
            enrichmentType: "vision",
            schemaVersion: "v1",
            triggeredBy: "admin",
            requestedBy: "operator@example.com"
          } satisfies EnrichmentRunParams
        } as any,
        makeStep()
      );

      // Run marked needs-review (not complete, not failed)
      expect(result).toEqual({ runId: "run-1", status: "needs-review" });
      // Payload was persisted for inspection
      expect(persisted).toHaveLength(1);
      // Run was marked needs-review with quality gate error
      expect(reviewMarks).toHaveLength(1);
      expect(reviewMarks[0]).toEqual(
        expect.objectContaining({
          error: expect.objectContaining({
            tag: "EnrichmentQualityGateError"
          }),
          // resultWrittenAt is set (not null)
          resultWrittenAt: expect.any(Number)
        })
      );
      // Source attribution was NOT queued
      expect(launcherCalls).toEqual([]);
      // markComplete was NOT called
      expect(completions).toEqual([]);
    })
  );
```

**Step 2: Run tests to verify the new test fails**

Run: `bun run test tests/enrichment-run-workflow.test.ts`
Expected: New test FAILS (gate not yet wired)

**Step 3: Wire the gate into the workflow**

Modify `src/enrichment/EnrichmentRunWorkflow.ts`:

Add imports at the top:

```ts
import { assessVisionQuality } from "./EnrichmentQualityGate";
import { EnrichmentQualityGateError } from "../domain/errors";
```

Update the existing `EnrichmentOutput` import to also import `VisionEnrichment`:

```ts
import {
  defaultSchemaVersionForEnrichmentKind,
  type EnrichmentOutput,
  type VisionEnrichment
} from "../domain/enrichment";
```

Replace lines 275-331 (from `mark persisting` through the final `return`) with:

```ts
      // --- Persist enrichment ---
      // Runs before validation so payload is always inspectable.
      // The persist step is an upsert — idempotent and safe if replayed.
      await step.do("mark persisting", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markPhase({
              id: run.id,
              phase: "persisting",
              lastProgressAt: Date.now()
            })
          ),
          "EnrichmentRunWorkflow.markPersisting"
        )
      );

      const resultWrittenAt = Date.now();
      await step.do(`persist ${plan.enrichmentType} enrichment`, async () =>
        this.runEffect(
          this.persistEnrichment(plan, enrichment, resultWrittenAt),
          "EnrichmentRunWorkflow.persistEnrichment"
        )
      );

      // --- Quality gate (Enriching → Reviewable transition) ---
      // Classification only, no retry. Vision output is deterministic for
      // a given input — retrying produces the same result. Quality improvement
      // comes from prompt tuning (SKY-42/SKY-51) and manual retry via
      // EnrichmentRepairService after changes.
      if (isVisionExecutionPlan(plan)) {
        const verdict = assessVisionQuality(enrichment as VisionEnrichment);
        if (verdict.outcome === "needs-review") {
          await step.do("mark needs review (quality gate)", async () =>
            this.runEffect(
              Effect.flatMap(EnrichmentRunsRepo, (runs) =>
                runs.markNeedsReview({
                  id: run.id,
                  lastProgressAt: Date.now(),
                  resultWrittenAt,
                  error: toEnrichmentErrorEnvelope(
                    EnrichmentQualityGateError.make({
                      postUri: plan.postUri,
                      reason: verdict.reason
                    }),
                    {
                      runId,
                      operation: "EnrichmentRunWorkflow.qualityGate"
                    }
                  )
                })
              ),
              "EnrichmentRunWorkflow.markNeedsReviewQuality"
            )
          );

          // Early return — source-attribution is NOT queued.
          // Intentional: weak vision output makes downstream attribution unreliable.
          return {
            runId,
            status: "needs-review"
          } as const;
        }
      }

      // --- Queue downstream enrichment ---
      if (isVisionExecutionPlan(plan)) {
        await step.do("queue source attribution", async () =>
          this.runEffect(
            Effect.flatMap(EnrichmentWorkflowLauncher, (launcher) =>
              launcher.startIfAbsent({
                postUri: plan.postUri,
                enrichmentType: "source-attribution",
                schemaVersion: defaultSchemaVersionForEnrichmentKind(
                  "source-attribution"
                ),
                triggeredBy: run.triggeredBy,
                requestedBy: run.requestedBy
              })
            ),
            "EnrichmentRunWorkflow.queueSourceAttribution"
          )
        );
      }

      // --- Mark complete ---
      await step.do("mark complete", async () =>
        this.runEffect(
          Effect.flatMap(EnrichmentRunsRepo, (runs) =>
            runs.markComplete({
              id: run.id,
              finishedAt: Date.now(),
              resultWrittenAt
            })
          ),
          "EnrichmentRunWorkflow.markComplete"
        )
      );

      return {
        runId,
        status: "complete"
      } as const;
```

The existing catch block is unchanged — it only handles real errors. Quality gate failures are handled inline via early return, not via throw/catch.

**Step 4: Run tests**

Run: `bun run test tests/enrichment-run-workflow.test.ts`
Expected: All 4 tests pass (3 existing + 1 new)

**Step 5: Run full test suite + typecheck**

Run: `bun run typecheck && bun run test`
Expected: All pass

**Step 6: Commit**

```bash
git add src/enrichment/EnrichmentRunWorkflow.ts src/domain/errors.ts tests/enrichment-run-workflow.test.ts
git commit -m "feat(enrichment): wire quality gate into workflow — weak output marked needs-review (SKY-41)"
```

---

## Verification Checklist

1. `bun run typecheck` — clean
2. `bun run test` — all pass
3. Strong vision output (charts or screenshots with source clues + findings) → `markComplete` (unchanged behavior)
4. Weak vision output (no findings, no analysis signal) → `markNeedsReview` with `EnrichmentQualityGateError` and `resultWrittenAt`
5. Payload is always persisted before validation (upsert, runs before gate check)
6. `resultWrittenAt` on the needs-review record matches the actual persist timestamp (not a fresh `Date.now()`)
7. Source-attribution queueing is intentionally skipped when gate fails (early return before queue step)
8. `MarkEnrichmentRunNeedsReview` carries optional `resultWrittenAt` for readiness model (SKY-78)
9. `isUsable` composite predicate is exported for reuse by readiness queries (SKY-78)
10. No workflow-level restarts, no step retries, no new retry system
11. No new workflow bindings, Worker exports, or D1 migrations
12. Error uses `EnrichmentQualityGateError` (Schema.TaggedError), consistent with existing enrichment error patterns
13. All test `altTextProvenance` values use `"synthetic"`
14. All test `organizationMentions` use `{ name, location }` matching `VisionOrganizationMention` schema
15. Existing catch block unchanged — only handles real errors, not quality gate outcomes
