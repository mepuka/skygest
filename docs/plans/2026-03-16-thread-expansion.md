# Bluesky Thread Expansion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `get_post_thread` MCP tool that fetches full thread context (ancestors + focus + replies) with engagement metrics from the live Bluesky API, enabling agents to follow discussions and evaluate post quality.

**Architecture:** Extend the existing `BlueskyClient` Effect service with `getPostThread` and `getPosts` methods using the same `requestJson` pattern (rate limiting, retries, schema decode). Define lightweight Effect schemas for the Bluesky `PostView` and `ThreadViewPost` response types. Add a thread flattening utility that walks the recursive parent/replies tree into a linear structure. Wire as an MCP tool with `_display` formatter showing ancestors → focus → replies with engagement counts.

**Tech Stack:** Effect.ts, `@effect/platform` HttpClient, Bluesky public API at `public.api.bsky.app` (unauthenticated), `@effect/printer` for display formatting

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| API endpoint | `app.bsky.feed.getPostThread` | Returns recursive thread with parent chain + replies + engagement counts |
| Auth | None (public API) | `public.api.bsky.app` supports `getPostThread` unauthenticated |
| Depth limits | Clamp to 0-10 at MCP layer | Bluesky allows 0-1000 but LLMs can't usefully process deep trees |
| Defaults | depth=3, parentHeight=3 | Reasonable conversation context without overwhelming output |
| Schema approach | Lightweight decode-what-we-need schemas | Don't import `@atproto/api` — define minimal schemas for `PostView` fields we actually use |
| Thread flattening | Iterative walk (not recursive) | Avoids stack overflow on deep threads; matches the `@effect/printer` fix pattern |
| `OpenWorld` annotation | true | This tool calls an external API (Bluesky), unlike other tools which query local D1 |
| Service dependency | `BlueskyClient` directly in MCP handler | Thread data comes from live Bluesky API, not `KnowledgeQueryService` |
| Result schema | New `PostThreadOutput` with `ancestors`, `focus`, `replies` arrays | Flat structure for easy LLM consumption; each post has a `position` field |

---

## Task 1: Bluesky Thread Response Schemas

**Files:**
- Create: `src/bluesky/ThreadTypes.ts`

Define lightweight Effect schemas for the Bluesky thread API response. Only decode fields we need — don't try to model the full AT Protocol lexicon.

```typescript
// src/bluesky/ThreadTypes.ts
import { Schema } from "effect";

// --- Profile (minimal, for thread context) ---

export const ThreadProfileBasic = Schema.Struct({
  did: Schema.String,
  handle: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.String)
});
export type ThreadProfileBasic = Schema.Schema.Type<typeof ThreadProfileBasic>;

// --- PostView (the core post object with engagement counts) ---

export const ThreadPostView = Schema.Struct({
  uri: Schema.String,
  cid: Schema.String,
  author: ThreadProfileBasic,
  record: Schema.Unknown,
  replyCount: Schema.optional(Schema.Number),
  repostCount: Schema.optional(Schema.Number),
  likeCount: Schema.optional(Schema.Number),
  quoteCount: Schema.optional(Schema.Number),
  indexedAt: Schema.String
});
export type ThreadPostView = Schema.Schema.Type<typeof ThreadPostView>;

// --- ThreadViewPost (recursive thread node) ---
// Use Schema.Unknown for parent/replies to avoid recursive schema issues.
// We decode them manually during thread flattening.

export const ThreadViewPostNode = Schema.Struct({
  $type: Schema.optional(Schema.String),
  post: ThreadPostView,
  parent: Schema.optional(Schema.Unknown),
  replies: Schema.optional(Schema.Array(Schema.Unknown))
});
export type ThreadViewPostNode = Schema.Schema.Type<typeof ThreadViewPostNode>;

// --- API response envelope ---

export const GetPostThreadResponse = Schema.Struct({
  thread: Schema.Unknown
});
export type GetPostThreadResponse = Schema.Schema.Type<typeof GetPostThreadResponse>;

// --- Batch posts response ---

export const GetPostsResponse = Schema.Struct({
  posts: Schema.Array(ThreadPostView)
});
export type GetPostsResponse = Schema.Schema.Type<typeof GetPostsResponse>;
```

**Why `Schema.Unknown` for parent/replies:** Effect Schema doesn't support recursive types easily. We decode the top-level response, then walk the tree manually using `Schema.decodeUnknownSync(ThreadViewPostNode)` at each level during flattening.

**Verify:** `bunx tsc --noEmit -p tsconfig.json`

**Commit:**
```bash
git add src/bluesky/ThreadTypes.ts
git commit -m "feat(thread): add Effect schemas for Bluesky thread API response types"
```

---

## Task 2: Add getPostThread + getPosts to BlueskyClient

**Files:**
- Modify: `src/bluesky/BlueskyClient.ts`

### 2.1 Extend the service interface

Add two new methods to the `BlueskyClient` `Context.Tag` type:

```typescript
readonly getPostThread: (
  uri: string,
  opts?: { depth?: number; parentHeight?: number }
) => Effect.Effect<GetPostThreadResponse, BlueskyApiError>;

readonly getPosts: (
  uris: ReadonlyArray<string>
) => Effect.Effect<GetPostsResponse, BlueskyApiError>;
```

Import `GetPostThreadResponse` and `GetPostsResponse` from `./ThreadTypes.ts`.

### 2.2 Implement in `makeBlueskyClient`

```typescript
const getPostThread = (uri: string, opts?: { depth?: number; parentHeight?: number }) =>
  requestJson(
    `${base}/xrpc/app.bsky.feed.getPostThread`,
    GetPostThreadResponse,
    {
      uri,
      depth: String(opts?.depth ?? 6),
      parentHeight: String(opts?.parentHeight ?? 80)
    }
  );

const getPosts = (uris: ReadonlyArray<string>) =>
  requestJson(
    `${base}/xrpc/app.bsky.feed.getPosts`,
    GetPostsResponse,
    Object.fromEntries(uris.map((uri, i) => [`uris`, uri]))
  );
```

**Note on `getPosts` params:** The Bluesky API expects repeated `uris` query params (`?uris=at://...&uris=at://...`). The `@effect/platform` `HttpClient.get` `urlParams` may not support repeated keys. If not, construct the URL manually:

```typescript
const getPosts = (uris: ReadonlyArray<string>) => {
  const params = uris.map(uri => `uris=${encodeURIComponent(uri)}`).join("&");
  return requestJson(
    `${base}/xrpc/app.bsky.feed.getPosts?${params}`,
    GetPostsResponse
  );
};
```

### 2.3 Add to `.of({...})` return

```typescript
return BlueskyClient.of({
  resolveDidOrHandle,
  getProfile,
  getFollows,
  resolveRepoService,
  listRecordsAtService,
  getPostThread,
  getPosts
});
```

**Verify:** `bunx tsc --noEmit -p tsconfig.json` + `bun run test`

**Commit:**
```bash
git add src/bluesky/BlueskyClient.ts
git commit -m "feat(thread): add getPostThread + getPosts to BlueskyClient"
```

---

## Task 3: Thread Flattening Utility

**Files:**
- Create: `src/bluesky/ThreadFlatten.ts`

A pure function that walks the recursive `ThreadViewPost` tree and produces a flat structure: `{ ancestors, focus, replies }`.

```typescript
// src/bluesky/ThreadFlatten.ts
import { Schema } from "effect";
import { ThreadViewPostNode, type ThreadPostView } from "./ThreadTypes.ts";

export interface FlattenedThread {
  readonly ancestors: ReadonlyArray<ThreadPostView>;
  readonly focus: ThreadPostView;
  readonly replies: ReadonlyArray<ThreadPostView>;
}

const tryDecodeNode = (value: unknown): ThreadPostView | null => {
  try {
    const node = Schema.decodeUnknownSync(ThreadViewPostNode)(value);
    return node.post;
  } catch {
    return null;
  }
};

const tryDecodeNodeFull = (value: unknown) => {
  try {
    return Schema.decodeUnknownSync(ThreadViewPostNode)(value);
  } catch {
    return null;
  }
};

export const flattenThread = (threadData: unknown): FlattenedThread | null => {
  const root = tryDecodeNodeFull(threadData);
  if (!root) return null;

  const focus = root.post;
  const seen = new Set<string>([focus.uri]);

  // Walk parent chain upward (iterative, not recursive)
  const ancestors: ThreadPostView[] = [];
  let currentParent = root.parent;
  while (currentParent != null) {
    const parentNode = tryDecodeNodeFull(currentParent);
    if (!parentNode || seen.has(parentNode.post.uri)) break;
    seen.add(parentNode.post.uri);
    ancestors.unshift(parentNode.post); // oldest first
    currentParent = parentNode.parent;
  }

  // Walk replies (BFS, one level at a time, up to depth limit)
  const replies: ThreadPostView[] = [];
  const replyQueue: unknown[] = [...(root.replies ?? [])];
  while (replyQueue.length > 0) {
    const next = replyQueue.shift()!;
    const replyNode = tryDecodeNodeFull(next);
    if (!replyNode || seen.has(replyNode.post.uri)) continue;
    seen.add(replyNode.post.uri);
    replies.push(replyNode.post);
    // Add nested replies to queue for BFS
    if (replyNode.replies) {
      replyQueue.push(...replyNode.replies);
    }
  }

  return { ancestors, focus, replies };
};
```

**Key design:**
- Iterative parent walk (not recursive) — avoids stack overflow
- BFS for replies — processes level by level
- URI deduplication via `Set` — handles cycles
- `tryDecodeNode` gracefully handles `NotFoundPost` and `BlockedPost` by returning null

**Test:** Create `tests/thread-flatten.test.ts` with mock thread data and verify:
- Empty thread (focus only, no parents/replies)
- Thread with 2 ancestors
- Thread with nested replies (2 levels)
- Deduplication on cycle
- `NotFoundPost` nodes are skipped

**Verify:** `bun run test`

**Commit:**
```bash
git add src/bluesky/ThreadFlatten.ts tests/thread-flatten.test.ts
git commit -m "feat(thread): add iterative thread flattening utility with BFS replies"
```

---

## Task 4: Thread Domain Types + MCP Input/Output Schemas

**Files:**
- Modify: `src/domain/bi.ts` — add thread-related domain types
- Create: `src/mcp/OutputSchemas.ts` — add `PostThreadMcpOutput` (or extend existing file)

### 4.1 Domain types in `bi.ts`

```typescript
// --- Thread expansion ---

export const GetPostThreadInput = Schema.Struct({
  postUri: AtUri.annotations({
    description: "AT Protocol URI of the post to get thread context for"
  }),
  depth: Schema.optional(Schema.Number.annotations({
    description: "Reply depth levels to include (0-10, default 3)"
  })),
  parentHeight: Schema.optional(Schema.Number.annotations({
    description: "Parent context levels to include (0-10, default 3)"
  }))
});
export type GetPostThreadInput = Schema.Schema.Type<typeof GetPostThreadInput>;

export const ThreadPostPosition = Schema.Literal("ancestor", "focus", "reply");
export type ThreadPostPosition = Schema.Schema.Type<typeof ThreadPostPosition>;

export const ThreadPostResult = Schema.Struct({
  uri: AtUri,
  did: Did,
  handle: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.String,
  replyCount: Schema.NullOr(Schema.Number),
  repostCount: Schema.NullOr(Schema.Number),
  likeCount: Schema.NullOr(Schema.Number),
  quoteCount: Schema.NullOr(Schema.Number),
  position: ThreadPostPosition
});
export type ThreadPostResult = Schema.Schema.Type<typeof ThreadPostResult>;

export const PostThreadOutput = Schema.Struct({
  focusUri: AtUri,
  ancestors: Schema.Array(ThreadPostResult),
  focus: ThreadPostResult,
  replies: Schema.Array(ThreadPostResult)
});
export type PostThreadOutput = Schema.Schema.Type<typeof PostThreadOutput>;
```

### 4.2 MCP wrapper in `OutputSchemas.ts`

```typescript
import { PostThreadOutput } from "../domain/bi.ts";

export const PostThreadMcpOutput = Schema.extend(PostThreadOutput, DisplayField);
export type PostThreadMcpOutput = Schema.Schema.Type<typeof PostThreadMcpOutput>;
```

**Verify:** `bunx tsc --noEmit -p tsconfig.json`

**Commit:**
```bash
git add src/domain/bi.ts src/mcp/OutputSchemas.ts
git commit -m "feat(thread): add thread domain types and MCP output schema"
```

---

## Task 5: Thread Display Formatter

**Files:**
- Modify: `src/mcp/Fmt.ts`

Add `formatPostThread` to the formatter module:

```typescript
export const formatPostThread = (
  result: { focusUri: string; ancestors: ReadonlyArray<any>; focus: any; replies: ReadonlyArray<any> }
): string => {
  const lines: string[] = [];
  lines.push(`Thread for ${result.focusUri}`);

  if (result.ancestors.length > 0) {
    lines.push("");
    lines.push("--- Ancestors ---");
    for (const [i, a] of result.ancestors.entries()) {
      const handle = a.handle ? `@${a.handle}` : a.did;
      const engagement = `♡${a.likeCount ?? 0} ↻${a.repostCount ?? 0} 💬${a.replyCount ?? 0}`;
      lines.push(`[A${i + 1}] ${handle} · ${a.createdAt.slice(0, 10)} · ${engagement}`);
      lines.push(`     ${truncate(collapse(a.text), 150)}`);
      lines.push(`     URI: ${a.uri}`);
    }
  }

  lines.push("");
  lines.push("--- Focus ---");
  const f = result.focus;
  const fHandle = f.handle ? `@${f.handle}` : f.did;
  const fEngagement = `♡${f.likeCount ?? 0} ↻${f.repostCount ?? 0} 💬${f.replyCount ?? 0}`;
  lines.push(`[F] ${fHandle} · ${f.createdAt.slice(0, 10)} · ${fEngagement}`);
  lines.push(`    ${truncate(collapse(f.text), 200)}`);
  lines.push(`    URI: ${f.uri}`);

  if (result.replies.length > 0) {
    lines.push("");
    lines.push(`--- Replies (${result.replies.length}) ---`);
    for (const [i, r] of result.replies.entries()) {
      const handle = r.handle ? `@${r.handle}` : r.did;
      const engagement = `♡${r.likeCount ?? 0} ↻${r.repostCount ?? 0} 💬${r.replyCount ?? 0}`;
      lines.push(`[R${i + 1}] ${handle} · ${r.createdAt.slice(0, 10)} · ${engagement}`);
      lines.push(`     ${truncate(collapse(r.text), 150)}`);
      lines.push(`     URI: ${r.uri}`);
    }
  }

  return lines.join("\n");
};
```

Note: Uses plain string concatenation (not `@effect/printer` Doc) to avoid the stack overflow pattern. The formatter is simple enough that `Doc` adds no value.

**Verify:** Add test in `tests/mcp-fmt.test.ts` for `formatPostThread`.

**Commit:**
```bash
git add src/mcp/Fmt.ts tests/mcp-fmt.test.ts
git commit -m "feat(thread): add thread display formatter with ancestor/focus/reply sections"
```

---

## Task 6: MCP Tool — get_post_thread

**Files:**
- Modify: `src/mcp/Toolkit.ts` — add tool definition + handler
- Modify: `src/mcp/Router.ts` — widen layer type to include `BlueskyClient`

### 6.1 Tool definition

```typescript
import { GetPostThreadInput, PostThreadOutput } from "../domain/bi";
import { PostThreadMcpOutput } from "./OutputSchemas.ts";

export const GetPostThreadTool = Tool.make("get_post_thread", {
  description: "Get the thread context for a Bluesky post. Returns ancestor posts (conversation history), the focus post, and replies. Includes engagement metrics (likes, reposts, reply counts). Calls the live Bluesky API.",
  parameters: GetPostThreadInput.fields,
  success: PostThreadMcpOutput,
  failure: McpToolQueryError
})
  .annotate(Tool.Title, "Get Post Thread")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);  // calls external Bluesky API
```

Add to `KnowledgeMcpToolkit = Toolkit.make(...)`.

### 6.2 Handler

```typescript
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { flattenThread } from "../bluesky/ThreadFlatten.ts";
import { formatPostThread } from "./Fmt.ts";

// In KnowledgeMcpHandlers Effect.gen:
const bskyClient = yield* BlueskyClient;

// Handler:
get_post_thread: (input) =>
  bskyClient.getPostThread(input.postUri, {
    depth: Math.min(input.depth ?? 3, 10),
    parentHeight: Math.min(input.parentHeight ?? 3, 10)
  }).pipe(
    Effect.flatMap((response) => {
      const flat = flattenThread(response.thread);
      if (!flat) {
        return Effect.fail(McpToolQueryError.make({
          tool: "get_post_thread",
          message: "Post not found or thread unavailable",
          error: new Error("thread decode failed")
        }));
      }

      const toResult = (post: ThreadPostView, position: string) => {
        const text = extractText(post.record);
        return {
          uri: post.uri,
          did: post.author.did,
          handle: post.author.handle ?? null,
          displayName: post.author.displayName ?? null,
          text,
          createdAt: post.indexedAt,
          replyCount: post.replyCount ?? null,
          repostCount: post.repostCount ?? null,
          likeCount: post.likeCount ?? null,
          quoteCount: post.quoteCount ?? null,
          position
        };
      };

      const result = {
        focusUri: flat.focus.uri,
        ancestors: flat.ancestors.map(p => toResult(p, "ancestor")),
        focus: toResult(flat.focus, "focus"),
        replies: flat.replies.map(p => toResult(p, "reply")),
        _display: formatPostThread(...)
      };

      return Effect.succeed(result);
    }),
    Effect.mapError(toQueryError("get_post_thread"))
  ),
```

### 6.3 Router type widening

`makeMcpLayer` in `Router.ts` needs `BlueskyClient` in the service layer. Since the agent worker's `makeAdminWorkerLayer` already includes `BlueskyClient` (via `ExpertRegistryService` dependency), this should work without additional layer changes.

Verify by checking that `makeQueryLayer` or `makeAdminWorkerLayer` provides `BlueskyClient`.

### 6.4 Text extraction helper

The Bluesky `PostView.record` is `Schema.Unknown`. We need a helper to extract text:

```typescript
const extractText = (record: unknown): string => {
  if (typeof record === "object" && record !== null && "text" in record) {
    return typeof record.text === "string" ? record.text : "";
  }
  return "";
};
```

### 6.5 Update tool list test

Update `tests/mcp.test.ts` tool list assertion from 9 to 10 tools, adding `"get_post_thread"` in alphabetical position.

**Verify:** `bunx tsc --noEmit -p tsconfig.json` + `bun run test`

**Commit:**
```bash
git add src/mcp/Toolkit.ts src/mcp/Router.ts tests/mcp.test.ts
git commit -m "feat(thread): add get_post_thread MCP tool with live Bluesky API integration"
```

---

## Task 7: Integration Test + Glossary Update

**Files:**
- Modify: `tests/mcp.test.ts` — add integration test
- Modify: `src/mcp/glossary.ts` — document the new tool

### 7.1 Integration test

Note: This test calls the LIVE Bluesky API. Mark it appropriately:

```typescript
describe("thread expansion", () => {
  it.live("get_post_thread returns thread with engagement data", () =>
    // Use a known public post URI (e.g., from the seeded fixture data)
    // Call the tool via MCP client
    // Verify response has focus post with engagement counts
    // Verify _display contains [F] and engagement symbols
  );
});
```

**Caveat:** Live API tests may be flaky. Consider a unit test path using mocked `BlueskyClient` instead.

### 7.2 Glossary update

Add to `src/mcp/glossary.ts`:

```
**Thread** — A conversation on Bluesky: a chain of reply posts. The \`get_post_thread\` tool fetches ancestors (parent posts), the focus post, and replies with engagement counts (likes, reposts, reply counts). Thread data comes from the live Bluesky API, not the local knowledge store.
```

Update the Display Convention section to include thread IDs:
```
- \`[A1]\`, \`[A2]\` — Thread ancestors (oldest first)
- \`[F]\` — Thread focus post
- \`[R1]\`, \`[R2]\` — Thread replies
```

**Commit:**
```bash
git add tests/mcp.test.ts src/mcp/glossary.ts
git commit -m "feat(thread): add integration test and glossary documentation"
```

---

## Task 8: Deploy + Verify

Deploy to staging and test live:

```bash
bunx wrangler deploy --config wrangler.agent.toml --env staging
```

Test via MCP:
```
get_post_thread(postUri: "at://did:plc:.../app.bsky.feed.post/...")
```

Use a post URI from the solar discussion thread discovered earlier (the @dave.bzky.team "oil price vs solar" thread).

---

## Milestone Summary

| Task | Deliverable | Key Files |
|------|-------------|-----------|
| 1 | Thread response schemas | `ThreadTypes.ts` |
| 2 | BlueskyClient methods | `BlueskyClient.ts` |
| 3 | Thread flattening | `ThreadFlatten.ts` |
| 4 | Domain + MCP output types | `bi.ts`, `OutputSchemas.ts` |
| 5 | Display formatter | `Fmt.ts` |
| 6 | MCP tool + handler | `Toolkit.ts`, `Router.ts` |
| 7 | Tests + glossary | `mcp.test.ts`, `glossary.ts` |
| 8 | Deploy + verify | Staging |

## Acceptance Criteria

1. `get_post_thread` returns ancestors, focus, and replies with engagement counts
2. Display format shows `[A1]`, `[F]`, `[R1]` with `♡`, `↻`, `💬` counters
3. Depth and parentHeight clamped to 0-10 at MCP layer
4. Tool annotated as `OpenWorld: true` (external API call)
5. Thread flattening handles missing/blocked posts gracefully
6. No `@atproto/api` dependency — lightweight custom schemas only
7. All 230+ tests pass + new thread tests
8. Glossary documents the thread tool and display IDs
