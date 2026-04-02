/**
 * Source attribution eval runner — evaluates the deterministic matcher
 * against a small golden set and writes diffable run artifacts.
 *
 * Usage:
 *   bun eval/source-attribution/run-eval.ts
 *   bun eval/source-attribution/run-eval.ts ercot
 *   bun eval/source-attribution/run-eval.ts ercot-chart-source-line
 */

import { Effect, Layer } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { ProviderRegistry } from "../../src/services/ProviderRegistry";
import { SourceAttributionMatcher } from "../../src/source/SourceAttributionMatcher";
import { stringifyUnknown } from "../../src/platform/Json";
import {
  assessEvalResult,
  buildFailureResult,
  formatActualProvider,
  formatExpectedProvider,
  loadGoldenSetFromString,
  summarizeAncillaryAssertions,
  type SourceAttributionEvalGoldenEntry,
  type SourceAttributionEvalResult
} from "./shared";

const GOLDEN_SET_PATH = path.join(import.meta.dir, "golden-set.jsonl");

const formatTimestamp = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
    "-",
    String(date.getMilliseconds()).padStart(3, "0")
  ].join("");

const createRunDirectory = (runsRoot: string) =>
  Effect.sync(() => {
    fs.mkdirSync(runsRoot, { recursive: true });

    const baseTimestamp = formatTimestamp(new Date());
    for (let attempt = 0; attempt < 1000; attempt++) {
      const suffix = attempt === 0
        ? ""
        : `-${String(attempt).padStart(2, "0")}`;
      const runDir = path.join(runsRoot, `${baseTimestamp}${suffix}`);

      try {
        fs.mkdirSync(runDir);
        return runDir;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        ) {
          throw error;
        }
      }
    }

    throw new Error(`Failed to create a unique run directory under ${runsRoot}`);
  });

const loadGoldenSet = Effect.gen(function* () {
  const raw = yield* Effect.try({
    try: () => fs.readFileSync(GOLDEN_SET_PATH, "utf-8"),
    catch: (error) =>
      new Error(`Failed to read ${GOLDEN_SET_PATH}: ${stringifyUnknown(error)}`)
  });

  return yield* loadGoldenSetFromString(raw);
});

const formatCell = (value: string) => value.replaceAll("|", "\\|");

const formatOptionalComparison = (
  expected: string | null | undefined,
  actual: string | null
) =>
  expected === undefined
    ? "—"
    : expected === actual
    ? actual ?? "—"
    : `! ${expected ?? "—"} -> ${actual ?? "—"}`;

const writeJson = (filePath: string, value: unknown) =>
  Effect.sync(() => {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  });

const evaluateEntry = (
  entry: SourceAttributionEvalGoldenEntry,
  runDir: string
) =>
  Effect.gen(function* () {
    const matcher = yield* SourceAttributionMatcher;
    const startedAt = Date.now();
    const result = yield* matcher.match(entry.input);
    const elapsed = Date.now() - startedAt;
    const assessed = assessEvalResult(entry, result, elapsed);

    yield* writeJson(path.join(runDir, `${entry.slug}.json`), {
      ...assessed,
      _meta: {
        elapsed,
        evalTimestamp: new Date().toISOString()
      }
    });

    yield* Effect.log(
      `${entry.slug}: ${assessed.rubric?.providerVerdict ?? "error"} (${elapsed}ms)`
    );

    return assessed;
  }).pipe(
    Effect.matchEffect({
      onSuccess: Effect.succeed,
      onFailure: (error) =>
        Effect.gen(function* () {
          const message = stringifyUnknown(error);
          const failed = buildFailureResult(entry, message);

          yield* writeJson(path.join(runDir, `${entry.slug}.json`), {
            ...failed,
            _meta: {
              elapsed: 0,
              evalTimestamp: new Date().toISOString()
            }
          });
          yield* Effect.logError(`${entry.slug}: FAILED — ${message}`);

          return failed;
        })
    })
  );

const writeSummary = (
  results: ReadonlyArray<SourceAttributionEvalResult>,
  runDir: string
) =>
  Effect.sync(() => {
    const now = new Date();
    const headerStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const okCount = results.filter((result) => result.rubric?.overall === "ok").length;
    const needsReviewCount = results.filter(
      (result) => result.rubric?.overall === "needs-review"
    ).length;
    const errorCount = results.filter((result) => result.error !== null).length;
    const ancillarySummary = summarizeAncillaryAssertions(results);
    const providerVerdictCounts = {
      trueMatch: results.filter(
        (result) => result.rubric?.providerVerdict === "true-match"
      ).length,
      ambiguous: results.filter(
        (result) => result.rubric?.providerVerdict === "ambiguous-case"
      ).length,
      expectedUnmatched: results.filter(
        (result) => result.rubric?.providerVerdict === "expected-unmatched"
      ).length,
      falsePositive: results.filter(
        (result) => result.rubric?.providerVerdict === "false-positive"
      ).length,
      miss: results.filter(
        (result) => result.rubric?.providerVerdict === "miss"
      ).length
    };
    const findings = results
      .filter((result) => result.rubric?.hasFindings || result.error !== null)
      .map((result) => result.slug);
    const formatAssertionSummary = (
      label: string,
      summary: { readonly matched: number; readonly asserted: number }
    ) =>
      summary.asserted === 0
        ? `no ${label} assertions`
        : `${summary.matched}/${summary.asserted} ${label} assertions matched`;

    const lines: Array<string> = [];
    lines.push(`# Source Attribution Eval Run — ${headerStamp}`);
    lines.push("");
    lines.push(
      `Golden set: ${results.length} cases | OK: ${okCount} | Needs review: ${needsReviewCount} | Errors: ${errorCount}`
    );
    lines.push("");
    lines.push(
      "| Slug | Expected | Actual | Verdict | Signals | Source | Publication |"
    );
    lines.push(
      "|------|----------|--------|---------|---------|--------|-------------|"
    );

    for (const result of results) {
      if (result.error !== null) {
        lines.push(
          `| ${formatCell(result.slug)} | ${formatCell(formatExpectedProvider(result.expected))} | error | error | — | — | — |`
        );
        continue;
      }

      const actual = result.actual!;
      const rubric = result.rubric!;
      lines.push(
        `| ${formatCell(result.slug)} | ${formatCell(formatExpectedProvider(result.expected))} | ${formatCell(formatActualProvider(actual))} | ${rubric.providerVerdict} | ${formatCell(actual.bestSignals.length > 0 ? actual.bestSignals.join(", ") : "—")} | ${formatCell(formatOptionalComparison(result.expected.contentSourceDomain, actual.contentSourceDomain))} | ${formatCell(formatOptionalComparison(result.expected.publication, actual.publication))} |`
      );
    }

    lines.push("");
    lines.push("## Rubric Summary");
    lines.push("");
    lines.push(
      `- Provider hits: ${providerVerdictCounts.trueMatch} true matches, ${providerVerdictCounts.ambiguous} expected ambiguous cases, ${providerVerdictCounts.expectedUnmatched} expected unmatched cases`
    );
    lines.push(
      `- Provider failures: ${providerVerdictCounts.falsePositive} false positives, ${providerVerdictCounts.miss} misses`
    );
    lines.push(
      `- Ancillary checks: ${formatAssertionSummary("content source", ancillarySummary.contentSource)}, ${formatAssertionSummary("publication", ancillarySummary.publication)}, ${formatAssertionSummary("source family", ancillarySummary.sourceFamily)}`
    );
    lines.push(
      `- Needs review: ${findings.length > 0 ? findings.join(", ") : "none"}`
    );
    lines.push("");

    const content = lines.join("\n");
    fs.writeFileSync(path.join(runDir, "summary.md"), content);
    console.log(content);
  });

const program = Effect.gen(function* () {
  const allEntries = yield* loadGoldenSet;
  const slugFilter = process.argv[2];
  const entries = slugFilter
    ? allEntries.filter(
        (entry) => entry.slug === slugFilter || entry.slug.startsWith(slugFilter)
      )
    : allEntries;

  if (entries.length === 0) {
    yield* Effect.logWarning(
      `No golden set entries matching "${slugFilter}". Available: ${allEntries.map((entry) => entry.slug).join(", ")}`
    );
    return;
  }

  yield* Effect.log(
    `Running source attribution eval on ${entries.length} of ${allEntries.length} golden set entries`
  );

  const runDir = yield* createRunDirectory(
    path.join(
      import.meta.dir,
      "runs"
    )
  );
  yield* Effect.log(`Output directory: ${runDir}`);

  const results = yield* Effect.forEach(
    entries,
    (entry) => evaluateEntry(entry, runDir)
  );

  yield* writeSummary(results, runDir);
  yield* Effect.log(`Eval complete: ${results.length} cases -> ${runDir}`);
});

const matcherLayer = SourceAttributionMatcher.layer.pipe(
  Layer.provide(ProviderRegistry.layer)
);

Effect.runPromise(
  program.pipe(Effect.provide(matcherLayer))
).catch((error) => {
  console.error(stringifyUnknown(error));
  process.exit(1);
});
