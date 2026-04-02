import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { SearchPostsInput, GetRecentPostsInput, GetPostLinksInput, ListExpertsInput, GetPostThreadInput, GetThreadDocumentInput } from "../src/domain/bi";
import { ListEditorialPicksInput } from "../src/domain/editorial";
import { ListCurationCandidatesInput } from "../src/domain/curation";

const decodeSync = <S extends Schema.Decoder<unknown>>(schema: S) =>
  (input: unknown): S["Type"] => Schema.decodeUnknownSync(schema)(input);

describe("MCP input schemas accept string-encoded numbers", () => {
  it("SearchPostsInput accepts limit as string", () => {
    const result = decodeSync(SearchPostsInput)({ query: "solar", limit: "20" });
    expect(result.limit).toBe(20);
  });

  it("SearchPostsInput accepts since/until as strings", () => {
    const result = decodeSync(SearchPostsInput)({ query: "solar", since: "1774000000000", until: "1775000000000" });
    expect(result.since).toBe(1774000000000);
  });

  it("SearchPostsInput still accepts native numbers", () => {
    const result = decodeSync(SearchPostsInput)({ query: "solar", limit: 20 });
    expect(result.limit).toBe(20);
  });

  it("SearchPostsInput rejects non-finite numeric strings", () => {
    expect(() => decodeSync(SearchPostsInput)({ query: "solar", limit: "Infinity" })).toThrow();
    expect(() => decodeSync(SearchPostsInput)({ query: "solar", since: "NaN" })).toThrow();
  });

  it("GetRecentPostsInput accepts limit as string", () => {
    const result = decodeSync(GetRecentPostsInput)({ limit: "10" });
    expect(result.limit).toBe(10);
  });

  it("GetPostLinksInput accepts limit as string", () => {
    const result = decodeSync(GetPostLinksInput)({ limit: "50" });
    expect(result.limit).toBe(50);
  });

  it("ListExpertsInput accepts limit as string", () => {
    const result = decodeSync(ListExpertsInput)({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("ListEditorialPicksInput accepts limit, since, and minScore as strings", () => {
    const result = decodeSync(ListEditorialPicksInput)({ limit: "10", since: "1774000000000", minScore: "50" });
    expect(result.limit).toBe(10);
    expect(result.since).toBe(1774000000000);
    expect(result.minScore).toBe(50);
  });

  it("ListCurationCandidatesInput accepts limit, since, and minScore as strings", () => {
    const result = decodeSync(ListCurationCandidatesInput)({ limit: "20", since: "1774000000000", minScore: "75" });
    expect(result.limit).toBe(20);
    expect(result.since).toBe(1774000000000);
    expect(result.minScore).toBe(75);
  });

  it("GetPostThreadInput accepts depth and parentHeight as strings", () => {
    const result = decodeSync(GetPostThreadInput)({
      postUri: "at://did:plc:test/app.bsky.feed.post/abc",
      depth: "5",
      parentHeight: "3"
    });
    expect(result.depth).toBe(5);
    expect(result.parentHeight).toBe(3);
  });

  it("GetThreadDocumentInput accepts all numeric params as strings", () => {
    const result = decodeSync(GetThreadDocumentInput)({
      postUri: "at://did:plc:test/app.bsky.feed.post/abc",
      depth: "3",
      parentHeight: "2",
      maxDepth: "5",
      minLikes: "10",
      topN: "25"
    });
    expect(result.depth).toBe(3);
    expect(result.maxDepth).toBe(5);
    expect(result.topN).toBe(25);
  });
});
