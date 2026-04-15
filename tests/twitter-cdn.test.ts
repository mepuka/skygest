import { describe, expect, it } from "@effect/vitest";
import { parseTwitterMediaUrl } from "../src/twitter/TwitterCdn";

describe("parseTwitterMediaUrl", () => {
  it("parses a media id from extensionless Twitter image URLs", () => {
    expect(
      parseTwitterMediaUrl(
        "https://pbs.twimg.com/media/GT2AbCdWgAAefgh?format=jpg&name=large"
      )
    ).toEqual({
      mediaId: "GT2AbCdWgAAefgh"
    });
  });

  it("parses a media id from Twitter image URLs with a file extension", () => {
    expect(
      parseTwitterMediaUrl("https://pbs.twimg.com/media/GT2AbCdWgAAefgh.jpg")
    ).toEqual({
      mediaId: "GT2AbCdWgAAefgh"
    });
  });

  it("returns null for non-twitter hosts", () => {
    expect(
      parseTwitterMediaUrl("https://example.com/media/GT2AbCdWgAAefgh.jpg")
    ).toBeNull();
  });
});
