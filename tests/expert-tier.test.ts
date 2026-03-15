import { describe, expect, it } from "@effect/vitest";
import { resolveExpertTier } from "../src/ontology/expertTier";
import type { OntologyAuthorTiers } from "../src/domain/bi";

const sampleTiers: OntologyAuthorTiers = {
  energyFocused: ["canarymedia.com", "heatmap.news", "utilitydive.com"],
  generalOutlets: ["nytimes.com", "reuters.com", "washingtonpost.com"]
};

describe("resolveExpertTier", () => {
  it("returns energy-focused for a handle in energyFocused list", () => {
    expect(resolveExpertTier("canarymedia.com", sampleTiers)).toBe("energy-focused");
  });

  it("returns general-outlet for a handle in generalOutlets list", () => {
    expect(resolveExpertTier("nytimes.com", sampleTiers)).toBe("general-outlet");
  });

  it("returns independent for a handle not in any list", () => {
    expect(resolveExpertTier("random-blogger.bsky.social", sampleTiers)).toBe("independent");
  });

  it("returns independent for a null handle", () => {
    expect(resolveExpertTier(null, sampleTiers)).toBe("independent");
  });

  it("returns independent for an empty string handle", () => {
    expect(resolveExpertTier("", sampleTiers)).toBe("independent");
  });

  it("returns independent for a whitespace-only handle", () => {
    expect(resolveExpertTier("   ", sampleTiers)).toBe("independent");
  });

  it("matches case-insensitively", () => {
    expect(resolveExpertTier("CanaryMedia.com", sampleTiers)).toBe("energy-focused");
    expect(resolveExpertTier("NYTIMES.COM", sampleTiers)).toBe("general-outlet");
  });

  it("trims whitespace before matching", () => {
    expect(resolveExpertTier("  heatmap.news  ", sampleTiers)).toBe("energy-focused");
    expect(resolveExpertTier("  reuters.com  ", sampleTiers)).toBe("general-outlet");
  });

  it("returns independent when both tier lists are empty", () => {
    const emptyTiers: OntologyAuthorTiers = {
      energyFocused: [],
      generalOutlets: []
    };
    expect(resolveExpertTier("canarymedia.com", emptyTiers)).toBe("independent");
  });

  it("handles entries in tier lists with leading/trailing whitespace", () => {
    const tiersWithWhitespace: OntologyAuthorTiers = {
      energyFocused: ["  canarymedia.com  "],
      generalOutlets: ["  nytimes.com  "]
    };
    expect(resolveExpertTier("canarymedia.com", tiersWithWhitespace)).toBe("energy-focused");
    expect(resolveExpertTier("nytimes.com", tiersWithWhitespace)).toBe("general-outlet");
  });
});
