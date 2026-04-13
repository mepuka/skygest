import { describe, expect, it } from "@effect/vitest";
import {
  FUZZY_CANDIDATE_THRESHOLD,
  FUZZY_CONFIDENT_THRESHOLD,
  jaccardTokenSet
} from "../src/resolution/fuzzyMatch";

describe("jaccardTokenSet", () => {
  it("returns 1 for identical token sets", () => {
    expect(jaccardTokenSet("Energy Information Administration", "Energy Information Administration")).toBe(1);
  });

  it("returns 0 for disjoint token sets", () => {
    expect(jaccardTokenSet("wind capacity", "battery storage")).toBe(0);
  });

  it("returns 0 when either side is empty", () => {
    expect(jaccardTokenSet("", "battery storage")).toBe(0);
    expect(jaccardTokenSet("battery storage", "")).toBe(0);
  });

  it("is case-insensitive and whitespace-insensitive", () => {
    expect(
      jaccardTokenSet(
        "  ENERGY   INFORMATION Administration ",
        "energy information administration"
      )
    ).toBe(1);
  });

  it("treats slug separators and apostrophes as equivalent word boundaries", () => {
    expect(
      jaccardTokenSet("CAISO Today's Outlook", "caiso-todays-outlook")
    ).toBe(1);
  });

  it("exports the locked Stage 2 thresholds", () => {
    expect(FUZZY_CANDIDATE_THRESHOLD).toBe(0.6);
    expect(FUZZY_CONFIDENT_THRESHOLD).toBe(0.85);
  });

  it("discriminates below-candidate, candidate, and confident ranges", () => {
    const belowCandidate = jaccardTokenSet(
      "wind energy capacity",
      "wind capacity additions report"
    );
    const candidateBoundary = jaccardTokenSet(
      "wind energy capacity",
      "us wind energy capacity report"
    );
    const confidentRange = jaccardTokenSet(
      "us energy information administration monthly electric report",
      "us energy information administration monthly electric report archive"
    );

    expect(belowCandidate).toBeLessThan(FUZZY_CANDIDATE_THRESHOLD);
    expect(candidateBoundary).toBeCloseTo(FUZZY_CANDIDATE_THRESHOLD);
    expect(candidateBoundary).toBeLessThan(FUZZY_CONFIDENT_THRESHOLD);
    expect(confidentRange).toBeGreaterThan(FUZZY_CONFIDENT_THRESHOLD);
  });
});
