# Vision Eval Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a repeatable, Effect-native eval script that runs the golden set through the vision pipeline and produces diffable per-image output with a review rubric and summary report.

**Architecture:** A `bun` entry point at `eval/vision/run-eval.ts` builds a minimal Effect layer following the same pattern as `scripts/test-vision.ts`: `GeminiVisionServiceLive` + `ConfigProvider.fromEnv()` + `BunContext.layer` + `BunRuntime.runMain`. Reads `eval/vision/golden-set.jsonl` via `Schema.decode` per line, runs each image through Gemini with `Effect.forEach({ concurrency: 3 })`, writes per-image JSON + summary markdown to a timestamped output directory. Optional slug filter for single-image iteration.

**Tech Stack:** Effect (`Effect.gen`, `Effect.forEach`, `Layer`, `Schema`, `ConfigProvider`, `BunRuntime`), existing `GeminiVisionServiceLive` (reads `GOOGLE_API_KEY` from env), `assessVisionQuality` + `hasFindings` from `EnrichmentQualityGate.ts`.

**Review findings addressed:**
- P1: Per-image output splits into stable `analysis` (diffable) and `_meta` (volatile — `processedAt`, `elapsed`, timestamps)
- P1: Summary includes review rubric columns: chart understanding, alt text usefulness, source clue quality
- P2: Layer uses `ConfigProvider.fromEnv()` + `GOOGLE_API_KEY` (matching `scripts/test-vision.ts` and `GeminiVisionServiceLive`)
- P2: Golden set loaded via `Schema.decode` per line, not raw `JSON.parse`

---

### Task 1: Eval Script Entry Point and Golden Set Loader

**Files:**
- Create: `eval/vision/run-eval.ts`
- Modify: `.gitignore` (add `eval/vision/runs/`)

**Step 1: Add git-ignore rule**

Add to `.gitignore`:

```
eval/vision/runs/
```

**Step 2: Create the script skeleton**

Follow the same layer + runtime pattern as `scripts/test-vision.ts`:

```ts
// eval/vision/run-eval.ts
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer, Logger, LogLevel, Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { GeminiVisionServiceLive } from "../../src/enrichment/GeminiVisionServiceLive";

// ---------------------------------------------------------------------------
// Golden set schema
// ---------------------------------------------------------------------------

const GoldenSetEntry = Schema.Struct({
  slug: Schema.String,
  thread: Schema.String,
  context: Schema.String,
  url: Schema.String
});
type GoldenSetEntry = Schema.Schema.Type<typeof GoldenSetEntry>;

const decodeGoldenSetEntry = Schema.decodeUnknown(GoldenSetEntry);

// ---------------------------------------------------------------------------
// Load golden set — Schema.decode per line, not raw JSON.parse
// ---------------------------------------------------------------------------

const GOLDEN_SET_PATH = path.resolve(import.meta.dir, "golden-set.jsonl");

const loadGoldenSet = Effect.gen(function* () {
  const raw = fs.readFileSync(GOLDEN_SET_PATH, "utf-8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: GoldenSetEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = yield* Effect.try({
      try: () => JSON.parse(lines[i]!),
      catch: () => new Error(`golden-set.jsonl line ${i + 1}: invalid JSON`)
    });
    const entry = yield* decodeGoldenSetEntry(parsed).pipe(
      Effect.mapError((e) => new Error(`golden-set.jsonl line ${i + 1}: ${e.message}`))
    );
    entries.push(entry);
  }

  return entries;
});

// ---------------------------------------------------------------------------
// CLI args — optional slug filter
// ---------------------------------------------------------------------------

const slugFilter = process.argv[2] ?? null;

const filterEntries = (entries: ReadonlyArray<GoldenSetEntry>) =>
  slugFilter === null
    ? entries
    : entries.filter((e) => e.slug === slugFilter || e.slug.startsWith(slugFilter));

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------

const formatTimestamp = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
};

const ensureDir = (dirPath: string) =>
  Effect.sync(() => {
    fs.mkdirSync(dirPath, { recursive: true });
  });

// Placeholder — filled in Task 2
const evaluateEntry = (_entry: GoldenSetEntry, _outputDir: string) =>
  Effect.succeed({ slug: _entry.slug });

// Placeholder — filled in Task 3
const writeSummary = (_outputDir: string, _results: ReadonlyArray<unknown>) =>
  Effect.void;

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const allEntries = yield* loadGoldenSet;
  const entries = filterEntries(allEntries);

  if (entries.length === 0) {
    yield* Effect.logWarning(
      slugFilter === null
        ? "Golden set is empty"
        : `No entries match filter: ${slugFilter}`
    );
    return;
  }

  yield* Effect.log(`Running eval on ${entries.length} of ${allEntries.length} golden set entries`);

  const timestamp = formatTimestamp(new Date());
  const outputDir = path.resolve(import.meta.dir, "runs", timestamp);
  yield* ensureDir(outputDir);

  const results = yield* Effect.forEach(
    entries,
    (entry) => evaluateEntry(entry, outputDir),
    { concurrency: 3 }
  );

  yield* writeSummary(outputDir, results);
  yield* Effect.log(`Eval complete: ${results.length} images → ${outputDir}`);
});

// ---------------------------------------------------------------------------
// Layer + runtime — same pattern as scripts/test-vision.ts
// ---------------------------------------------------------------------------

const configLayer = Layer.setConfigProvider(ConfigProvider.fromEnv());
const visionLayer = GeminiVisionServiceLive.pipe(Layer.provide(configLayer));

program.pipe(
  Effect.provide(Layer.mergeAll(visionLayer, BunContext.layer)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  BunRuntime.runMain
);
```

**Step 3: Verify the skeleton runs**

Run: `bun eval/vision/run-eval.ts`
Expected: Logs "Running eval on 16 of 16 golden set entries" and "Eval complete"

Run: `bun eval/vision/run-eval.ts shaffer-hydro-01`
Expected: Logs "Running eval on 1 of 16 golden set entries"

Run: `bun eval/vision/run-eval.ts nonexistent`
Expected: Logs warning "No entries match filter: nonexistent"

**Step 4: Commit**

```bash
git add eval/vision/run-eval.ts .gitignore
git commit -m "feat(eval): vision eval loop skeleton with golden set loader (SKY-42)"
```

---

### Task 2: Image Evaluation with Gemini

**Files:**
- Modify: `eval/vision/run-eval.ts`

This task wires in the actual Gemini call and writes per-image output files.

**Step 1: Implement `evaluateEntry`**

The `GeminiVisionService` interface (check `src/enrichment/GeminiVisionService.ts`) exposes `classifyImage` and `extractChartData`. The eval script should call `extractChartData` (the full pipeline) for each golden set image, same as `scripts/test-vision.ts --extract`.

Per-image output splits into stable and volatile sections:

```ts
import { GeminiVisionService } from "../../src/enrichment/GeminiVisionService";
import { assessVisionQuality, hasFindings } from "../../src/enrichment/EnrichmentQualityGate";
import type { VisionAssetAnalysis, VisionEnrichment } from "../../src/domain/enrichment";
import type { GateVerdict } from "../../src/enrichment/EnrichmentQualityGate";

type EvalResult = {
  readonly slug: string;
  readonly thread: string;
  readonly context: string;
  readonly gateVerdict: GateVerdict | null;
  readonly hasFindings: boolean;
  // Review rubric (machine-checkable)
  readonly rubric: {
    readonly chartUnderstanding: boolean;  // has at least one chart type
    readonly altTextUseful: boolean;       // altText non-null and length > 20
    readonly sourceClueCount: number;      // sourceLines + visibleUrls + orgMentions + logoText
  } | null;
  readonly analysis: VisionAssetAnalysis | null;
  readonly error: string | null;
};

// Per-image output file shape — stable analysis + volatile meta
type EvalOutputFile = {
  readonly slug: string;
  readonly thread: string;
  readonly context: string;
  readonly gateVerdict: GateVerdict | null;
  readonly hasFindings: boolean;
  readonly rubric: EvalResult["rubric"];
  readonly analysis: Omit<VisionAssetAnalysis, "processedAt" | "modelId"> | null;
  readonly error: string | null;
  readonly _meta: {
    readonly processedAt: number | null;
    readonly modelId: string | null;
    readonly elapsed: number;
    readonly evalTimestamp: string;
  };
};
```

The function should:

1. Start a timer via `Effect.clockWith`
2. Call `svc.extractChartData(entry.url, "image/jpeg")` via `yield* GeminiVisionService`
3. Wrap in a minimal `VisionEnrichment` to run `assessVisionQuality`
4. Compute review rubric fields from the analysis
5. Split `processedAt` and `modelId` into `_meta` (volatile), keep the rest in `analysis` (stable/diffable)
6. Write `<slug>.json` to the output directory using `Effect.sync` + `fs.writeFileSync`
7. Return the `EvalResult`

Error handling: wrap each entry evaluation in `Effect.catchAll` — on failure, record `{ slug, error: message, analysis: null, gateVerdict: null, rubric: null }` and continue.

**Step 2: Verify with a single image**

Run: `bun eval/vision/run-eval.ts shaffer-hydro-01`
Expected: Creates `eval/vision/runs/<timestamp>/shaffer-hydro-01.json` with stable analysis body and `_meta` section

**Step 3: Verify diffability**

Run the same image twice. Diff the two output files — `analysis` section should be identical, only `_meta.elapsed` and `_meta.evalTimestamp` should differ.

**Step 4: Commit**

```bash
git add eval/vision/run-eval.ts
git commit -m "feat(eval): wire Gemini vision calls into eval loop (SKY-42)"
```

---

### Task 3: Summary Report with Review Rubric

**Files:**
- Modify: `eval/vision/run-eval.ts`

**Step 1: Implement `writeSummary`**

Generate a markdown file at `<outputDir>/summary.md` with:

Header:
```markdown
# Vision Eval Run — YYYY-MM-DD HH:mm

Golden set: N images | Passed: N | Needs Review: N | Errors: N
```

Review rubric table:
```markdown
| Slug | Gate | Chart? | Alt Text? | Source Clues | Media | Chart Types | Findings | Signals |
|------|------|--------|-----------|-------------|-------|-------------|----------|---------|
| shaffer-hydro-01 | usable | yes | yes (142ch) | 3 | chart | bar-chart | 3 | title, sourceLines |
| joshi-data-centres-01 | usable | no | yes (89ch) | 5 | photo | — | 0 | visibleUrls, orgMentions |
| shaffer-hydro-03 | needs-review | no | no | 0 | — | — | 0 | — |
```

Where:
- Gate: `usable` / `needs-review` / `error`
- Chart?: did the model identify at least one chart type (yes/no)
- Alt Text?: is altText non-null and >20 chars (yes/no + length)
- Source Clues: count of sourceLines + visibleUrls + orgMentions + logoText entries
- Media: `analysis.mediaType`
- Chart Types: comma-joined `analysis.chartTypes` or `—`
- Findings: count of `analysis.keyFindings`
- Signals: which non-empty signal fields (title, sourceLines, visibleUrls, orgMentions, logoText)

Rubric summary at the bottom:
```markdown
## Rubric Summary

- Chart understanding: N/M images with chart type detected
- Alt text useful: N/M images with alt text > 20 chars
- Source clues: avg N per image (min M, max M)
```

Also print the summary table and rubric to stdout.

**Step 2: Run the full golden set**

Run: `bun eval/vision/run-eval.ts`
Expected: Creates timestamped directory with 16 JSON files + summary.md. Summary printed to stdout.

**Step 3: Commit**

```bash
git add eval/vision/run-eval.ts
git commit -m "feat(eval): add summary report with review rubric to vision eval loop (SKY-42)"
```

---

## Verification Checklist

1. `bun eval/vision/run-eval.ts` — runs full golden set, produces output dir with 16 JSONs + summary
2. `bun eval/vision/run-eval.ts shaffer-hydro-01` — runs single image
3. `bun eval/vision/run-eval.ts nonexistent` — warns, exits cleanly
4. `eval/vision/runs/` is git-ignored
5. Per-image JSON has stable `analysis` body (no `processedAt`/`modelId`) and volatile `_meta` section — diffable between runs
6. Summary table includes review rubric: chart understanding, alt text usefulness, source clue count
7. Rubric summary shows aggregate stats at the bottom
8. Failed images produce error entries without aborting the run
9. `bun run typecheck` — clean (eval script type-checks against domain schemas)
10. No production code changes — eval is standalone
11. Layer follows `scripts/test-vision.ts` pattern: `ConfigProvider.fromEnv()` + `GeminiVisionServiceLive` + `BunContext.layer` + `BunRuntime.runMain`
12. Golden set loaded via `Schema.decodeUnknown` per line (not raw `JSON.parse`)
