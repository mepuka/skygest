import { describe, expect, it } from "@effect/vitest";
import { extractPostLinkCards } from "../src/enrichment/PostContextSignals";

describe("extractPostLinkCards", () => {
  it("returns no link cards when the payload is null", () => {
    expect(extractPostLinkCards(null)).toEqual([]);
  });

  it("extracts the direct link-card payload", () => {
    expect(
      extractPostLinkCards({
        kind: "link",
        uri: "https://example.com/report",
        title: "Report",
        description: "Grid update",
        thumb: null
      })
    ).toEqual([
      {
        source: "embed",
        uri: "https://example.com/report",
        title: "Report",
        description: "Grid update",
        thumb: null
      }
    ]);
  });

  it("extracts a nested media link-card payload", () => {
    expect(
      extractPostLinkCards({
        kind: "media",
        record: null,
        media: {
          kind: "link",
          uri: "https://example.com/follow-up",
          title: "Follow-up",
          description: null,
          thumb: "https://example.com/thumb.png"
        }
      })
    ).toEqual([
      {
        source: "media",
        uri: "https://example.com/follow-up",
        title: "Follow-up",
        description: null,
        thumb: "https://example.com/thumb.png"
      }
    ]);
  });

  it("returns no link cards for media payloads without a nested link", () => {
    expect(
      extractPostLinkCards({
        kind: "media",
        record: null,
        media: {
          kind: "img",
          images: []
        }
      })
    ).toEqual([]);
  });

  it("returns no link cards for non-link embed kinds", () => {
    expect(
      extractPostLinkCards({
        kind: "quote",
        uri: null,
        text: "Quoted context",
        author: "author.bsky.social"
      })
    ).toEqual([]);
  });
});
