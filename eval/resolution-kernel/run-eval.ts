/**
 * Resolution kernel deterministic eval runner.
 *
 * Usage:
 *   bun eval/resolution-kernel/run-eval.ts
 *   bun eval/resolution-kernel/run-eval.ts --filter 001-ember-energy
 *
 * Reads the stage1 snapshot (same `Stage1Input` contract feeds both harnesses)
 * and the kernel-specific `expected-outcomes.jsonl`, then invokes the full
 * `ResolutionKernel` service against the checked-in data layer registry.
 *
 * Each run writes per-entry JSON files plus `summary.md` into
 * `eval/resolution-kernel/runs/<timestamp>/`.
 */

import { Command, Flag } from "effect/unstable/cli";
import { Clock, Console, Effect, FileSystem, Layer, Path } from "effect";
import { checkedInDataLayerRegistryLayer } from "../../src/bootstrap/CheckedInDataLayerRegistry";
import { ResolutionOutcomeStatus } from "../../src/domain/resolutionKernel";
import { FacetVocabulary } from "../../src/resolution/facetVocabulary";
import { DataLayerRegistry } from "../../src/services/DataLayerRegistry";
import { Logging } from "../../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../../src/platform/ScriptRuntime";
import {
  loadSnapshotFromString,
  toStage1Input
} from "../resolution-stage1/shared";
import {
  buildFailureEntry,
  evaluateRow,
  formatTraceDiagnostic,
  indexExpectedOutcomes,
  loadExpectedOutcomesFromString,
  summarizeBundles,
  tracePost,
  type BundleTrace,
  type ExpectedOutcomesIndex,
  type KernelEvalEntry
} from "./shared";

const SNAPSHOT_RELATIVE = "eval/resolution-stage1/snapshot.jsonl";
const EXPECTED_RELATIVE = "eval/resolution-kernel/expected-outcomes.jsonl";
const RUNS_RELATIVE = "eval/resolution-kernel/runs";

const filterFlag = Flag.string("filter").pipe(
  Flag.withDescription("Filter snapshot rows by exact slug or prefix"),
  Flag.optional
);

type CliOptions = {
  readonly filter: typeof filterFlag.Type;
};

const formatTimestamp = (millis: number) => {
  const date = new Date(millis);
  return [
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
};

const createRunDirectory = Effect.fn("kernel-eval.createRunDirectory")(
  function* (runsRoot: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(runsRoot, { recursive: true });
    const baseTimestamp = formatTimestamp(yield* Clock.currentTimeMillis);

    for (let attempt = 0; attempt < 1000; attempt++) {
      const suffix = attempt === 0 ? "" : `-${String(attempt).padStart(2, "0")}`;
      const runDir = path.join(runsRoot, `${baseTimestamp}${suffix}`);
      const exists = yield* fs.exists(runDir);
      if (!exists) {
        yield* fs.makeDirectory(runDir, { recursive: true });
        return runDir;
      }
    }

    return yield* Effect.die(
      new Error(`Failed to create a unique run directory under ${runsRoot}`)
    );
  }
);

const readText = (relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const absolute = path.resolve(process.cwd(), relative);
    return yield* fs.readFileString(absolute);
  });

const writeJsonFile = (filePath: string, value: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, `${JSON.stringify(value, null, 2)}\n`);
  });

const writeTextFile = (filePath: string, contents: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, contents);
  });

const OUTCOME_TAGS: ReadonlyArray<ResolutionOutcomeStatus> = [
  "Resolved",
  "Ambiguous",
  "Underspecified",
  "Conflicted",
  "OutOfRegistry",
  "NoMatch"
];

type ConfusionMatrix = Record<
  ResolutionOutcomeStatus,
  Record<ResolutionOutcomeStatus, number>
>;

const emptyMatrix = (): ConfusionMatrix =>
  Object.fromEntries(
    OUTCOME_TAGS.map((expected) => [
      expected,
      Object.fromEntries(
        OUTCOME_TAGS.map((actual) => [actual, 0])
      ) as Record<ResolutionOutcomeStatus, number>
    ])
  ) as ConfusionMatrix;

const formatSummary = (
  entries: ReadonlyArray<KernelEvalEntry>,
  runWallClockMs: number
) => {
  const annotated = entries.flatMap((entry) =>
    entry.kind === "annotated" ? [entry] : []
  );
  const unannotated = entries.flatMap((entry) =>
    entry.kind === "unannotated" ? [entry] : []
  );

  const matrix = emptyMatrix();
  let passCount = 0;
  let failCount = 0;
  const failingRows: Array<(typeof annotated)[number]> = [];

  for (const entry of annotated) {
    const actualTag = entry.selectedBundle?.actual.outcomeTag ?? "NoMatch";
    matrix[entry.expected.outcomeTag][actualTag] += 1;
    if (entry.hasFindings || entry.error !== null) {
      failCount += 1;
      failingRows.push(entry);
    } else {
      passCount += 1;
    }
  }

  const lines: Array<string> = [];
  lines.push(`# Resolution Kernel Eval Run — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    `Annotated: ${annotated.length} | Pass: ${passCount} | Fail: ${failCount} | Unannotated bundles: ${unannotated.reduce(
      (acc, entry) => acc + entry.bundles.length,
      0
    )}`
  );
  lines.push(`Wall-clock: ${runWallClockMs}ms`);
  lines.push("");

  lines.push("## Outcome-tag confusion matrix");
  lines.push("");
  lines.push(`| expected \\ actual | ${OUTCOME_TAGS.join(" | ")} |`);
  lines.push(`| --- | ${OUTCOME_TAGS.map(() => "---").join(" | ")} |`);
  for (const expectedTag of OUTCOME_TAGS) {
    const row = OUTCOME_TAGS.map((actualTag) =>
      String(matrix[expectedTag][actualTag])
    );
    lines.push(`| ${expectedTag} | ${row.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## Failing rows");
  lines.push("");
  if (failingRows.length === 0) {
    lines.push("- none");
  } else {
    for (const row of failingRows) {
      lines.push(`### ${row.slug} (${row.postUri})`);
      if (row.error !== null) {
        lines.push(`- Error: ${row.error}`);
        lines.push("");
        continue;
      }
      lines.push(
        `- Expected: ${row.expected.outcomeTag}${
          row.expected.assetKey !== undefined
            ? ` (asset=${row.expected.assetKey})`
            : ""
        }`
      );
      lines.push(
        `- Actual: ${row.selectedBundle?.actual.outcomeTag ?? "NoMatch"}`
      );
      for (const check of row.checks) {
        if (check.pass) {
          continue;
        }
        switch (check.kind) {
          case "outcome-tag":
            lines.push(
              `- outcome-tag: expected ${check.expected}, got ${check.actual}`
            );
            break;
          case "variable-ids":
            lines.push(
              `- variable-ids: missing=[${check.missing.join(", ")}] unexpected=[${check.unexpected.join(", ")}]`
            );
            break;
          case "gap-reason":
            lines.push(
              `- gap-reason: expected ${check.expected}, got ${check.actual ?? "—"}`
            );
            break;
          case "agent-scope":
            lines.push(
              `- agent-scope: expected ${check.expected}, got ${check.actual ?? "—"}`
            );
            break;
        }
      }
      if (row.selectedBundle !== null) {
        lines.push("- Trace:");
        for (const traceLine of formatTraceDiagnostic(
          row.selectedBundle.trace
        )) {
          lines.push(`  ${traceLine}`);
        }
      }
      if (row.expected.notes !== undefined) {
        lines.push(`- Notes: ${row.expected.notes}`);
      }
      lines.push("");
    }
  }

  if (unannotated.length > 0) {
    lines.push("## Unannotated bundles (candidates for new ground truth)");
    lines.push("");
    for (const entry of unannotated) {
      lines.push(`### ${entry.slug} (${entry.postUri})`);
      if (entry.error !== null) {
        lines.push(`- Error: ${entry.error}`);
        lines.push("");
        continue;
      }
      for (const bundle of entry.bundles) {
        lines.push(
          `- asset=${bundle.assetKey ?? "post-text"} actualTag=${bundle.actual.outcomeTag} boundVars=[${bundle.actual.boundVariableIds.join(", ")}] gap=${bundle.actual.gapReason ?? "—"}`
        );
      }
      lines.push("");
    }
  }

  return { content: lines.join("\n"), matrix, passCount, failCount };
};

const resolveRow = Effect.fn("kernel-eval.row")(function* (
  row: Parameters<typeof toStage1Input>[0],
  index: ExpectedOutcomesIndex
) {
  const registry = yield* DataLayerRegistry;
  const vocabulary = yield* FacetVocabulary;
  const stage1Input = toStage1Input(row);

  const traces = tracePost(stage1Input, registry.lookup, vocabulary);
  const bundles = summarizeBundles(traces);
  const entries = evaluateRow(row.slug, row.postUri, bundles, index);
  const annotated = entries.filter((entry) => entry.kind === "annotated");
  const failing = annotated.filter(
    (entry) => entry.kind === "annotated" && entry.hasFindings
  ).length;

  yield* Logging.logSummary("kernel-eval.row.completed", {
    slug: row.slug,
    postUri: row.postUri,
    bundleCount: bundles.length,
    annotatedCount: annotated.length,
    failingCount: failing,
    resolvedAgentId: traces[0]?.agentId ?? null,
    outcomes: bundles.map((bundle) => ({
      assetKey: bundle.assetKey,
      outcomeTag: bundle.actual.outcomeTag,
      interpretTag: bundle.trace.interpreted._tag,
      boundVariableIds: [...bundle.actual.boundVariableIds],
      gapReason: bundle.actual.gapReason
    }))
  });

  return entries;
});

const runKernelEval = Effect.fn("kernel-eval.run")(function* (
  options: CliOptions
) {
  const path = yield* Path.Path;
  const startedAt = yield* Clock.currentTimeMillis;

  const snapshotRaw = yield* readText(SNAPSHOT_RELATIVE);
  const allRows = yield* loadSnapshotFromString(snapshotRaw);
  const filter = options.filter._tag === "Some" ? options.filter.value : null;
  const rows =
    filter === null
      ? allRows
      : allRows.filter(
          (row) => row.slug === filter || row.slug.startsWith(filter)
        );

  if (rows.length === 0) {
    yield* Console.log(`No snapshot rows matching "${filter ?? "(none)"}"`);
    return;
  }

  const expectedRaw = yield* readText(EXPECTED_RELATIVE);
  const expectedEntries = yield* loadExpectedOutcomesFromString(expectedRaw);
  const index = indexExpectedOutcomes(expectedEntries);

  const runsRoot = path.resolve(process.cwd(), RUNS_RELATIVE);
  const runDir = yield* createRunDirectory(runsRoot);

  yield* Logging.logSummary("kernel-eval.run.started", {
    rowCount: rows.length,
    expectedEntryCount: expectedEntries.length,
    filter: filter ?? null,
    runDir
  });

  const perRow = yield* Effect.forEach(rows, (row) =>
    resolveRow(row, index).pipe(
      Logging.withContext({ slug: row.slug, postUri: row.postUri })
    )
  );
  const flattened = perRow.flat();

  for (const entry of flattened) {
    const assetTag =
      entry.kind === "annotated" && entry.expected.assetKey !== undefined
        ? `-${entry.expected.assetKey}`
        : "";
    const filename = `${entry.slug}-${entry.kind}${assetTag}.json`;
    yield* writeJsonFile(path.join(runDir, filename), entry);
  }

  const finishedAt = yield* Clock.currentTimeMillis;
  const { content, matrix, passCount, failCount } = formatSummary(
    flattened,
    finishedAt - startedAt
  );

  yield* writeTextFile(path.join(runDir, "summary.md"), content);
  yield* writeJsonFile(path.join(runDir, "confusion-matrix.json"), matrix);
  yield* Console.log("");
  yield* Console.log(content);

  yield* Logging.logSummary("kernel-eval.run.completed", {
    rowCount: rows.length,
    annotatedPass: passCount,
    annotatedFail: failCount,
    entryCount: flattened.length,
    durationMs: finishedAt - startedAt,
    runDir
  });
});

const runKernelEvalCommand = Command.make(
  "resolution-kernel-eval",
  { filter: filterFlag },
  runKernelEval
);

const kernelLayer = Layer.mergeAll(
  checkedInDataLayerRegistryLayer(),
  FacetVocabulary.layer
);

const cli = Command.runWith(runKernelEvalCommand, {
  version: "0.1.0"
});

runScriptMain(
  "resolution-kernel-eval",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(kernelLayer),
    Effect.provide(scriptPlatformLayer)
  )
);
