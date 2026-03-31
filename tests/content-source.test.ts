import { describe, expect, it } from "@effect/vitest";
import { choosePrimaryContentSource, type PublicationContext } from "../src/source/contentSource";
import { publicationsSeedManifest } from "../src/bootstrap/CheckedInPublications";
import { brandShortenerMap } from "../src/source/brandShorteners";
import { buildPublicationIndex } from "../src/source/publicationResolver";

const publicationContext: PublicationContext = {
  publicationIndex: buildPublicationIndex(publicationsSeedManifest.publications),
  brandShortenerMap
};

describe("choosePrimaryContentSource — publication resolution", () => {
  it("populates publication for a known seed domain via link card", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [
          {
            source: "embed",
            uri: "https://www.carbonbrief.org/daily-brief/21-march-2025",
            title: "Daily Brief",
            description: null,
            thumb: null
          }
        ],
        links: []
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("carbonbrief.org");
    expect(result!.publication).toBe("carbonbrief.org");
  });

  it("populates publication for a known seed domain via link record", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://www.carbonbrief.org/analysis/some-article",
            domain: "carbonbrief.org",
            title: "Analysis",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("carbonbrief.org");
    expect(result!.publication).toBe("carbonbrief.org");
  });

  it("populates publication for a curated follow-up publisher domain", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://www.businessinsider.com/energy-grid-story-2026-03",
            domain: "businessinsider.com",
            title: "Energy grid story",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("businessinsider.com");
    expect(result!.publication).toBe("businessinsider.com");
  });

  it("resolves brand shortener domain to canonical publication", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://reut.rs/4abc123",
            domain: "reut.rs",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("reut.rs");
    expect(result!.publication).toBe("Reuters");
  });

  it("resolves reuters.com subdomain to Reuters via parent-domain fallback", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [
          {
            source: "embed",
            uri: "https://news.reuters.com/some-article",
            title: "Reuters Article",
            description: null,
            thumb: null
          }
        ],
        links: []
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.publication).toBe("Reuters");
  });

  it("resolves multi-label country domains via parent-domain fallback", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [
          {
            source: "embed",
            uri: "https://news.bbc.co.uk/2/hi/science/nature/123456.stm",
            title: "BBC story",
            description: null,
            thumb: null
          }
        ],
        links: []
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("news.bbc.co.uk");
    expect(result!.publication).toBe("bbc.co.uk");
  });

  it("resolves seeded publication subdomains before collapsing to the site root", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2024EF123456",
            domain: "agupubs.onlinelibrary.wiley.com",
            title: "AGU paper",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.publication).toBe("onlinelibrary.wiley.com");
  });

  it("suppresses publication labels for utility and reference hosts", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://doi.org/10.1126/science.1234567",
            domain: "doi.org",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("doi.org");
    expect(result!.publication).toBeNull();
  });

  it("suppresses publication labels for repository and aggregator hosts that remain matchable", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://www.sciencedirect.com/science/article/pii/S1234567890123456",
            domain: "sciencedirect.com",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("sciencedirect.com");
    expect(result!.publication).toBeNull();
  });

  it("returns publication = null for unknown domains", () => {
    const result = choosePrimaryContentSource(
      {
        linkCards: [],
        links: [
          {
            url: "https://example-unknown-site.com/page",
            domain: "example-unknown-site.com",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ]
      },
      publicationContext
    );

    expect(result).not.toBeNull();
    expect(result!.publication).toBeNull();
  });

  it("returns publication = null when no publicationContext is provided (backward compat)", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://www.carbonbrief.org/analysis/some-article",
          domain: "carbonbrief.org",
          title: "Analysis",
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });

    expect(result).not.toBeNull();
    expect(result!.domain).toBe("carbonbrief.org");
    expect(result!.publication).toBeNull();
  });
});
