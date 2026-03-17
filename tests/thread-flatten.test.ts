import { describe, expect, it } from "@effect/vitest";
import { flattenThread } from "../src/bluesky/ThreadFlatten";

// Helper to build a mock ThreadViewPost node
const makeNode = (uri: string, text: string, opts?: {
  parent?: unknown;
  replies?: unknown[];
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  embed?: { $type?: string };
}) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: {
    uri,
    cid: `cid-${uri}`,
    author: { did: `did:plc:${uri}`, handle: `user-${uri}.bsky.social` },
    record: { text, createdAt: "2025-03-15T00:00:00Z", $type: "app.bsky.feed.post" },
    indexedAt: "2025-03-15T00:01:00Z",
    likeCount: opts?.likeCount ?? 5,
    repostCount: opts?.repostCount ?? 2,
    replyCount: opts?.replyCount ?? 1,
    ...(opts?.embed ? { embed: opts.embed } : {})
  },
  parent: opts?.parent,
  replies: opts?.replies
});

describe("flattenThread", () => {
  it("returns null for invalid input", () => {
    expect(flattenThread(null)).toBeNull();
    expect(flattenThread({})).toBeNull();
    expect(flattenThread("not a thread")).toBeNull();
  });

  it("handles focus-only thread (no parents, no replies)", () => {
    const thread = makeNode("post-1", "Hello world");
    const result = flattenThread(thread);
    expect(result).not.toBeNull();
    expect(result!.focus.post.uri).toBe("post-1");
    expect(result!.focus.depth).toBe(0);
    expect(result!.focus.parentUri).toBeNull();
    expect(result!.ancestors).toHaveLength(0);
    expect(result!.replies).toHaveLength(0);
  });

  it("walks parent chain upward, oldest first", () => {
    const grandparent = makeNode("gp", "Grandparent post");
    const parent = makeNode("parent", "Parent post", { parent: grandparent });
    const focus = makeNode("focus", "Focus post", { parent });
    const result = flattenThread(focus);
    expect(result!.ancestors).toHaveLength(2);
    expect(result!.ancestors[0]!.post.uri).toBe("gp");    // oldest first
    expect(result!.ancestors[1]!.post.uri).toBe("parent");
    expect(result!.focus.post.uri).toBe("focus");
  });

  it("collects replies via DFS", () => {
    const reply1 = makeNode("r1", "Reply 1");
    const reply2 = makeNode("r2", "Reply 2");
    const nested = makeNode("r1-1", "Nested reply");
    const reply1WithNested = makeNode("r1", "Reply 1", { replies: [nested] });
    const focus = makeNode("focus", "Focus", { replies: [reply1WithNested, reply2] });
    const result = flattenThread(focus);
    expect(result!.replies.length).toBeGreaterThanOrEqual(2);
    const uris = result!.replies.map(r => r.post.uri);
    expect(uris).toContain("r1");
    expect(uris).toContain("r2");
    expect(uris).toContain("r1-1");
  });

  it("deduplicates on URI cycle", () => {
    // Create a cycle: focus -> parent -> focus (via parent chain)
    const focus = makeNode("focus", "Focus");
    // Manually set parent to reference focus URI
    const parent = makeNode("parent", "Parent", { parent: focus });
    const focusWithParent = makeNode("focus", "Focus", { parent });
    const result = flattenThread(focusWithParent);
    // Should not loop forever; parent appears once
    expect(result!.ancestors).toHaveLength(1);
    expect(result!.ancestors[0]!.post.uri).toBe("parent");
  });

  it("skips NotFoundPost nodes", () => {
    const notFound = { $type: "app.bsky.feed.defs#notFoundPost", uri: "nf", notFound: true };
    const focus = makeNode("focus", "Focus", { replies: [notFound] });
    const result = flattenThread(focus);
    expect(result!.replies).toHaveLength(0);
  });

  // --- New tests for depth, parentUri, engagement sorting ---

  it("assigns negative depths to ancestors", () => {
    const gp = makeNode("gp", "Grandparent");
    const parent = makeNode("parent", "Parent", { parent: gp });
    const focus = makeNode("focus", "Focus", { parent });
    const result = flattenThread(focus)!;

    expect(result.ancestors[0]!.depth).toBe(-2);
    expect(result.ancestors[1]!.depth).toBe(-1);
    expect(result.focus.depth).toBe(0);
  });

  it("assigns increasing depths to nested replies", () => {
    const deep = makeNode("deep", "Deep reply");
    const mid = makeNode("mid", "Mid reply", { replies: [deep] });
    const top = makeNode("top", "Top reply", { replies: [mid] });
    const focus = makeNode("focus", "Focus", { replies: [top] });
    const result = flattenThread(focus)!;

    expect(result.replies[0]!.depth).toBe(1);  // top
    expect(result.replies[1]!.depth).toBe(2);  // mid
    expect(result.replies[2]!.depth).toBe(3);  // deep
  });

  it("preserves parentUri chain", () => {
    const gp = makeNode("gp", "Grandparent");
    const parent = makeNode("parent", "Parent", { parent: gp });
    const child = makeNode("child", "Child reply");
    const reply = makeNode("reply", "Reply", { replies: [child] });
    const focus = makeNode("focus", "Focus", { parent, replies: [reply] });
    const result = flattenThread(focus)!;

    // Ancestors
    expect(result.ancestors[0]!.parentUri).toBeNull(); // gp has no parent
    expect(result.ancestors[1]!.parentUri).toBe("gp");

    // Focus
    expect(result.focus.parentUri).toBe("parent");

    // Replies
    expect(result.replies[0]!.parentUri).toBe("focus");
    expect(result.replies[1]!.parentUri).toBe("reply");
  });

  it("sorts siblings by engagement (likes DESC)", () => {
    const lowEngagement = makeNode("low", "Low", { likeCount: 1, repostCount: 0, replyCount: 0 });
    const highEngagement = makeNode("high", "High", { likeCount: 50, repostCount: 5, replyCount: 3 });
    const midEngagement = makeNode("mid", "Mid", { likeCount: 10, repostCount: 1, replyCount: 1 });
    // Put low first in array to verify sorting overrides input order
    const focus = makeNode("focus", "Focus", { replies: [lowEngagement, highEngagement, midEngagement] });
    const result = flattenThread(focus)!;

    expect(result.replies[0]!.post.uri).toBe("high");
    expect(result.replies[1]!.post.uri).toBe("mid");
    expect(result.replies[2]!.post.uri).toBe("low");
  });

  it("sorts nested children independently by engagement", () => {
    const child1 = makeNode("child-low", "Low child", { likeCount: 2 });
    const child2 = makeNode("child-high", "High child", { likeCount: 20 });
    const parent = makeNode("parent", "Parent", { likeCount: 5, replies: [child1, child2] });
    const focus = makeNode("focus", "Focus", { replies: [parent] });
    const result = flattenThread(focus)!;

    expect(result.replies[0]!.post.uri).toBe("parent");
    // children should be sorted: high before low
    expect(result.replies[1]!.post.uri).toBe("child-high");
    expect(result.replies[2]!.post.uri).toBe("child-low");
  });

  it("assigns sequential dfsIndex to replies", () => {
    const deep = makeNode("deep", "Deep reply");
    const mid = makeNode("mid", "Mid reply", { replies: [deep] });
    const top = makeNode("top", "Top reply", { replies: [mid] });
    const focus = makeNode("focus", "Focus", { replies: [top] });
    const result = flattenThread(focus)!;

    expect(result.replies[0]!.dfsIndex).toBe(0);  // top
    expect(result.replies[1]!.dfsIndex).toBe(1);  // mid
    expect(result.replies[2]!.dfsIndex).toBe(2);  // deep
  });

  it("assigns dfsIndex across engagement-sorted siblings", () => {
    const low = makeNode("low", "Low", { likeCount: 1 });
    const high = makeNode("high", "High", { likeCount: 50 });
    const focus = makeNode("focus", "Focus", { replies: [low, high] });
    const result = flattenThread(focus)!;

    // high sorted first (engagement), gets dfsIndex 0
    expect(result.replies[0]!.post.uri).toBe("high");
    expect(result.replies[0]!.dfsIndex).toBe(0);
    expect(result.replies[1]!.post.uri).toBe("low");
    expect(result.replies[1]!.dfsIndex).toBe(1);
  });

  it("assigns dfsIndex 0 to ancestors and focus", () => {
    const gp = makeNode("gp", "Grandparent");
    const parent = makeNode("parent", "Parent", { parent: gp });
    const focus = makeNode("focus", "Focus", { parent });
    const result = flattenThread(focus)!;

    expect(result.ancestors[0]!.dfsIndex).toBe(0);
    expect(result.ancestors[1]!.dfsIndex).toBe(0);
    expect(result.focus.dfsIndex).toBe(0);
  });

  it("preserves embed data on posts", () => {
    const reply = makeNode("reply", "Reply with link", {
      embed: { $type: "app.bsky.embed.external#view" }
    });
    const focus = makeNode("focus", "Focus", { replies: [reply] });
    const result = flattenThread(focus)!;

    expect(result.replies[0]!.post.embed?.$type).toBe("app.bsky.embed.external#view");
  });
});
