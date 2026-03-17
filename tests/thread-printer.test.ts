import { describe, expect, it } from "@effect/vitest";
import {
  filterReplies,
  type PrinterConfig
} from "../src/bluesky/ThreadPrinter";
import type { FlattenedPost } from "../src/bluesky/ThreadFlatten";

/** Helper: build a minimal FlattenedPost for filter testing */
const makeReply = (uri: string, opts: {
  depth?: number;
  parentUri?: string | null;
  dfsIndex?: number;
  likeCount?: number;
}): FlattenedPost => ({
  post: {
    uri,
    cid: `cid-${uri}`,
    author: { did: `did:plc:${uri}` },
    record: { text: `text-${uri}` },
    indexedAt: "2025-03-15T00:00:00Z",
    likeCount: opts.likeCount ?? 5,
    repostCount: 0,
    replyCount: 0
  } as any,
  depth: opts.depth ?? 1,
  parentUri: opts.parentUri ?? "focus",
  dfsIndex: opts.dfsIndex ?? 0
});

describe("filterReplies", () => {
  const replies: ReadonlyArray<FlattenedPost> = [
    makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 50, parentUri: "focus" }),
    makeReply("r2", { depth: 1, dfsIndex: 1, likeCount: 10, parentUri: "focus" }),
    makeReply("r2-1", { depth: 2, dfsIndex: 2, likeCount: 30, parentUri: "r2" }),
    makeReply("r2-1-1", { depth: 3, dfsIndex: 3, likeCount: 5, parentUri: "r2-1" }),
    makeReply("r3", { depth: 1, dfsIndex: 4, likeCount: 2, parentUri: "focus" })
  ];

  it("returns all replies when config is empty", () => {
    const { filtered, total } = filterReplies(replies, {});
    expect(filtered).toHaveLength(5);
    expect(total).toBe(5);
  });

  it("caps depth", () => {
    const { filtered } = filterReplies(replies, { maxDepth: 1 });
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2", "r3"]);
  });

  it("filters by engagement threshold", () => {
    const { filtered } = filterReplies(replies, { minLikes: 10 });
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2", "r2-1"]);
  });

  it("takes top-N by engagement, preserves DFS order", () => {
    const { filtered } = filterReplies(replies, { topN: 2 });
    // Top 2 by likes: r1 (50), r2-1 (30)
    // Re-sorted by dfsIndex: r1 (0), r2-1 (2)
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2-1"]);
  });

  it("applies filters in order: depth → engagement → topN", () => {
    // maxDepth 2 removes r2-1-1 (depth 3)
    // minLikes 10 removes r3 (2 likes)
    // topN 2 keeps r1 (50) and r2-1 (30) from [r1, r2, r2-1]
    const { filtered } = filterReplies(replies, { maxDepth: 2, minLikes: 10, topN: 2 });
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2-1"]);
  });

  it("ensures structural closure — restores missing parent chain", () => {
    // minLikes: 25 removes r2 (10), r2-1-1 (5), r3 (2)
    // r2-1 (30 likes) survives, but its parent r2 (10 likes) was removed
    // closure should restore r2 so indentation makes sense
    const { filtered } = filterReplies(replies, { minLikes: 25 });
    const uris = filtered.map(r => r.post.uri);
    expect(uris).toContain("r2-1");
    expect(uris).toContain("r2");  // restored by closure
    expect(uris.indexOf("r2")).toBeLessThan(uris.indexOf("r2-1"));  // DFS order preserved
  });

  it("closure does not restore replies at depth 0 (focus boundary)", () => {
    const { filtered } = filterReplies(replies, { topN: 1 });
    // top-1 = r1 (50 likes, depth 1, parentUri: focus)
    // r1's parent is focus — should NOT be added to reply list
    expect(filtered.map(r => r.post.uri)).toEqual(["r1"]);
  });
});
