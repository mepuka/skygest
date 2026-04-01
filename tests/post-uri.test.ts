import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { AtUri, PostUri, atUriToPostUri, platformFromUri } from "../src/domain/types";

describe("PostUri", () => {
  it("accepts at:// URIs", () => {
    const uri = Schema.decodeUnknownSync(PostUri)(
      "at://did:plc:abc/app.bsky.feed.post/123"
    );
    expect(uri).toBe("at://did:plc:abc/app.bsky.feed.post/123");
  });

  it("accepts x:// URIs", () => {
    const uri = Schema.decodeUnknownSync(PostUri)(
      "x://44196397/status/1899477362348818662"
    );
    expect(uri).toBe("x://44196397/status/1899477362348818662");
  });

  it("rejects http:// URIs", () => {
    expect(() =>
      Schema.decodeUnknownSync(PostUri)("http://example.com")
    ).toThrow();
  });
});

describe("AtUri still rejects x://", () => {
  it("rejects x:// URIs", () => {
    expect(() =>
      Schema.decodeUnknownSync(AtUri)(
        "x://44196397/status/1899477362348818662"
      )
    ).toThrow();
  });
});

describe("atUriToPostUri", () => {
  it("widens AtUri to PostUri", () => {
    const atUri = Schema.decodeUnknownSync(AtUri)(
      "at://did:plc:abc/app.bsky.feed.post/123"
    );
    const postUri: PostUri = atUriToPostUri(atUri);
    expect(postUri).toBe("at://did:plc:abc/app.bsky.feed.post/123");
    expect(platformFromUri(postUri)).toBe("bluesky");
  });
});

describe("platformFromUri", () => {
  it("returns bluesky for at:// URIs", () => {
    const uri = Schema.decodeUnknownSync(PostUri)(
      "at://did:plc:abc/app.bsky.feed.post/123"
    );
    expect(platformFromUri(uri)).toBe("bluesky");
  });

  it("returns twitter for x:// URIs", () => {
    const uri = Schema.decodeUnknownSync(PostUri)(
      "x://44196397/status/1899477362348818662"
    );
    expect(platformFromUri(uri)).toBe("twitter");
  });
});
