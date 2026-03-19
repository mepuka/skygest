import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import {
  MatchSignalType,
  MatchEvidence,
  ProviderMatch,
  MatchResolution,
  MatchResult
} from "../src/domain/source";
import {
  stripSourcePrefix,
  isWholeWordMatch,
  extractDomainFromText
} from "../src/source/normalize";
import { choosePrimaryContentSource } from "../src/source/contentSource";
import { SourceAttributionMatcher } from "../src/source/SourceAttributionMatcher";
import { ProviderRegistry } from "../src/services/ProviderRegistry";

describe("evidence contract types", () => {
  it("MatchSignalType decodes all 7 signal types and rejects invalid", () => {
    const decode = Schema.decodeUnknownSync(MatchSignalType);
    const signals = [
      "source-line-alias",
      "source-line-domain",
      "chart-title-alias",
      "link-domain",
      "embed-link-domain",
      "visible-url-domain",
      "post-text-mention"
    ];
    for (const s of signals) {
      expect(decode(s)).toBe(s);
    }
    expect(() => decode("invalid-signal")).toThrow();
  });

  it("MatchResult resolution discriminates matched/ambiguous/none", () => {
    const decode = Schema.decodeUnknownSync(MatchResult);
    const result = decode({
      providerMatches: [],
      selectedProvider: null,
      resolution: "none",
      contentSource: null,
      socialProvenance: null
    });
    expect(result.resolution).toBe("none");
  });

  it("MatchResult decodes correctly with a matched provider", () => {
    const decode = Schema.decodeUnknownSync(MatchResult);
    const result = decode({
      providerMatches: [
        {
          providerId: "ercot",
          providerLabel: "ERCOT",
          sourceFamily: null,
          signals: [
            {
              signal: "link-domain",
              raw: { url: "https://ercot.com/data", domain: "ercot.com" }
            }
          ]
        }
      ],
      selectedProvider: {
        providerId: "ercot",
        providerLabel: "ERCOT",
        sourceFamily: null
      },
      resolution: "matched",
      contentSource: {
        url: "https://ercot.com/data",
        title: "ERCOT Data",
        domain: "ercot.com",
        publication: null
      },
      socialProvenance: {
        did: "did:plc:abc123",
        handle: "expert.bsky.social"
      }
    });
    expect(result.resolution).toBe("matched");
    expect(result.selectedProvider?.providerId).toBe("ercot");
    expect(result.providerMatches).toHaveLength(1);
    expect(result.providerMatches[0]?.signals[0]?.signal).toBe("link-domain");
    expect(result.contentSource?.domain).toBe("ercot.com");
    expect(result.socialProvenance?.did).toBe("did:plc:abc123");
  });
});

describe("normalization utilities", () => {
  describe("stripSourcePrefix", () => {
    it("removes common prefixes", () => {
      expect(stripSourcePrefix("Source: EIA")).toBe("EIA");
      expect(stripSourcePrefix("Data: AESO")).toBe("AESO");
      expect(stripSourcePrefix("Source data: BC Hydro")).toBe("BC Hydro");
      expect(stripSourcePrefix("via ERCOT")).toBe("ERCOT");
    });

    it("is case-insensitive", () => {
      expect(stripSourcePrefix("SOURCE: EIA")).toBe("EIA");
      expect(stripSourcePrefix("source: EIA")).toBe("EIA");
      expect(stripSourcePrefix("Via ERCOT")).toBe("ERCOT");
      expect(stripSourcePrefix("VIA ERCOT")).toBe("ERCOT");
      expect(stripSourcePrefix("DATA: AESO")).toBe("AESO");
      expect(stripSourcePrefix("Source Data: NEB")).toBe("NEB");
    });

    it("returns original text when no prefix matches", () => {
      expect(stripSourcePrefix("EIA")).toBe("EIA");
      expect(stripSourcePrefix("ERCOT load data")).toBe("ERCOT load data");
    });

    it("trims whitespace", () => {
      expect(stripSourcePrefix("  Source: EIA  ")).toBe("EIA");
      expect(stripSourcePrefix("  EIA  ")).toBe("EIA");
    });

    it("handles prefix with extra whitespace", () => {
      expect(stripSourcePrefix("Source:  EIA")).toBe("EIA");
      expect(stripSourcePrefix("Source :  EIA")).toBe("EIA");
    });
  });

  describe("isWholeWordMatch", () => {
    it("matches on word boundaries", () => {
      expect(isWholeWordMatch("ERCOT demand is near peak", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("the ercot grid", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("forecast data", "ERCOT")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isWholeWordMatch("ercot data", "ERCOT")).toBe(true);
      expect(isWholeWordMatch("ERCOT data", "ercot")).toBe(true);
    });

    it("handles hyphenated aliases like ISO-NE", () => {
      expect(isWholeWordMatch("ISO-NE prices", "ISO-NE")).toBe(true);
      expect(isWholeWordMatch("the ISO-NE market", "ISO-NE")).toBe(true);
    });

    it("handles ENTSO-E", () => {
      expect(isWholeWordMatch("ENTSO-E transparency platform", "ENTSO-E")).toBe(
        true
      );
    });

    it("skips aliases shorter than 3 chars", () => {
      expect(isWholeWordMatch("BC Hydro report", "BC")).toBe(false);
      expect(isWholeWordMatch("AB power", "AB")).toBe(false);
    });

    it("does not match partial words", () => {
      expect(isWholeWordMatch("ERCOTX data", "ERCOT")).toBe(false);
      expect(isWholeWordMatch("XERCOT data", "ERCOT")).toBe(false);
    });

    it("matches aliases with special regex characters", () => {
      expect(isWholeWordMatch("reporting by S&P Global", "S&P Global")).toBe(
        true
      );
    });

    it("matches 3-char aliases", () => {
      expect(isWholeWordMatch("EIA data is out", "EIA")).toBe(true);
      expect(isWholeWordMatch("NEB report", "NEB")).toBe(true);
    });
  });

  describe("extractDomainFromText", () => {
    it("extracts domain from full URLs", () => {
      expect(extractDomainFromText("https://ercot.com/data")).toBe(
        "ercot.com"
      );
      expect(extractDomainFromText("http://www.eia.gov/petroleum")).toBe(
        "eia.gov"
      );
    });

    it("extracts bare domains", () => {
      expect(extractDomainFromText("Source: eia.gov")).toBe("eia.gov");
      expect(extractDomainFromText("from ercot.com")).toBe("ercot.com");
    });

    it("strips www prefix", () => {
      expect(extractDomainFromText("www.eia.gov")).toBe("eia.gov");
      expect(extractDomainFromText("https://www.ercot.com/data")).toBe(
        "ercot.com"
      );
    });

    it("returns null when no domain found", () => {
      expect(extractDomainFromText("Source: EIA")).toBeNull();
      expect(extractDomainFromText("ERCOT demand is near peak")).toBeNull();
      expect(extractDomainFromText("")).toBeNull();
    });

    it("lowercases the extracted domain", () => {
      expect(extractDomainFromText("ERCOT.COM/data")).toBe("ercot.com");
      expect(extractDomainFromText("https://EIA.GOV")).toBe("eia.gov");
    });

    it("handles domains with subdomains", () => {
      expect(extractDomainFromText("https://api.gridstatus.io/live")).toBe(
        "api.gridstatus.io"
      );
    });

    it("handles domains embedded in text", () => {
      expect(
        extractDomainFromText("Check out gridstatus.io for live data")
      ).toBe("gridstatus.io");
    });

    it("rejects common abbreviations (U.S., a.m., i.e., e.g.)", () => {
      expect(extractDomainFromText("at 10 a.m. ET")).toBeNull();
      expect(extractDomainFromText("U.S. Energy Information Administration")).toBeNull();
      expect(extractDomainFromText("i.e. this is a test")).toBeNull();
      expect(extractDomainFromText("e.g. solar panels")).toBeNull();
    });
  });
});

describe("content source assembly", () => {
  it("prefers embed link card URL (rule 1)", () => {
    const result = choosePrimaryContentSource({
      linkCards: [
        {
          source: "embed" as const,
          uri: "https://utilitydive.com/story/123",
          title: "Article",
          description: null,
          thumb: null
        }
      ],
      links: [
        {
          url: "https://other.com/page",
          domain: "other.com",
          title: null,
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://utilitydive.com/story/123");
    expect(result?.domain).toBe("utilitydive.com");
    expect(result?.title).toBe("Article");
    expect(result?.publication).toBeNull();
  });

  it("strips www from embed link card domain", () => {
    const result = choosePrimaryContentSource({
      linkCards: [
        {
          source: "embed" as const,
          uri: "https://www.eia.gov/petroleum/report",
          title: "EIA Report",
          description: null,
          thumb: null
        }
      ],
      links: []
    });
    expect(result?.domain).toBe("eia.gov");
  });

  it("falls back to single unique link (rule 2)", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://eia.gov/report",
          domain: "eia.gov",
          title: "Report",
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://eia.gov/report");
    expect(result?.domain).toBe("eia.gov");
    expect(result?.title).toBe("Report");
  });

  it("deduplicates links by URL for rule 2", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://eia.gov/report",
          domain: "eia.gov",
          title: "Report",
          description: null,
          imageUrl: null,
          extractedAt: 0
        },
        {
          url: "https://eia.gov/report",
          domain: "eia.gov",
          title: "Report (dup)",
          description: null,
          imageUrl: null,
          extractedAt: 1
        }
      ]
    });
    expect(result).not.toBeNull();
    expect(result?.url).toBe("https://eia.gov/report");
  });

  it("returns null for multiple unrelated links (rule 3)", () => {
    const result = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://a.com/page1",
          domain: "a.com",
          title: null,
          description: null,
          imageUrl: null,
          extractedAt: 0
        },
        {
          url: "https://b.com/page2",
          domain: "b.com",
          title: null,
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });
    expect(result).toBeNull();
  });

  it("returns null when no links exist", () => {
    const result = choosePrimaryContentSource({ linkCards: [], links: [] });
    expect(result).toBeNull();
  });

  it("uses link domain field when available, falls back to parsing URL", () => {
    const withDomain = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://www.ercot.com/data",
          domain: "ercot.com",
          title: null,
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });
    expect(withDomain?.domain).toBe("ercot.com");

    const withoutDomain = choosePrimaryContentSource({
      linkCards: [],
      links: [
        {
          url: "https://www.ercot.com/data",
          domain: null,
          title: null,
          description: null,
          imageUrl: null,
          extractedAt: 0
        }
      ]
    });
    expect(withoutDomain?.domain).toBe("ercot.com");
  });

  it("handles invalid URL in link card gracefully", () => {
    const result = choosePrimaryContentSource({
      linkCards: [
        {
          source: "embed" as const,
          uri: "not-a-valid-url",
          title: "Bad Link",
          description: null,
          thumb: null
        }
      ],
      links: []
    });
    expect(result).not.toBeNull();
    expect(result?.url).toBe("not-a-valid-url");
    expect(result?.domain).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SourceAttributionMatcher service tests
// ---------------------------------------------------------------------------

const TestLayer = Layer.merge(
  ProviderRegistry.layer,
  Layer.provideMerge(SourceAttributionMatcher.live, ProviderRegistry.layer)
);

describe("SourceAttributionMatcher", () => {
  it.effect("matches provider from link domain", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Check this out" },
        links: [
          {
            url: "https://ercot.com/gridinfo",
            domain: "ercot.com",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe("link-domain");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("matches provider from post text mention", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "ERCOT demand is near peak today" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe(
        "post-text-mention"
      );
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("returns ambiguous when multiple providers match at same rank", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: {
          did: "did:plc:test",
          text: "Comparing ERCOT and CAISO load data"
        },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("ambiguous");
      expect(result.selectedProvider).toBeNull();
      expect(result.providerMatches.length).toBeGreaterThanOrEqual(2);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("returns none when no signals match", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Beautiful sunset today" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("none");
      expect(result.selectedProvider).toBeNull();
      expect(result.providerMatches).toHaveLength(0);
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("assembles socialProvenance from post DID", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:abc123", text: "test" },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.socialProvenance?.did).toBe("did:plc:abc123");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("socialProvenance includes handle when provided", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: {
          did: "did:plc:abc123",
          text: "test",
          handle: "expert.bsky.social"
        },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.socialProvenance?.did).toBe("did:plc:abc123");
      expect(result.socialProvenance?.handle).toBe("expert.bsky.social");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("link-domain outranks post-text-mention", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "CAISO data looks interesting" },
        links: [
          {
            url: "https://ercot.com/data",
            domain: "ercot.com",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });
      // ERCOT has link-domain (rank 4), CAISO has post-text-mention (rank 7)
      // ERCOT wins because it has the stronger signal
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("assembles contentSource from link card", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "ERCOT report" },
        links: [],
        linkCards: [
          {
            source: "embed" as const,
            uri: "https://gridstatus.io/live/ercot",
            title: "ERCOT Dashboard",
            description: null,
            thumb: null
          }
        ],
        vision: null
      });
      expect(result.contentSource?.domain).toBe("gridstatus.io");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("embed-link-domain matches provider", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Check this report" },
        links: [],
        linkCards: [
          {
            source: "embed" as const,
            uri: "https://www.eia.gov/petroleum/supply/monthly/",
            title: "EIA Monthly",
            description: null,
            thumb: null
          }
        ],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("eia");
      expect(result.providerMatches[0]?.signals[0]?.signal).toBe(
        "embed-link-domain"
      );
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("non-provider domain does not match (gridstatus.io)", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: { did: "did:plc:test", text: "Nice dashboard" },
        links: [
          {
            url: "https://gridstatus.io/live",
            domain: "gridstatus.io",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });
      // gridstatus.io is NOT in provider registry
      expect(result.selectedProvider).toBeNull();
      // But contentSource should still be populated
      expect(result.contentSource?.domain).toBe("gridstatus.io");
    }).pipe(Effect.provide(TestLayer))
  );

  it.effect("long alias match works (full organization name)", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const result = yield* matcher.match({
        post: {
          did: "did:plc:test",
          text: "The Electric Reliability Council of Texas reported record demand"
        },
        links: [],
        linkCards: [],
        vision: null
      });
      expect(result.resolution).toBe("matched");
      expect(result.selectedProvider?.providerId).toBe("ercot");
    }).pipe(Effect.provide(TestLayer))
  );
});
