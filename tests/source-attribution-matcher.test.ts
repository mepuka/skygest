import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { vi } from "vitest";

vi.mock("../src/domain/enrichmentPlan", async () => {
  const { Schema } = await import("effect");

  return {
    EnrichmentPlannedLinkCardContext: Schema.Struct({
      source: Schema.Literal("embed", "media"),
      uri: Schema.String,
      title: Schema.NullOr(Schema.String),
      description: Schema.NullOr(Schema.String),
      thumb: Schema.NullOr(Schema.String)
    })
  };
});

import { SourceAttributionMatcher } from "../src/source/SourceAttributionMatcher";
import type {
  SourceAttributionMatcherInput,
  SourceAttributionMatchResult
} from "../src/domain/sourceMatching";
import { ProviderRegistry } from "../src/services/ProviderRegistry";

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
              assetKey: "chart-1",
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
        assetKey: "chart-1",
        sourceText: "Source: ERCOT"
      });
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
