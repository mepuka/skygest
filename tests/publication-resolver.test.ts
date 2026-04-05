import { describe, expect, it } from "@effect/vitest";
import {
  buildPublicationIndex,
  buildPodcastShowIndex,
  extractRootDomain,
  publicationDisplayLabel,
  resolvePodcastShowEntry,
  resolvePublicationEntry,
  type PublicationLike,
  type PodcastShowLike,
} from "../src/source/publicationResolver";
import { brandShortenerMap } from "../src/source/brandShorteners";

const entries: ReadonlyArray<PublicationLike> = [
  { hostname: "reuters.com" },
  { hostname: "financialtimes.com" },
  { hostname: "nytimes.com" },
  { hostname: "washingtonpost.com" },
  { hostname: "cbc.ca" },
  { hostname: "bbc.co.uk" },
  { hostname: "abc.net.au" },
  { hostname: "onlinelibrary.wiley.com" },
  { hostname: "doi.org" },
];

const index = buildPublicationIndex(entries);

const podcastEntries: ReadonlyArray<PodcastShowLike> = [
  { showSlug: "catalyst-with-shayle-kann" },
  { showSlug: "the-carbon-copy" }
];

const podcastIndex = buildPodcastShowIndex(podcastEntries);

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

  it("walks parent domains for multi-label country domains", () => {
    const result = resolvePublicationEntry("news.bbc.co.uk", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "bbc.co.uk" });
  });

  it("walks parent domains for seeded subdomain publications", () => {
    const result = resolvePublicationEntry("agupubs.onlinelibrary.wiley.com", index, brandShortenerMap);
    expect(result).toEqual({ hostname: "onlinelibrary.wiley.com" });
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

describe("publicationDisplayLabel", () => {
  it("returns a friendly label for mapped publications", () => {
    expect(publicationDisplayLabel("reuters.com")).toBe("Reuters");
  });

  it("suppresses obvious utility, repository, and aggregator hosts", () => {
    for (const hostname of [
      "doi.org",
      "arxiv.org",
      "link.springer.com",
      "sciencedirect.com",
      "yahoo.com",
      "msn.com",
      "soundcloud.com"
    ]) {
      expect(publicationDisplayLabel(hostname), `${hostname} should not display as a publication`).toBeNull();
    }
  });
});

describe("resolvePodcastShowEntry", () => {
  it("matches a show slug exactly", () => {
    const result = resolvePodcastShowEntry(
      "catalyst-with-shayle-kann",
      podcastIndex
    );
    expect(result).toEqual({ showSlug: "catalyst-with-shayle-kann" });
  });

  it("normalizes casing and surrounding whitespace", () => {
    const result = resolvePodcastShowEntry(
      "  The-Carbon-Copy  ",
      podcastIndex
    );
    expect(result).toEqual({ showSlug: "the-carbon-copy" });
  });

  it("returns null for unknown show slugs", () => {
    const result = resolvePodcastShowEntry("unknown-show", podcastIndex);
    expect(result).toBeNull();
  });
});
