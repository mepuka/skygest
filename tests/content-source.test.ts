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

  it("resolves reuters.com subdomain to Reuters via root extraction", () => {
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
