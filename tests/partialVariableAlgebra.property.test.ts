import { describe, expect, it } from "@effect/vitest";
import fc from "fast-check";
import { Result, Schema } from "effect";
import {
  PartialVariableShape,
  joinPartials,
  mismatched,
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
      fc.constantFrom("generation", "capacity", "investment", "price")
    ),
    domainObject: optional(
      fc.constantFrom("electricity", "natural gas", "battery storage", "grid")
    ),
    technologyOrFuel: optional(
      fc.constantFrom("wind", "solar", "coal", "natural gas")
    ),
    statisticType: optional(
      fc.constantFrom("stock", "flow", "price", "share", "count")
    ),
    aggregation: optional(
      fc.constantFrom(
        "point",
        "end_of_period",
        "sum",
        "average",
        "max",
        "min",
        "settlement"
      )
    ),
    unitFamily: optional(
      fc.constantFrom(
        "power",
        "energy",
        "currency",
        "currency_per_energy",
        "mass_co2e",
        "intensity",
        "dimensionless",
        "other"
      )
    )
  })
  .map((value) => decodePartial(pruneUndefined(value)));

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
});
