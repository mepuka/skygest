/**
 * Vision eval runner — evaluates GeminiVisionService against a golden set.
 *
 * Usage:
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-eval.ts              # run all entries
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-eval.ts shaffer      # filter by prefix
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-eval.ts shaffer-hydro-01  # exact match
 */

import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer, Logger, LogLevel, Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { GeminiVisionService } from "../../src/enrichment/GeminiVisionService";
import { GeminiVisionServiceLive } from "../../src/enrichment/GeminiVisionServiceLive";
import {
  assessVisionQuality,
  hasFindings,
  type GateVerdict,
} from "../../src/enrichment/EnrichmentQualityGate";
import type {
  VisionAssetAnalysis,
  VisionEnrichment,
} from "../../src/domain/enrichment";

// ---------------------------------------------------------------------------
// Golden set schema
// ---------------------------------------------------------------------------

const GoldenEntry = Schema.Struct({
  slug: Schema.String,
  thread: Schema.String,
  context: Schema.String,
  url: Schema.String,
});

type GoldenEntry = typeof GoldenEntry.Type;

const decodeEntry = Schema.decodeUnknown(GoldenEntry);

// ---------------------------------------------------------------------------
// Load golden set
// ---------------------------------------------------------------------------

const loadGoldenSet = Effect.gen(function* () {
  const goldenPath = path.join(import.meta.dir, "golden-set.jsonl");
  const raw = fs.readFileSync(goldenPath, "utf-8");
  const lines = raw.trim().split("\n");

  const entries = yield* Effect.forEach(lines, (line, idx) =>
    decodeEntry(JSON.parse(line)).pipe(
      Effect.mapError((e) => new Error(`Invalid golden entry at line ${idx + 1}: ${e}`))
    )
  );

  return entries;
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

type EvalRubric = {
  readonly chartUnderstanding: boolean;
  readonly altTextUseful: boolean;
  readonly sourceClueCount: number;
};

type EvalResult = {
  readonly slug: string;
  readonly thread: string;
  readonly context: string;
  readonly gateVerdict: GateVerdict | null;
  readonly hasFindings: boolean;
  readonly rubric: EvalRubric | null;
  readonly analysis: VisionAssetAnalysis | null;
  readonly elapsed: number;
  readonly error: string | null;
};

// ---------------------------------------------------------------------------
// Evaluate a single entry against GeminiVisionService
// ---------------------------------------------------------------------------

const evaluateEntry = (entry: GoldenEntry, runDir: string) =>
  Effect.gen(function* () {
    const svc = yield* GeminiVisionService;
    const start = Date.now();

    // Resolve MIME type from response headers — don't hardcode JPEG.
    // CDN serves a mix of jpeg, png, and webp.
    const headResponse = yield* Effect.tryPromise({
      try: () => fetch(entry.url, { method: "HEAD" }),
      catch: () => new Error(`Failed to HEAD ${entry.url}`)
    });
    const mimeType = headResponse.headers.get("content-type") ?? "image/jpeg";

    const analysis = yield* svc.extractChartData(entry.url, mimeType);

    const elapsed = Date.now() - start;

    // Wrap analysis in a minimal VisionEnrichment for quality gate
    const enrichment: VisionEnrichment = {
      kind: "vision",
      summary: {
        text: analysis.title ?? "Untitled",
        mediaTypes: [analysis.mediaType],
        chartTypes: [...analysis.chartTypes],
        titles: analysis.title ? [analysis.title] : [],
        keyFindings: analysis.keyFindings.map((f) => ({
          text: f,
          assetKeys: [entry.slug],
        })),
      },
      assets: [
        {
          assetKey: entry.slug,
          assetType: "image",
          source: "embed",
          index: 0 as any,
          originalAltText: null,
          analysis,
        },
      ],
      modelId: analysis.modelId,
      promptVersion: "eval",
      processedAt: Date.now(),
    };

    const verdict = assessVisionQuality(enrichment);

    const rubric: EvalRubric = {
      chartUnderstanding: analysis.chartTypes.length > 0,
      altTextUseful: analysis.altText !== null && analysis.altText.length > 20,
      sourceClueCount:
        analysis.sourceLines.length +
        analysis.visibleUrls.length +
        analysis.organizationMentions.length +
        analysis.logoText.length,
    };

    // Write per-image JSON with stable/volatile split
    const { processedAt, modelId, ...stableAnalysis } = analysis;
    const output = {
      slug: entry.slug,
      thread: entry.thread,
      context: entry.context,
      gateVerdict: verdict,
      hasFindings: hasFindings(enrichment),
      rubric,
      analysis: stableAnalysis,
      _meta: {
        processedAt,
        modelId,
        elapsed,
        evalTimestamp: new Date().toISOString(),
      },
    };

    fs.writeFileSync(
      path.join(runDir, `${entry.slug}.json`),
      JSON.stringify(output, null, 2)
    );

    yield* Effect.log(`${entry.slug}: ${verdict.outcome} (${elapsed}ms)`);

    const result: EvalResult = {
      slug: entry.slug,
      thread: entry.thread,
      context: entry.context,
      gateVerdict: verdict,
      hasFindings: hasFindings(enrichment),
      rubric,
      analysis,
      elapsed,
      error: null,
    };
    return result;
  }).pipe(
    Effect.catchAll((err) =>
      Effect.gen(function* () {
        const message =
          "message" in err && typeof err.message === "string"
            ? err.message
            : String(err);
        yield* Effect.logError(`${entry.slug}: FAILED — ${message}`);

        // Persist failure record so it survives console scrollback
        const failureOutput = {
          slug: entry.slug,
          thread: entry.thread,
          context: entry.context,
          gateVerdict: null,
          hasFindings: false,
          rubric: null,
          analysis: null,
          error: message,
          _meta: {
            processedAt: null,
            modelId: null,
            elapsed: 0,
            evalTimestamp: new Date().toISOString()
          }
        };
        fs.writeFileSync(
          path.join(runDir, `${entry.slug}.json`),
          JSON.stringify(failureOutput, null, 2)
        );

        const result: EvalResult = {
          slug: entry.slug,
          thread: entry.thread,
          context: entry.context,
          gateVerdict: null,
          hasFindings: false,
          rubric: null,
          analysis: null,
          elapsed: 0,
          error: message,
        };
        return result;
      })
    )
  );

// ---------------------------------------------------------------------------
// Summary report generator
// ---------------------------------------------------------------------------

const formatGate = (result: EvalResult): string => {
  if (result.error) return "error";
  if (!result.gateVerdict) return "error";
  return result.gateVerdict.outcome;
};

const formatAltText = (result: EvalResult): string => {
  if (!result.rubric || !result.analysis) return "—";
  if (!result.rubric.altTextUseful) return "no";
  const len = result.analysis.altText?.length ?? 0;
  return `yes (${len}ch)`;
};

const formatChartTypes = (result: EvalResult): string => {
  if (!result.analysis) return "—";
  return result.analysis.chartTypes.length > 0
    ? result.analysis.chartTypes.join(", ")
    : "—";
};

const formatFindings = (result: EvalResult): string => {
  if (!result.analysis) return "—";
  return String(result.analysis.keyFindings.length);
};

const formatSignals = (result: EvalResult): string => {
  if (!result.analysis) return "—";
  const a = result.analysis;
  const present: string[] = [];
  if (a.title) present.push("title");
  if (a.sourceLines.length > 0) present.push("sourceLines");
  if (a.visibleUrls.length > 0) present.push("visibleUrls");
  if (a.organizationMentions.length > 0) present.push("organizationMentions");
  if (a.logoText.length > 0) present.push("logoText");
  return present.length > 0 ? present.join(", ") : "—";
};

const writeSummary = (results: ReadonlyArray<EvalResult>, runDir: string) =>
  Effect.sync(() => {
    const now = new Date();
    const dateStr = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    const timeStr = [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
    ].join(":");

    const total = results.length;
    const passed = results.filter(
      (r) => r.gateVerdict?.outcome === "usable"
    ).length;
    const needsReview = results.filter(
      (r) => r.gateVerdict?.outcome === "needs-review"
    ).length;
    const errors = results.filter((r) => r.error !== null).length;

    // --- Header ---
    const lines: string[] = [];
    lines.push(`# Vision Eval Run — ${dateStr} ${timeStr}`);
    lines.push("");
    lines.push(
      `Golden set: ${total} images | Passed: ${passed} | Needs Review: ${needsReview} | Errors: ${errors}`
    );
    lines.push("");

    // --- Rubric table ---
    lines.push(
      "| Slug | Gate | Chart? | Alt Text? | Src Clues | Media | Chart Types | Findings | Signals |"
    );
    lines.push(
      "|------|------|--------|-----------|-----------|-------|-------------|----------|---------|"
    );

    for (const r of results) {
      if (r.error) {
        lines.push(
          `| ${r.slug} | error | — | — | — | — | — | — | — |`
        );
      } else {
        lines.push(
          `| ${r.slug} | ${formatGate(r)} | ${r.rubric?.chartUnderstanding ? "yes" : "no"} | ${formatAltText(r)} | ${r.rubric?.sourceClueCount ?? 0} | ${r.analysis?.mediaType ?? "—"} | ${formatChartTypes(r)} | ${formatFindings(r)} | ${formatSignals(r)} |`
        );
      }
    }

    lines.push("");

    // --- Rubric summary ---
    const withAnalysis = results.filter((r) => r.analysis !== null);
    const m = withAnalysis.length;

    const chartCount = withAnalysis.filter(
      (r) => r.analysis!.chartTypes.length > 0
    ).length;

    const altTextCount = withAnalysis.filter(
      (r) => r.analysis!.altText !== null && r.analysis!.altText.length > 20
    ).length;

    const sourceClues = withAnalysis.map(
      (r) => r.rubric!.sourceClueCount
    );
    const avgClues = m > 0
      ? (sourceClues.reduce((a, b) => a + b, 0) / m).toFixed(1)
      : "0.0";
    const minClues = m > 0 ? Math.min(...sourceClues) : 0;
    const maxClues = m > 0 ? Math.max(...sourceClues) : 0;

    lines.push("## Rubric Summary");
    lines.push("");
    lines.push(`- Chart understanding: ${chartCount}/${m} images with chart type detected`);
    lines.push(`- Alt text useful: ${altTextCount}/${m} images with alt text > 20 chars`);
    lines.push(`- Source clues: avg ${avgClues} per image (min ${minClues}, max ${maxClues})`);
    lines.push(`- Gate pass rate: ${passed}/${m} usable`);
    lines.push("");

    const content = lines.join("\n");

    // Write file
    fs.writeFileSync(path.join(runDir, "summary.md"), content);

    // Print to stdout
    console.log("\n" + content);
  });

// ---------------------------------------------------------------------------
// Main program
// ---------------------------------------------------------------------------

const program = Effect.gen(function* () {
  const allEntries = yield* loadGoldenSet;
  const slugFilter = process.argv[2];

  // Filter entries if slug argument provided
  const entries = slugFilter
    ? allEntries.filter(
        (e) => e.slug === slugFilter || e.slug.startsWith(slugFilter)
      )
    : allEntries;

  if (entries.length === 0) {
    yield* Effect.logWarning(
      `No golden set entries matching "${slugFilter}". Available: ${allEntries.map((e) => e.slug).join(", ")}`
    );
    return;
  }

  yield* Effect.log(
    `Running eval on ${entries.length} of ${allEntries.length} golden set entries`
  );

  // Create timestamped output directory (includes seconds to avoid collisions)
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const runDir = path.join(import.meta.dir, "runs", timestamp);
  fs.mkdirSync(runDir, { recursive: true });

  yield* Effect.log(`Output directory: ${runDir}`);

  // Evaluate entries in parallel (concurrency: 3)
  const results = yield* Effect.forEach(
    entries,
    (entry) => evaluateEntry(entry, runDir),
    { concurrency: 3 }
  );

  // Write summary
  yield* writeSummary(results, runDir);

  yield* Effect.log("Eval complete");
});

// ---------------------------------------------------------------------------
// Layer construction & runtime
// ---------------------------------------------------------------------------

const configLayer = Layer.setConfigProvider(ConfigProvider.fromEnv());
const visionLayer = GeminiVisionServiceLive.pipe(Layer.provide(configLayer));

program.pipe(
  Effect.provide(Layer.mergeAll(visionLayer, BunContext.layer)),
  Logger.withMinimumLogLevel(LogLevel.Debug),
  BunRuntime.runMain
);
