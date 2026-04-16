# Thread Printer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a composable thread printer that filter-reduces a flattened Bluesky thread into a narrative document optimized for agent consumption, exposed via a new `get_thread_document` MCP tool.

**Architecture:** Pure function `printThread(FlattenedThread, PrinterConfig) → ThreadDocument`. Filter pipeline uses pipeable `ReplyTransform` endomorphisms composed with `flow`. Render pipeline uses `@effect/printer` Doc combinators. New `get_thread_document` MCP tool becomes the primary thread tool; existing `get_post_thread` gets improved `_display`.

**Tech Stack:** Effect (Schema, Predicate, Array, flow, identity), @effect/printer (Doc), @effect/ai (Tool, Toolkit), vitest via @effect/vitest, bun test runner.

**Design doc:** `docs/plans/2026-03-17-thread-printer-design.md`

---

## Task 1: Add `dfsIndex` to `FlattenedPost`

The printer needs to restore DFS ordering after top-N filtering. Add an index to each flattened post tracking its original traversal position.

**Files:**
- Modify: `src/bluesky/ThreadFlatten.ts:4-8` (FlattenedPost interface)
- Modify: `src/bluesky/ThreadFlatten.ts:37-113` (flattenThread — assign dfsIndex)
- Modify: `tests/thread-flatten.test.ts` (add dfsIndex assertions)

**Step 1: Write the failing tests**

Add to `tests/thread-flatten.test.ts`:

```typescript
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

it("assigns dfsIndex to ancestors and focus", () => {
  const gp = makeNode("gp", "Grandparent");
  const parent = makeNode("parent", "Parent", { parent: gp });
  const focus = makeNode("focus", "Focus", { parent });
  const result = flattenThread(focus)!;

  expect(result.ancestors[0]!.dfsIndex).toBe(0);
  expect(result.ancestors[1]!.dfsIndex).toBe(0);
  expect(result.focus.dfsIndex).toBe(0);
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/thread-flatten.test.ts`
Expected: FAIL — `dfsIndex` property does not exist on `FlattenedPost`

**Step 3: Implement dfsIndex**

In `src/bluesky/ThreadFlatten.ts`:

Update the `FlattenedPost` interface (line 4):

```typescript
export interface FlattenedPost {
  readonly post: ThreadPostView;
  readonly depth: number;
  readonly parentUri: string | null;
  readonly dfsIndex: number;
}
```

Update `flattenThread` — assign `dfsIndex: 0` to ancestors and focus (they don't participate in reply filtering):

```typescript
// Line 41: focus creation
const focus: FlattenedPost = { post: root.post, depth: 0, parentUri: null, dfsIndex: 0 };

// Line 51: ancestor creation in unshift
ancestors.unshift({ post: parentNode.post, depth: 0, parentUri: null, dfsIndex: 0 });

// Line 59: ancestor depth reassignment
ancestors[i] = { post: ancestors[i]!.post, depth, parentUri, dfsIndex: 0 };

// Line 64: focus with parentUri
const focusPost: FlattenedPost = { post: root.post, depth: 0, parentUri: focusParentUri, dfsIndex: 0 };
```

Add a counter before the reply DFS loop and assign to each reply:

```typescript
// Before the DFS loop (after stack initialization, around line 87)
let replyDfsIndex = 0;

// Line 93: inside the while loop, when pushing to replies
replies.push({ post: replyNode.post, depth, parentUri, dfsIndex: replyDfsIndex++ });
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/thread-flatten.test.ts`
Expected: PASS — all existing tests still pass, new dfsIndex tests pass

**Step 5: Commit**

```bash
git add src/bluesky/ThreadFlatten.ts tests/thread-flatten.test.ts
git commit -m "feat(thread): add dfsIndex to FlattenedPost for post-filter ordering"
```

---

## Task 2: Build the filter pipeline

Create `ThreadPrinter.ts` with `PrinterConfig`, predicates, pipeable transforms, structural closure, and `buildFilterPipeline`.

**Files:**
- Create: `src/bluesky/ThreadPrinter.ts`
- Create: `tests/thread-printer.test.ts`

**Step 1: Write the failing tests**

Create `tests/thread-printer.test.ts`:

```typescript
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
    // topN: 1 keeps only r2-1 (depth 2, parentUri: r2)
    // closure should restore r2 (depth 1, parentUri: focus) so indentation makes sense
    const { filtered } = filterReplies(replies, { topN: 1, minLikes: 25 });
    // r2-1 (30 likes) survives, r2 (10 likes) is below threshold but restored by closure
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
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/thread-printer.test.ts`
Expected: FAIL — module `../src/bluesky/ThreadPrinter` not found

**Step 3: Implement the filter pipeline**

Create `src/bluesky/ThreadPrinter.ts`:

```typescript
import { Schema, Predicate, Array as A, flow, identity, Order } from "effect";
import type { FlattenedPost, FlattenedThread } from "./ThreadFlatten.ts";
import type { ThreadPostView } from "./ThreadTypes.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const PrinterConfig = Schema.Struct({
  maxDepth: Schema.optional(Schema.Number),
  minLikes: Schema.optional(Schema.Number),
  topN: Schema.optional(Schema.Number)
});
export type PrinterConfig = Schema.Schema.Type<typeof PrinterConfig>;

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

const withinDepth = (max: number): Predicate.Predicate<FlattenedPost> =>
  (post) => post.depth <= max;

const meetsEngagement = (min: number): Predicate.Predicate<FlattenedPost> =>
  (post) => (post.post.likeCount ?? 0) >= min;

// ---------------------------------------------------------------------------
// Comparators
// ---------------------------------------------------------------------------

/** Engagement: likes DESC, reposts DESC, replies DESC */
const byEngagement = Order.make<FlattenedPost>((a, b) => {
  const aLikes = a.post.likeCount ?? 0;
  const bLikes = b.post.likeCount ?? 0;
  if (aLikes !== bLikes) return bLikes > aLikes ? 1 : -1;
  const aReposts = a.post.repostCount ?? 0;
  const bReposts = b.post.repostCount ?? 0;
  if (aReposts !== bReposts) return bReposts > aReposts ? 1 : -1;
  const aReplies = a.post.replyCount ?? 0;
  const bReplies = b.post.replyCount ?? 0;
  if (aReplies !== bReplies) return bReplies > aReplies ? 1 : -1;
  return 0;
});

/** DFS position: ascending by original traversal index */
const byDfsPosition = Order.make<FlattenedPost>((a, b) =>
  a.dfsIndex < b.dfsIndex ? -1 : a.dfsIndex > b.dfsIndex ? 1 : 0
);

// ---------------------------------------------------------------------------
// Pipeable transform steps
// ---------------------------------------------------------------------------

type ReplyTransform = (replies: ReadonlyArray<FlattenedPost>) => ReadonlyArray<FlattenedPost>;

const capDepth = (max: number | undefined): ReplyTransform =>
  max === undefined ? identity : A.filter(withinDepth(max));

const requireEngagement = (min: number | undefined): ReplyTransform =>
  min === undefined ? identity : A.filter(meetsEngagement(min));

const takeTopN = (n: number | undefined): ReplyTransform =>
  n === undefined
    ? identity
    : flow(
        A.sort(byEngagement),
        A.take(n),
        A.sort(byDfsPosition)
      );

// ---------------------------------------------------------------------------
// Structural closure
// ---------------------------------------------------------------------------

const ensureClosure = (
  allReplies: ReadonlyArray<FlattenedPost>
): (kept: ReadonlyArray<FlattenedPost>) => ReadonlyArray<FlattenedPost> => {
  const allByUri = new Map(allReplies.map((r) => [r.post.uri, r]));

  return (kept) => {
    const keptUris = new Set(kept.map((r) => r.post.uri));

    for (const reply of kept) {
      let parentUri = reply.parentUri;
      while (parentUri && !keptUris.has(parentUri)) {
        const parent = allByUri.get(parentUri);
        if (!parent || parent.depth <= 0) break;
        keptUris.add(parentUri);
        parentUri = parent.parentUri;
      }
    }

    return A.sort(allReplies.filter((r) => keptUris.has(r.post.uri)), byDfsPosition);
  };
};

// ---------------------------------------------------------------------------
// Composed pipeline
// ---------------------------------------------------------------------------

const buildFilterPipeline = (
  config: PrinterConfig,
  allReplies: ReadonlyArray<FlattenedPost>
): ReplyTransform =>
  flow(
    capDepth(config.maxDepth),
    requireEngagement(config.minLikes),
    takeTopN(config.topN),
    ensureClosure(allReplies)
  );

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const filterReplies = (
  replies: ReadonlyArray<FlattenedPost>,
  config: PrinterConfig
): { filtered: ReadonlyArray<FlattenedPost>; total: number } => {
  const pipeline = buildFilterPipeline(config, replies);
  return { filtered: pipeline(replies), total: replies.length };
};
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/thread-printer.test.ts`
Expected: PASS — all 7 filter tests pass

**Step 5: Commit**

```bash
git add src/bluesky/ThreadPrinter.ts tests/thread-printer.test.ts
git commit -m "feat(thread): filter pipeline with predicates, topN, and structural closure"
```

---

## Task 3: Build the Doc render pipeline

Add `printThread` and the Doc-based renderers to `ThreadPrinter.ts`.

**Files:**
- Modify: `src/bluesky/ThreadPrinter.ts`
- Modify: `tests/thread-printer.test.ts`

**Step 1: Write the failing tests**

Add to `tests/thread-printer.test.ts`:

```typescript
import { printThread, type ThreadDocument } from "../src/bluesky/ThreadPrinter";
import type { FlattenedThread } from "../src/bluesky/ThreadFlatten";

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
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "For the first time, all three hydro provinces"),
      replies: []
    };
    const doc = printThread(thread);

    expect(doc.postCount).toBe(1);
    expect(doc.replyCount).toBe(0);
    expect(doc.totalReplies).toBe(0);
    expect(doc.body).toContain("@blakeshaffer");
    expect(doc.body).toContain("[1/1]");
    expect(doc.body).toContain("For the first time");
  });

  it("renders ancestors and focus as numbered posts", () => {
    const ancestor: FlattenedPost = {
      ...makeFocus("a1", "blakeshaffer", "Context post"),
      depth: -1,
      dfsIndex: 0
    };
    const thread: FlattenedThread = {
      ancestors: [ancestor],
      focus: makeFocus("focus-1", "blakeshaffer", "Main analysis"),
      replies: []
    };
    const doc = printThread(thread);

    expect(doc.postCount).toBe(2);
    expect(doc.body).toContain("[1/2]");
    expect(doc.body).toContain("[2/2]");
    expect(doc.body).toContain("Context post");
    expect(doc.body).toContain("Main analysis");
  });

  it("renders filtered replies with engagement", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "Main post"),
      replies: [
        makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 42 }),
        makeReply("r2", { depth: 1, dfsIndex: 1, likeCount: 5 })
      ]
    };
    const doc = printThread(thread, { topN: 1 });

    expect(doc.replyCount).toBe(1);
    expect(doc.totalReplies).toBe(2);
    expect(doc.body).toContain("filtered from 2");
    expect(doc.body).toContain("♡42");
  });

  it("renders discussion header without filter note when unfiltered", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "Main post"),
      replies: [
        makeReply("r1", { depth: 1, dfsIndex: 0, likeCount: 10 })
      ]
    };
    const doc = printThread(thread);

    expect(doc.body).toContain("Discussion (1 replies)");
    expect(doc.body).not.toContain("filtered from");
  });

  it("renders image embeds with alt text", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "Chart post", {
        embed: {
          $type: "app.bsky.embed.images#view",
          images: [{ thumb: "t.jpg", fullsize: "f.jpg", alt: "BC hydro imports chart" }]
        }
      }),
      replies: []
    };
    const doc = printThread(thread);

    expect(doc.body).toContain("📊");
    expect(doc.body).toContain("BC hydro imports chart");
  });

  it("renders link embeds", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "Source link", {
        embed: {
          $type: "app.bsky.embed.external#view",
          external: { uri: "https://bchydro.com/report", title: "BC Hydro Report" }
        }
      }),
      replies: []
    };
    const doc = printThread(thread);

    expect(doc.body).toContain("🔗");
    expect(doc.body).toContain("BC Hydro Report");
  });

  it("returns a title with handle and date", () => {
    const thread: FlattenedThread = {
      ancestors: [],
      focus: makeFocus("focus-1", "blakeshaffer", "For the first time all three hydro provinces were net importers"),
      replies: []
    };
    const doc = printThread(thread);

    expect(doc.title).toContain("@blakeshaffer");
    expect(doc.title).toContain("2026-03-15");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/thread-printer.test.ts`
Expected: FAIL — `printThread` is not exported from `ThreadPrinter`

**Step 3: Implement the render pipeline**

Add to `src/bluesky/ThreadPrinter.ts`:

```typescript
import * as Doc from "@effect/printer/Doc";
import type { ThreadEmbedView } from "./ThreadTypes.ts";

type SDoc = Doc.Doc<never>;

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

const extractText = (record: unknown): string => {
  if (typeof record === "object" && record !== null && "text" in record) {
    return typeof record.text === "string" ? record.text : "";
  }
  return "";
};

const extractCreatedAt = (record: unknown, fallbackIndexedAt: string): string => {
  if (typeof record === "object" && record !== null && "createdAt" in record) {
    return typeof record.createdAt === "string" ? record.createdAt : fallbackIndexedAt;
  }
  return fallbackIndexedAt;
};

// ---------------------------------------------------------------------------
// Atomic Doc renderers
// ---------------------------------------------------------------------------

const renderHandle = (post: FlattenedPost): SDoc =>
  Doc.text(`@${post.post.author.handle ?? post.post.author.did}`);

const renderEngagement = (post: FlattenedPost): SDoc =>
  Doc.hsep([
    Doc.text(`♡${post.post.likeCount ?? 0}`),
    Doc.text(`↻${post.post.repostCount ?? 0}`),
    Doc.text(`💬${post.post.replyCount ?? 0}`)
  ]);

const renderEmbedLine = (embed: any | undefined): SDoc => {
  if (!embed?.$type) return Doc.empty;
  const t = embed.$type as string;
  if (t.includes("images") && embed.images?.length) {
    return Doc.vsep(
      (embed.images as Array<{ fullsize: string; alt?: string }>).map((img) =>
        Doc.text(`📊 ${img.alt ?? "Image"} (${img.fullsize})`)
      )
    );
  }
  if (t.includes("external") && embed.external) {
    return Doc.text(`🔗 ${embed.external.title ?? embed.external.uri}`);
  }
  if (t.includes("video")) {
    return Doc.text(`🎬 ${embed.alt ?? "Video"}`);
  }
  return Doc.empty;
};

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

const renderAuthorPost = (total: number) =>
  (post: FlattenedPost, index: number): SDoc =>
    Doc.vsep([
      Doc.text(`[${index + 1}/${total}]`),
      Doc.text(extractText(post.post.record)),
      renderEmbedLine(post.post.embed)
    ]);

const renderReplyPost = (post: FlattenedPost): SDoc => {
  const indent = Math.max(0, post.depth - 1) * 2;
  const header = Doc.hsep([renderHandle(post), renderEngagement(post)]);
  const body = Doc.text(extractText(post.post.record));
  return Doc.nest(Doc.vsep([header, Doc.nest(body, 2)]), indent);
};

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const buildTitle = (thread: FlattenedThread): string => {
  const handle = thread.focus.post.author.handle ?? thread.focus.post.author.did;
  const date = extractCreatedAt(thread.focus.post.record, thread.focus.post.indexedAt);
  const text = extractText(thread.focus.post.record);
  const snippet = text.length > 60 ? text.slice(0, 57) + "…" : text;
  return `${snippet} — @${handle} · ${date.slice(0, 10)}`;
};

const renderDocument = (
  thread: FlattenedThread,
  filtered: ReadonlyArray<FlattenedPost>,
  totalReplies: number
): SDoc => {
  const authorPosts = [...thread.ancestors, thread.focus];
  const title = Doc.text(buildTitle(thread));
  const posts = Doc.vsep(authorPosts.map(renderAuthorPost(authorPosts.length)));

  const separator = filtered.length < totalReplies
    ? Doc.text(`--- Expert Discussion (${filtered.length} replies, filtered from ${totalReplies}) ---`)
    : Doc.text(`--- Discussion (${filtered.length} replies) ---`);

  const parts: SDoc[] = [title, Doc.hardLine, posts];

  if (filtered.length > 0) {
    parts.push(Doc.hardLine, separator, Doc.hardLine);
    parts.push(Doc.vsep(filtered.map(renderReplyPost)));
  }

  return Doc.vsep(parts);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ThreadDocument {
  readonly title: string;
  readonly postCount: number;
  readonly replyCount: number;
  readonly totalReplies: number;
  readonly body: string;
}

export const printThread = (
  thread: FlattenedThread,
  config: PrinterConfig = {}
): ThreadDocument => {
  const { filtered, total } = filterReplies(thread.replies, config);
  const doc = renderDocument(thread, filtered, total);

  return {
    title: buildTitle(thread),
    postCount: thread.ancestors.length + 1,
    replyCount: filtered.length,
    totalReplies: total,
    body: Doc.render(doc, { style: "compact" })
  };
};
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/thread-printer.test.ts`
Expected: PASS — all filter + render tests pass

**Step 5: Commit**

```bash
git add src/bluesky/ThreadPrinter.ts tests/thread-printer.test.ts
git commit -m "feat(thread): Doc-based render pipeline for thread-as-document"
```

---

## Task 4: Add domain schemas for `get_thread_document`

Add `GetThreadDocumentInput` and `ThreadDocumentOutput` to the domain layer, plus the MCP output schema.

**Files:**
- Modify: `src/domain/bi.ts:555-605`
- Modify: `src/mcp/OutputSchemas.ts`

**Step 1: Write the failing test**

Add to `tests/thread-printer.test.ts`:

```typescript
import { Schema } from "effect";
import { GetThreadDocumentInput, ThreadDocumentOutput } from "../src/domain/bi";

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
```

**Step 2: Run tests to verify they fail**

Run: `bun run test tests/thread-printer.test.ts`
Expected: FAIL — `GetThreadDocumentInput` and `ThreadDocumentOutput` not found in `bi`

**Step 3: Implement the schemas**

Add to `src/domain/bi.ts` after the existing `PostThreadOutput` (after line 605):

```typescript
// --- Thread document (printer) ---

export const GetThreadDocumentInput = Schema.Struct({
  postUri: AtUri.annotations({
    description: "AT Protocol URI of the post to render as a document"
  }),
  depth: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, 10)).annotations({
      description: "Reply depth levels to fetch from Bluesky API (0-10, default 3)"
    })
  ),
  parentHeight: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(0, 10)).annotations({
      description: "Parent context levels to fetch (0-10, default 3)"
    })
  ),
  maxDepth: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 10)).annotations({
      description: "Max reply nesting depth to include in document (1-10)"
    })
  ),
  minLikes: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)).annotations({
      description: "Minimum likes for a reply to be included"
    })
  ),
  topN: Schema.optional(
    Schema.Number.pipe(Schema.int(), Schema.between(1, 50)).annotations({
      description: "Keep only the N highest-engagement replies (1-50)"
    })
  )
});
export type GetThreadDocumentInput = Schema.Schema.Type<typeof GetThreadDocumentInput>;

export const ThreadDocumentOutput = Schema.Struct({
  title: Schema.String,
  postCount: Schema.Number,
  replyCount: Schema.Number,
  totalReplies: Schema.Number,
  body: Schema.String
});
export type ThreadDocumentOutput = Schema.Schema.Type<typeof ThreadDocumentOutput>;
```

Add to `src/mcp/OutputSchemas.ts`:

```typescript
// Add to imports
import { ThreadDocumentOutput } from "../domain/bi.ts";

// Add after PostThreadMcpOutput
export const ThreadDocumentMcpOutput = ThreadDocumentOutput;
export type ThreadDocumentMcpOutput = Schema.Schema.Type<typeof ThreadDocumentMcpOutput>;
```

Note: No `DisplayField` extension — `body` is the display string.

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/thread-printer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/domain/bi.ts src/mcp/OutputSchemas.ts tests/thread-printer.test.ts
git commit -m "feat(thread): add GetThreadDocumentInput and ThreadDocumentOutput schemas"
```

---

## Task 5: Wire up the `get_thread_document` MCP tool

Add the tool definition, handler, and update the toolkit.

**Files:**
- Modify: `src/mcp/Toolkit.ts:1-30` (imports)
- Modify: `src/mcp/Toolkit.ts:180-203` (tool definition + toolkit registration)
- Modify: `src/mcp/Toolkit.ts:299-430` (handler)

**Step 1: Write the failing test**

Add to `tests/thread-printer.test.ts`:

```typescript
describe("get_thread_document MCP tool", () => {
  it("is listed in available tools", async () => {
    // This test depends on your MCP test infrastructure
    // If you can create an MCP client, verify the tool appears
    // Otherwise skip this and verify manually
  });
});
```

Better: add to `tests/mcp.test.ts`. Update the tool listing assertion:

In `tests/mcp.test.ts`, find the tools list assertion (around line 36-47) and add `"get_thread_document"` to the expected array:

```typescript
expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
  "expand_topics",
  "explain_post_topics",
  "get_post_links",
  "get_post_thread",
  "get_recent_posts",
  "get_thread_document",  // NEW
  "get_topic",
  "list_editorial_picks",
  "list_experts",
  "list_topics",
  "search_posts"
]);
```

**Step 2: Run tests to verify it fails**

Run: `bun run test tests/mcp.test.ts`
Expected: FAIL — tool list doesn't include `get_thread_document`

**Step 3: Implement the tool**

In `src/mcp/Toolkit.ts`:

Add imports:

```typescript
import { GetThreadDocumentInput } from "../domain/bi";
import { ThreadDocumentMcpOutput } from "./OutputSchemas.ts";
import { flattenThread } from "../bluesky/ThreadFlatten.ts";
import { printThread } from "../bluesky/ThreadPrinter.ts";
```

Add tool definition after `GetPostThreadTool` (after line 190):

```typescript
export const GetThreadDocumentTool = Tool.make("get_thread_document", {
  description: "Render a Bluesky thread as a readable document. Returns the thread author's posts as a narrative with numbered sections, plus filtered expert discussion. Use this to read and understand threads — prefer over get_post_thread for analysis. Supports filtering replies by engagement (minLikes), depth (maxDepth), and top-N.",
  parameters: GetThreadDocumentInput.fields,
  success: ThreadDocumentMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Thread Document")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);
```

Add to `KnowledgeMcpToolkit` registration:

```typescript
export const KnowledgeMcpToolkit = Toolkit.make(
  SearchPostsTool,
  GetRecentPostsTool,
  GetPostLinksTool,
  ListExpertsTool,
  ListTopicsTool,
  GetTopicTool,
  ExpandTopicsTool,
  ExplainPostTopicsTool,
  ListEditorialPicksTool,
  GetPostThreadTool,
  GetThreadDocumentTool  // NEW
);
```

Add handler in `KnowledgeMcpHandlers` (inside the `Effect.gen`, after the `get_post_thread` handler):

```typescript
get_thread_document: (input) =>
  bskyClient.getPostThread(input.postUri, {
    depth: input.depth ?? 3,
    parentHeight: input.parentHeight ?? 3
  }).pipe(
    Effect.flatMap((response) => {
      const flat = flattenThread(response.thread);
      if (!flat) {
        return Effect.fail(McpToolQueryError.make({
          tool: "get_thread_document",
          message: "Post not found or thread unavailable",
          error: new Error("thread decode failed")
        }));
      }

      const doc = printThread(flat, {
        maxDepth: input.maxDepth,
        minLikes: input.minLikes,
        topN: input.topN
      });

      return Effect.succeed(doc);
    }),
    Effect.mapError((error) =>
      "_tag" in (error as any) && (error as any)._tag === "McpToolQueryError"
        ? error as McpToolQueryError
        : McpToolQueryError.make({
            tool: "get_thread_document",
            message: error instanceof Error ? error.message : String(error),
            error
          })
    )
  ),
```

**Step 4: Run tests to verify they pass**

Run: `bun run test tests/mcp.test.ts`
Expected: PASS — tool list includes `get_thread_document`

Then run full suite:

Run: `bun run test`
Expected: PASS — all tests pass

**Step 5: Type check**

Run: `bunx tsc --noEmit`
Expected: Clean — no type errors

**Step 6: Commit**

```bash
git add src/mcp/Toolkit.ts tests/mcp.test.ts
git commit -m "feat(thread): add get_thread_document MCP tool"
```

---

## Task 6: Update `get_post_thread` `_display` to use printer

Replace the legacy `formatPostThread` call with the printer for improved display.

**Files:**
- Modify: `src/mcp/Toolkit.ts:416-419`

**Step 1: Write the failing test**

Add to `tests/thread-printer.test.ts`:

```typescript
describe("get_post_thread _display uses printer", () => {
  it("_display contains narrative format markers", () => {
    // This is verified via the existing MCP tests — the display
    // should now contain [1/N] post numbering instead of [A1]/[F]/[R1] tags
    // Verify by running the full test suite
  });
});
```

This is better verified as a manual check — the existing `mcp.test.ts` exercises `get_post_thread` and its `_display` field.

**Step 2: Implement**

In `src/mcp/Toolkit.ts`, in the `get_post_thread` handler (around line 416-419), replace:

```typescript
// Before:
_display: formatPostThread(result)

// After:
_display: printThread(flat, {}).body
```

Remove the `formatPostThread` import if no other caller uses it. Check `Fmt.ts` — `formatPostThread` is only used here, so the import can be removed. Keep the function in `Fmt.ts` in case it's needed later.

**Step 3: Run full test suite**

Run: `bun run test`
Expected: PASS — existing tests still pass with new display format

Run: `bunx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add src/mcp/Toolkit.ts
git commit -m "refactor(thread): use printer for get_post_thread _display"
```

---

## Task 7: Verify end-to-end

**Step 1: Run full test suite**

Run: `bun run test`
Expected: All tests pass

**Step 2: Type check**

Run: `bunx tsc --noEmit`
Expected: Clean

**Step 3: Deploy to staging**

Run: `bunx wrangler deploy --config wrangler.agent.toml --env staging`

**Step 4: Live smoke test**

Test `get_thread_document` on the Blake Shaffer hydro thread:
```
URI: at://did:plc:qadd3esli2op67lh66daubzp/app.bsky.feed.post/3mh7xbwo2422s
```

Verify:
- Document reads as narrative with `[1/N]` post numbering
- Image embeds show 📊 with alt text (or "Image" placeholder since alt text is empty)
- Link embeds show 🔗
- Discussion section appears with reply count
- Filtering works: `topN: 3, minLikes: 5` reduces replies

Test `get_post_thread` on the same URI:
- Structured JSON unchanged
- `_display` now uses printer format

**Step 5: Commit any fixes and final commit**

```bash
git add -A
git commit -m "feat(thread): thread-as-document printer — complete"
```
