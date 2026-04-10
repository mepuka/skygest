/**
 * Stage 1 deterministic resolution eval runner.
 *
 * Usage:
 *   bun eval/resolution-stage1/run-eval.ts
 *   bun eval/resolution-stage1/run-eval.ts 001-kendrawrites-com
 */

import { Effect, FileSystem, Layer, Path } from "effect";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";
import { loadCheckedInDataLayerRegistry } from "../../src/bootstrap/CheckedInDataLayerRegistry";
import { Candidate } from "../../src/domain/data-layer/candidate";
import {
  decodeJsonStringWith,
  stringifyUnknown
} from "../../src/platform/Json";
import { runStage1 } from "../../src/resolution/Stage1";
import { toDataLayerRegistryLookup, type DataLayerRegistryLookup } from "../../src/resolution/dataLayerRegistry";
import {
  assessEvalResult,
  buildFailureResult,
  emptyExpectedRefs,
  loadSnapshotFromString,
  projectExpectedRefsByPost,
  toStage1Input,
  type Stage1EvalResult,
  type Stage1ExpectedRefs
} from "./shared";

const SNAPSHOT_PATH = nodePath.join(import.meta.dir, "snapshot.jsonl");
const CANDIDATES_DIR = nodePath.join(
  import.meta.dir,
  "../../references/cold-start/candidates"
);

const fileSystemLayer = Layer.mergeAll(
  Layer.succeed(
    FileSystem.FileSystem,
    {
      readDirectory: (path: string) =>
        Effect.tryPromise({
          try: () => fsp.readdir(path),
          catch: (error) => new Error(String(error))
        }),
      readFileString: (path: string) =>
        Effect.tryPromise({
          try: () => fsp.readFile(path, "utf-8"),
          catch: (error) => new Error(String(error))
        })
    } as unknown as FileSystem.FileSystem
  ),
  Layer.succeed(Path.Path, nodePath as unknown as Path.Path)
);

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
      const suffix = attempt === 0 ? "" : `-${String(attempt).padStart(2, "0")}`;
      const runDir = nodePath.join(runsRoot, `${baseTimestamp}${suffix}`);
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

const readSnapshot = Effect.gen(function* () {
  const raw = yield* Effect.try({
    try: () => fs.readFileSync(SNAPSHOT_PATH, "utf-8"),
    catch: (error) =>
      new Error(`Failed to read ${SNAPSHOT_PATH}: ${stringifyUnknown(error)}`)
  });

  return yield* loadSnapshotFromString(raw);
});

const readCandidates = Effect.gen(function* () {
  const decodeCandidateJson = decodeJsonStringWith(Candidate);
  const fileNames = yield* Effect.tryPromise({
    try: () => fsp.readdir(CANDIDATES_DIR),
    catch: (error) =>
      new Error(`Failed to read ${CANDIDATES_DIR}: ${stringifyUnknown(error)}`)
  });

  return yield* Effect.forEach(
    fileNames
      .filter((fileName) => fileName.endsWith(".json") && !fileName.startsWith("."))
      .sort((left, right) => left.localeCompare(right)),
    (fileName) =>
      Effect.try({
        try: () =>
          decodeCandidateJson(
            fs.readFileSync(nodePath.join(CANDIDATES_DIR, fileName), "utf-8")
          ),
        catch: (error) =>
          new Error(
            `Failed to decode candidate ${fileName}: ${stringifyUnknown(error)}`
          )
      })
  );
});

const writeJson = (filePath: string, value: unknown) =>
  Effect.sync(() => {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  });

const formatRefSet = (ids: ReadonlyArray<string>) =>
  ids.length === 0 ? "—" : ids.join(", ");

const intersectionSize = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>
) => left.filter((value) => right.includes(value)).length;

const evaluateRow = (
  row: Awaited<ReturnType<typeof loadSnapshotFromString>>[number],
  expected: Stage1ExpectedRefs,
  lookup: DataLayerRegistryLookup,
  runDir: string
) =>
  Effect.gen(function* () {
    const startedAt = Date.now();
    const result = runStage1(toStage1Input(row), lookup);
    const elapsed = Date.now() - startedAt;
    const assessed = assessEvalResult(row, expected, result, elapsed);

    yield* writeJson(nodePath.join(runDir, `${row.slug}.json`), assessed);
    yield* Effect.log(
      `${row.slug}: ${assessed.hasFindings ? assessed.missBucket ?? "needs-review" : "ok"} (${elapsed}ms)`
    );

    return assessed;
  }).pipe(
    Effect.matchEffect({
      onSuccess: Effect.succeed,
      onFailure: (error) =>
        Effect.gen(function* () {
          const failed = buildFailureResult(row, expected, stringifyUnknown(error));
          yield* writeJson(nodePath.join(runDir, `${row.slug}.json`), failed);
          yield* Effect.logError(`${row.slug}: FAILED — ${failed.error}`);
          return failed;
        })
    })
  );

const writeSummary = (
  results: ReadonlyArray<Stage1EvalResult>,
  runDir: string
) =>
  Effect.sync(() => {
    const failures = results.filter((result) => result.hasFindings || result.error !== null);
    const errors = results.filter((result) => result.error !== null).length;
    const directTotals = {
      distribution: { expected: 0, actual: 0, truePositive: 0 },
      dataset: { expected: 0, actual: 0, truePositive: 0 },
      agent: { expected: 0, actual: 0, truePositive: 0 },
      variable: { expected: 0, actual: 0, truePositive: 0 }
    };

    for (const result of results) {
      if (result.actual === null) {
        continue;
      }

      directTotals.distribution.expected += result.expected.distributionIds.length;
      directTotals.distribution.actual += result.actual.distributionIds.length;
      directTotals.distribution.truePositive += intersectionSize(
        result.expected.distributionIds,
        result.actual.distributionIds
      );

      directTotals.dataset.expected += result.expected.datasetIds.length;
      directTotals.dataset.actual += result.actual.datasetIds.length;
      directTotals.dataset.truePositive += intersectionSize(
        result.expected.datasetIds,
        result.actual.datasetIds
      );

      directTotals.agent.expected += result.expected.agentIds.length;
      directTotals.agent.actual += result.actual.agentIds.length;
      directTotals.agent.truePositive += intersectionSize(
        result.expected.agentIds,
        result.actual.agentIds
      );

      directTotals.variable.expected += result.expected.variableIds.length;
      directTotals.variable.actual += result.actual.variableIds.length;
      directTotals.variable.truePositive += intersectionSize(
        result.expected.variableIds,
        result.actual.variableIds
      );
    }

    const scoreLine = (label: string, totals: { expected: number; actual: number; truePositive: number }) => {
      const precision =
        totals.actual === 0 ? 1 : totals.truePositive / totals.actual;
      const recall =
        totals.expected === 0 ? 1 : totals.truePositive / totals.expected;
      return `- ${label}: precision ${precision.toFixed(2)} (${totals.truePositive}/${totals.actual}), recall ${recall.toFixed(2)} (${totals.truePositive}/${totals.expected})`;
    };

    const lines: Array<string> = [];
    lines.push(`# Stage 1 Resolution Eval Run — ${new Date().toISOString()}`);
    lines.push("");
    lines.push(
      `Snapshot rows: ${results.length} | Failing posts: ${failures.length} | Errors: ${errors}`
    );
    lines.push("");
    lines.push("## Failing Posts");
    lines.push("");

    if (failures.length === 0) {
      lines.push("- none");
    } else {
      for (const result of failures) {
        lines.push(`### ${result.slug}`);
        lines.push(`- Post: ${result.postUri}`);
        lines.push(
          `- Expected direct refs: D=${formatRefSet(result.expected.distributionIds)} | DS=${formatRefSet(result.expected.datasetIds)} | A=${formatRefSet(result.expected.agentIds)} | V=${formatRefSet(result.expected.variableIds)}`
        );
        lines.push(
          `- Expected deferred series refs: ${formatRefSet(result.expected.seriesIds)}`
        );

        if (result.error !== null || result.actual === null || result.diff === null) {
          lines.push(`- Error: ${result.error ?? "unknown error"}`);
          lines.push("");
          continue;
        }

        lines.push(
          `- Actual direct refs: D=${formatRefSet(result.actual.distributionIds)} | DS=${formatRefSet(result.actual.datasetIds)} | A=${formatRefSet(result.actual.agentIds)} | V=${formatRefSet(result.actual.variableIds)}`
        );
        lines.push(
          `- Missing refs: D=${formatRefSet(result.diff.missing.distributionIds)} | DS=${formatRefSet(result.diff.missing.datasetIds)} | A=${formatRefSet(result.diff.missing.agentIds)} | V=${formatRefSet(result.diff.missing.variableIds)}`
        );
        lines.push(
          `- Unexpected refs: D=${formatRefSet(result.diff.unexpected.distributionIds)} | DS=${formatRefSet(result.diff.unexpected.datasetIds)} | A=${formatRefSet(result.diff.unexpected.agentIds)} | V=${formatRefSet(result.diff.unexpected.variableIds)}`
        );
        lines.push(`- Miss bucket: ${result.missBucket ?? "—"}`);
        lines.push(
          `- Residuals: ${result.result?.residuals.map((residual) => residual._tag).join(", ") || "—"}`
        );
        lines.push("");
      }
    }

    lines.push("## Totals");
    lines.push("");
    lines.push(scoreLine("Distribution", directTotals.distribution));
    lines.push(scoreLine("Dataset", directTotals.dataset));
    lines.push(scoreLine("Agent", directTotals.agent));
    lines.push(scoreLine("Variable", directTotals.variable));
    lines.push("");

    const content = lines.join("\n");
    fs.writeFileSync(nodePath.join(runDir, "summary.md"), content);
    console.log(content);
  });

const program = Effect.gen(function* () {
  const allRows = yield* readSnapshot;
  const slugFilter = process.argv[2];
  const rows = slugFilter
    ? allRows.filter(
        (row) => row.slug === slugFilter || row.slug.startsWith(slugFilter)
      )
    : allRows;

  if (rows.length === 0) {
    yield* Effect.logWarning(`No snapshot rows matching "${slugFilter}"`);
    return;
  }

  const candidates = yield* readCandidates;
  const expectedByPost = projectExpectedRefsByPost(candidates);
  const prepared = yield* loadCheckedInDataLayerRegistry().pipe(
    Effect.provide(fileSystemLayer)
  );
  const lookup = toDataLayerRegistryLookup(prepared);

  const runDir = yield* createRunDirectory(nodePath.join(import.meta.dir, "runs"));
  const results = yield* Effect.forEach(rows, (row) =>
    evaluateRow(
      row,
      expectedByPost.get(row.postUri) ?? emptyExpectedRefs(),
      lookup,
      runDir
    )
  );

  yield* writeSummary(results, runDir);
  yield* Effect.log(`Eval complete: ${results.length} rows -> ${runDir}`);
});

Effect.runPromise(program).catch((error) => {
  console.error(stringifyUnknown(error));
  process.exit(1);
});
