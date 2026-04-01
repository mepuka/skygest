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
import { GeminiVisionServiceLive } from "../../src/enrichment/GeminiVisionServiceLive";

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
// Placeholder: evaluate a single entry (Task 2 will fill this in)
// ---------------------------------------------------------------------------

const evaluateEntry = (entry: GoldenEntry) =>
  Effect.succeed({ slug: entry.slug });

// ---------------------------------------------------------------------------
// Placeholder: write summary report (Task 3 will fill this in)
// ---------------------------------------------------------------------------

const writeSummary = (_results: ReadonlyArray<{ slug: string }>, _runDir: string) =>
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
  const results = yield* Effect.forEach(entries, (entry) => evaluateEntry(entry), {
    concurrency: 3,
  });

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
