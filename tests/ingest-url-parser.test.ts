import { describe, expect, it } from "@effect/vitest";
import { Option } from "effect";
import { parsePostUrl } from "../src/domain/ingestUrl";

describe("parsePostUrl", () => {
  it("parses bsky.app URL", () => {
    const result = Option.getOrThrow(parsePostUrl("https://bsky.app/profile/simonevans.bsky.social/post/3abc123"));
    expect(result.platform).toBe("bluesky");
    expect(result.handle).toBe("simonevans.bsky.social");
    expect(result.id).toBe("3abc123");
  });

  it("parses x.com URL", () => {
    const result = Option.getOrThrow(parsePostUrl("https://x.com/DrSimEvans/status/123456789"));
    expect(result.platform).toBe("twitter");
    expect(result.handle).toBe("DrSimEvans");
    expect(result.id).toBe("123456789");
  });

  it("parses twitter.com URL", () => {
    const result = Option.getOrThrow(parsePostUrl("https://twitter.com/DrSimEvans/status/123456789"));
    expect(result.platform).toBe("twitter");
    expect(result.handle).toBe("DrSimEvans");
    expect(result.id).toBe("123456789");
  });

  it("returns None for unsupported URL", () => {
    expect(Option.isNone(parsePostUrl("https://mastodon.social/@user/123"))).toBe(true);
  });

  it("returns None for malformed input", () => {
    expect(Option.isNone(parsePostUrl("not-a-url"))).toBe(true);
  });

  it("parses x.com URL with query parameters", () => {
    const result = Option.getOrThrow(parsePostUrl("https://x.com/DrSimEvans/status/123456789?s=20&t=abc"));
    expect(result.platform).toBe("twitter");
    expect(result.handle).toBe("DrSimEvans");
    expect(result.id).toBe("123456789");
  });

  it("parses bsky.app URL with trailing slash", () => {
    const result = Option.getOrThrow(parsePostUrl("https://bsky.app/profile/test.bsky.social/post/3abc123/"));
    expect(result.platform).toBe("bluesky");
    expect(result.id).toBe("3abc123");
  });
});
