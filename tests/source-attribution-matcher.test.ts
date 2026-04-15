import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { SourceAttributionMatcher } from "../src/source/SourceAttributionMatcher";
import type {
  SourceAttributionMatcherInput,
  SourceAttributionMatchResult
} from "../src/domain/sourceMatching";
import { ProviderRegistry } from "../src/services/ProviderRegistry";

const chartAssetKey =
  "https://id.skygest.io/post/bluesky/did.plc.test/matcher/chart/chart-1" as any;

const TestLayer = Layer.provideMerge(
  SourceAttributionMatcher.layer,
  ProviderRegistry.layer
);

const runMatch = (input: SourceAttributionMatcherInput) =>
  Effect.gen(function* () {
    const matcher = yield* SourceAttributionMatcher;
    return (yield* matcher.match(input)) as SourceAttributionMatchResult;
  }).pipe(Effect.provide(TestLayer));

describe("SourceAttributionMatcher", () => {
  it.effect("matches from link domains and returns ranked provider candidates", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: "expert.bsky.social",
          text: "Check this out"
        },
        links: [
          {
            url: "https://ercot.com/gridinfo",
            domain: "ercot.com",
            title: "ERCOT Grid Info",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("matched");
      expect(result.provider?.providerId).toBe("ercot");
      expect(result.providerCandidates).toHaveLength(1);
      expect(result.providerCandidates[0]?.providerId).toBe("ercot");
      expect(result.providerCandidates[0]?.bestRank).toBe(4);
      expect(result.providerCandidates[0]?.evidence[0]?.signal).toBe("link-domain");
      expect(result.contentSource?.domain).toBe("ercot.com");
      expect(result.socialProvenance?.handle).toBe("expert.bsky.social");
    })
  );

  it.effect("matches from post text when no stronger signal exists", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "ERCOT demand is near peak today"
        },
        links: [],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("matched");
      expect(result.provider?.providerId).toBe("ercot");
      expect(result.providerCandidates).toHaveLength(1);
      expect(result.providerCandidates[0]?.bestRank).toBe(7);
      expect(result.providerCandidates[0]?.evidence[0]?.signal).toBe(
        "post-text-mention"
      );
      expect(result.providerCandidates[0]?.evidence[0]).toMatchObject({
        matchedAlias: "ERCOT"
      });
    })
  );

  it.effect("returns ambiguous when multiple providers tie at the best rank", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Comparing ERCOT and CAISO load data"
        },
        links: [],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("ambiguous");
      expect(result.provider).toBeNull();
      expect(result.providerCandidates.map((candidate) => candidate.providerId)).toEqual([
        "caiso",
        "ercot"
      ]);
      expect(
        result.providerCandidates.every((candidate) => candidate.bestRank === 7)
      ).toBe(true);
    })
  );

  it.effect("returns unmatched when no provider signals are present", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Beautiful sunset today"
        },
        links: [],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.provider).toBeNull();
      expect(result.providerCandidates).toEqual([]);
      expect(result.contentSource).toBeNull();
      expect(result.socialProvenance).toEqual({
        did: "did:plc:test",
        handle: null
      });
    })
  );

  it.effect("keeps contentSource separate from provider for non-provider platform links", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: "gridwatch.bsky.social",
          text: "ERCOT dashboard looks interesting"
        },
        links: [],
        linkCards: [
          {
            source: "embed",
            uri: "https://gridstatus.io/live/ercot",
            title: "ERCOT Dashboard",
            description: null,
            thumb: null
          }
        ],
        vision: null
      });

      expect(result.resolution).toBe("matched");
      expect(result.provider?.providerId).toBe("ercot");
      expect(result.contentSource?.domain).toBe("gridstatus.io");
      expect(result.socialProvenance?.handle).toBe("gridwatch.bsky.social");
    })
  );

  it.effect("uses vision source-line evidence and canonical source family in v2 results", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "New adequacy update"
        },
        links: [],
        linkCards: [],
        vision: {
          assets: [
            {
              assetKey: chartAssetKey,
              analysis: {
                title: null,
                sourceLines: [
                  {
                    sourceText: "Source: ERCOT",
                    datasetName: "Monthly Outlook for Resource Adequacy (MORA)"
                  }
                ],
                visibleUrls: [],
                organizationMentions: [],
                logoText: []
              }
            }
          ]
        }
      });

      expect(result.resolution).toBe("matched");
      expect(result.provider).toEqual({
        providerId: "ercot",
        providerLabel: "ERCOT",
        sourceFamily: "Monthly Outlook for Resource Adequacy (MORA)"
      });
      expect(result.providerCandidates).toHaveLength(1);
      expect(result.providerCandidates[0]?.bestRank).toBe(1);
      expect(result.providerCandidates[0]?.sourceFamily).toBe(
        "Monthly Outlook for Resource Adequacy (MORA)"
      );
      expect(result.providerCandidates[0]?.evidence[0]).toMatchObject({
        signal: "source-line-alias",
        rank: 1,
        assetKey: chartAssetKey,
        sourceText: "Source: ERCOT"
      });
    })
  );

  it.effect("populates contentSource.publication for a known publication even when resolution is unmatched", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Interesting read on Carbon Brief"
        },
        links: [
          {
            url: "https://www.carbonbrief.org/analysis/some-article",
            domain: "carbonbrief.org",
            title: "Carbon Brief Analysis",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.provider).toBeNull();
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.domain).toBe("carbonbrief.org");
      expect(result.contentSource!.publication).toBe("carbonbrief.org");
    })
  );

  it.effect("populates contentSource.publication for curated follow-up publisher domains", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Interesting read"
        },
        links: [
          {
            url: "https://www.businessinsider.com/energy-grid-story-2026-03",
            domain: "businessinsider.com",
            title: "Energy grid story",
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.publication).toBe("businessinsider.com");
    })
  );

  it.effect("resolves brand shortener to publication label via matcher", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Reuters report on energy"
        },
        links: [
          {
            url: "https://reut.rs/4abc123",
            domain: "reut.rs",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.publication).toBe("Reuters");
    })
  );

  it.effect("resolves deeper seeded publication subdomains via matcher", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Interesting BBC article"
        },
        links: [
          {
            url: "https://news.bbc.co.uk/2/hi/science/nature/123456.stm",
            domain: "news.bbc.co.uk",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.publication).toBe("bbc.co.uk");
    })
  );

  it.effect("keeps utility hosts out of the publication field via matcher", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Paper DOI"
        },
        links: [
          {
            url: "https://doi.org/10.1126/science.1234567",
            domain: "doi.org",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.publication).toBeNull();
    })
  );

  it.effect("keeps repository and aggregator hosts out of the publication field via matcher", () =>
    Effect.gen(function* () {
      const result = yield* runMatch({
        post: {
          did: "did:plc:test" as any,
          handle: null,
          text: "Interesting paper"
        },
        links: [
          {
            url: "https://www.sciencedirect.com/science/article/pii/S1234567890123456",
            domain: "sciencedirect.com",
            title: null,
            description: null,
            imageUrl: null,
            extractedAt: 0
          }
        ],
        linkCards: [],
        vision: null
      });

      expect(result.resolution).toBe("unmatched");
      expect(result.contentSource).not.toBeNull();
      expect(result.contentSource!.publication).toBeNull();
    })
  );

  it.effect("fails with a schema decode error when post.handle uses the old missing-field shape", () =>
    Effect.gen(function* () {
      const matcher = yield* SourceAttributionMatcher;
      const error = yield* matcher.match({
        post: {
          did: "did:plc:test",
          text: "ERCOT report"
        },
        links: [],
        linkCards: [],
        vision: null
      } as any).pipe(Effect.flip);

      expect(error._tag).toBe("EnrichmentSchemaDecodeError");
      expect(error.operation).toBe("SourceAttributionMatcher.match");
    }).pipe(Effect.provide(TestLayer))
  );
});
