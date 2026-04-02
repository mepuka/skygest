/**
 * Routing eval runner — evaluates classifyImage + fullExtractionEligible
 * against the golden set and reports routing decisions.
 *
 * Usage:
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-routing-eval.ts              # all entries
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-routing-eval.ts shaffer      # filter by prefix
 *   GOOGLE_API_KEY=<key> bun eval/vision/run-routing-eval.ts shaffer-hydro-01  # exact match
 */

import { BunContext, BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer, Logger, LogLevel, Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { GeminiVisionService, type ImageClassification } from "../../src/enrichment/GeminiVisionService";
import { GeminiVisionServiceLive } from "../../src/enrichment/GeminiVisionServiceLive";
import { fullExtractionEligible } from "../../src/enrichment/VisionEnrichmentExecutor";

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
// Result type
// ---------------------------------------------------------------------------

type RoutingResult = {
  readonly slug: string;
  readonly classification: ImageClassification | null;
  readonly route: "full" | "lightweight" | null;
  readonly elapsed: number;
  readonly error: string | null;
};

// ---------------------------------------------------------------------------
// Evaluate a single entry: classify + route
// ---------------------------------------------------------------------------

const evaluateEntry = (entry: GoldenEntry, runDir: string) =>
  Effect.gen(function* () {
    const svc = yield* GeminiVisionService;
    const start = Date.now();

    // Resolve MIME type from response headers
    const headResponse = yield* Effect.tryPromise({
      try: () => fetch(entry.url, { method: "HEAD" }),
      catch: () => new Error(`Failed to HEAD ${entry.url}`)
    });
    const mimeType = headResponse.headers.get("content-type") ?? "image/jpeg";

    // Classify the image (pass CDN URL directly — createPartFromUri handles it)
    const classification = yield* svc.classifyImage(entry.url, mimeType);

    const elapsed = Date.now() - start;

    // Compute routing decision
    const eligible = fullExtractionEligible(classification);
    const route = eligible ? "full" as const : "lightweight" as const;

    // Write per-entry JSON
    const output = {
      slug: entry.slug,
      classification,
      route,
      _meta: {
        elapsed,
        mimeType,
        evalTimestamp: new Date().toISOString(),
      },
    };

    fs.writeFileSync(
      path.join(runDir, `${entry.slug}.json`),
      JSON.stringify(output, null, 2)
    );

    yield* Effect.log(`${entry.slug}: ${route} (${elapsed}ms)`);

    const result: RoutingResult = {
      slug: entry.slug,
      classification,
      route,
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

        // Persist failure record
        const failureOutput = {
          slug: entry.slug,
          classification: null,
          route: null,
          error: message,
          _meta: {
            elapsed: 0,
            mimeType: null,
            evalTimestamp: new Date().toISOString(),
          },
        };
        fs.writeFileSync(
          path.join(runDir, `${entry.slug}.json`),
          JSON.stringify(failureOutput, null, 2)
        );

        const result: RoutingResult = {
          slug: entry.slug,
          classification: null,
          route: null,
          elapsed: 0,
          error: message,
        };
        return result;
      })
    )
  );

// ---------------------------------------------------------------------------
// Summary report
// ---------------------------------------------------------------------------

const writeSummary = (results: ReadonlyArray<RoutingResult>, runDir: string) =>
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
    const fullCount = results.filter((r) => r.route === "full").length;
    const lightCount = results.filter((r) => r.route === "lightweight").length;
    const errorCount = results.filter((r) => r.error !== null).length;

    // --- Stdout table ---
    const lines: string[] = [];
    lines.push(`\nRouting Eval Run — ${dateStr} ${timeStr}`);
    lines.push(`Golden set: ${total} images | Full: ${fullCount} | Lightweight: ${lightCount} | Errors: ${errorCount}\n`);

    // Table header
    lines.push(
      "| Slug | mediaType | chartTypes | hasDataPoints | isCompound | Route | ms |"
    );
    lines.push(
      "|------|-----------|------------|---------------|------------|-------|----|"
    );

    for (const r of results) {
      if (r.error) {
        lines.push(
          `| ${r.slug} | ERROR | — | — | — | — | — |`
        );
      } else {
        const c = r.classification!;
        lines.push(
          `| ${r.slug} | ${c.mediaType} | ${c.chartTypes.length > 0 ? c.chartTypes.join(", ") : "—"} | ${c.hasDataPoints} | ${c.isCompound} | ${r.route} | ${r.elapsed} |`
        );
      }
    }

    lines.push("");
    lines.push(`Routing: ${fullCount} full, ${lightCount} lightweight, ${errorCount} errors`);
    lines.push("");

    const content = lines.join("\n");

    // Write markdown summary
    fs.writeFileSync(path.join(runDir, "routing-summary.md"), content);

    // Print to stdout
    console.log(content);
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
    `Running routing eval on ${entries.length} of ${allEntries.length} golden set entries`
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

  yield* Effect.log("Routing eval complete");
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
