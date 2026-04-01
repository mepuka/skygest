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

    const analysis = yield* svc.extractChartData(entry.url, "image/jpeg");

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
// Placeholder: write summary report (Task 3 will fill this in)
// ---------------------------------------------------------------------------

const writeSummary = (_results: ReadonlyArray<EvalResult>, _runDir: string) =>
  Effect.void;

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

  // Create timestamped output directory
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
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
