/**
 * CQ conformance harness — reads vocab validation reports, the runtime
 * registry, and the kernel eval gold set, then emits a three-lane verdict
 * per capability plus a per-gold-row dependency matrix.
 *
 * Usage:
 *   bun eval/cq-conformance/run.ts
 *   bun eval/cq-conformance/run.ts --vocab-validation-root ../ontology_skill/...
 *   bun eval/cq-conformance/run.ts --registry-root references/cold-start
 *
 * Outputs (written under eval/cq-conformance/runs/<timestamp>/):
 *
 *   summary.md
 *   capabilities.json
 *   gold-row-capability-matrix.json
 *
 * This harness is read-only — it does not mutate the registry or the
 * vocabulary. Per the conformance design discussion, it stays in parallel to
 * the kernel eval and shares its gold set + snapshot.
 */

import { Command, Flag } from "effect/unstable/cli";
import { Clock, Console, Effect, FileSystem, Layer, Path } from "effect";
import { checkedInDataLayerRegistryLayer } from "../../src/bootstrap/CheckedInDataLayerRegistry";
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
  indexExpectedOutcomes,
  loadExpectedOutcomesFromString,
  tracePost,
  type BundleTrace,
  type ExpectedKernelOutcome
} from "../resolution-kernel/shared";
import {
  CAPABILITY_DEFINITIONS,
  deriveVocabularyLane,
  type CapabilityDefinition,
  type CapabilityVerdict,
  type GlobalProbeContext,
  type GoldRowCellState,
  type KernelSourceLookup,
  type LaneCell
} from "./capabilities";
import { mergeVocabVerdicts } from "./shared/consumeValidationReports";
import {
  buildTraceabilityIndex,
  type TraceabilityIndex
} from "./shared/consumeTraceabilityMatrices";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const vocabValidationRootFlag = Flag.string("vocab-validation-root").pipe(
  Flag.withDescription(
    "Path to the sibling ontology repo's docs/ directory containing validation-report*.md and traceability-matrix*.csv"
  ),
  Flag.withDefault(
    "../ontology_skill/ontologies/skygest-energy-vocab/docs"
  )
);

const registryRootFlag = Flag.string("registry-root").pipe(
  Flag.withDescription("Path to the cold-start registry root"),
  Flag.withDefault("references/cold-start")
);

type CliOptions = {
  readonly vocabValidationRoot: typeof vocabValidationRootFlag.Type;
  readonly registryRoot: typeof registryRootFlag.Type;
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const RUNS_RELATIVE = "eval/cq-conformance/runs";
const SNAPSHOT_RELATIVE = "eval/resolution-stage1/snapshot.jsonl";
const EXPECTED_RELATIVE = "eval/resolution-kernel/expected-outcomes.jsonl";

const VALIDATION_REPORT_FILES = [
  "validation-report.md",
  "validation-report-sky309.md",
  "validation-report-gap-expansion.md",
  "validation-report-dcat-extension.md"
] as const;

const TRACEABILITY_MATRIX_FILES = [
  "traceability-matrix.csv",
  "traceability-matrix-dcat-extension.csv"
] as const;

const KERNEL_SOURCE_FILES = [
  "src/resolution/kernel/Bind.ts",
  "src/resolution/kernel/Interpret.ts",
  "src/resolution/kernel/AssembleOutcome.ts",
  "src/resolution/ResolutionKernel.ts"
] as const;

// ---------------------------------------------------------------------------
// Filesystem helpers (Effect-native, no Node imports)
// ---------------------------------------------------------------------------

const readTextIfExists = (absolutePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(absolutePath);
    if (!exists) {
      return null;
    }
    return yield* fs.readFileString(absolutePath);
  });

const readRequiredText = (relative: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* fs.readFileString(path.resolve(process.cwd(), relative));
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

const createRunDirectory = Effect.fn("cq-conformance.createRunDirectory")(
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

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

const loadVocabVerdicts = Effect.fn("cq-conformance.loadVocabVerdicts")(
  function* (vocabRoot: string) {
    const path = yield* Path.Path;
    const reports: Array<{ readonly path: string; readonly contents: string }> = [];
    for (const fileName of VALIDATION_REPORT_FILES) {
      const absolutePath = path.resolve(process.cwd(), vocabRoot, fileName);
      const contents = yield* readTextIfExists(absolutePath);
      if (contents !== null) {
        reports.push({ path: fileName, contents });
      }
    }
    return {
      verdicts: mergeVocabVerdicts(reports),
      reportsLoaded: reports.length
    };
  }
);

const loadTraceabilityIndex = Effect.fn("cq-conformance.loadTraceabilityIndex")(
  function* (vocabRoot: string) {
    const path = yield* Path.Path;
    const matrices: Array<{ readonly path: string; readonly contents: string }> = [];
    for (const fileName of TRACEABILITY_MATRIX_FILES) {
      const absolutePath = path.resolve(process.cwd(), vocabRoot, fileName);
      const contents = yield* readTextIfExists(absolutePath);
      if (contents !== null) {
        matrices.push({ path: fileName, contents });
      }
    }
    return buildTraceabilityIndex(matrices);
  }
);

const loadKernelSource = Effect.fn("cq-conformance.loadKernelSource")(
  function* (): Generator<unknown, KernelSourceLookup, never> {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const cache = new Map<string, string>();
    for (const relative of KERNEL_SOURCE_FILES) {
      const absolute = path.resolve(process.cwd(), relative);
      const exists = yield* fs.exists(absolute);
      if (exists) {
        cache.set(relative, yield* fs.readFileString(absolute));
      }
    }

    return {
      contains: (filePath, pattern) => {
        const contents = cache.get(filePath);
        return contents === undefined ? false : pattern.test(contents);
      },
      read: (filePath) => cache.get(filePath)
    };
  }
);

// ---------------------------------------------------------------------------
// Capability evaluation
// ---------------------------------------------------------------------------

type CapabilityRunResult = {
  readonly verdict: CapabilityVerdict;
  readonly goldRow: ReadonlyMap<string, GoldRowCellState>;
};

const evaluateCapability = (
  capability: CapabilityDefinition,
  ctx: GlobalProbeContext,
  vocabularyLane: LaneCell,
  goldRowEvaluations: ReadonlyArray<{
    readonly bundleKey: string;
    readonly state: GoldRowCellState;
  }>
): CapabilityRunResult => {
  const runtimeData = capability.runtimeData(ctx);
  const workerBehavior = capability.workerBehavior(ctx);
  const goldRow = new Map<string, GoldRowCellState>();
  for (const entry of goldRowEvaluations) {
    goldRow.set(entry.bundleKey, entry.state);
  }

  return {
    verdict: {
      capabilityId: capability.id,
      label: capability.label,
      description: capability.description,
      dependsOnCqIds: capability.dependsOnCqIds,
      lanes: {
        vocabulary: vocabularyLane,
        runtimeData,
        workerBehavior
      }
    },
    goldRow
  };
};

// ---------------------------------------------------------------------------
// Gold-row plumbing
// ---------------------------------------------------------------------------

type GoldRow = {
  readonly bundleKey: string;
  readonly slug: string;
  readonly postUri: string;
  readonly assetKey: string | null;
  readonly expected: ExpectedKernelOutcome;
  readonly trace: BundleTrace;
};

const bundleKey = (postUri: string, assetKey: string | null) =>
  assetKey === null ? postUri : `${postUri}#${assetKey}`;

// ---------------------------------------------------------------------------
// Summary formatter
// ---------------------------------------------------------------------------

const STATUS_GLYPH: Record<string, string> = {
  pass: "PASS",
  amber: "AMBER",
  fail: "FAIL",
  "n-a": "N/A"
};

const renderLane = (cell: LaneCell): string => {
  const tag = STATUS_GLYPH[cell.status] ?? cell.status;
  return `${tag} — ${cell.summary}${cell.detail ? ` (${cell.detail})` : ""}`;
};

const verdictToParagraph = (verdict: CapabilityVerdict): string => {
  const { lanes } = verdict;
  const sentences: Array<string> = [];

  if (lanes.vocabulary.status === "pass") {
    sentences.push("the vocabulary declares the relationship");
  } else if (lanes.vocabulary.status === "fail") {
    sentences.push(`the vocabulary lane is failing (${lanes.vocabulary.summary})`);
  } else if (lanes.vocabulary.status === "amber") {
    sentences.push(`the vocabulary lane is amber (${lanes.vocabulary.summary})`);
  } else {
    sentences.push("the vocabulary lane is not applicable");
  }

  if (lanes.runtimeData.status === "pass") {
    sentences.push(`the runtime data is populated (${lanes.runtimeData.summary})`);
  } else if (lanes.runtimeData.status === "fail") {
    sentences.push(`the runtime data is missing (${lanes.runtimeData.summary})`);
  } else if (lanes.runtimeData.status === "amber") {
    sentences.push(`the runtime data is partial (${lanes.runtimeData.summary})`);
  } else {
    sentences.push("the runtime data lane is not applicable");
  }

  if (lanes.workerBehavior.status === "pass") {
    sentences.push("the worker uses it");
  } else if (lanes.workerBehavior.status === "fail") {
    sentences.push(`the worker does not yet use it (${lanes.workerBehavior.summary})`);
  } else if (lanes.workerBehavior.status === "amber") {
    sentences.push(`the worker partially uses it (${lanes.workerBehavior.summary})`);
  } else {
    sentences.push("worker behavior is not applicable");
  }

  return sentences.join("; ");
};

const isActionable = (verdict: CapabilityVerdict): boolean => {
  const { lanes } = verdict;
  return (
    lanes.vocabulary.status === "pass" &&
    (lanes.runtimeData.status === "fail" ||
      lanes.runtimeData.status === "amber" ||
      lanes.workerBehavior.status === "fail" ||
      lanes.workerBehavior.status === "amber")
  );
};

const formatSummary = (
  verdicts: ReadonlyArray<CapabilityVerdict>,
  goldRowMatrix: ReadonlyArray<{
    readonly row: GoldRow;
    readonly cells: ReadonlyMap<string, GoldRowCellState>;
  }>,
  vocabReportsLoaded: number,
  vocabVerdictsCount: number,
  traceabilityIndex: TraceabilityIndex,
  registryRoot: string
): string => {
  const lines: Array<string> = [];
  lines.push(`# CQ Conformance Report — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Registry root: \`${registryRoot}\``);
  lines.push(
    `Vocabulary input: ${vocabReportsLoaded} validation report(s), ${vocabVerdictsCount} CQ verdicts, ${traceabilityIndex.all.length} traceability rows`
  );
  lines.push(`Capabilities: ${verdicts.length}`);
  lines.push(`Gold rows in matrix: ${goldRowMatrix.length}`);
  lines.push("");

  // Capability verdicts
  lines.push("## Capability verdicts");
  lines.push("");
  for (const verdict of verdicts) {
    lines.push(`### ${verdict.label} (\`${verdict.capabilityId}\`)`);
    lines.push("");
    lines.push(verdict.description);
    lines.push("");
    lines.push(`In plain terms: ${verdictToParagraph(verdict)}.`);
    lines.push("");
    lines.push(`- vocabulary: ${renderLane(verdict.lanes.vocabulary)}`);
    lines.push(`- runtimeData: ${renderLane(verdict.lanes.runtimeData)}`);
    lines.push(`- workerBehavior: ${renderLane(verdict.lanes.workerBehavior)}`);
    if (verdict.dependsOnCqIds.length > 0) {
      const useCases = new Set<string>();
      for (const cqId of verdict.dependsOnCqIds) {
        const trace = traceabilityIndex.byCqId.get(cqId);
        if (trace !== undefined) {
          useCases.add(`${trace.useCaseId} (${trace.stakeholderNeed})`);
        }
      }
      lines.push(`- depends on CQs: ${verdict.dependsOnCqIds.join(", ")}`);
      if (useCases.size > 0) {
        lines.push(`- traces to use cases: ${[...useCases].join("; ")}`);
      }
    }
    lines.push("");
  }

  // Punch list (vocab green + data/worker red)
  const actionable = verdicts.filter(isActionable);
  lines.push("## Actionable punch list");
  lines.push("");
  if (actionable.length === 0) {
    lines.push("- nothing actionable: every vocabulary-passing capability is also runtime-green");
  } else {
    lines.push(
      "Capabilities where the vocabulary already says yes, but the runtime data or worker behavior is not yet there. These are the highest-leverage fixes — the ontology has done its job, the runtime has not caught up."
    );
    lines.push("");
    for (const verdict of actionable) {
      const failingLane =
        verdict.lanes.runtimeData.status === "fail" || verdict.lanes.runtimeData.status === "amber"
          ? "runtimeData"
          : "workerBehavior";
      const cell =
        failingLane === "runtimeData" ? verdict.lanes.runtimeData : verdict.lanes.workerBehavior;
      lines.push(`- **${verdict.label}** (${failingLane}): ${cell.summary}`);
      if (cell.detail) {
        lines.push(`  - detail: ${cell.detail}`);
      }
    }
  }
  lines.push("");

  // Gold-row matrix table
  lines.push("## Gold-row dependency matrix");
  lines.push("");
  if (goldRowMatrix.length === 0) {
    lines.push("- no annotated gold rows matched the snapshot");
  } else {
    const header = ["row", ...verdicts.map((verdict) => verdict.capabilityId)];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (const entry of goldRowMatrix) {
      const cells = verdicts.map((verdict) => {
        const state = entry.cells.get(verdict.capabilityId);
        if (state === undefined) {
          return "·";
        }
        if (state.kind === "not-required") {
          return "·";
        }
        return state.satisfied ? "✓" : "✗";
      });
      lines.push(`| ${entry.row.slug} | ${cells.join(" | ")} |`);
    }

    // Per-row failure detail
    lines.push("");
    lines.push("### Per-row failure detail");
    lines.push("");
    for (const entry of goldRowMatrix) {
      const failures: Array<string> = [];
      for (const verdict of verdicts) {
        const state = entry.cells.get(verdict.capabilityId);
        if (state === undefined || state.kind !== "required" || state.satisfied) {
          continue;
        }
        const lane = state.failingLane ?? "?";
        failures.push(`  - **${verdict.capabilityId}** (${lane}): ${state.summary}`);
      }
      if (failures.length === 0) {
        continue;
      }
      lines.push(`#### ${entry.row.slug} (${entry.row.postUri})`);
      lines.push(...failures);
      lines.push("");
    }
  }

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const runConformance = Effect.fn("cq-conformance.run")(function* (
  options: CliOptions
) {
  const path = yield* Path.Path;
  const startedAt = yield* Clock.currentTimeMillis;

  const registry = yield* DataLayerRegistry;
  const vocabulary = yield* FacetVocabulary;

  const { verdicts: vocabVerdicts, reportsLoaded: vocabReportsLoaded } =
    yield* loadVocabVerdicts(options.vocabValidationRoot);
  const traceabilityIndex = yield* loadTraceabilityIndex(options.vocabValidationRoot);
  const kernelSource = yield* loadKernelSource();

  // Load the kernel-eval gold rows + snapshot so the matrix is computed against
  // the same bundles the kernel eval scores.
  const snapshotRaw = yield* readRequiredText(SNAPSHOT_RELATIVE);
  const snapshotRows = yield* loadSnapshotFromString(snapshotRaw);
  const expectedRaw = yield* readRequiredText(EXPECTED_RELATIVE);
  const expectedEntries = yield* loadExpectedOutcomesFromString(expectedRaw);
  const expectedIndex = indexExpectedOutcomes(expectedEntries);

  // Build per-bundle traces using the existing tracePost helper. We only
  // produce gold-row entries for bundles that have a matching expected entry —
  // unannotated bundles are out of scope for v1.
  //
  // Bundle-level expected entries (those with `assetKey`) match the bundle
  // whose assetKey they name. Post-level expected entries (no assetKey) are
  // attached to the *first* bundle of the post — one matrix row per gold
  // entry, not per bundle, so post-level expectations don't get duplicated
  // across N bundles.
  const goldRows: Array<GoldRow> = [];
  const seenPostLevelExpected = new Set<string>();
  for (const row of snapshotRows) {
    const stage1Input = toStage1Input(row);
    const traces = tracePost(stage1Input, registry.lookup, vocabulary);
    for (const trace of traces) {
      const assetKey = trace.assetKey;
      const bundleSpecific =
        assetKey !== null
          ? expectedIndex.byBundle.get(`${row.postUri}#${assetKey}`)
          : undefined;

      let expected: ExpectedKernelOutcome | undefined = bundleSpecific;
      if (expected === undefined) {
        const postLevelEntries = expectedIndex.byPost.get(row.postUri);
        if (postLevelEntries !== undefined && postLevelEntries.length > 0) {
          // Only attach to the first matching bundle to avoid the N×N
          // duplication seen in v1 dry-run.
          if (!seenPostLevelExpected.has(row.postUri)) {
            expected = postLevelEntries[0];
            seenPostLevelExpected.add(row.postUri);
          }
        }
      }

      if (expected === undefined) {
        continue;
      }

      goldRows.push({
        bundleKey: bundleKey(row.postUri, assetKey),
        slug: row.slug,
        postUri: row.postUri,
        assetKey,
        expected,
        trace
      });
    }
  }

  yield* Logging.logSummary("cq-conformance.gold-rows.assembled", {
    annotatedBundles: goldRows.length,
    snapshotRows: snapshotRows.length,
    expectedEntries: expectedEntries.length
  });

  const ctx: GlobalProbeContext = {
    prepared: registry.prepared,
    vocabulary,
    kernelSource
  };

  const verdicts: Array<CapabilityVerdict> = [];
  const goldRowMatrix = goldRows.map((row) => ({
    row,
    cells: new Map<string, GoldRowCellState>()
  }));

  for (const capability of CAPABILITY_DEFINITIONS) {
    const vocabularyLane = deriveVocabularyLane(capability, vocabVerdicts);

    // Per-row dependency check before running global probes — that way the
    // capability's gold-row evaluator can see the same context as the global
    // probes.
    const perRow: Array<{
      readonly bundleKey: string;
      readonly state: GoldRowCellState;
    }> = [];
    for (const entry of goldRowMatrix) {
      const state = capability.goldRowDependency({
        ...ctx,
        expected: entry.row.expected,
        trace: entry.row.trace
      });
      perRow.push({ bundleKey: entry.row.bundleKey, state });
      entry.cells.set(capability.id, state);
    }

    const result = evaluateCapability(capability, ctx, vocabularyLane, perRow);
    verdicts.push(result.verdict);
  }

  // Runs directory + outputs
  const runsRoot = path.resolve(process.cwd(), RUNS_RELATIVE);
  const runDir = yield* createRunDirectory(runsRoot);

  const summaryContent = formatSummary(
    verdicts,
    goldRowMatrix,
    vocabReportsLoaded,
    vocabVerdicts.size,
    traceabilityIndex,
    options.registryRoot
  );

  yield* writeTextFile(path.join(runDir, "summary.md"), summaryContent);
  yield* writeJsonFile(path.join(runDir, "capabilities.json"), {
    generatedAt: new Date().toISOString(),
    registryRoot: options.registryRoot,
    vocabValidationRoot: options.vocabValidationRoot,
    capabilities: verdicts
  });
  yield* writeJsonFile(path.join(runDir, "gold-row-capability-matrix.json"), {
    generatedAt: new Date().toISOString(),
    rows: goldRowMatrix.map((entry) => ({
      bundleKey: entry.row.bundleKey,
      slug: entry.row.slug,
      postUri: entry.row.postUri,
      assetKey: entry.row.assetKey,
      expectedOutcomeTag: entry.row.expected.outcomeTag,
      expectedVariableIds: entry.row.expected.expectedVariableIds ?? [],
      cells: Object.fromEntries(entry.cells.entries())
    }))
  });

  const finishedAt = yield* Clock.currentTimeMillis;
  yield* Console.log("");
  yield* Console.log(summaryContent);
  yield* Console.log("");
  yield* Console.log(`Wrote ${runDir} (${finishedAt - startedAt}ms)`);

  yield* Logging.logSummary("cq-conformance.run.completed", {
    runDir,
    capabilities: verdicts.length,
    goldRows: goldRowMatrix.length,
    durationMs: finishedAt - startedAt
  });
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

const conformanceCommand = Command.make(
  "cq-conformance",
  {
    vocabValidationRoot: vocabValidationRootFlag,
    registryRoot: registryRootFlag
  },
  runConformance
);

const cli = Command.runWith(conformanceCommand, {
  version: "0.1.0"
});

const runtimeLayer = (registryRoot: string) =>
  Layer.mergeAll(
    checkedInDataLayerRegistryLayer(registryRoot),
    FacetVocabulary.layer
  );

// We can't read the flag inside Layer.mergeAll because the layer is built
// before the command runs. Use the default registry root for the layer; the
// CLI flag value is still surfaced in the output for transparency.
runScriptMain(
  "cq-conformance",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(runtimeLayer("references/cold-start")),
    Effect.provide(scriptPlatformLayer)
  )
);
