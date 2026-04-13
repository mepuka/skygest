import { Result } from "effect";
import type { Variable } from "../../domain/data-layer";
import type { AgentId } from "../../domain/data-layer/ids";
import type {
  BoundResolutionBoundItem,
  BoundResolutionGapItem,
  BoundResolutionItem,
  ResolutionHypothesis,
  VariableCandidateScore
} from "../../domain/resolutionKernel";
import {
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
  readonly agentId?: AgentId;
};

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
  options: {
    readonly agentId?: AgentId;
  } = {}
): BoundHypothesis => {
  const variables = listVariables(lookup);
  const items: Array<BoundResolutionItem> = [];

  for (const hypothesisItem of hypothesis.items) {
    const semanticPartialResult = joinPartials(
      hypothesis.sharedPartial,
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

    const narrowedCandidates =
      options.agentId !== undefined && compatibleCandidates.length > 1
        ? narrowCandidatesByAgent(compatibleCandidates, options.agentId, lookup)
        : compatibleCandidates;

    if (
      options.agentId !== undefined &&
      compatibleCandidates.length > 1 &&
      narrowedCandidates.length === 0
    ) {
      items.push(
        makeGapItem(
          hypothesis,
          hypothesisItem,
          semanticPartial,
          compatibleCandidates,
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
    agentId: options.agentId
  });
};
