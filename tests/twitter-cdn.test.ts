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

  it("parses a media id from png and webp Twitter image URLs", () => {
    expect(
      parseTwitterMediaUrl("https://pbs.twimg.com/media/GT2AbCdWgAAefgh.png")
    ).toEqual({
      mediaId: "GT2AbCdWgAAefgh"
    });
    expect(
      parseTwitterMediaUrl("https://pbs.twimg.com/media/GT2AbCdWgAAefgh.webp")
    ).toEqual({
      mediaId: "GT2AbCdWgAAefgh"
    });
  });

  it("parses a media id from Twitter image URLs with a colon size suffix", () => {
    expect(
      parseTwitterMediaUrl("https://pbs.twimg.com/media/GT2AbCdWgAAefgh.jpg:large")
    ).toEqual({
      mediaId: "GT2AbCdWgAAefgh"
    });
  });

  it("returns null for non-twitter hosts", () => {
    expect(
      parseTwitterMediaUrl("https://example.com/media/GT2AbCdWgAAefgh.jpg")
    ).toBeNull();
  });

  it("returns null for Twitter video URLs and video thumbnails", () => {
    expect(
      parseTwitterMediaUrl("https://video.twimg.com/amplify_video/1234567890/vid/avc1/1280x720/video.mp4")
    ).toBeNull();
    expect(
      parseTwitterMediaUrl("https://pbs.twimg.com/ext_tw_video_thumb/1234567890/pu/img/GT2AbCdWgAAefgh.jpg:large")
    ).toBeNull();
  });
});
