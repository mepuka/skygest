import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import type { KnowledgePost } from "../src/domain/bi";
import {
  ContentId,
  ContentItem,
  contentTypeFromContentId,
  isPodcastSegmentContentId,
  isPodcastSegmentContentItem,
  isPostContentId,
  isPostContentItem,
  podcastSegmentUriToContentId,
  postToContentItem,
  postUriToContentId
} from "../src/domain/content";
import {
  Did,
  PodcastSegmentUri,
  PostUri,
  podcastSegmentUriFromId
} from "../src/domain/types";

describe("ContentId", () => {
  it("accepts post uris", () => {
    const contentId = Schema.decodeUnknownSync(ContentId)(
      "at://did:plc:abc/app.bsky.feed.post/123"
    );

    expect(contentId).toBe("at://did:plc:abc/app.bsky.feed.post/123");
    expect(isPostContentId(contentId)).toBe(true);
    expect(contentTypeFromContentId(contentId)).toBe("post");
  });

  it("accepts x:// post uris", () => {
    const contentId = Schema.decodeUnknownSync(ContentId)(
      "x://44196397/status/1899477362348818662"
    );

    expect(contentId).toBe("x://44196397/status/1899477362348818662");
    expect(isPostContentId(contentId)).toBe(true);
    expect(contentTypeFromContentId(contentId)).toBe("post");
  });

  it("accepts podcast segment uris", () => {
    const segmentUri = Schema.decodeUnknownSync(PodcastSegmentUri)(
      "podcast-segment://catalyst-canary-media/2026-04-04/segment-3"
    );
    const contentId = podcastSegmentUriToContentId(segmentUri);

    expect(contentId).toBe("podcast-segment://catalyst-canary-media/2026-04-04/segment-3");
    expect(isPodcastSegmentContentId(contentId)).toBe(true);
    expect(contentTypeFromContentId(contentId)).toBe("podcast-segment");
  });

  it("rejects unsupported identifiers", () => {
    expect(() => Schema.decodeUnknownSync(ContentId)("https://example.com"))
      .toThrow();
  });

  it("rejects bare podcast prefixes and whitespace", () => {
    expect(() =>
      Schema.decodeUnknownSync(ContentId)("podcast-segment://")
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ContentId)(
        "podcast-segment://catalyst canary/episode-1/segment-1"
      )
    ).toThrow();
  });
});

describe("podcastSegmentUriFromId", () => {
  it.effect("builds a branded segment uri", () =>
    Effect.gen(function* () {
      const segmentUri = yield* podcastSegmentUriFromId(
      "catalyst-canary-media/2026-04-04/segment-3"
      );

      expect(segmentUri).toBe(
        "podcast-segment://catalyst-canary-media/2026-04-04/segment-3"
      );
    })
  );
});

describe("postToContentItem", () => {
  it("converts a knowledge post into the shared content shape", () => {
    const postUri = Schema.decodeUnknownSync(PostUri)(
      "at://did:plc:abc/app.bsky.feed.post/123"
    );
    const did = Schema.decodeUnknownSync(Did)("did:plc:expert");
    const post: Pick<KnowledgePost, "uri" | "did" | "text" | "createdAt"> = {
      uri: postUri,
      did,
      text: "Hydrogen storage costs are falling faster than forecast.",
      createdAt: 1_712_300_000_000
    };

    const contentItem = postToContentItem(post);

    expect(contentItem).toEqual({
      contentId: postUriToContentId(postUri),
      contentType: "post",
      authorDid: did,
      text: "Hydrogen storage costs are falling faster than forecast.",
      createdAt: 1_712_300_000_000
    });
    expect(isPostContentItem(contentItem)).toBe(true);
    expect(isPodcastSegmentContentItem(contentItem)).toBe(false);
    expect(Schema.decodeUnknownSync(ContentItem)(contentItem)).toEqual(contentItem);
  });
});
