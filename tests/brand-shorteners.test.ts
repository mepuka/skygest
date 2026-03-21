import { describe, expect, it } from "@effect/vitest";
import {
  brandShortenerManifest,
  brandShortenerMap
} from "../src/source/brandShorteners";
import { publicationsSeedManifest } from "../src/bootstrap/CheckedInPublications";
import { normalizeDomain } from "../src/domain/normalize";

describe("brand shortener catalog", () => {
  it("decodes the manifest with the expected number of entries", () => {
    expect(brandShortenerManifest.version).toBe("2026-03-21");
    expect(brandShortenerManifest.entries.length).toBe(10);
  });

  it("builds a map keyed by normalized short domain", () => {
    expect(brandShortenerMap.size).toBe(10);
    expect(brandShortenerMap.get("reut.rs")).toBe("reuters.com");
    expect(brandShortenerMap.get("nyti.ms")).toBe("nytimes.com");
    expect(brandShortenerMap.get("on.ft.com")).toBe("financialtimes.com");
    expect(brandShortenerMap.get("bloom.bg")).toBe("bloomberg.com");
  });

  it("every resolvedDomain exists in the publication seed", () => {
    const seededHostnames = new Set(
      publicationsSeedManifest.publications.map((p) =>
        normalizeDomain(p.hostname)
      )
    );

    for (const entry of brandShortenerManifest.entries) {
      const resolved = normalizeDomain(entry.resolvedDomain);
      expect(
        seededHostnames.has(resolved),
        `shortener target "${resolved}" (from ${entry.shortDomain}) is not in the publication seed`
      ).toBe(true);
    }
  });
});
