import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { normalizeBlueskyThread } from "../src/ops/BlueskyNormalizer";

const threadFixture = {
  thread: {
    $type: "app.bsky.feed.defs#threadViewPost",
    post: {
      uri: "at://did:plc:abc123/app.bsky.feed.post/3xyz",
      cid: "bafyrei...",
      author: {
        did: "did:plc:abc123",
        handle: "simonevans.bsky.social",
        displayName: "Simon Evans",
        avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:abc123/abc@jpeg"
      },
      record: {
        $type: "app.bsky.feed.post",
        text: "UK grid carbon intensity hit a new low",
        createdAt: "2026-03-15T10:30:00.000Z",
        facets: [
          {
            features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://carbonintensity.org.uk" }],
            index: { byteStart: 0, byteEnd: 5 }
          },
          {
            features: [{ $type: "app.bsky.richtext.facet#tag", tag: "energy" }],
            index: { byteStart: 10, byteEnd: 17 }
          }
        ]
      },
      embed: {
        $type: "app.bsky.embed.external#view",
        external: { uri: "https://carbonintensity.org.uk", title: "Carbon Intensity", description: "..." }
      },
      indexedAt: "2026-03-15T10:30:05.000Z"
    }
  }
};

describe("normalizeBlueskyThread", () => {
  it("extracts post data from thread", () => {
    const result = Option.getOrThrow(normalizeBlueskyThread(threadFixture as any));
    expect(result.post.uri).toBe("at://did:plc:abc123/app.bsky.feed.post/3xyz");
    expect(result.post.did).toBe("did:plc:abc123");
    expect(result.post.text).toBe("UK grid carbon intensity hit a new low");
    expect(result.post.hashtags).toEqual(["energy"]);
    expect(result.post.links.length).toBeGreaterThanOrEqual(1);
    expect(result.post.links[0]!.url).toBe("https://carbonintensity.org.uk");
  });

  it("extracts expert data from author", () => {
    const result = Option.getOrThrow(normalizeBlueskyThread(threadFixture as any));
    expect(result.expert.did).toBe("did:plc:abc123");
    expect(result.expert.handle).toBe("simonevans.bsky.social");
    expect(result.expert.domain).toBe("energy");
    expect(result.expert.source).toBe("bluesky-import");
  });

  it("captures embed payload", () => {
    const result = Option.getOrThrow(normalizeBlueskyThread(threadFixture as any));
    expect(result.post.embedType).toBe("link");
    expect(result.post.embedPayload).toBeDefined();
    expect((result.post.embedPayload as any).kind).toBe("link");
  });

  it("returns None for missing focus post", () => {
    expect(Option.isNone(normalizeBlueskyThread({ thread: null } as any))).toBe(true);
  });
});
