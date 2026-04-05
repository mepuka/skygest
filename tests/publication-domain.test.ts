import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  PublicationListItem,
  PublicationRecord,
  PublicationSeed
} from "../src/domain/bi";

describe("publication identity schemas", () => {
  it("accepts a text publication seed with hostname identity", () => {
    const publication = Schema.decodeUnknownSync(PublicationSeed)({
      hostname: "reuters.com",
      tier: "general-outlet"
    });

    expect(publication).toEqual({
      medium: "text",
      hostname: "reuters.com",
      showSlug: null,
      feedUrl: null,
      appleId: null,
      spotifyId: null,
      tier: "general-outlet"
    });
  });

  it("accepts a podcast publication record with show slug identity", () => {
    const publication = Schema.decodeUnknownSync(PublicationRecord)({
      publicationId: "catalyst-with-shayle-kann",
      medium: "podcast",
      hostname: null,
      showSlug: "catalyst-with-shayle-kann",
      feedUrl: "https://example.com/catalyst.rss",
      appleId: "123456789",
      spotifyId: "show-abc",
      tier: "energy-focused",
      source: "seed",
      firstSeenAt: 1,
      lastSeenAt: 2
    });

    expect(publication.showSlug).toBe("catalyst-with-shayle-kann");
  });

  it("rejects text publications without hostnames", () => {
    expect(() =>
      Schema.decodeUnknownSync(PublicationSeed)({
        medium: "text",
        hostname: null,
        tier: "unknown"
      })
    ).toThrow();
  });

  it("rejects podcasts without show slugs", () => {
    expect(() =>
      Schema.decodeUnknownSync(PublicationListItem)({
        publicationId: "broken-podcast",
        medium: "podcast",
        hostname: null,
        showSlug: null,
        feedUrl: "https://example.com/broken.rss",
        appleId: null,
        spotifyId: null,
        tier: "unknown",
        source: "seed",
        postCount: 0,
        latestPostAt: null
      })
    ).toThrow();
  });

  it("rejects podcast metadata on text publications", () => {
    expect(() =>
      Schema.decodeUnknownSync(PublicationSeed)({
        medium: "text",
        hostname: "reuters.com",
        feedUrl: "https://example.com/not-allowed.rss",
        tier: "general-outlet"
      })
    ).toThrow();
  });
});
