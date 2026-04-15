import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  extractBlobCid,
  feedThumbnailUrl,
  parseAvatarUrl,
  parseFeedImageUrl
} from "../src/bluesky/BskyCdn";
import { Did, HttpsUrl } from "../src/domain/types";

const decodeDid = Schema.decodeUnknownSync(Did);

describe("BskyCdn helpers", () => {
  describe("parseAvatarUrl", () => {
    it("returns branded HttpsUrl for valid HTTPS avatar URL", () => {
      const result = parseAvatarUrl("https://cdn.bsky.app/img/avatar/plain/did:plc:abc/cid@jpeg");
      expect(result).not.toBeNull();
      expect(typeof result).toBe("string");
      expect(result).toBe("https://cdn.bsky.app/img/avatar/plain/did:plc:abc/cid@jpeg");
    });

    it("returns null for HTTP (non-HTTPS) URL", () => {
      expect(parseAvatarUrl("http://cdn.bsky.app/img/avatar/plain/did:plc:abc/cid@jpeg")).toBeNull();
    });

    it("returns null for invalid URL", () => {
      expect(parseAvatarUrl("not-a-url")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseAvatarUrl("")).toBeNull();
    });
  });

  describe("feedThumbnailUrl", () => {
    it("builds a valid HTTPS thumbnail URL from DID and blob CID", () => {
      const did = decodeDid("did:plc:test123");
      const result = feedThumbnailUrl(did, "bafkrei-example-cid");
      expect(result).toBe("https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:test123/bafkrei-example-cid@jpeg");
    });

    it("result is a branded HttpsUrl", () => {
      const did = decodeDid("did:plc:test123");
      const result = feedThumbnailUrl(did, "bafkrei-cid");
      const decoded = Schema.decodeUnknownSync(HttpsUrl)(result);
      expect(decoded).toBe(result);
    });
  });

  describe("parseFeedImageUrl", () => {
    it("parses Bluesky fullsize feed image URLs", () => {
      expect(
        parseFeedImageUrl(
          "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkrei123@jpeg"
        )
      ).toEqual({
        did: decodeDid("did:plc:abc"),
        blobCid: "bafkrei123"
      });
    });

    it("parses Bluesky thumbnail feed image URLs", () => {
      expect(
        parseFeedImageUrl(
          "https://cdn.bsky.app/img/feed_thumbnail/plain/did:web:example.com/bafkrei456@jpeg"
        )
      ).toEqual({
        did: decodeDid("did:web:example.com"),
        blobCid: "bafkrei456"
      });
    });

    it("parses stored feed image URLs without a trailing format suffix", () => {
      expect(
        parseFeedImageUrl(
          "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkrei789"
        )
      ).toEqual({
        did: decodeDid("did:plc:abc"),
        blobCid: "bafkrei789"
      });
    });

    it("rejects non-feed Bluesky CDN URLs", () => {
      expect(
        parseFeedImageUrl(
          "https://cdn.bsky.app/img/avatar/plain/did:plc:abc/bafkrei123@jpeg"
        )
      ).toBeNull();
    });

    it("rejects non-https URLs", () => {
      expect(
        parseFeedImageUrl(
          "http://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkrei123@jpeg"
        )
      ).toBeNull();
    });
  });

  describe("extractBlobCid", () => {
    it("extracts CID from nested ref.$link structure", () => {
      const thumb = {
        $type: "blob",
        ref: { $link: "bafkrei-abc123" },
        mimeType: "image/jpeg",
        size: 12345
      };
      expect(extractBlobCid(thumb)).toBe("bafkrei-abc123");
    });

    it("extracts CID from flat $link structure", () => {
      const thumb = { $link: "bafkrei-flat-cid" };
      expect(extractBlobCid(thumb)).toBe("bafkrei-flat-cid");
    });

    it("returns null for null input", () => {
      expect(extractBlobCid(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(extractBlobCid(undefined)).toBeNull();
    });

    it("returns null for non-object input", () => {
      expect(extractBlobCid("string")).toBeNull();
    });

    it("returns null for object without ref or $link", () => {
      expect(extractBlobCid({ foo: "bar" })).toBeNull();
    });

    it("returns null for empty $link", () => {
      expect(extractBlobCid({ $link: "" })).toBeNull();
    });
  });
});
