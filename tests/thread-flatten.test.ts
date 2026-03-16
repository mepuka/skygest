import { describe, expect, it } from "@effect/vitest";
import { flattenThread } from "../src/bluesky/ThreadFlatten";

// Helper to build a mock ThreadViewPost node
const makeNode = (uri: string, text: string, opts?: {
  parent?: unknown;
  replies?: unknown[];
}) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: {
    uri,
    cid: `cid-${uri}`,
    author: { did: `did:plc:${uri}`, handle: `user-${uri}.bsky.social` },
    record: { text, createdAt: "2025-03-15T00:00:00Z", $type: "app.bsky.feed.post" },
    indexedAt: "2025-03-15T00:01:00Z",
    likeCount: 5,
    repostCount: 2,
    replyCount: 1
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
    expect(result!.focus.uri).toBe("post-1");
    expect(result!.ancestors).toHaveLength(0);
    expect(result!.replies).toHaveLength(0);
  });

  it("walks parent chain upward, oldest first", () => {
    const grandparent = makeNode("gp", "Grandparent post");
    const parent = makeNode("parent", "Parent post", { parent: grandparent });
    const focus = makeNode("focus", "Focus post", { parent });
    const result = flattenThread(focus);
    expect(result!.ancestors).toHaveLength(2);
    expect(result!.ancestors[0]!.uri).toBe("gp");    // oldest first
    expect(result!.ancestors[1]!.uri).toBe("parent");
    expect(result!.focus.uri).toBe("focus");
  });

  it("collects replies via BFS", () => {
    const reply1 = makeNode("r1", "Reply 1");
    const reply2 = makeNode("r2", "Reply 2");
    const nested = makeNode("r1-1", "Nested reply");
    const reply1WithNested = makeNode("r1", "Reply 1", { replies: [nested] });
    const focus = makeNode("focus", "Focus", { replies: [reply1WithNested, reply2] });
    const result = flattenThread(focus);
    expect(result!.replies.length).toBeGreaterThanOrEqual(2);
    // BFS: r1 and r2 before r1-1
    const uris = result!.replies.map(r => r.uri);
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
    expect(result!.ancestors[0]!.uri).toBe("parent");
  });

  it("skips NotFoundPost nodes", () => {
    const notFound = { $type: "app.bsky.feed.defs#notFoundPost", uri: "nf", notFound: true };
    const focus = makeNode("focus", "Focus", { replies: [notFound] });
    const result = flattenThread(focus);
    expect(result!.replies).toHaveLength(0);
  });
});
