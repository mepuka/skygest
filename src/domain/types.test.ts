import { describe, it, expect } from "bun:test";
import { Schema } from "effect";
import { RawEvent } from "./types";

describe("RawEvent", () => {
  it("decodes commit event", () => {
    const value = Schema.decodeSync(RawEvent)({
      kind: "commit",
      operation: "create",
      collection: "app.bsky.feed.post",
      did: "did:plc:1",
      uri: "at://did:plc:1/app.bsky.feed.post/1",
      cid: "cid",
      record: { text: "hello" },
      timeUs: 123
    });

    expect(value.uri).toBe("at://did:plc:1/app.bsky.feed.post/1");
  });
});
