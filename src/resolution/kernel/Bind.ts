import { Result } from "effect";
import type { Variable } from "../../domain/data-layer";
import type { AgentId, DatasetId } from "../../domain/data-layer/ids";
import type {
  BoundResolutionBoundItem,
  BoundResolutionGapItem,
  BoundResolutionItem,
  ResolutionHypothesis,
  ResolutionScopeOptions,
  VariableCandidateScore
} from "../../domain/resolutionKernel";
import {
  type FacetKey,
  type PartialVariableShape,
  joinPartials,
  matched,
  mismatched,
  missingRequired,
  type RequiredFacetKey,
  specificity,
  subsumes,
  subsumptionRatio
} from "../../domain/partialVariableAlgebra";
import { stripUndefined } from "../../platform/Json";
import type { DataLayerRegistryLookup } from "../dataLayerRegistry";

const NEAREST_MISS_LIMIT = 5;

export type BoundHypothesis = {
  readonly hypothesis: ResolutionHypothesis;
  readonly items: ReadonlyArray<BoundResolutionItem>;
} & ResolutionScopeOptions;

const variableToPartial = (variable: Variable): PartialVariableShape =>
  stripUndefined({
    measuredProperty: variable.measuredProperty,
    domainObject: variable.domainObject,
    technologyOrFuel: variable.technologyOrFuel,
    statisticType: variable.statisticType,
    aggregation: variable.aggregation,
    unitFamily: variable.unitFamily,
    policyInstrument: variable.policyInstrument
  });

const listVariables = (
  lookup: DataLayerRegistryLookup
): ReadonlyArray<Variable> =>
  Array.from(lookup.entities).flatMap((entity) =>
    entity._tag === "Variable" ? [entity] : []
  );

const scoreVariable = (
  partial: PartialVariableShape,
  variable: Variable
): VariableCandidateScore => {
  const semanticPartial = variableToPartial(variable);

  return {
    variableId: variable.id,
    label: variable.label,
    matchedFacets: matched(partial, semanticPartial),
    mismatchedFacets: mismatched(partial, semanticPartial),
    subsumptionRatio: subsumptionRatio(partial, semanticPartial),
    partialSpecificity: specificity(semanticPartial),
    semanticPartial
  };
};

const compareCompatibleCandidates = (
  left: VariableCandidateScore,
  right: VariableCandidateScore
): number =>
  right.matchedFacets.length - left.matchedFacets.length ||
  right.subsumptionRatio - left.subsumptionRatio ||
  left.label.localeCompare(right.label);

const compareNearestMisses = (
  left: VariableCandidateScore,
  right: VariableCandidateScore
): number =>
  left.mismatchedFacets.length - right.mismatchedFacets.length ||
  right.matchedFacets.length - left.matchedFacets.length ||
  left.label.localeCompare(right.label);

const scoreCompatibleCandidates = (
  partial: PartialVariableShape,
  variables: ReadonlyArray<Variable>
): ReadonlyArray<VariableCandidateScore> =>
  variables
    .map((variable) => scoreVariable(partial, variable))
    .filter((candidate) => subsumes(partial, candidate.semanticPartial))
    .sort(compareCompatibleCandidates);

const scoreNearestMisses = (
  partial: PartialVariableShape,
  variables: ReadonlyArray<Variable>
): ReadonlyArray<VariableCandidateScore> =>
  variables
    .map((variable) => scoreVariable(partial, variable))
    .filter((candidate) => candidate.mismatchedFacets.length > 0)
    .sort(compareNearestMisses)
    .slice(0, NEAREST_MISS_LIMIT);

const narrowCandidatesByAgent = (
  candidates: ReadonlyArray<VariableCandidateScore>,
  agentId: AgentId,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<VariableCandidateScore> => {
  const allowedVariableIds = new Set(
    Array.from(lookup.findVariablesByAgentId(agentId)).map((variable) => variable.id)
  );

  return candidates.filter((candidate) => allowedVariableIds.has(candidate.variableId));
};

const narrowCandidatesByDatasets = (
  candidates: ReadonlyArray<VariableCandidateScore>,
  datasetIds: ReadonlyArray<DatasetId>,
  lookup: DataLayerRegistryLookup
): ReadonlyArray<VariableCandidateScore> => {
  const allowedVariableIds = new Set(
    datasetIds.flatMap((datasetId) =>
      Array.from(lookup.findVariablesByDatasetId(datasetId)).map(
        (variable) => variable.id
      )
    )
  );

  return candidates.filter((candidate) => allowedVariableIds.has(candidate.variableId));
};

// Shared↔item retraction join: series-label items are strictly more
// specific than the chart-level shared partial on any facet they define.
// Before joining, we strip those facets from the shared partial so the
// item can win without producing a spurious required-facet-conflict.
// See docs/plans/2026-04-12-sky-314-resolution-kernel-ontology-fixes.md
// §Task 4 for the algebra rationale.
const retractedShared = (
  shared: PartialVariableShape,
  overrideKeys: ReadonlyArray<FacetKey>
): PartialVariableShape => {
  const result: Record<string, unknown> = { ...shared };
  for (const key of overrideKeys) {
    delete result[key];
  }
  return result as PartialVariableShape;
};

const mergeAttachedContext = (
  hypothesis: ResolutionHypothesis,
  item: ResolutionHypothesis["items"][number]
) =>
  stripUndefined({
    ...hypothesis.attachedContext,
    ...(item.attachedContext ?? {})
  });

const makeBoundItem = (
  hypothesis: ResolutionHypothesis,
  item: ResolutionHypothesis["items"][number],
  semanticPartial: PartialVariableShape,
  candidate: VariableCandidateScore
): BoundResolutionBoundItem =>
  stripUndefined({
    _tag: "bound" as const,
    itemKey: item.itemKey,
    semanticPartial,
    attachedContext: mergeAttachedContext(hypothesis, item),
    evidence: [...item.evidence],
    variableId: candidate.variableId,
    label: candidate.label
  });

const makeGapItem = (
  hypothesis: ResolutionHypothesis,
  item: ResolutionHypothesis["items"][number],
  semanticPartial: PartialVariableShape,
  candidates: ReadonlyArray<VariableCandidateScore>,
  reason: BoundResolutionGapItem["reason"],
  options: {
    readonly missingRequired?: ReadonlyArray<RequiredFacetKey>;
  } = {}
): BoundResolutionGapItem =>
  stripUndefined({
    _tag: "gap" as const,
    itemKey: item.itemKey,
    semanticPartial,
    attachedContext: mergeAttachedContext(hypothesis, item),
    evidence: [...item.evidence],
    candidates: [...candidates],
    missingRequired:
      options.missingRequired === undefined
        ? undefined
        : [...options.missingRequired],
    reason
  });

export const bindHypothesis = (
  hypothesis: ResolutionHypothesis,
  lookup: DataLayerRegistryLookup,
  options: ResolutionScopeOptions = {}
): BoundHypothesis => {
  const variables = listVariables(lookup);
  const items: Array<BoundResolutionItem> = [];

  for (const hypothesisItem of hypothesis.items) {
    const itemKeys = Object.keys(hypothesisItem.partial) as Array<FacetKey>;
    const narrowedShared = retractedShared(hypothesis.sharedPartial, itemKeys);
    const semanticPartialResult = joinPartials(
      narrowedShared,
      hypothesisItem.partial
    );

    if (Result.isFailure(semanticPartialResult)) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          hypothesis.sharedPartial,
          [],
          "required-facet-conflict"
        )
      );
      continue;
    }

    const semanticPartial = semanticPartialResult.success;
    const missing = missingRequired(semanticPartial);
    const compatibleCandidates = scoreCompatibleCandidates(semanticPartial, variables);

    if (missing.length > 0) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          compatibleCandidates,
          "missing-required",
          { missingRequired: missing }
        )
      );
      continue;
    }

    if (compatibleCandidates.length === 0) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          scoreNearestMisses(semanticPartial, variables),
          "no-candidates"
        )
      );
      continue;
    }

    const datasetNarrowedCandidates =
      options.datasetIds === undefined
        ? compatibleCandidates
        : narrowCandidatesByDatasets(
            compatibleCandidates,
            options.datasetIds,
            lookup
          );

    if (
      options.datasetIds !== undefined &&
      datasetNarrowedCandidates.length === 0
    ) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          compatibleCandidates,
          "dataset-scope-empty"
        )
      );
      continue;
    }

    const narrowedCandidates =
      options.agentId === undefined
        ? datasetNarrowedCandidates
        : narrowCandidatesByAgent(
            datasetNarrowedCandidates,
            options.agentId,
            lookup
          );

    if (options.agentId !== undefined && narrowedCandidates.length === 0) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          datasetNarrowedCandidates,
          "agent-scope-empty"
        )
      );
      continue;
    }

    if (narrowedCandidates.length === 1) {
      items.push(
        makeBoundItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          narrowedCandidates[0]!
        )
      );
      continue;
    }

    items.push(
      makeGapItem(
        hypothesis,
        hypothesisItem,
        semanticPartial,
        narrowedCandidates,
        "ambiguous-candidates"
      )
    );
  }

  return stripUndefined({
    hypothesis,
    items,
    agentId: options.agentId,
    datasetIds:
      options.datasetIds === undefined ? undefined : [...options.datasetIds]
  });
};
