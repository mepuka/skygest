import { describe, expect, it } from "@effect/vitest";
import {
  hasLinkCardSignal,
  hasQuoteSignal,
  hasSourceSignals,
  hasVisualEmbedPayload,
  inferPrimaryEnrichmentType
} from "../src/enrichment/EmbedSignals";

describe("EmbedSignals", () => {
  it("detects visual, link, and quote signals across direct and media embeds", () => {
    const imageEmbed = {
      kind: "img" as const,
      images: [{
        alt: "Chart",
        fullsize: "https://example.com/chart.jpg",
        mediaId: null,
        thumb: "https://example.com/chart-thumb.jpg"
      }]
    };
    const mediaLinkEmbed = {
      kind: "media" as const,
      record: null,
      media: {
        kind: "link" as const,
        uri: "https://example.com/story",
        title: "Story",
        description: null,
        thumb: null
      }
    };
    const mediaQuoteEmbed = {
      kind: "media" as const,
      record: {
        uri: "at://did:plc:quoted/app.bsky.feed.post/post-1",
        text: "quoted context",
        author: "quoted-author"
      },
      media: null
    };

    expect(hasVisualEmbedPayload(imageEmbed)).toBe(true);
    expect(hasLinkCardSignal(mediaLinkEmbed)).toBe(true);
    expect(hasQuoteSignal(mediaQuoteEmbed)).toBe(true);
    expect(hasVisualEmbedPayload(mediaLinkEmbed)).toBe(false);
  });

  it("uses stored links and existing enrichments as source-signal fallbacks", () => {
    expect(inferPrimaryEnrichmentType(null)).toBe("source-attribution");
    expect(inferPrimaryEnrichmentType({
      kind: "video",
      playlist: "https://example.com/video.m3u8",
      thumbnail: null,
      alt: null
    })).toBe("vision");

    expect(hasSourceSignals({
      embedPayload: null,
      hasStoredLinks: true,
      hasExistingEnrichments: false
    })).toBe(true);

    expect(hasSourceSignals({
      embedPayload: null,
      hasStoredLinks: false,
      hasExistingEnrichments: true
    })).toBe(true);

    expect(hasSourceSignals({
      embedPayload: null,
      hasStoredLinks: false,
      hasExistingEnrichments: false
    })).toBe(false);
  });
});
