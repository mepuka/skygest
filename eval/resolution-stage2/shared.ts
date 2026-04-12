import type { Stage1EvalSnapshotRow } from "../../src/domain/stage1Eval";
import type { MatchEvidence } from "../../src/domain/matchEvidence";
import type {
  Stage1Residual,
  Stage1Result
} from "../../src/domain/stage1Resolution";
import type { Stage1Match } from "../../src/domain/stage1Match";
import type {
  Stage2Corroboration,
  Stage2Evidence,
  Stage2Result,
  Stage3Input
} from "../../src/domain/stage2Resolution";
import {
  assessEvalResult,
  diffDirectRefs,
  hasAnyRefs,
  summarizeActualRefs,
  type Stage1ActualRefs,
  type Stage1ExpectedRefs,
  type Stage1MissBucket,
  type Stage1RefsDiff
} from "../resolution-stage1/shared";

export {
  emptyExpectedRefs,
  loadSnapshotFromString,
  projectExpectedRefsByPost,
  summarizeActualRefs,
  toStage1Input
} from "../resolution-stage1/shared";

export type Stage2ObservationBucket =
  | "no-facet-match"
  | "facet-match-no-variable"
  | "fuzzy-below-threshold"
  | "fuzzy-no-candidate"
  | "ambiguous"
  | "handoff"
  | "wrong-new-match";

type Stage1ResidualTag = Stage1Residual["_tag"];

export type Stage2ResidualProgressCounts = {
  readonly total: number;
  readonly resolved: number;
  readonly corroborated: number;
  readonly escalated: number;
};

export type Stage2ResidualProgression = {
  readonly byKind: Record<Stage1ResidualTag, Stage2ResidualProgressCounts>;
  readonly totals: Stage2ResidualProgressCounts;
};

export type Stage2LiftDetail = {
  readonly missingDelta: number;
  readonly unexpectedDelta: number;
};

export type Stage2EvalResult = {
  readonly slug: string;
  readonly postUri: string;
  readonly metadata: Stage1EvalSnapshotRow["metadata"];
  readonly expected: Stage1ExpectedRefs;
  readonly stage1Actual: Stage1ActualRefs | null;
  readonly stage1Diff: Stage1RefsDiff | null;
  readonly stage1MissBucket: Stage1MissBucket | null;
  readonly stage1HasFindings: boolean;
  readonly stage1Result: Stage1Result | null;
  readonly combinedActual: Stage1ActualRefs | null;
  readonly combinedDiff: Stage1RefsDiff | null;
  readonly hasFindings: boolean;
  readonly stage2Result: Stage2Result | null;
  readonly stage2ObservationBuckets: ReadonlyArray<Stage2ObservationBucket>;
  readonly residualProgression: Stage2ResidualProgression | null;
  readonly liftDetail: Stage2LiftDetail | null;
  readonly elapsed: number;
  readonly error: string | null;
};

const stage1ResidualTags = [
  "DeferredToStage2Residual",
  "UnmatchedTextResidual",
  "UnmatchedDatasetTitleResidual",
  "AmbiguousCandidatesResidual",
  "UnmatchedUrlResidual"
] as const satisfies ReadonlyArray<Stage1ResidualTag>;

const emptyProgressCounts = (): Stage2ResidualProgressCounts => ({
  total: 0,
  resolved: 0,
  corroborated: 0,
  escalated: 0
});

const emptyProgressByKind = (): Record<
  Stage1ResidualTag,
  Stage2ResidualProgressCounts
> => ({
  DeferredToStage2Residual: emptyProgressCounts(),
  UnmatchedTextResidual: emptyProgressCounts(),
  UnmatchedDatasetTitleResidual: emptyProgressCounts(),
  AmbiguousCandidatesResidual: emptyProgressCounts(),
  UnmatchedUrlResidual: emptyProgressCounts()
});

const countRefs = (refs: Stage1ActualRefs) =>
  refs.distributionIds.length +
  refs.datasetIds.length +
  refs.agentIds.length +
  refs.variableIds.length;

const matchIdIsExpected = (
  match: Stage1Match,
  expected: Stage1ExpectedRefs
) => {
  switch (match._tag) {
    case "DistributionMatch":
      return expected.distributionIds.includes(match.distributionId);
    case "DatasetMatch":
      return expected.datasetIds.includes(match.datasetId);
    case "AgentMatch":
      return expected.agentIds.includes(match.agentId);
    case "VariableMatch":
      return expected.variableIds.includes(match.variableId);
  }
};

const isFuzzyLane = (lane: Stage3Input["stage2Lane"]) =>
  lane === "fuzzy-dataset-title" || lane === "fuzzy-agent-label";

const isStage2Evidence = (evidence: MatchEvidence): evidence is Stage2Evidence => {
  switch (evidence._tag) {
    case "FacetDecompositionEvidence":
    case "GroupedFacetDecompositionEvidence":
    case "FuzzyDatasetTitleEvidence":
    case "FuzzyAgentLabelEvidence":
    case "FuzzyTitleEvidence":
      return true;
    default:
      return false;
  }
};

const residualTagForStage2Evidence = (
  evidence: Stage2Evidence
): Stage1ResidualTag => {
  switch (evidence._tag) {
    case "FacetDecompositionEvidence":
    case "GroupedFacetDecompositionEvidence":
      return "DeferredToStage2Residual";
    case "FuzzyDatasetTitleEvidence":
      return "UnmatchedDatasetTitleResidual";
    case "FuzzyAgentLabelEvidence":
    case "FuzzyTitleEvidence":
      return "UnmatchedTextResidual";
  }
};

const allStage2EvidenceFromMatches = (
  matches: ReadonlyArray<Stage1Match>
): ReadonlyArray<Stage2Evidence> =>
  matches.flatMap((match) => match.evidence.filter(isStage2Evidence));

const allStage2EvidenceFromCorroborations = (
  corroborations: ReadonlyArray<Stage2Corroboration>
): ReadonlyArray<Stage2Evidence> =>
  corroborations.flatMap((corroboration) => corroboration.evidence);

const evidenceOutcomeCount = (evidence: Stage2Evidence) =>
  evidence._tag === "GroupedFacetDecompositionEvidence"
    ? evidence.residualCount
    : 1;

export const mergeStage1And2Matches = (
  stage1: Stage1Result,
  stage2: Stage2Result
): Stage1ActualRefs =>
  summarizeActualRefs({
    matches: [...stage1.matches, ...stage2.matches],
    residuals: []
  });

export const classifyEscalationBucket = (
  escalation: Stage3Input
): Stage2ObservationBucket => {
  if (escalation.stage2Lane === "no-op" || escalation.stage2Lane === "pending") {
    return "handoff";
  }

  if (escalation.stage2Lane === "tie-breaker") {
    return "ambiguous";
  }

  if (
    escalation.stage2Lane === "facet-decomposition" ||
    escalation.stage2Lane === "grouped-facet-decomposition"
  ) {
    if (escalation.candidateSet.length > 1) {
      return "ambiguous";
    }

    if (escalation.matchedSurfaceForms.length === 0) {
      return "no-facet-match";
    }

    return "facet-match-no-variable";
  }

  if (isFuzzyLane(escalation.stage2Lane)) {
    if (escalation.candidateSet.length > 1) {
      return "ambiguous";
    }

    if (
      escalation.reason.includes("below") &&
      escalation.reason.includes("threshold")
    ) {
      return "fuzzy-below-threshold";
    }

    return "fuzzy-no-candidate";
  }

  return "handoff";
};

export const classifyNewMatchBuckets = (
  stage2: Stage2Result,
  expected: Stage1ExpectedRefs
): ReadonlyArray<Stage2ObservationBucket> =>
  stage2.matches.flatMap((match) =>
    matchIdIsExpected(match, expected) ? [] : (["wrong-new-match"] as const)
  );

export const computeLiftDetail = (
  stage1Diff: Stage1RefsDiff,
  combinedDiff: Stage1RefsDiff
): Stage2LiftDetail => ({
  missingDelta:
    countRefs(combinedDiff.missing) - countRefs(stage1Diff.missing),
  unexpectedDelta:
    countRefs(combinedDiff.unexpected) - countRefs(stage1Diff.unexpected)
});

export const computeResidualProgression = (
  stage1: Stage1Result,
  stage2: Stage2Result
): Stage2ResidualProgression => {
  const byKind = emptyProgressByKind();

  for (const residual of stage1.residuals) {
    const current = byKind[residual._tag];
    byKind[residual._tag] = {
      ...current,
      total: current.total + 1
    };
  }

  for (const evidence of allStage2EvidenceFromMatches(stage2.matches)) {
    const kind = residualTagForStage2Evidence(evidence);
    const current = byKind[kind];
    byKind[kind] = {
      ...current,
      resolved: current.resolved + evidenceOutcomeCount(evidence)
    };
  }

  for (const evidence of allStage2EvidenceFromCorroborations(stage2.corroborations)) {
    const kind = residualTagForStage2Evidence(evidence);
    const current = byKind[kind];
    byKind[kind] = {
      ...current,
      corroborated: current.corroborated + evidenceOutcomeCount(evidence)
    };
  }

  for (const escalation of stage2.escalations) {
    const kind = escalation.originalResidual._tag;
    const current = byKind[kind];
    byKind[kind] = {
      ...current,
      escalated: current.escalated + (escalation.contributingResidualCount ?? 1)
    };
  }

  const totals = stage1ResidualTags.reduce<Stage2ResidualProgressCounts>(
    (acc, tag) => ({
      total: acc.total + byKind[tag].total,
      resolved: acc.resolved + byKind[tag].resolved,
      corroborated: acc.corroborated + byKind[tag].corroborated,
      escalated: acc.escalated + byKind[tag].escalated
    }),
    emptyProgressCounts()
  );

  return {
    byKind,
    totals
  };
};

export const assessStage2EvalResult = (
  row: Stage1EvalSnapshotRow,
  expected: Stage1ExpectedRefs,
  stage1Result: Stage1Result,
  stage2Result: Stage2Result,
  elapsed: number
): Stage2EvalResult => {
  const stage1Assessment = assessEvalResult(row, expected, stage1Result, elapsed);
  const combinedActual = mergeStage1And2Matches(stage1Result, stage2Result);
  const combinedDiff = diffDirectRefs(expected, combinedActual);
  const stage2ObservationBuckets = [
    ...stage2Result.escalations.map(classifyEscalationBucket),
    ...classifyNewMatchBuckets(stage2Result, expected)
  ];

  return {
    slug: row.slug,
    postUri: row.postUri,
    metadata: row.metadata,
    expected,
    stage1Actual: stage1Assessment.actual,
    stage1Diff: stage1Assessment.diff,
    stage1MissBucket: stage1Assessment.missBucket,
    stage1HasFindings: stage1Assessment.hasFindings,
    stage1Result,
    combinedActual,
    combinedDiff,
    hasFindings:
      hasAnyRefs(combinedDiff.missing) || hasAnyRefs(combinedDiff.unexpected),
    stage2Result,
    stage2ObservationBuckets,
    residualProgression: computeResidualProgression(stage1Result, stage2Result),
    liftDetail:
      stage1Assessment.diff === null
        ? null
        : computeLiftDetail(stage1Assessment.diff, combinedDiff),
    elapsed,
    error: null
  };
};

export const buildStage2FailureResult = (
  row: Stage1EvalSnapshotRow,
  expected: Stage1ExpectedRefs,
  error: string,
  elapsed = 0
): Stage2EvalResult => ({
  slug: row.slug,
  postUri: row.postUri,
  metadata: row.metadata,
  expected,
  stage1Actual: null,
  stage1Diff: null,
  stage1MissBucket: null,
  stage1HasFindings: true,
  stage1Result: null,
  combinedActual: null,
  combinedDiff: null,
  hasFindings: true,
  stage2Result: null,
  stage2ObservationBuckets: [],
  residualProgression: null,
  liftDetail: null,
  elapsed,
  error
});
