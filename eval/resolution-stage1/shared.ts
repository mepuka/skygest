import { Effect, Schema } from "effect";
import type { Candidate as CandidateRecord } from "../../src/domain/data-layer/candidate";
import {
  AgentId,
  DatasetId,
  DistributionId,
  SeriesId,
  VariableId
} from "../../src/domain/data-layer/ids";
import {
  Stage1Input,
  type Stage1Result
} from "../../src/domain/stage1Resolution";
import {
  Stage1EvalSnapshotMetadata,
  Stage1EvalSnapshotRow
} from "../../src/domain/stage1Eval";
import {
  decodeJsonStringWith,
  stringifyUnknown
} from "../../src/platform/Json";

export class Stage1EvalSnapshotDecodeError extends Schema.TaggedErrorClass<Stage1EvalSnapshotDecodeError>()(
  "Stage1EvalSnapshotDecodeError",
  {
    lineNumber: Schema.Number,
    message: Schema.String
  }
) {}

export const Stage1ExpectedRefs = Schema.Struct({
  distributionIds: Schema.Array(DistributionId),
  datasetIds: Schema.Array(DatasetId),
  agentIds: Schema.Array(AgentId),
  variableIds: Schema.Array(VariableId),
  seriesIds: Schema.Array(SeriesId)
});
export type Stage1ExpectedRefs = Schema.Schema.Type<typeof Stage1ExpectedRefs>;

export type Stage1ActualRefs = {
  readonly distributionIds: ReadonlyArray<string>;
  readonly datasetIds: ReadonlyArray<string>;
  readonly agentIds: ReadonlyArray<string>;
  readonly variableIds: ReadonlyArray<string>;
};

export type Stage1RefsDiff = {
  readonly missing: Stage1ActualRefs;
  readonly unexpected: Stage1ActualRefs;
};

export type Stage1MissBucket =
  | "stage1-ambiguity"
  | "registry-gap"
  | "parser-or-normalization-gap"
  | "deferred-to-stage2";

export type Stage1EvalResult = {
  readonly slug: string;
  readonly postUri: string;
  readonly metadata: Stage1EvalSnapshotMetadata;
  readonly expected: Stage1ExpectedRefs;
  readonly actual: Stage1ActualRefs | null;
  readonly diff: Stage1RefsDiff | null;
  readonly missBucket: Stage1MissBucket | null;
  readonly hasFindings: boolean;
  readonly result: Stage1Result | null;
  readonly elapsed: number;
  readonly error: string | null;
};

const decodeSnapshotRowJson = decodeJsonStringWith(Stage1EvalSnapshotRow);

const normalizeIds = (ids: Iterable<string>) =>
  [...new Set(ids)].sort((left, right) => left.localeCompare(right));

export const emptyExpectedRefs = (): Stage1ExpectedRefs => ({
  distributionIds: [],
  datasetIds: [],
  agentIds: [],
  variableIds: [],
  seriesIds: []
});

export const toStage1Input = (row: Stage1EvalSnapshotRow): Stage1Input => ({
  postContext: row.postContext,
  vision: row.vision,
  sourceAttribution: row.sourceAttribution
});

export const loadSnapshotFromString = (raw: string) =>
  Effect.forEach(
    raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    (line, index) =>
      Effect.try({
        try: () => decodeSnapshotRowJson(line),
        catch: (error) =>
          new Stage1EvalSnapshotDecodeError({
            lineNumber: index + 1,
            message: `snapshot.jsonl line ${index + 1}: ${stringifyUnknown(error)}`
          })
      })
  );

const toSortedExpectedRefs = (value: {
  readonly distributionIds: Set<string>;
  readonly datasetIds: Set<string>;
  readonly agentIds: Set<string>;
  readonly variableIds: Set<string>;
  readonly seriesIds: Set<string>;
}): Stage1ExpectedRefs => ({
  distributionIds: normalizeIds(value.distributionIds) as unknown as Stage1ExpectedRefs["distributionIds"],
  datasetIds: normalizeIds(value.datasetIds) as unknown as Stage1ExpectedRefs["datasetIds"],
  agentIds: normalizeIds(value.agentIds) as unknown as Stage1ExpectedRefs["agentIds"],
  variableIds: normalizeIds(value.variableIds) as unknown as Stage1ExpectedRefs["variableIds"],
  seriesIds: normalizeIds(value.seriesIds) as unknown as Stage1ExpectedRefs["seriesIds"]
});

export const projectExpectedRefsByPost = (
  candidates: ReadonlyArray<CandidateRecord>
): ReadonlyMap<string, Stage1ExpectedRefs> => {
  const grouped = new Map<
    string,
    {
      readonly distributionIds: Set<string>;
      readonly datasetIds: Set<string>;
      readonly agentIds: Set<string>;
      readonly variableIds: Set<string>;
      readonly seriesIds: Set<string>;
    }
  >();

  for (const candidate of candidates) {
    const bucket = grouped.get(candidate.sourceRef.contentId) ?? {
      distributionIds: new Set<string>(),
      datasetIds: new Set<string>(),
      agentIds: new Set<string>(),
      variableIds: new Set<string>(),
      seriesIds: new Set<string>()
    };

    if (candidate.referencedDistributionId !== undefined) {
      bucket.distributionIds.add(candidate.referencedDistributionId);
    }
    if (candidate.referencedDatasetId !== undefined) {
      bucket.datasetIds.add(candidate.referencedDatasetId);
    }
    if (candidate.referencedAgentId !== undefined) {
      bucket.agentIds.add(candidate.referencedAgentId);
    }
    if (candidate.referencedVariableId !== undefined) {
      bucket.variableIds.add(candidate.referencedVariableId);
    }
    if (candidate.referencedSeriesId !== undefined) {
      bucket.seriesIds.add(candidate.referencedSeriesId);
    }

    grouped.set(candidate.sourceRef.contentId, bucket);
  }

  return new Map(
    [...grouped.entries()].map(([postUri, refs]) => [
      postUri,
      toSortedExpectedRefs(refs)
    ])
  );
};

export const summarizeActualRefs = (result: Stage1Result): Stage1ActualRefs => ({
  distributionIds: normalizeIds(
    result.matches.flatMap((match) =>
      match._tag === "DistributionMatch" ? [match.distributionId] : []
    )
  ),
  datasetIds: normalizeIds(
    result.matches.flatMap((match) =>
      match._tag === "DatasetMatch" ? [match.datasetId] : []
    )
  ),
  agentIds: normalizeIds(
    result.matches.flatMap((match) =>
      match._tag === "AgentMatch" ? [match.agentId] : []
    )
  ),
  variableIds: normalizeIds(
    result.matches.flatMap((match) =>
      match._tag === "VariableMatch" ? [match.variableId] : []
    )
  )
});

const diffIds = (
  expected: ReadonlyArray<string>,
  actual: ReadonlyArray<string>
) => ({
  missing: expected.filter((id) => !actual.includes(id)),
  unexpected: actual.filter((id) => !expected.includes(id))
});

export const diffDirectRefs = (
  expected: Stage1ExpectedRefs,
  actual: Stage1ActualRefs
): Stage1RefsDiff => ({
  missing: {
    distributionIds: diffIds(expected.distributionIds, actual.distributionIds).missing,
    datasetIds: diffIds(expected.datasetIds, actual.datasetIds).missing,
    agentIds: diffIds(expected.agentIds, actual.agentIds).missing,
    variableIds: diffIds(expected.variableIds, actual.variableIds).missing
  },
  unexpected: {
    distributionIds: diffIds(expected.distributionIds, actual.distributionIds).unexpected,
    datasetIds: diffIds(expected.datasetIds, actual.datasetIds).unexpected,
    agentIds: diffIds(expected.agentIds, actual.agentIds).unexpected,
    variableIds: diffIds(expected.variableIds, actual.variableIds).unexpected
  }
});

const hasAnyRefs = (refs: Stage1ActualRefs) =>
  refs.distributionIds.length > 0 ||
  refs.datasetIds.length > 0 ||
  refs.agentIds.length > 0 ||
  refs.variableIds.length > 0;

export const classifyMissBucket = (
  expected: Stage1ExpectedRefs,
  actual: Stage1ActualRefs,
  result: Stage1Result
): Stage1MissBucket | null => {
  const diff = diffDirectRefs(expected, actual);
  const hasDirectFindings = hasAnyRefs(diff.missing) || hasAnyRefs(diff.unexpected);
  if (!hasDirectFindings) {
    return null;
  }

  if (result.residuals.some((residual) => residual._tag === "AmbiguousCandidatesResidual")) {
    return "stage1-ambiguity";
  }

  if (result.residuals.some((residual) => residual._tag === "DeferredToStage2Residual")) {
    return "deferred-to-stage2";
  }

  if (
    result.residuals.some(
      (residual) =>
        residual._tag === "UnmatchedUrlResidual" ||
        residual._tag === "UnmatchedDatasetTitleResidual"
    )
  ) {
    return "registry-gap";
  }

  return "parser-or-normalization-gap";
};

export const assessEvalResult = (
  row: Stage1EvalSnapshotRow,
  expected: Stage1ExpectedRefs,
  result: Stage1Result,
  elapsed: number
): Stage1EvalResult => {
  const actual = summarizeActualRefs(result);
  const diff = diffDirectRefs(expected, actual);
  const hasFindings = hasAnyRefs(diff.missing) || hasAnyRefs(diff.unexpected);

  return {
    slug: row.slug,
    postUri: row.postUri,
    metadata: row.metadata,
    expected,
    actual,
    diff,
    missBucket: classifyMissBucket(expected, actual, result),
    hasFindings,
    result,
    elapsed,
    error: null
  };
};

export const buildFailureResult = (
  row: Stage1EvalSnapshotRow,
  expected: Stage1ExpectedRefs,
  error: string,
  elapsed = 0
): Stage1EvalResult => ({
  slug: row.slug,
  postUri: row.postUri,
  metadata: row.metadata,
  expected,
  actual: null,
  diff: null,
  missBucket: null,
  hasFindings: true,
  result: null,
  elapsed,
  error
});
