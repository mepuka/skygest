import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { AtUri, Did } from "./types";

describe("domain types", () => {
  it("brands did and at uri", () => {
    expect(String(Schema.decodeSync(Did)("did:plc:abc")))
      .toBe("did:plc:abc");
    expect(String(Schema.decodeSync(AtUri)("at://did:plc:abc/app.bsky.feed.post/123")))
      .toBe("at://did:plc:abc/app.bsky.feed.post/123");
  });
});
