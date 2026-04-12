import { Predicate, Result, Schema } from "effect";
import {
  Aggregation,
  StatisticType,
  UnitFamily
} from "./data-layer/variable";
import {
  PartialVariableFacetConflict,
  PartialVariableJoinConflictError
} from "./errors";
import {
  AggregationMembers,
  DomainObjectCanonicals,
  FACET_KEYS,
  MeasuredPropertyCanonicals,
  PolicyInstrumentCanonicals,
  REQUIRED_FACET_KEYS,
  StatisticTypeMembers,
  TechnologyOrFuelCanonicals,
  UnitFamilyMembers
} from "./generated/energyVariableProfile";

export { FACET_KEYS, REQUIRED_FACET_KEYS } from "./generated/energyVariableProfile";

export type FacetKey = (typeof FACET_KEYS)[number];
export type RequiredFacetKey = (typeof REQUIRED_FACET_KEYS)[number];

export const FacetKey = Schema.Literals(FACET_KEYS).annotate({
  description: "One of the seven locked semantic identity dimensions for the resolution kernel"
});
export const RequiredFacetKey = Schema.Literals(REQUIRED_FACET_KEYS).annotate({
  description: "Kernel facets required for a partial to clear the minimum identity threshold"
});

export const PARTIAL_VARIABLE_GENERATOR_VALUES = {
  measuredProperty: MeasuredPropertyCanonicals.slice(0, 4),
  domainObject: DomainObjectCanonicals.slice(0, 4),
  technologyOrFuel: TechnologyOrFuelCanonicals.slice(0, 4),
  statisticType: StatisticTypeMembers,
  aggregation: AggregationMembers,
  unitFamily: UnitFamilyMembers,
  policyInstrument: PolicyInstrumentCanonicals.slice(0, 4)
} as const;

export const PARTIAL_VARIABLE_FIELDS = {
  measuredProperty: Schema.optionalKey(Schema.String),
  domainObject: Schema.optionalKey(Schema.String),
  technologyOrFuel: Schema.optionalKey(Schema.String),
  statisticType: Schema.optionalKey(StatisticType),
  aggregation: Schema.optionalKey(Aggregation),
  unitFamily: Schema.optionalKey(UnitFamily),
  policyInstrument: Schema.optionalKey(Schema.String)
} as const;

export const PartialVariableShape = Schema.Struct(PARTIAL_VARIABLE_FIELDS).annotate({
  description:
    "Resolution-kernel partial variable assignment over the seven locked semantic identity dimensions"
});
export type PartialVariableShape = Schema.Schema.Type<typeof PartialVariableShape>;
export type ResolvablePartial = PartialVariableShape & {
  readonly measuredProperty: string;
  readonly statisticType: PartialVariableShape["statisticType"];
};

const asConflictPair = (left: string, right: string): readonly [string, string] =>
  left <= right ? [left, right] : [right, left];

export const missingRequired = (
  partial: PartialVariableShape
): ReadonlyArray<RequiredFacetKey> =>
  REQUIRED_FACET_KEYS.filter((facet) => partial[facet] === undefined);

export const resolvable: Predicate.Refinement<
  PartialVariableShape,
  ResolvablePartial
> = (partial): partial is ResolvablePartial =>
  partial.measuredProperty !== undefined && partial.statisticType !== undefined;

export const specificity = (partial: PartialVariableShape): number =>
  FACET_KEYS.reduce(
    (count, facet) => (partial[facet] === undefined ? count : count + 1),
    0
  );

export const matched = (
  left: PartialVariableShape,
  right: PartialVariableShape
): ReadonlyArray<FacetKey> =>
  FACET_KEYS.filter((facet) => {
    const leftValue = left[facet];
    const rightValue = right[facet];

    return leftValue !== undefined && leftValue === rightValue;
  });

export const mismatched = (
  left: PartialVariableShape,
  right: PartialVariableShape
): ReadonlyArray<Schema.Schema.Type<typeof PartialVariableFacetConflict>> =>
  FACET_KEYS.flatMap((facet) => {
    const leftValue = left[facet];
    const rightValue = right[facet];

    if (
      leftValue === undefined ||
      rightValue === undefined ||
      leftValue === rightValue
    ) {
      return [];
    }

    return [
      {
        facet,
        values: asConflictPair(leftValue, rightValue)
      }
    ];
  });

export const subsumes = (
  general: PartialVariableShape,
  specific: PartialVariableShape
): boolean =>
  FACET_KEYS.every((facet) => {
    const generalValue = general[facet];
    const specificValue = specific[facet];

    return generalValue === undefined || generalValue === specificValue;
  });

export const subsumptionRatio = (
  general: PartialVariableShape,
  specific: PartialVariableShape
): number => {
  if (!subsumes(general, specific)) {
    return 0;
  }

  const specificSpecificity = specificity(specific);
  if (specificSpecificity === 0) {
    return specificity(general) === 0 ? 1 : 0;
  }

  return matched(general, specific).length / specificSpecificity;
};

export const joinPartials = (
  left: PartialVariableShape,
  right: PartialVariableShape
): Result.Result<PartialVariableShape, PartialVariableJoinConflictError> => {
  const conflicts = mismatched(left, right);
  if (conflicts.length > 0) {
    return Result.fail(
      new PartialVariableJoinConflictError({
        message:
          conflicts.length === 1
            ? `Partial join conflict on ${conflicts[0]?.facet ?? "unknown facet"}`
            : `Partial join conflict on ${conflicts.length} facets`,
        conflicts
      })
    );
  }

  return Result.succeed({
    ...left,
    ...right
  });
};
