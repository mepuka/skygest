import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  ImportPostsInput,
  ImportPostsOutput,
  ImportExpertInput,
  ImportPostInput
} from "../src/domain/api";

const decodeImportPostsInput = Schema.decodeUnknownSync(ImportPostsInput);
const decodeImportPostsOutput = Schema.decodeUnknownSync(ImportPostsOutput);
const decodeImportExpertInput = Schema.decodeUnknownSync(ImportExpertInput);
const decodeImportPostInput = Schema.decodeUnknownSync(ImportPostInput);

const validExpert = {
  did: "did:plc:abc123",
  handle: "alice.bsky.social",
  domain: "energy",
  source: "twitter-import" as const,
  tier: "energy-focused" as const
};

const validPostAt = {
  uri: "at://did:plc:abc123/app.bsky.feed.post/rkey1",
  did: "did:plc:abc123",
  text: "Solar is booming",
  createdAt: 1700000000000,
  links: []
};

const validPostX = {
  uri: "x://user123/status/987654321",
  did: "did:x:user123",
  text: "Wind capacity surges in Q3",
  createdAt: 1700000000000,
  hashtags: ["windpower"],
  links: [{ url: "https://example.com/article", title: "Wind report" }]
};

describe("ImportPostsInput", () => {
  it("accepts valid payload with at:// post URIs", () => {
    const result = decodeImportPostsInput({
      experts: [validExpert],
      posts: [validPostAt]
    });
    expect(result.experts).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
  });

  it("accepts valid payload with x:// post URIs", () => {
    const result = decodeImportPostsInput({
      experts: [validExpert],
      posts: [validPostX]
    });
    const post = result.posts[0]!;
    expect(post.uri).toBe("x://user123/status/987654321");
    expect(post.links).toHaveLength(1);
    expect(post.links[0]!.title).toBe("Wind report");
  });

  it("accepts mixed at:// and x:// URIs in the same batch", () => {
    const result = decodeImportPostsInput({
      experts: [validExpert],
      posts: [validPostAt, validPostX]
    });
    expect(result.posts).toHaveLength(2);
  });

  it("rejects invalid URI schemes", () => {
    expect(() =>
      decodeImportPostsInput({
        experts: [],
        posts: [{ ...validPostAt, uri: "https://example.com/not-a-post" }]
      })
    ).toThrow();
  });

  it("rejects URIs without a scheme prefix", () => {
    expect(() =>
      decodeImportPostsInput({
        experts: [],
        posts: [{ ...validPostAt, uri: "no-scheme" }]
      })
    ).toThrow();
  });
});

describe("ImportExpertInput", () => {
  it("accepts did:plc: DIDs", () => {
    const result = decodeImportExpertInput(validExpert);
    expect(result.did).toBe("did:plc:abc123");
  });

  it("accepts did:x: DIDs (Twitter import)", () => {
    const result = decodeImportExpertInput({
      ...validExpert,
      did: "did:x:user456"
    });
    expect(result.did).toBe("did:x:user456");
  });

  it("rejects DIDs without did: prefix", () => {
    expect(() =>
      decodeImportExpertInput({ ...validExpert, did: "plc:abc123" })
    ).toThrow();
  });

  it("includes optional displayName when provided", () => {
    const result = decodeImportExpertInput({
      ...validExpert,
      displayName: "Alice Energy"
    });
    expect(result.displayName).toBe("Alice Energy");
  });

  it("includes optional avatar when provided", () => {
    const result = decodeImportExpertInput({
      ...validExpert,
      avatar: "https://pbs.twimg.com/profile/avatar.jpg"
    });
    expect(result.avatar).toBe("https://pbs.twimg.com/profile/avatar.jpg");
  });

  it("omits optional fields when not provided", () => {
    const result = decodeImportExpertInput(validExpert);
    expect(result.displayName).toBeUndefined();
    expect(result.avatar).toBeUndefined();
  });
});

describe("ImportPostInput", () => {
  it("accepts optional embedType and embedPayload", () => {
    const result = decodeImportPostInput({
      ...validPostAt,
      embedType: "link",
      embedPayload: {
        kind: "link",
        uri: "https://example.com",
        title: "Example",
        description: null,
        thumb: null
      }
    });
    expect(result.embedType).toBe("link");
    expect(result.embedPayload?.kind).toBe("link");
  });

  it("accepts null embedType and embedPayload", () => {
    const result = decodeImportPostInput({
      ...validPostAt,
      embedType: null,
      embedPayload: null
    });
    expect(result.embedType).toBeNull();
    expect(result.embedPayload).toBeNull();
  });

  it("omits embedType and embedPayload when not provided", () => {
    const result = decodeImportPostInput(validPostAt);
    expect(result.embedType).toBeUndefined();
    expect(result.embedPayload).toBeUndefined();
  });

  it("accepts optional hashtags when provided", () => {
    const result = decodeImportPostInput({
      ...validPostAt,
      hashtags: ["solarenergy", "grid"]
    });
    expect(result.hashtags).toEqual(["solarenergy", "grid"]);
  });

  it("accepts links with only url (other fields optional)", () => {
    const result = decodeImportPostInput({
      ...validPostAt,
      links: [{ url: "https://example.com" }]
    });
    expect(result.links[0]!.url).toBe("https://example.com");
    expect(result.links[0]!.title).toBeUndefined();
  });

  it("accepts links with all optional fields", () => {
    const result = decodeImportPostInput({
      ...validPostAt,
      links: [
        {
          url: "https://example.com/article",
          title: "Article",
          description: "A great read",
          domain: "example.com"
        }
      ]
    });
    const link = result.links[0]!;
    expect(link.title).toBe("Article");
    expect(link.description).toBe("A great read");
    expect(link.domain).toBe("example.com");
  });
});

describe("ImportPostsOutput", () => {
  it("decodes valid output", () => {
    const result = decodeImportPostsOutput({
      imported: 10,
      flagged: 2,
      skipped: 1
    });
    expect(result.imported).toBe(10);
    expect(result.flagged).toBe(2);
    expect(result.skipped).toBe(1);
  });
});
