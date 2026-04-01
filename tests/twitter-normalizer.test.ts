import { describe, expect, it } from "@effect/vitest";
import {
  normalizeTweet,
  normalizeTweetDetail,
  normalizeProfile
} from "../src/ops/TwitterNormalizer";
import type {
  ScraperTweet,
  ScraperTweetDetailNode,
  ScraperProfile
} from "../src/ops/TwitterNormalizer";

const baseTweet: ScraperTweet = {
  id: "123456789",
  userId: "user42",
  username: "alice",
  name: "Alice",
  text: "Solar is booming",
  timestamp: 1700000000, // seconds
  hashtags: [],
  urls: [],
  photos: [],
  videos: [],
  likes: 10,
  retweets: 3,
  replies: 1,
  isQuoted: false,
  isRetweet: false,
  isReply: false
};

describe("normalizeTweet", () => {
  it("produces correct URI, DID, and createdAt from a text-only tweet", () => {
    const result = normalizeTweet(baseTweet);
    expect(result).not.toBeNull();
    expect(result!.uri).toBe("x://user42/status/123456789");
    expect(result!.did).toBe("did:x:user42");
    expect(result!.text).toBe("Solar is booming");
    expect(result!.links).toHaveLength(0);
  });

  it("converts timestamp from seconds to milliseconds", () => {
    const result = normalizeTweet(baseTweet);
    expect(result!.createdAt).toBe(1700000000000);
  });

  it("returns null when userId is missing", () => {
    const { userId: _, ...rest } = baseTweet;
    const tweet: ScraperTweet = rest;
    expect(normalizeTweet(tweet)).toBeNull();
  });

  it("maps photos to an img embed", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      photos: [
        { id: "p1", url: "https://pbs.twimg.com/media/abc.jpg", altText: "solar panel" }
      ]
    };
    const result = normalizeTweet(tweet);
    expect(result!.embedType).toBe("img");
    expect(result!.embedPayload).toEqual({
      kind: "img",
      images: [
        {
          thumb: "https://pbs.twimg.com/media/abc.jpg",
          fullsize: "https://pbs.twimg.com/media/abc.jpg",
          alt: "solar panel"
        }
      ]
    });
  });

  it("maps photos without altText to null alt", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      photos: [{ id: "p1", url: "https://example.com/img.png" }]
    };
    const result = normalizeTweet(tweet);
    expect(result!.embedPayload).toEqual({
      kind: "img",
      images: [
        {
          thumb: "https://example.com/img.png",
          fullsize: "https://example.com/img.png",
          alt: null
        }
      ]
    });
  });

  it("maps videos to a video embed", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      videos: [
        { id: "v1", preview: "https://pbs.twimg.com/thumb.jpg", url: "https://video.twimg.com/v.mp4" }
      ]
    };
    const result = normalizeTweet(tweet);
    expect(result!.embedType).toBe("video");
    expect(result!.embedPayload).toEqual({
      kind: "video",
      playlist: "https://video.twimg.com/v.mp4",
      thumbnail: "https://pbs.twimg.com/thumb.jpg",
      alt: null
    });
  });

  it("maps video without url to null playlist", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      videos: [{ id: "v1", preview: "https://pbs.twimg.com/thumb.jpg" }]
    };
    const result = normalizeTweet(tweet);
    expect(result!.embedPayload).toEqual({
      kind: "video",
      playlist: null,
      thumbnail: "https://pbs.twimg.com/thumb.jpg",
      alt: null
    });
  });

  it("extracts links with domains from URLs", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      urls: [
        "https://reuters.com/article/energy",
        "https://www.nytimes.com/solar"
      ]
    };
    const result = normalizeTweet(tweet);
    expect(result!.links).toEqual([
      { url: "https://reuters.com/article/energy", domain: "reuters.com" },
      { url: "https://www.nytimes.com/solar", domain: "www.nytimes.com" }
    ]);
  });

  it("handles malformed URLs gracefully (no domain)", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      urls: ["not-a-url"]
    };
    const result = normalizeTweet(tweet);
    expect(result!.links).toEqual([{ url: "not-a-url" }]);
  });

  it("prefers photos over videos when both exist", () => {
    const tweet: ScraperTweet = {
      ...baseTweet,
      photos: [{ id: "p1", url: "https://example.com/img.png" }],
      videos: [{ id: "v1", preview: "https://example.com/thumb.jpg" }]
    };
    const result = normalizeTweet(tweet);
    expect(result!.embedType).toBe("img");
  });

  it("uses empty string for missing text", () => {
    const { text: _, ...rest } = baseTweet;
    const tweet: ScraperTweet = rest;
    const result = normalizeTweet(tweet);
    expect(result!.text).toBe("");
  });
});

describe("normalizeTweetDetail", () => {
  it("normalizes a detail node the same as a timeline tweet", () => {
    const node: ScraperTweetDetailNode = {
      ...baseTweet,
      resolution: "full",
      versions: [],
      isEdited: false
    };
    const result = normalizeTweetDetail(node);
    expect(result).not.toBeNull();
    expect(result!.uri).toBe("x://user42/status/123456789");
    expect(result!.did).toBe("did:x:user42");
    expect(result!.createdAt).toBe(1700000000000);
  });

  it("returns null when userId is missing", () => {
    const { userId: _, ...rest } = baseTweet;
    const node: ScraperTweetDetailNode = {
      ...rest,
      resolution: "full",
      versions: [],
      isEdited: false
    };
    expect(normalizeTweetDetail(node)).toBeNull();
  });
});

describe("normalizeProfile", () => {
  const baseProfile: ScraperProfile = {
    userId: "user42",
    username: "alice",
    name: "Alice Energy",
    avatar: "https://pbs.twimg.com/avatar.jpg",
    biography: "Energy researcher",
    followersCount: 5000
  };

  it("produces correct DID and handle", () => {
    const result = normalizeProfile(baseProfile, "energy-focused");
    expect(result).not.toBeNull();
    expect(result!.did).toBe("did:x:user42");
    expect(result!.handle).toBe("alice");
    expect(result!.tier).toBe("energy-focused");
    expect(result!.source).toBe("twitter-import");
    expect(result!.domain).toBe("energy");
  });

  it("includes displayName and avatar when provided", () => {
    const result = normalizeProfile(baseProfile, "independent");
    expect(result!.displayName).toBe("Alice Energy");
    expect(result!.avatar).toBe("https://pbs.twimg.com/avatar.jpg");
  });

  it("omits displayName and avatar when not provided", () => {
    const profile: ScraperProfile = {
      userId: "user42",
      username: "alice"
    };
    const result = normalizeProfile(profile, "general-outlet");
    expect(result!.displayName).toBeUndefined();
    expect(result!.avatar).toBeUndefined();
  });

  it("returns null when userId is missing", () => {
    const profile: ScraperProfile = { username: "alice" };
    expect(normalizeProfile(profile, "energy-focused")).toBeNull();
  });

  it("falls back to userId as handle when username is missing", () => {
    const profile: ScraperProfile = { userId: "user42" };
    const result = normalizeProfile(profile, "independent");
    expect(result!.handle).toBe("user42");
  });
});
