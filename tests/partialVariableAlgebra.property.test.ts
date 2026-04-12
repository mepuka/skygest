import { describe, expect, it } from "@effect/vitest";
import fc from "fast-check";
import { Result, Schema } from "effect";
import {
  FACET_KEYS,
  PARTIAL_VARIABLE_GENERATOR_VALUES,
  PartialVariableShape,
  joinPartials,
  missingRequired,
  mismatched,
  resolvable,
  specificity,
  subsumes
} from "../src/domain/partialVariableAlgebra";

const decodePartial = Schema.decodeUnknownSync(PartialVariableShape);

const pruneUndefined = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );

const optional = <A>(arbitrary: fc.Arbitrary<A>) =>
  fc.option(arbitrary, { nil: undefined });

const partialVariableArbitrary: fc.Arbitrary<
  Schema.Schema.Type<typeof PartialVariableShape>
> = fc
  .record({
    measuredProperty: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.measuredProperty)
    ),
    domainObject: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.domainObject)
    ),
    technologyOrFuel: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.technologyOrFuel)
    ),
    statisticType: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.statisticType)
    ),
    aggregation: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.aggregation)
    ),
    unitFamily: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.unitFamily)
    ),
    policyInstrument: optional(
      fc.constantFrom(...PARTIAL_VARIABLE_GENERATOR_VALUES.policyInstrument)
    )
  })
  .map((value) => decodePartial(pruneUndefined(value)));

const emptyPartial = decodePartial({});

const joinLeft = (
  first: Schema.Schema.Type<typeof PartialVariableShape>,
  second: Schema.Schema.Type<typeof PartialVariableShape>,
  third: Schema.Schema.Type<typeof PartialVariableShape>
) => {
  const intermediate = joinPartials(first, second);
  if (Result.isFailure(intermediate)) {
    return intermediate;
  }

  return joinPartials(intermediate.success, third);
};

const joinRight = (
  first: Schema.Schema.Type<typeof PartialVariableShape>,
  second: Schema.Schema.Type<typeof PartialVariableShape>,
  third: Schema.Schema.Type<typeof PartialVariableShape>
) => {
  const intermediate = joinPartials(second, third);
  if (Result.isFailure(intermediate)) {
    return intermediate;
  }

  return joinPartials(first, intermediate.success);
};

describe("partialVariableAlgebra property laws", () => {
  it("join is commutative", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        (left, right) => {
          expect(joinPartials(left, right)).toEqual(joinPartials(right, left));
        }
      )
    );
  });

  it("the empty partial is a left and right identity", () => {
    fc.assert(
      fc.property(partialVariableArbitrary, (partial) => {
        expect(joinPartials(emptyPartial, partial)).toEqual(
          Result.succeed(partial)
        );
        expect(joinPartials(partial, emptyPartial)).toEqual(
          Result.succeed(partial)
        );
      })
    );
  });

  it("successful joins are associative", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        partialVariableArbitrary,
        (first, second, third) => {
          const leftIntermediate = joinPartials(first, second);
          const rightIntermediate = joinPartials(second, third);

          if (
            Result.isFailure(leftIntermediate) ||
            Result.isFailure(rightIntermediate)
          ) {
            return;
          }

          const leftAssociative = joinPartials(leftIntermediate.success, third);
          const rightAssociative = joinPartials(first, rightIntermediate.success);

          if (
            Result.isFailure(leftAssociative) ||
            Result.isFailure(rightAssociative)
          ) {
            return;
          }

          expect(leftAssociative.success).toEqual(rightAssociative.success);
        }
      )
    );
  });

  it("conflict paths stay consistent across associativity orderings", () => {
    const conflictCases = FACET_KEYS.map((facet) => {
      const [leftValue, rightValue] = PARTIAL_VARIABLE_GENERATOR_VALUES[facet];
      return {
        first: decodePartial({ [facet]: leftValue }),
        second: decodePartial({ [facet]: rightValue }),
        third: emptyPartial
      };
    });

    for (const { first, second, third } of conflictCases) {
      const leftAssociative = joinLeft(first, second, third);
      const rightAssociative = joinRight(first, second, third);

      expect(Result.isFailure(leftAssociative)).toBe(true);
      expect(leftAssociative).toEqual(rightAssociative);
    }
  });

  it("subsumption is reflexive and transitive", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        partialVariableArbitrary,
        (a, b, c) => {
          expect(subsumes(a, a)).toBe(true);

          if (subsumes(a, b) && subsumes(b, c)) {
            expect(subsumes(a, c)).toBe(true);
          }
        }
      )
    );
  });

  it("specificity never decreases when a join succeeds", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        (left, right) => {
          const joined = joinPartials(left, right);
          if (Result.isFailure(joined)) {
            return;
          }

          expect(specificity(joined.success)).toBeGreaterThanOrEqual(
            specificity(left)
          );
          expect(specificity(joined.success)).toBeGreaterThanOrEqual(
            specificity(right)
          );
        }
      )
    );
  });

  it("successful joins are subsumed by both inputs", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        (left, right) => {
          const joined = joinPartials(left, right);
          if (Result.isFailure(joined)) {
            return;
          }

          expect(subsumes(left, joined.success)).toBe(true);
          expect(subsumes(right, joined.success)).toBe(true);
        }
      )
    );
  });

  it("subsumption and mismatch detection agree", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        (general, specific) => {
          if (subsumes(general, specific)) {
            expect(mismatched(general, specific)).toHaveLength(0);
          }
        }
      )
    );
  });

  it("subsumption implies non-decreasing specificity", () => {
    fc.assert(
      fc.property(
        partialVariableArbitrary,
        partialVariableArbitrary,
        (general, specific) => {
          if (subsumes(general, specific)) {
            expect(specificity(general)).toBeLessThanOrEqual(
              specificity(specific)
            );
          }
        }
      )
    );
  });

  it("missing required facets agrees with the resolvable refinement", () => {
    fc.assert(
      fc.property(partialVariableArbitrary, (partial) => {
        expect(missingRequired(partial).length === 0).toBe(resolvable(partial));
      })
    );
  });
});
