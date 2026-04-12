import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
  FACET_KEYS,
  PartialVariableShape,
  REQUIRED_FACET_KEYS,
  joinPartials,
  matched,
  mismatched,
  missingRequired,
  resolvable,
  specificity,
  subsumes,
  subsumptionRatio
} from "../src/domain/partialVariableAlgebra";

const asPartial = Schema.decodeUnknownSync(PartialVariableShape);

describe("partialVariableAlgebra", () => {
  it("exports the locked six facet keys", () => {
    expect(FACET_KEYS).toEqual([
      "measuredProperty",
      "domainObject",
      "technologyOrFuel",
      "statisticType",
      "aggregation",
      "unitFamily"
    ]);
  });

  it("exports the minimum required facet keys for resolvability", () => {
    expect(REQUIRED_FACET_KEYS).toEqual(["measuredProperty", "statisticType"]);
  });

  it("joins compatible partials without losing filled facets", () => {
    const left = asPartial({
      measuredProperty: "generation",
      statisticType: "flow"
    });
    const right = asPartial({
      technologyOrFuel: "wind",
      unitFamily: "energy"
    });

    const joined = joinPartials(left, right);

    expect(Result.isSuccess(joined)).toBe(true);
    if (Result.isFailure(joined)) {
      return;
    }

    expect(joined.success).toEqual({
      measuredProperty: "generation",
      statisticType: "flow",
      technologyOrFuel: "wind",
      unitFamily: "energy"
    });
  });

  it("returns a typed conflict when incompatible facets disagree", () => {
    const left = asPartial({
      measuredProperty: "generation",
      statisticType: "flow"
    });
    const right = asPartial({
      measuredProperty: "capacity",
      statisticType: "flow"
    });

    const joined = joinPartials(left, right);

    expect(Result.isFailure(joined)).toBe(true);
    if (Result.isSuccess(joined)) {
      return;
    }

    expect(joined.failure._tag).toBe("PartialVariableJoinConflictError");
    expect(joined.failure.conflicts).toEqual([
      {
        facet: "measuredProperty",
        values: ["capacity", "generation"]
      }
    ]);
  });

  it("computes matched facets, mismatches, and specificity consistently", () => {
    const partial = asPartial({
      measuredProperty: "generation",
      technologyOrFuel: "solar",
      statisticType: "flow"
    });
    const candidate = asPartial({
      measuredProperty: "generation",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy"
    });

    expect(matched(partial, candidate)).toEqual([
      "measuredProperty",
      "statisticType"
    ]);
    expect(mismatched(partial, candidate)).toEqual([
      {
        facet: "technologyOrFuel",
        values: ["solar", "wind"]
      }
    ]);
    expect(specificity(partial)).toBe(3);
    expect(specificity(candidate)).toBe(4);
  });

  it("treats subsumption as general to specific and scores the coverage ratio", () => {
    const general = asPartial({
      measuredProperty: "generation",
      statisticType: "flow"
    });
    const specific = asPartial({
      measuredProperty: "generation",
      technologyOrFuel: "wind",
      statisticType: "flow",
      unitFamily: "energy"
    });

    expect(subsumes(general, specific)).toBe(true);
    expect(subsumes(specific, general)).toBe(false);
    expect(subsumptionRatio(general, specific)).toBe(0.5);
  });

  it("returns a zero subsumption ratio when shapes disagree", () => {
    const general = asPartial({
      measuredProperty: "generation",
      statisticType: "flow"
    });
    const specific = asPartial({
      measuredProperty: "capacity",
      statisticType: "flow",
      unitFamily: "energy"
    });

    expect(subsumes(general, specific)).toBe(false);
    expect(subsumptionRatio(general, specific)).toBe(0);
  });

  it("tracks missing required facets and refines resolvable partials", () => {
    const unresolved = asPartial({
      measuredProperty: "generation"
    });
    const resolved = asPartial({
      measuredProperty: "generation",
      statisticType: "flow"
    });

    expect(missingRequired(unresolved)).toEqual(["statisticType"]);
    expect(resolvable(unresolved)).toBe(false);
    expect(missingRequired(resolved)).toEqual([]);
    expect(resolvable(resolved)).toBe(true);
  });
});
