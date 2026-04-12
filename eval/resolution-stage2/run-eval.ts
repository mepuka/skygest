/**
 * Stage 1 + Stage 2 comparative deterministic resolution eval runner.
 *
 * Usage:
 *   bun eval/resolution-stage2/run-eval.ts
 *   bun eval/resolution-stage2/run-eval.ts 001-kendrawrites-com
 */

import { Argument, Command } from "effect/unstable/cli";
import {
  Console,
  DateTime,
  Effect,
  FileSystem,
  Option,
  Path
} from "effect";
import { loadCheckedInDataLayerRegistry } from "../../src/bootstrap/CheckedInDataLayerRegistry";
import { Candidate } from "../../src/domain/data-layer/candidate";
import {
  decodeJsonStringWith,
  stringifyUnknown
} from "../../src/platform/Json";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../../src/platform/ScriptRuntime";
import {
  loadFacetVocabularyLookups,
  makeFacetVocabulary,
  type FacetVocabularyShape
} from "../../src/resolution/facetVocabulary";
import { runStage1 } from "../../src/resolution/Stage1";
import { runStage2 } from "../../src/resolution/Stage2";
import {
  toDataLayerRegistryLookup,
  type DataLayerRegistryLookup
} from "../../src/resolution/dataLayerRegistry";
import type { Stage1ExpectedRefs } from "../resolution-stage1/shared";
import {
  assessStage2EvalResult,
  buildStage2FailureResult,
  emptyExpectedRefs,
  loadSnapshotFromString,
  projectExpectedRefsByPost,
  toStage1Input,
  type Stage2EvalResult,
  type Stage2ObservationBucket
} from "./shared";

type EvalPaths = {
  readonly snapshotPath: string;
  readonly candidatesDir: string;
  readonly runsRoot: string;
};

type GrainTotals = {
  readonly expected: number;
  readonly stage1Actual: number;
  readonly stage1TruePositive: number;
  readonly combinedActual: number;
  readonly combinedTruePositive: number;
};

const slugFilterArgument = Argument.string("slug-filter").pipe(
  Argument.optional,
  Argument.withDescription("Optional exact-or-prefix slug filter")
);

const formatRunDirectoryTimestamp = (timestamp: DateTime.Utc) =>
  DateTime.formatIso(timestamp)
    .replace("T", "-")
    .replaceAll(":", "")
    .replace(".", "-");

const resolveEvalPaths = Effect.gen(function* () {
  const path = yield* Path.Path;

  return {
    snapshotPath: path.resolve(
      import.meta.dirname,
      "../resolution-stage1/snapshot.jsonl"
    ),
    candidatesDir: path.resolve(
      import.meta.dirname,
      "../../references/cold-start/candidates"
    ),
    runsRoot: path.resolve(import.meta.dirname, "runs")
  } satisfies EvalPaths;
});

const readSnapshot = (snapshotPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const raw = yield* fs.readFileString(snapshotPath).pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Failed to read ${snapshotPath}: ${stringifyUnknown(error)}`
          )
      )
    );

    return yield* loadSnapshotFromString(raw);
  });

const readCandidates = (candidatesDir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const decodeCandidateJson = decodeJsonStringWith(Candidate);
    const fileNames = yield* fs.readDirectory(candidatesDir).pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Failed to read ${candidatesDir}: ${stringifyUnknown(error)}`
          )
      )
    );

    return yield* Effect.forEach(
      fileNames
        .filter(
          (fileName) =>
            fileName.endsWith(".json") && !fileName.startsWith(".")
        )
        .sort((left, right) => left.localeCompare(right)),
      (fileName) =>
        Effect.gen(function* () {
          const filePath = path.join(candidatesDir, fileName);
          const raw = yield* fs.readFileString(filePath).pipe(
            Effect.mapError(
              (error) =>
                new Error(
                  `Failed to read ${filePath}: ${stringifyUnknown(error)}`
                )
            )
          );

          return yield* Effect.try({
            try: () => decodeCandidateJson(raw),
            catch: (error) =>
              new Error(
                `Failed to decode candidate ${fileName}: ${stringifyUnknown(error)}`
              )
          });
        })
    );
  });

const writeJson = (filePath: string, value: unknown) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, JSON.stringify(value, null, 2));
  });

const writeText = (filePath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(filePath, content);
  });

const createRunDirectory = (runsRoot: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(runsRoot, { recursive: true });

    const baseTimestamp = formatRunDirectoryTimestamp(yield* DateTime.now);

    for (let attempt = 0; attempt < 1000; attempt++) {
      const suffix =
        attempt === 0 ? "" : `-${String(attempt).padStart(2, "0")}`;
      const runDir = path.join(runsRoot, `${baseTimestamp}${suffix}`);
      const exists = yield* fs.exists(runDir);

      if (!exists) {
        yield* fs.makeDirectory(runDir);
        return runDir;
      }
    }

    return yield* Effect.fail(
      new Error(`Failed to create a unique run directory under ${runsRoot}`)
    );
  });

const formatRefSet = (ids: ReadonlyArray<string>) =>
  ids.length === 0 ? "—" : ids.join(", ");

const countIds = (ids: ReadonlyArray<string>) => ids.length;

const diffCount = (diff: NonNullable<Stage2EvalResult["combinedDiff"]>) =>
  countIds(diff.missing.distributionIds) +
  countIds(diff.missing.datasetIds) +
  countIds(diff.missing.agentIds) +
  countIds(diff.missing.variableIds) +
  countIds(diff.unexpected.distributionIds) +
  countIds(diff.unexpected.datasetIds) +
  countIds(diff.unexpected.agentIds) +
  countIds(diff.unexpected.variableIds);

const intersectionSize = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
) => left.filter((value) => right.includes(value)).length;

const effectLabel = (delta: number) =>
  delta < 0 ? "improved" : delta > 0 ? "degraded" : "unchanged";

const formatSigned = (value: number) =>
  `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;

const formatBucketSummary = (buckets: ReadonlyArray<Stage2ObservationBucket>) =>
  buckets.length === 0 ? "—" : buckets.join(", ");

const emptyGrainTotals = (): GrainTotals => ({
  expected: 0,
  stage1Actual: 0,
  stage1TruePositive: 0,
  combinedActual: 0,
  combinedTruePositive: 0
});

const precision = (truePositive: number, actual: number) =>
  actual === 0 ? 1 : truePositive / actual;

const recall = (truePositive: number, expected: number) =>
  expected === 0 ? 1 : truePositive / expected;

const scoreCell = (totals: {
  readonly expected: number;
  readonly actual: number;
  readonly truePositive: number;
}) =>
  `P=${precision(totals.truePositive, totals.actual).toFixed(2)} R=${recall(totals.truePositive, totals.expected).toFixed(2)}`;

const deltaCell = (totals: GrainTotals) => {
  const precisionDelta =
    precision(totals.combinedTruePositive, totals.combinedActual) -
    precision(totals.stage1TruePositive, totals.stage1Actual);
  const recallDelta =
    recall(totals.combinedTruePositive, totals.expected) -
    recall(totals.stage1TruePositive, totals.expected);

  return `P=${formatSigned(precisionDelta)} R=${formatSigned(recallDelta)}`;
};

const evaluateRow = (
  row: Awaited<ReturnType<typeof loadSnapshotFromString>>[number],
  expected: Stage1ExpectedRefs,
  lookup: DataLayerRegistryLookup,
  vocabulary: FacetVocabularyShape,
  runDir: string
) => {
  const startedAt = performance.now();
  const elapsedMs = () => Math.round(performance.now() - startedAt);

  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const stage1Result = runStage1(toStage1Input(row), lookup);
    const stage2Result = runStage2(
      row.postContext,
      stage1Result,
      lookup,
      vocabulary
    );
    const elapsed = elapsedMs();
    const assessed = assessStage2EvalResult(
      row,
      expected,
      stage1Result,
      stage2Result,
      elapsed
    );

    yield* writeJson(path.join(runDir, `${row.slug}.json`), assessed);
    yield* Effect.log(
      `${row.slug}: recall ${effectLabel(assessed.liftDetail?.missingDelta ?? 0)}, precision ${effectLabel(assessed.liftDetail?.unexpectedDelta ?? 0)} (${elapsed}ms)`
    );

    return assessed;
  }).pipe(
    Effect.matchEffect({
      onSuccess: Effect.succeed,
      onFailure: (error) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const failed = buildStage2FailureResult(
            row,
            expected,
            stringifyUnknown(error),
            elapsedMs()
          );
          yield* writeJson(path.join(runDir, `${row.slug}.json`), failed);
          yield* Effect.logError(`${row.slug}: FAILED — ${failed.error}`);
          return failed;
        })
    })
  );
};

const writeComparativeSummary = (
  results: ReadonlyArray<Stage2EvalResult>,
  runDir: string
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const generatedAt = DateTime.formatIso(yield* DateTime.now);
    const stage1Failures = results.filter(
      (result) => result.error !== null || result.stage1HasFindings
    ).length;
    const combinedFailures = results.filter(
      (result) => result.error !== null || result.hasFindings
    ).length;
    const errorCount = results.filter((result) => result.error !== null).length;
    const successful = results.filter(
      (result) => result.error === null && result.liftDetail !== null
    );
    const failing = results.filter(
      (result) => result.error !== null || result.hasFindings
    );

    const recallCounts = {
      improved: successful.filter(
        (result) => (result.liftDetail?.missingDelta ?? 0) < 0
      ).length,
      degraded: successful.filter(
        (result) => (result.liftDetail?.missingDelta ?? 0) > 0
      ).length,
      unchanged: successful.filter(
        (result) => (result.liftDetail?.missingDelta ?? 0) === 0
      ).length
    };
    const precisionCounts = {
      improved: successful.filter(
        (result) => (result.liftDetail?.unexpectedDelta ?? 0) < 0
      ).length,
      degraded: successful.filter(
        (result) => (result.liftDetail?.unexpectedDelta ?? 0) > 0
      ).length,
      unchanged: successful.filter(
        (result) => (result.liftDetail?.unexpectedDelta ?? 0) === 0
      ).length
    };

    const directTotals = {
      distribution: emptyGrainTotals(),
      dataset: emptyGrainTotals(),
      agent: emptyGrainTotals(),
      variable: emptyGrainTotals()
    };

    const bucketCounts = new Map<Stage2ObservationBucket, number>();

    for (const result of results) {
      for (const bucket of result.stage2ObservationBuckets) {
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      }

      if (result.stage1Actual === null || result.combinedActual === null) {
        continue;
      }

      directTotals.distribution = {
        expected:
          directTotals.distribution.expected +
          result.expected.distributionIds.length,
        stage1Actual:
          directTotals.distribution.stage1Actual +
          result.stage1Actual.distributionIds.length,
        stage1TruePositive:
          directTotals.distribution.stage1TruePositive +
          intersectionSize(
            result.expected.distributionIds,
            result.stage1Actual.distributionIds
          ),
        combinedActual:
          directTotals.distribution.combinedActual +
          result.combinedActual.distributionIds.length,
        combinedTruePositive:
          directTotals.distribution.combinedTruePositive +
          intersectionSize(
            result.expected.distributionIds,
            result.combinedActual.distributionIds
          )
      };

      directTotals.dataset = {
        expected: directTotals.dataset.expected + result.expected.datasetIds.length,
        stage1Actual:
          directTotals.dataset.stage1Actual + result.stage1Actual.datasetIds.length,
        stage1TruePositive:
          directTotals.dataset.stage1TruePositive +
          intersectionSize(result.expected.datasetIds, result.stage1Actual.datasetIds),
        combinedActual:
          directTotals.dataset.combinedActual + result.combinedActual.datasetIds.length,
        combinedTruePositive:
          directTotals.dataset.combinedTruePositive +
          intersectionSize(result.expected.datasetIds, result.combinedActual.datasetIds)
      };

      directTotals.agent = {
        expected: directTotals.agent.expected + result.expected.agentIds.length,
        stage1Actual:
          directTotals.agent.stage1Actual + result.stage1Actual.agentIds.length,
        stage1TruePositive:
          directTotals.agent.stage1TruePositive +
          intersectionSize(result.expected.agentIds, result.stage1Actual.agentIds),
        combinedActual:
          directTotals.agent.combinedActual + result.combinedActual.agentIds.length,
        combinedTruePositive:
          directTotals.agent.combinedTruePositive +
          intersectionSize(result.expected.agentIds, result.combinedActual.agentIds)
      };

      directTotals.variable = {
        expected: directTotals.variable.expected + result.expected.variableIds.length,
        stage1Actual:
          directTotals.variable.stage1Actual + result.stage1Actual.variableIds.length,
        stage1TruePositive:
          directTotals.variable.stage1TruePositive +
          intersectionSize(result.expected.variableIds, result.stage1Actual.variableIds),
        combinedActual:
          directTotals.variable.combinedActual + result.combinedActual.variableIds.length,
        combinedTruePositive:
          directTotals.variable.combinedTruePositive +
          intersectionSize(result.expected.variableIds, result.combinedActual.variableIds)
      };
    }

    const bucketLevers: Record<Stage2ObservationBucket, string> = {
      "no-facet-match": "Expand vocabulary / fix ontology",
      "facet-match-no-variable": "Add registry Variables OR fix vocab mappings",
      "fuzzy-below-threshold": "Adjust thresholds after validating lane coverage",
      "fuzzy-no-candidate": "Add lane coverage / aliases / registry candidates",
      ambiguous: "Add discriminating facets or improve scoring",
      handoff: "No Stage 2 action (Stage 3 / registry-gap)",
      "wrong-new-match": "Fix vocab misclassification / scoring"
    };

    const lines: Array<string> = [];
    lines.push(`# Stage 1+2 Comparative Eval Run — ${generatedAt}`);
    lines.push("");
    lines.push(
      `Rows: ${results.length} | Stage 1 failures: ${stage1Failures} | Stage 1+2 failures: ${combinedFailures} | Errors: ${errorCount}`
    );
    lines.push("");
    lines.push("## Per-Post Lift");
    lines.push("");

    if (successful.length === 0) {
      lines.push("- none");
    } else {
      lines.push("| Post | Missing Δ | Unexpected Δ | Recall Effect | Precision Effect |");
      lines.push("|------|-----------|--------------|---------------|------------------|");
      for (const result of successful) {
        lines.push(
          `| ${result.slug} | ${result.liftDetail?.missingDelta ?? 0} | ${result.liftDetail?.unexpectedDelta ?? 0} | ${effectLabel(result.liftDetail?.missingDelta ?? 0)} | ${effectLabel(result.liftDetail?.unexpectedDelta ?? 0)} |`
        );
      }
      lines.push("");
      lines.push(
        `- Recall improved: ${recallCounts.improved} | Recall degraded: ${recallCounts.degraded} | Recall unchanged: ${recallCounts.unchanged}`
      );
      lines.push(
        `- Precision improved: ${precisionCounts.improved} | Precision degraded: ${precisionCounts.degraded} | Precision unchanged: ${precisionCounts.unchanged}`
      );
    }

    lines.push("");
    lines.push("## Precision / Recall");
    lines.push("");
    lines.push("| Grain | Stage 1 P/R | Stage 1+2 P/R | Delta |");
    lines.push("|------|-------------|---------------|-------|");
    lines.push(
      `| Distribution | ${scoreCell({
        expected: directTotals.distribution.expected,
        actual: directTotals.distribution.stage1Actual,
        truePositive: directTotals.distribution.stage1TruePositive
      })} | ${scoreCell({
        expected: directTotals.distribution.expected,
        actual: directTotals.distribution.combinedActual,
        truePositive: directTotals.distribution.combinedTruePositive
      })} | ${deltaCell(directTotals.distribution)} |`
    );
    lines.push(
      `| Dataset | ${scoreCell({
        expected: directTotals.dataset.expected,
        actual: directTotals.dataset.stage1Actual,
        truePositive: directTotals.dataset.stage1TruePositive
      })} | ${scoreCell({
        expected: directTotals.dataset.expected,
        actual: directTotals.dataset.combinedActual,
        truePositive: directTotals.dataset.combinedTruePositive
      })} | ${deltaCell(directTotals.dataset)} |`
    );
    lines.push(
      `| Agent | ${scoreCell({
        expected: directTotals.agent.expected,
        actual: directTotals.agent.stage1Actual,
        truePositive: directTotals.agent.stage1TruePositive
      })} | ${scoreCell({
        expected: directTotals.agent.expected,
        actual: directTotals.agent.combinedActual,
        truePositive: directTotals.agent.combinedTruePositive
      })} | ${deltaCell(directTotals.agent)} |`
    );
    lines.push(
      `| Variable | ${scoreCell({
        expected: directTotals.variable.expected,
        actual: directTotals.variable.stage1Actual,
        truePositive: directTotals.variable.stage1TruePositive
      })} | ${scoreCell({
        expected: directTotals.variable.expected,
        actual: directTotals.variable.combinedActual,
        truePositive: directTotals.variable.combinedTruePositive
      })} | ${deltaCell(directTotals.variable)} |`
    );

    lines.push("");
    lines.push("## Residual Progression (by kind)");
    lines.push("");
    lines.push("| Residual Kind | Entered | Resolved | Corroborated | Escalated |");
    lines.push("|---------------|---------|----------|--------------|-----------|");

    const firstWithProgression = results.find(
      (result) => result.residualProgression !== null
    );
    if (firstWithProgression === undefined) {
      lines.push("| none | 0 | 0 | 0 | 0 |");
    } else {
      const progressionTotals = {
        DeferredToStage2Residual: {
          entered: 0,
          resolved: 0,
          corroborated: 0,
          escalated: 0
        },
        UnmatchedTextResidual: {
          entered: 0,
          resolved: 0,
          corroborated: 0,
          escalated: 0
        },
        UnmatchedDatasetTitleResidual: {
          entered: 0,
          resolved: 0,
          corroborated: 0,
          escalated: 0
        },
        AmbiguousCandidatesResidual: {
          entered: 0,
          resolved: 0,
          corroborated: 0,
          escalated: 0
        },
        UnmatchedUrlResidual: {
          entered: 0,
          resolved: 0,
          corroborated: 0,
          escalated: 0
        }
      };

      for (const result of results) {
        if (result.residualProgression === null) {
          continue;
        }

        for (const [key, counts] of Object.entries(
          result.residualProgression.byKind
        ) as Array<
          [
            keyof typeof progressionTotals,
            (typeof result.residualProgression.byKind)[keyof typeof result.residualProgression.byKind]
          ]
        >) {
          progressionTotals[key] = {
            entered: progressionTotals[key].entered + counts.total,
            resolved: progressionTotals[key].resolved + counts.resolved,
            corroborated:
              progressionTotals[key].corroborated + counts.corroborated,
            escalated: progressionTotals[key].escalated + counts.escalated
          };
        }
      }

      const progressionRows: ReadonlyArray<
        readonly [keyof typeof progressionTotals, string]
      > = [
        ["DeferredToStage2Residual", "DeferredToStage2"],
        ["UnmatchedTextResidual", "UnmatchedText"],
        ["UnmatchedDatasetTitleResidual", "UnmatchedDatasetTitle"],
        ["AmbiguousCandidatesResidual", "AmbiguousCandidates"],
        ["UnmatchedUrlResidual", "UnmatchedUrl"]
      ];

      for (const [key, label] of progressionRows) {
        const counts = progressionTotals[key];
        lines.push(
          `| ${label} | ${counts.entered} | ${counts.resolved} | ${counts.corroborated} | ${counts.escalated} |`
        );
      }

      const totalCounts = Object.values(progressionTotals).reduce(
        (acc, counts) => ({
          entered: acc.entered + counts.entered,
          resolved: acc.resolved + counts.resolved,
          corroborated: acc.corroborated + counts.corroborated,
          escalated: acc.escalated + counts.escalated
        }),
        { entered: 0, resolved: 0, corroborated: 0, escalated: 0 }
      );

      lines.push(
        `| **Total** | **${totalCounts.entered}** | **${totalCounts.resolved}** | **${totalCounts.corroborated}** | **${totalCounts.escalated}** |`
      );
    }

    lines.push("");
    lines.push("## Stage 2 Observation Buckets");
    lines.push("");
    lines.push("| Bucket | Count | Suggested Lever |");
    lines.push("|--------|-------|-----------------|");

    const orderedBuckets: ReadonlyArray<Stage2ObservationBucket> = [
      "no-facet-match",
      "facet-match-no-variable",
      "fuzzy-below-threshold",
      "fuzzy-no-candidate",
      "ambiguous",
      "handoff",
      "wrong-new-match"
    ];
    for (const bucket of orderedBuckets) {
      lines.push(
        `| ${bucket} | ${bucketCounts.get(bucket) ?? 0} | ${bucketLevers[bucket]} |`
      );
    }

    lines.push("");
    lines.push("## Failing Posts (Stage 1+2)");
    lines.push("");

    if (failing.length === 0) {
      lines.push("- none");
    } else {
      for (const result of failing) {
        lines.push(`### ${result.slug}`);
        lines.push(`- Post: ${result.postUri}`);

        if (
          result.error !== null ||
          result.stage1Actual === null ||
          result.combinedActual === null ||
          result.combinedDiff === null ||
          result.liftDetail === null
        ) {
          lines.push(`- Error: ${result.error ?? "unknown error"}`);
          lines.push("");
          continue;
        }

        lines.push(
          `- Missing Δ: ${result.liftDetail.missingDelta} | Unexpected Δ: ${result.liftDetail.unexpectedDelta}`
        );
        lines.push(
          `- Recall effect: ${effectLabel(result.liftDetail.missingDelta)} | Precision effect: ${effectLabel(result.liftDetail.unexpectedDelta)}`
        );
        lines.push(
          `- Stage 1 actual: D=${formatRefSet(result.stage1Actual.distributionIds)} | DS=${formatRefSet(result.stage1Actual.datasetIds)} | A=${formatRefSet(result.stage1Actual.agentIds)} | V=${formatRefSet(result.stage1Actual.variableIds)}`
        );
        lines.push(
          `- Combined actual: D=${formatRefSet(result.combinedActual.distributionIds)} | DS=${formatRefSet(result.combinedActual.datasetIds)} | A=${formatRefSet(result.combinedActual.agentIds)} | V=${formatRefSet(result.combinedActual.variableIds)}`
        );
        lines.push(
          `- Expected: D=${formatRefSet(result.expected.distributionIds)} | DS=${formatRefSet(result.expected.datasetIds)} | A=${formatRefSet(result.expected.agentIds)} | V=${formatRefSet(result.expected.variableIds)}`
        );
        lines.push(
          `- Stage 2 observation buckets: ${formatBucketSummary(result.stage2ObservationBuckets)}`
        );
        lines.push(
          `- Escalation reasons: ${result.stage2Result?.escalations
            .map((escalation) => escalation.reason)
            .join(" | ") || "—"}`
        );
        lines.push(`- Combined issue count: ${diffCount(result.combinedDiff)}`);
        lines.push("");
      }
    }

    const content = lines.join("\n");
    yield* writeText(path.join(runDir, "summary.md"), content);
    yield* Console.log(content);
  });

const runComparativeEval = (slugFilter: Option.Option<string>) =>
  Effect.gen(function* () {
    const paths = yield* resolveEvalPaths;
    const allRows = yield* readSnapshot(paths.snapshotPath);
    const requestedSlug = Option.match(slugFilter, {
      onNone: () => undefined,
      onSome: (value) => value
    });
    const rows =
      requestedSlug === undefined
        ? allRows
        : allRows.filter(
            (row) =>
              row.slug === requestedSlug || row.slug.startsWith(requestedSlug)
          );

    if (rows.length === 0) {
      yield* Effect.logWarning(`No snapshot rows matching "${requestedSlug}"`);
      return;
    }

    const candidates = yield* readCandidates(paths.candidatesDir);
    const expectedByPost = projectExpectedRefsByPost(candidates);
    const prepared = yield* loadCheckedInDataLayerRegistry();
    const lookup = toDataLayerRegistryLookup(prepared);
    const vocabulary = makeFacetVocabulary(yield* loadFacetVocabularyLookups());
    const runDir = yield* createRunDirectory(paths.runsRoot);

    const results = yield* Effect.forEach(rows, (row) =>
      evaluateRow(
        row,
        expectedByPost.get(row.postUri) ?? emptyExpectedRefs(),
        lookup,
        vocabulary,
        runDir
      )
    );

    yield* writeComparativeSummary(results, runDir);
    yield* Effect.log(`Eval complete: ${results.length} rows -> ${runDir}`);
  });

const runEvalCommand = Command.make(
  "run-resolution-stage2-eval",
  {
    slugFilter: slugFilterArgument
  },
  ({ slugFilter }) => runComparativeEval(slugFilter)
);

const cli = Command.runWith(runEvalCommand, {
  version: "0.1.0"
});

runScriptMain(
  "resolution-stage2-eval",
  Effect.suspend(() => cli(process.argv.slice(2))).pipe(
    Effect.provide(scriptPlatformLayer)
  )
);
