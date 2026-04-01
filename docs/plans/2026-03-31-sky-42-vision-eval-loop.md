# Vision Eval Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a repeatable, Effect-native eval script that runs the golden set through the vision pipeline and produces diffable per-image output with a summary report.

**Architecture:** A `bun` entry point at `eval/vision/run-eval.ts` builds a minimal Effect layer (GeminiVisionService + AppConfig, no D1/KV/Cloudflare), reads `eval/vision/golden-set.jsonl`, runs each image through Gemini with `Effect.forEach({ concurrency: 3 })`, writes per-image JSON + summary markdown to a timestamped output directory. Optional slug filter for single-image iteration.

**Tech Stack:** Effect (`Effect.gen`, `Effect.forEach`, `Layer`, `Schema`), existing `GeminiVisionService`, existing vision prompt from `src/enrichment/prompts.ts`, `assessVisionQuality` + `hasFindings` from `EnrichmentQualityGate.ts`.

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

```ts
// eval/vision/run-eval.ts
import { Effect, Schema, Array as Arr } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";

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

const GoldenSetEntries = Schema.Array(GoldenSetEntry);

// ---------------------------------------------------------------------------
// Load golden set
// ---------------------------------------------------------------------------

const GOLDEN_SET_PATH = path.resolve(
  import.meta.dir,
  "golden-set.jsonl"
);

const loadGoldenSet = Effect.gen(function* () {
  const raw = fs.readFileSync(GOLDEN_SET_PATH, "utf-8");
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const parsed = lines.map((line) => JSON.parse(line));
  return yield* Schema.decode(GoldenSetEntries)(parsed);
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

Effect.runPromise(program).catch((error) => {
  console.error("Eval failed:", error);
  process.exit(1);
});
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

**Step 1: Build the minimal eval layer**

The eval script needs `GeminiVisionService` which depends on `AppConfig` (for `GEMINI_API_KEY` and model config). Check what the existing `GeminiVisionService` layer requires by reading `src/enrichment/GeminiVisionService.ts` and its dependencies. Build the smallest possible layer that satisfies those requirements.

If `GeminiVisionService` depends on services beyond `AppConfig` and HTTP, create stub layers for anything the eval path doesn't actually call (e.g., if it depends on `EnrichmentRunsRepo` transitively through the layer graph).

The key constraint: bun loads `.env` automatically, so `GEMINI_API_KEY` is available via `process.env`. Build `AppConfig` from env vars with safe defaults for non-vision fields.

**Step 2: Implement `evaluateEntry`**

```ts
import { assessVisionQuality, hasFindings } from "../../src/enrichment/EnrichmentQualityGate";
import type { VisionAssetAnalysis } from "../../src/domain/enrichment";

type EvalResult = {
  readonly slug: string;
  readonly thread: string;
  readonly context: string;
  readonly gateVerdict: GateVerdict | null;
  readonly hasFindings: boolean;
  readonly analysis: VisionAssetAnalysis | null;
  readonly elapsed: number;
  readonly error: string | null;
};
```

The function should:

1. Start a timer
2. Fetch the image from the CDN URL (raw bytes)
3. Send to Gemini via the service/client with the production vision prompt
4. Decode the response using `VisionAssetAnalysis` schema (same as production)
5. Wrap in a minimal `VisionEnrichment` to run `assessVisionQuality`
6. Check `hasFindings` separately (informational, not gating)
7. Write `<slug>.json` to the output directory
8. Return the `EvalResult`

Error handling: if the image fetch or Gemini call fails, catch the error, record `{ slug, error: message, analysis: null, gateVerdict: null }`, and continue.

Use `Effect.catchAll` to handle errors per-entry without aborting the run.

**Step 3: Verify with a single image**

Run: `bun eval/vision/run-eval.ts shaffer-hydro-01`
Expected: Creates `eval/vision/runs/<timestamp>/shaffer-hydro-01.json` with analysis output

**Step 4: Commit**

```bash
git add eval/vision/run-eval.ts
git commit -m "feat(eval): wire Gemini vision calls into eval loop (SKY-42)"
```

---

### Task 3: Summary Report

**Files:**
- Modify: `eval/vision/run-eval.ts`

**Step 1: Implement `writeSummary`**

Generate a markdown file at `<outputDir>/summary.md` with:

Header:
```markdown
# Vision Eval Run — YYYY-MM-DD HH:mm

Golden set: N images | Passed: N | Needs Review: N | Errors: N
```

Table:
```markdown
| Slug | Gate | Media | Chart Types | Findings | Signals | Time |
|------|------|-------|-------------|----------|---------|------|
| shaffer-hydro-01 | usable | chart | bar-chart | 3 | title, sourceLines | 2.1s |
| joshi-data-centres-01 | usable | photo | — | 0 | visibleUrls, orgMentions | 1.8s |
| shaffer-hydro-03 | needs-review | — | — | 0 | — | 1.5s |
```

Where:
- Gate: `usable` / `needs-review` / `error`
- Media: `analysis.mediaType`
- Chart Types: comma-joined `analysis.chartTypes` or `—`
- Findings: count of `analysis.keyFindings`
- Signals: which non-empty signal fields (title, sourceLines, visibleUrls, orgMentions, logoText)
- Time: elapsed in seconds with 1 decimal

Also print the summary table to stdout so you see it immediately.

**Step 2: Run the full golden set**

Run: `bun eval/vision/run-eval.ts`
Expected: Creates timestamped directory with 16 JSON files + summary.md. Summary printed to stdout.

**Step 3: Commit**

```bash
git add eval/vision/run-eval.ts
git commit -m "feat(eval): add summary report to vision eval loop (SKY-42)"
```

---

## Verification Checklist

1. `bun eval/vision/run-eval.ts` — runs full golden set, produces output dir with 16 JSONs + summary
2. `bun eval/vision/run-eval.ts shaffer-hydro-01` — runs single image
3. `bun eval/vision/run-eval.ts nonexistent` — warns, exits cleanly
4. `eval/vision/runs/` is git-ignored
5. Per-image JSON contains full `VisionAssetAnalysis` (diffable between runs)
6. Summary table shows gate verdict, media type, chart types, findings count, signal types
7. Failed images produce error entries without aborting the run
8. `bun run typecheck` — clean (eval script type-checks against domain schemas)
9. No production code changes — eval is standalone
