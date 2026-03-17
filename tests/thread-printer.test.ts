import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  filterReplies,
  printThread,
  type PrinterConfig,
  type ThreadDocument
} from "../src/bluesky/ThreadPrinter";
import { GetThreadDocumentInput, ThreadDocumentOutput } from "../src/domain/bi";
import type { FlattenedPost, FlattenedThread } from "../src/bluesky/ThreadFlatten";

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
    // Closure restores r2 (parent of r2-1)
    // Re-sorted by dfsIndex: r1 (0), r2 (1), r2-1 (2)
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2", "r2-1"]);
  });

  it("applies filters in order: depth → engagement → topN → closure", () => {
    // maxDepth 2 removes r2-1-1 (depth 3)
    // minLikes 10 removes r3 (2 likes)
    // topN 2 keeps r1 (50) and r2-1 (30)
    // closure restores r2 (parent of r2-1, was not in topN)
    const { filtered } = filterReplies(replies, { maxDepth: 2, minLikes: 10, topN: 2 });
    expect(filtered.map(r => r.post.uri)).toEqual(["r1", "r2", "r2-1"]);
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

  it("closure after topN restores parents removed by topN", () => {
    const { filtered } = filterReplies(replies, { topN: 2 });
    const uris = filtered.map(r => r.post.uri);
    expect(uris).toContain("r1");
    expect(uris).toContain("r2-1");
    expect(uris).toContain("r2");  // restored by closure
    expect(uris.indexOf("r2")).toBeLessThan(uris.indexOf("r2-1"));
  });

  it("closure does not restore replies at depth 0 (focus boundary)", () => {
    const { filtered } = filterReplies(replies, { topN: 1 });
    // top-1 = r1 (50 likes, depth 1, parentUri: focus)
    // r1's parent is focus — should NOT be added to reply list
    expect(filtered.map(r => r.post.uri)).toEqual(["r1"]);
  });
});

// ---------------------------------------------------------------------------
// printThread tests
// ---------------------------------------------------------------------------

/** Helper: build a minimal FlattenedPost suitable as a focus or ancestor */
const makeFocus = (uri: string, handle: string, text: string, opts?: {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  embed?: any;
}): FlattenedPost => ({
  post: {
    uri,
    cid: `cid-${uri}`,
    author: { did: `did:plc:${uri}`, handle, displayName: handle },
    record: { text, createdAt: "2026-03-15T00:00:00Z", $type: "app.bsky.feed.post" },
    indexedAt: "2026-03-15T00:01:00Z",
    likeCount: opts?.likeCount ?? 0,
    repostCount: opts?.repostCount ?? 0,
    replyCount: opts?.replyCount ?? 0,
    ...(opts?.embed ? { embed: opts.embed } : {})
  } as any,
  depth: 0,
  parentUri: null,
  dfsIndex: 0
});

describe("printThread", () => {
  it("renders a focus-only thread", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Hello world");
    const thread: FlattenedThread = { ancestors: [], focus, replies: [] };
    const doc = printThread(thread);

    expect(doc.postCount).toBe(1);
    expect(doc.replyCount).toBe(0);
    expect(doc.body).toContain("@alice.bsky.social");
    expect(doc.body).toContain("[1/1]");
    expect(doc.body).toContain("Hello world");
  });

  it("renders ancestors and focus as numbered posts", () => {
    const ancestor = makeFocus("a1", "alice.bsky.social", "Thread start");
    const focus = makeFocus("f1", "alice.bsky.social", "Thread continuation");
    // Ancestors have negative depth
    const ancestorPost: FlattenedPost = { ...ancestor, depth: -1, parentUri: null };
    const thread: FlattenedThread = { ancestors: [ancestorPost], focus, replies: [] };
    const doc = printThread(thread);

    expect(doc.postCount).toBe(2);
    expect(doc.body).toContain("[1/2]");
    expect(doc.body).toContain("[2/2]");
  });

  it("renders filtered replies with engagement", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Main post");
    const reply1 = makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 42, parentUri: "f1" });
    // Give reply1 a handle for display
    (reply1.post.author as any).handle = "bob.bsky.social";
    const reply2 = makeReply("r2", { depth: 1, dfsIndex: 1, likeCount: 5, parentUri: "f1" });
    (reply2.post.author as any).handle = "carol.bsky.social";

    const thread: FlattenedThread = { ancestors: [], focus, replies: [reply1, reply2] };
    const doc = printThread(thread, { topN: 1 });

    expect(doc.replyCount).toBe(1);
    expect(doc.totalReplies).toBe(2);
    expect(doc.body).toContain("filtered from 2");
    expect(doc.body).toContain("♡42");
  });

  it("renders discussion header without filter note when unfiltered", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Main post");
    const reply1 = makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 10, parentUri: "f1" });
    (reply1.post.author as any).handle = "bob.bsky.social";

    const thread: FlattenedThread = { ancestors: [], focus, replies: [reply1] };
    const doc = printThread(thread);

    expect(doc.body).toContain("Discussion (1 reply)");
    expect(doc.body).not.toContain("filtered from");
  });

  it("renders image embeds", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Check this chart", {
      embed: {
        $type: "app.bsky.embed.images#view",
        images: [
          { thumb: "https://img.example.com/thumb.jpg", fullsize: "https://img.example.com/full.jpg", alt: "Energy production chart" }
        ]
      }
    });
    const thread: FlattenedThread = { ancestors: [], focus, replies: [] };
    const doc = printThread(thread);

    expect(doc.body).toContain("\u{1F4CA}");
    expect(doc.body).toContain("Energy production chart");
  });

  it("renders link embeds", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Read this article", {
      embed: {
        $type: "app.bsky.embed.external#view",
        external: {
          uri: "https://example.com/article",
          title: "Important Energy Report"
        }
      }
    });
    const thread: FlattenedThread = { ancestors: [], focus, replies: [] };
    const doc = printThread(thread);

    expect(doc.body).toContain("\u{1F517}");
    expect(doc.body).toContain("Important Energy Report");
  });

  it("returns a title with handle and date", () => {
    const focus = makeFocus("f1", "alice.bsky.social", "Some interesting post about energy policy");
    const thread: FlattenedThread = { ancestors: [], focus, replies: [] };
    const doc = printThread(thread);

    expect(doc.title).toContain("@alice.bsky.social");
    expect(doc.title).toContain("2026-03-15");
  });

  it("indents nested replies by depth", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "alice.bsky.social", "Main post"),
      replies: [
        makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 10, parentUri: "focus-1" }),
        makeReply("r1-1", { depth: 2, dfsIndex: 1, likeCount: 5, parentUri: "r1" })
      ]
    };
    const doc = printThread(thread);
    const lines = doc.body.split("\n");

    // Find lines containing the reply handles
    const r1Line = lines.find(l => l.includes("did:plc:r1") && !l.includes("r1-1"));
    const r1_1Line = lines.find(l => l.includes("did:plc:r1-1"));

    expect(r1Line).toBeDefined();
    expect(r1_1Line).toBeDefined();
    // depth-1 reply should not be indented
    expect(r1Line!.match(/^\s*/)?.[0].length).toBe(0);
    // depth-2 reply should be indented (2 spaces)
    expect(r1_1Line!.match(/^\s*/)?.[0].length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Schema decode tests
// ---------------------------------------------------------------------------

describe("ThreadDocument schemas", () => {
  it("decodes valid GetThreadDocumentInput", () => {
    const input = Schema.decodeUnknownSync(GetThreadDocumentInput)({
      postUri: "at://did:plc:abc/app.bsky.feed.post/123",
      depth: 3,
      topN: 5,
      minLikes: 2
    });
    expect(input.postUri).toBe("at://did:plc:abc/app.bsky.feed.post/123");
    expect(input.topN).toBe(5);
  });

  it("rejects topN out of range", () => {
    expect(() => Schema.decodeUnknownSync(GetThreadDocumentInput)({
      postUri: "at://did:plc:abc/app.bsky.feed.post/123",
      topN: 100
    })).toThrow();
  });

  it("decodes valid ThreadDocumentOutput", () => {
    const output = Schema.decodeUnknownSync(ThreadDocumentOutput)({
      title: "Test thread",
      postCount: 5,
      replyCount: 3,
      totalReplies: 10,
      body: "document body"
    });
    expect(output.title).toBe("Test thread");
  });
});
