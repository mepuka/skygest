import { Result } from "effect";
import type { Variable } from "../../domain/data-layer";
import type { VariableId } from "../../domain/data-layer/ids";
import type { PartialVariableFacetConflict } from "../../domain/errors";
import {
  type BoundResolutionItem,
  type ResolutionHypothesis
} from "../../domain/resolutionKernel";
import {
  type PartialVariableShape,
  type RequiredFacetKey,
  joinPartials,
  matched,
  missingRequired,
  resolvable,
  subsumes,
  subsumptionRatio
} from "../../domain/partialVariableAlgebra";
import { stripUndefined } from "../../platform/Json";
import type { DataLayerRegistryLookup } from "../dataLayerRegistry";

export type VariableCandidateScore = {
  readonly variableId: VariableId;
  readonly label: string;
  readonly matchedFacets: ReadonlyArray<string>;
  readonly subsumptionRatio: number;
  readonly semanticPartial: PartialVariableShape;
};

export type BoundItemResult = {
  readonly item: BoundResolutionItem;
  readonly semanticPartial: PartialVariableShape;
  readonly missingRequired: ReadonlyArray<RequiredFacetKey>;
  readonly candidates: ReadonlyArray<VariableCandidateScore>;
};

export type BoundHypothesis =
  | {
      readonly _tag: "BoundHypothesis";
      readonly hypothesis: ResolutionHypothesis;
      readonly items: ReadonlyArray<BoundItemResult>;
    }
  | {
      readonly _tag: "Conflicted";
      readonly hypothesis: ResolutionHypothesis;
      readonly conflicts: ReadonlyArray<PartialVariableFacetConflict>;
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

const compareCandidates = (
  left: VariableCandidateScore,
  right: VariableCandidateScore
): number =>
  right.matchedFacets.length - left.matchedFacets.length ||
  right.subsumptionRatio - left.subsumptionRatio ||
  left.label.localeCompare(right.label);

const scoreCandidates = (
  partial: PartialVariableShape,
  variables: ReadonlyArray<Variable>
): ReadonlyArray<VariableCandidateScore> =>
  variables
    .map((variable) => {
      const semanticPartial = variableToPartial(variable);
      return {
        variableId: variable.id,
        label: variable.label,
        matchedFacets: matched(partial, semanticPartial),
        subsumptionRatio: subsumptionRatio(partial, semanticPartial),
        semanticPartial
      };
    })
    .sort(compareCandidates);

export const bindHypothesis = (
  hypothesis: ResolutionHypothesis,
  lookup: DataLayerRegistryLookup
): BoundHypothesis => {
  const variables = listVariables(lookup);
  const items: Array<BoundItemResult> = [];

  for (const hypothesisItem of hypothesis.items) {
    const semanticPartialResult = joinPartials(
      hypothesis.sharedPartial,
      hypothesisItem.partial
    );
    if (Result.isFailure(semanticPartialResult)) {
      return {
        _tag: "Conflicted",
        hypothesis,
        conflicts: semanticPartialResult.failure.conflicts
      };
    }

    const semanticPartial = semanticPartialResult.success;
    const missing = missingRequired(semanticPartial);
    const candidates =
      resolvable(semanticPartial)
        ? scoreCandidates(
            semanticPartial,
            variables.filter((variable) =>
              subsumes(semanticPartial, variableToPartial(variable))
            )
          )
        : [];

    items.push({
      item: stripUndefined({
        itemKey: hypothesisItem.itemKey,
        semanticPartial,
        attachedContext: hypothesis.attachedContext,
        evidence: [...hypothesisItem.evidence]
      }),
      semanticPartial,
      missingRequired: missing,
      candidates
    });
  }

  return {
    _tag: "BoundHypothesis",
    hypothesis,
    items
  };
};
