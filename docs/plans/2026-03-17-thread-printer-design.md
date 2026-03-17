# Thread Printer — Design Document

## Context

The `get_post_thread` MCP tool returns structured thread data (ancestors, focus, replies) with a `_display` string. This works for programmatic access but produces a data dump, not a readable document. Agents reasoning about thread content need a narrative they can summarize, not an array they must reassemble.

The opportunity-solution tree identifies "thread-as-document" as the highest-priority POC. This design implements it as a composable printer — a pure filter-reduce that takes a flattened thread and produces a compact document optimized for agent consumption.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Composable pure function, no Effect service | No side effects — takes data in, produces document out. Vision enrichment happens upstream. |
| Filter model | Pipeable `ReplyTransform` endomorphisms via `flow` | Each filter step is `identity` when unconfigured; compose with `flow` for zero-overhead no-ops. |
| Predicate composition | Effect `Predicate` primitives | Type-safe, composable. New filter dimensions = new predicates in the pipeline. |
| Structural closure | `ensureClosure` step after filtering | If a reply survives filtering, its ancestor chain back to focus is restored. Prevents orphaned indented replies. |
| Render engine | `@effect/printer` Doc combinators | Safe because printer input is bounded by `topN` (max 50) + author posts. The existing `formatPostThread` handles unbounded input — it stays as string concat. |
| Output format | Narrative flow (reads like an article) | Agents need to reason about content, not parse metadata. Structured data stays in `get_post_thread`. |
| Primary tool | `get_thread_document` (new) | Becomes the recommended thread tool. `get_post_thread` stays available for programmatic access. |
| Fetch vs print controls | Separate parameters | `depth`/`parentHeight` control Bluesky API fetch breadth. `maxDepth`/`minLikes`/`topN` control printer-time filtering. Both exposed. |
| Ancestors | Always included when fetched | No `includeAncestors` toggle. Use `parentHeight: 0` at fetch time if ancestors aren't wanted. |
| `_display` field | Not used for `get_thread_document` | `body` is the display. No `DisplayField` extension — avoids duplication. |
| File placement | `src/bluesky/ThreadPrinter.ts` | Same layer as `ThreadFlatten.ts` — Bluesky domain concern, not MCP concern. |

## Types

### PrinterConfig

```typescript
// src/bluesky/ThreadPrinter.ts

export const PrinterConfig = Schema.Struct({
  maxDepth: Schema.optional(Schema.Number),   // max reply nesting level
  minLikes: Schema.optional(Schema.Number),   // engagement floor
  topN: Schema.optional(Schema.Number)        // keep N highest-engagement replies
});
export type PrinterConfig = Schema.Schema.Type<typeof PrinterConfig>;
```

### ThreadDocument

Plain interface — printer output, not an API boundary.

```typescript
export interface ThreadDocument {
  readonly title: string;        // "BC Hydro Imports — @blakeshaffer · 2026-03-15"
  readonly postCount: number;    // author's posts in thread
  readonly replyCount: number;   // filtered reply count
  readonly totalReplies: number; // unfiltered count (for "filtered from X")
  readonly body: string;         // full rendered document
}
```

## Filter Pipeline

Each filter dimension is a `ReplyTransform` — an endomorphism on `ReadonlyArray<FlattenedPost>`. Unconfigured dimensions produce `identity`. Composed with `flow`.

### Predicates

```typescript
import { Predicate, Array as A, flow, identity } from "effect";

const withinDepth = (max: number): Predicate.Predicate<FlattenedPost> =>
  (post) => post.depth <= max;

const meetsEngagement = (min: number): Predicate.Predicate<FlattenedPost> =>
  (post) => (post.post.likeCount ?? 0) >= min;
```

### Pipeable Transform Steps

```typescript
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
        A.sort(byDfsPosition)     // restore thread reading order after top-N
      );
```

### Structural Closure

After filtering, some replies may survive while their parent reply was removed. This produces misleading indentation with no visible parent context. The `ensureClosure` step walks each surviving reply's `parentUri` chain and restores any missing ancestors back to the focus post.

```typescript
const ensureClosure = (
  kept: ReadonlyArray<FlattenedPost>,
  all: ReadonlyArray<FlattenedPost>
): ReadonlyArray<FlattenedPost> => {
  const keptUris = new Set(kept.map((r) => r.post.uri));
  const allByUri = new Map(all.map((r) => [r.post.uri, r]));

  for (const reply of kept) {
    let parentUri = reply.parentUri;
    while (parentUri && !keptUris.has(parentUri)) {
      const parent = allByUri.get(parentUri);
      if (!parent || parent.depth <= 0) break;  // stop at focus boundary
      keptUris.add(parentUri);
      parentUri = parent.parentUri;
    }
  }

  // Return in original DFS order
  return all.filter((r) => keptUris.has(r.post.uri));
};
```

### Composed Pipeline

```typescript
const buildFilterPipeline = (
  config: PrinterConfig,
  allReplies: ReadonlyArray<FlattenedPost>
): ReplyTransform =>
  flow(
    capDepth(config.maxDepth),
    requireEngagement(config.minLikes),
    takeTopN(config.topN),
    (kept) => ensureClosure(kept, allReplies)
  );
```

Filter order: depth cap → engagement threshold → top-N → structural closure. Closure runs last so it can restore parents removed by any earlier step.

## DFS Position Tracking

After top-N filtering, replies must be re-sorted into thread reading order. This requires a `dfsIndex` field on `FlattenedPost`:

```typescript
export interface FlattenedPost {
  readonly post: ThreadPostView;
  readonly depth: number;
  readonly parentUri: string | null;
  readonly dfsIndex: number;  // original DFS traversal position
}
```

Assigned during `flattenThread` traversal. Used by `byDfsPosition` comparator in `takeTopN`.

## Render Pipeline

Uses `@effect/printer` Doc combinators. Type: `Doc<never>` (plain text, no annotations). Render style: `compact` (non-recursive).

**Safety note:** The existing `formatPostThread` in `Fmt.ts` uses string concat because it handles unbounded reply sets. The printer is safe to use Doc because its input is bounded by `topN` (max 50) plus author posts (typically <20). The Doc tree never grows large enough for stack issues.

### Atomic Renderers

Small `(input) => SDoc` functions, composable and testable in isolation:

```typescript
type SDoc = Doc.Doc<never>;

const authorTag = (index: number, total: number): SDoc =>
  Doc.text(`[${index + 1}/${total}]`);

const handle = (post: FlattenedPost): SDoc =>
  Doc.text(`@${post.post.author.handle ?? post.post.author.did}`);

const engagement = (post: FlattenedPost): SDoc =>
  Doc.hsep([
    Doc.text(`♡${post.post.likeCount ?? 0}`),
    Doc.text(`↻${post.post.repostCount ?? 0}`),
    Doc.text(`💬${post.post.replyCount ?? 0}`)
  ]);

const embedLine = (embed: ThreadEmbedView | undefined): SDoc => {
  if (!embed?.$type) return Doc.empty;
  const t = embed.$type;
  if (t.includes("images") && embed.images?.length)
    return Doc.vsep(
      embed.images.map((img) =>
        Doc.text(`📊 ${img.alt ?? "Image"} (${img.fullsize})`)
      )
    );
  if (t.includes("external") && embed.external)
    return Doc.text(`🔗 ${embed.external.title ?? embed.external.uri}`);
  return Doc.empty;
};
```

### Section Renderers

```typescript
const renderAuthorPost = (total: number) =>
  (post: FlattenedPost, index: number): SDoc =>
    Doc.vsep([
      authorTag(index, total),
      Doc.text(extractText(post.post.record)),
      embedLine(post.post.embed)
    ]);

const renderReply = (post: FlattenedPost): SDoc =>
  pipe(
    Doc.vsep([
      Doc.hsep([handle(post), engagement(post)]),
      pipe(Doc.text(extractText(post.post.record)), Doc.nest(2))
    ]),
    Doc.nest((post.depth - 1) * 2)   // depth-based indentation
  );
```

### Document Assembly

```typescript
const renderDocument = (
  thread: FlattenedThread,
  filtered: ReadonlyArray<FlattenedPost>,
  totalReplies: number
): SDoc => {
  const authorPosts = [...thread.ancestors, thread.focus];
  const h = thread.focus.post.author.handle ?? "unknown";
  const date = extractCreatedAt(thread.focus.post.record, thread.focus.post.indexedAt);

  const title = Doc.text(
    `${extractTitle(thread.focus)} — @${h} · ${date.slice(0, 10)}`
  );

  const posts = Doc.vsep(
    authorPosts.map(renderAuthorPost(authorPosts.length))
  );

  const separator = filtered.length < totalReplies
    ? Doc.text(`--- Expert Discussion (${filtered.length} replies, filtered from ${totalReplies}) ---`)
    : Doc.text(`--- Discussion (${filtered.length} replies) ---`);

  const replies = Doc.vsep(filtered.map(renderReply));

  return Doc.vsep([title, Doc.hardLine, posts, Doc.hardLine, separator, Doc.hardLine, replies]);
};
```

### Top-Level Entry Point

```typescript
export const printThread = (
  thread: FlattenedThread,
  config: PrinterConfig = {}
): ThreadDocument => {
  const filter = buildFilterPipeline(config, thread.replies);
  const filtered = filter(thread.replies);
  const doc = renderDocument(thread, filtered, thread.replies.length);

  return {
    title: buildTitle(thread),
    postCount: thread.ancestors.length + 1,
    replyCount: filtered.length,
    totalReplies: thread.replies.length,
    body: Doc.render(doc, { style: "compact" })
  };
};
```

## Output Format

Narrative flow — reads like an article, not a data dump:

```
BC Hydro Imports Thread — @blakeshaffer · 2026-03-15

[1/10] For the first time, all three major hydro provinces...
📊 Line chart showing BC imports 2020-2025 (source: BC Hydro)

[2/10] Manitoba tells a similar story...
📊 Bar chart comparing Manitoba exports YoY

...

--- Expert Discussion (3 replies, filtered from 47) ---

@energy_wonk (♡42): The interconnection queue data actually shows...
  @grid_analyst (♡28): Worth noting the Bonneville constraint...
@policy_nerd (♡19): The FERC filing from last week adds context...
```

## MCP Integration

### A. Existing `get_post_thread` — improved `_display`

Replace `formatPostThread(result)` with `printThread(flat, {}).body`. Structured JSON unchanged. No contract break.

### B. New `get_thread_document` tool — primary thread tool

```typescript
export const GetThreadDocumentInput = Schema.Struct({
  postUri: AtUri,
  // Fetch controls (Bluesky API breadth)
  depth: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 10))),
  parentHeight: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(0, 10))),
  // Printer-time filters
  maxDepth: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 10))),
  minLikes: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))),
  topN: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 50)))
});

export const ThreadDocumentOutput = Schema.Struct({
  title: Schema.String,
  postCount: Schema.Number,
  replyCount: Schema.Number,
  totalReplies: Schema.Number,
  body: Schema.String
});
```

Two layers of control: `depth`/`parentHeight` control how much data the Bluesky API returns. `maxDepth`/`minLikes`/`topN` control what the printer shows from that data. An agent can fetch deep (`depth: 6`) but render compact (`topN: 5, minLikes: 3`).

No `_display` field — `body` is the display. `ThreadDocumentOutput` is not extended with `DisplayField`.

`get_thread_document` becomes the recommended tool for agents reading threads. `get_post_thread` stays for programmatic/structured access.

## Files

| File | Change |
|------|--------|
| `src/bluesky/ThreadPrinter.ts` | **New.** PrinterConfig, filter pipeline with structural closure, Doc renderers, `printThread` entry point |
| `src/bluesky/ThreadFlatten.ts` | Add `dfsIndex` to `FlattenedPost`, assign during traversal |
| `src/domain/bi.ts` | `GetThreadDocumentInput`, `ThreadDocumentOutput` schemas |
| `src/mcp/OutputSchemas.ts` | `ThreadDocumentMcpOutput` (no `DisplayField` — `body` is the display) |
| `src/mcp/Toolkit.ts` | New `get_thread_document` handler; update `get_post_thread` `_display` to use printer |
| `tests/thread-printer.test.ts` | **New.** Filter pipeline tests, closure tests, render tests, integration tests |
| `tests/thread-flatten.test.ts` | Add `dfsIndex` assertions |

## Testing

1. **Predicate tests:** `withinDepth`, `meetsEngagement` in isolation
2. **Pipeline tests:** Composed pipeline with various configs; `identity` when unconfigured; filter order matters
3. **Structural closure:** Orphaned depth-3 reply → parent chain restored; already-complete chain → no change; focus boundary respected
4. **Top-N re-sort:** Verify thread reading order preserved after engagement slice
5. **Render tests:** Author posts with embeds; reply depth indentation; filtered-from count display
6. **Integration:** Mock thread → `printThread` → verify document structure and body content
7. **MCP decode:** `get_thread_document` through MCP client → decode `ThreadDocumentOutput`

## Verification

1. `bun run test` — all tests pass
2. `bunx tsc --noEmit` — clean
3. Deploy to staging
4. Live test: `get_thread_document` on Blake Shaffer hydro thread — verify narrative reads coherently
5. Live test: same thread with `topN: 3, minLikes: 5` — verify filtering and closure work
6. Live test: verify `get_post_thread` `_display` now uses printer output

## Related

- `docs/plans/2026-03-17-opportunity-solution-tree.md` — POC 1: Thread-as-document
- `docs/plans/2026-03-17-jobs-to-be-done.md` — Core job: understand expert discourse
- `docs/canonical-threads.md` — Test cases for document rendering
