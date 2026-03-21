import { describe, expect, it } from "@effect/vitest";
import {
  buildPublicationIndex,
  extractRootDomain,
  resolvePublicationEntry,
  type PublicationLike,
} from "../src/source/publicationResolver";
import { brandShortenerMap } from "../src/source/brandShorteners";

const entries: ReadonlyArray<PublicationLike> = [
  { hostname: "reuters.com" },
  { hostname: "financialtimes.com" },
  { hostname: "nytimes.com" },
  { hostname: "washingtonpost.com" },
  { hostname: "cbc.ca" },
];

const index = buildPublicationIndex(entries);

describe("extractRootDomain", () => {
  it("returns a bare domain unchanged", () => {
    expect(extractRootDomain("reuters.com")).toBe("reuters.com");
  });

  it("strips subdomain when >2 parts", () => {
    expect(extractRootDomain("news.reuters.com")).toBe("reuters.com");
  });

  it("strips www. prefix", () => {
    expect(extractRootDomain("www.reuters.com")).toBe("reuters.com");
  });
});

describe("resolvePublicationEntry", () => {
  it("exact hostname match", () => {
    const result = resolvePublicationEntry("reuters.com", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "reuters.com" });
  });

  it("www. normalization", () => {
    const result = resolvePublicationEntry("www.reuters.com", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "reuters.com" });
  });

  it("subdomain fallback (news.reuters.com → reuters.com)", () => {
    const result = resolvePublicationEntry("news.reuters.com", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "reuters.com" });
  });

  it("shortener expansion (reut.rs → reuters.com)", () => {
    const result = resolvePublicationEntry("reut.rs", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "reuters.com" });
  });

  it("financialtimes.com via on.ft.com shortener", () => {
    const result = resolvePublicationEntry("on.ft.com", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "financialtimes.com" });
  });

  it("unknown domain returns null", () => {
    const result = resolvePublicationEntry("unknown-domain.example", index, brandShortenerMap);
    expect(result).toBeNull();
  });

  it("null domain returns null", () => {
    const result = resolvePublicationEntry(null, index, brandShortenerMap);
    expect(result).toBeNull();
  });
});
