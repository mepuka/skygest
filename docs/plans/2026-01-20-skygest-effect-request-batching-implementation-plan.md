# Skygest Effect Request Batching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class Effect Request batching for write paths and refactor FilterWorker to use declarative Match + pipe pipelines.

**Architecture:** Introduce `PutPost` / `DeletePost` Request types and a `PostsWriteResolver` using `RequestResolver.fromEffectTagged` to batch D1 writes. Update PostsRepo to support `markDeletedMany`, and refactor FilterWorker to convert events into Requests and execute via `Effect.request` with batching enabled.

**Tech Stack:** TypeScript, Effect (Request, RequestResolver, Match, Option), @effect/sql, @effect/sql-d1.

**Skill References:** @cloudflare (d1), Effect Request batching docs.

---

### Task 1: PostsRepo batched delete support

**Files:**
- Modify: `src/services/PostsRepo.ts`
- Modify: `src/services/d1/PostsRepoD1.ts`
- Modify: `src/services/d1/PostsRepoD1.test.ts`

**Step 1: Write the failing test**

Append a test to `src/services/d1/PostsRepoD1.test.ts`:

```ts
it("marks many posts deleted", async () => {
  const program = Effect.gen(function* () {
    yield* runMigrations;
    const repo = yield* PostsRepo;
    yield* repo.putMany([
      {
        uri: "at://did:plc:1/app.bsky.feed.post/1",
        cid: "cid1",
        authorDid: "did:plc:1",
        createdAt: 200,
        indexedAt: 250,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      },
      {
        uri: "at://did:plc:2/app.bsky.feed.post/2",
        cid: "cid2",
        authorDid: "did:plc:2",
        createdAt: 100,
        indexedAt: 150,
        searchText: "arxiv",
        replyRoot: null,
        replyParent: null,
        status: "active"
      }
    ]);
    yield* repo.markDeletedMany([
      "at://did:plc:1/app.bsky.feed.post/1",
      "at://did:plc:2/app.bsky.feed.post/2"
    ]);
    return yield* repo.listRecent(null, 10);
  });

  const result = await Effect.runPromise(
    program.pipe(
      Effect.provide(PostsRepoD1.layer),
      Effect.provide(SqliteClient.layer({ filename: ":memory:" }))
    )
  );

  expect(result.length).toBe(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`
Expected: FAIL (missing `markDeletedMany`).

**Step 3: Write minimal implementation**

Update `src/services/PostsRepo.ts`:

```ts
readonly markDeletedMany: (uris: ReadonlyArray<string>) => Effect.Effect<void>;
```

Update `src/services/d1/PostsRepoD1.ts`:

```ts
const markDeletedMany = (uris: ReadonlyArray<string>) =>
  uris.length === 0
    ? Effect.void
    : sql`UPDATE posts SET status = 'deleted' WHERE ${sql.in("uri", uris)}`.pipe(Effect.asVoid);
```

Add `markDeletedMany` to the service return.

**Step 4: Run test to verify it passes**

Run: `bun test src/services/d1/PostsRepoD1.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/PostsRepo.ts src/services/d1/PostsRepoD1.ts src/services/d1/PostsRepoD1.test.ts

git commit -m "feat: add batched delete for posts"
```

---

### Task 2: Posts write requests + resolver

**Files:**
- Create: `src/services/PostsWriteResolver.ts`
- Test: `src/services/PostsWriteResolver.test.ts`

**Step 1: Write the failing test**

```ts
import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { PostsRepo, PaperPost } from "./PostsRepo";
import { DeletePost, PutPost, PostsWriteResolver } from "./PostsWriteResolver";
import { Effect as EffectModule } from "effect";

it("batches put and delete requests", async () => {
  let putCalls = 0;
  let deleteCalls = 0;
  let putCount = 0;
  let deleteCount = 0;

  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: (posts: ReadonlyArray<PaperPost>) =>
      Effect.sync(() => {
        putCalls += 1;
        putCount += posts.length;
      }),
    listRecent: () => Effect.succeed([]),
    markDeleted: () => Effect.void,
    markDeletedMany: (uris: ReadonlyArray<string>) =>
      Effect.sync(() => {
        deleteCalls += 1;
        deleteCount += uris.length;
      })
  });

  const requests = [
    new PutPost({ post: { uri: "at://1", cid: "c1", authorDid: "did:1", createdAt: 1, indexedAt: 1, searchText: null, replyRoot: null, replyParent: null, status: "active" } }),
    new PutPost({ post: { uri: "at://2", cid: "c2", authorDid: "did:2", createdAt: 2, indexedAt: 2, searchText: null, replyRoot: null, replyParent: null, status: "active" } }),
    new DeletePost({ uri: "at://3" })
  ];

  await EffectModule.runPromise(
    EffectModule.forEach(
      requests,
      (req) => EffectModule.request(req, PostsWriteResolver),
      { concurrency: "unbounded", discard: true }
    ).pipe(
      EffectModule.withRequestBatching(true),
      EffectModule.withRequestCaching(false),
      EffectModule.provide(PostsTest)
    )
  );

  expect(putCalls).toBe(1);
  expect(putCount).toBe(2);
  expect(deleteCalls).toBe(1);
  expect(deleteCount).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/services/PostsWriteResolver.test.ts`
Expected: FAIL (module not found).

**Step 3: Write minimal implementation**

Create `src/services/PostsWriteResolver.ts`:

```ts
import { Effect, Request, RequestResolver } from "effect";
import { PostsRepo, PaperPost } from "./PostsRepo";

export class PutPost extends Request.TaggedClass("PutPost")<
  void,
  never,
  { readonly post: PaperPost }
>() {}

export class DeletePost extends Request.TaggedClass("DeletePost")<
  void,
  never,
  { readonly uri: string }
>() {}

export type PostsWriteRequest = PutPost | DeletePost;

export const PostsWriteResolver = RequestResolver.fromEffectTagged<PostsWriteRequest>()({
  PutPost: (requests) =>
    Effect.gen(function* () {
      const posts = yield* PostsRepo;
      yield* posts.putMany(requests.map((req) => req.post));
      return requests.map(() => undefined);
    }),
  DeletePost: (requests) =>
    Effect.gen(function* () {
      const posts = yield* PostsRepo;
      yield* posts.markDeletedMany(requests.map((req) => req.uri));
      return requests.map(() => undefined);
    })
});
```

**Step 4: Run test to verify it passes**

Run: `bun test src/services/PostsWriteResolver.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/PostsWriteResolver.ts src/services/PostsWriteResolver.test.ts

git commit -m "feat: add posts write request batching"
```

---

### Task 3: Refactor FilterWorker to use requests + Match

**Files:**
- Modify: `src/filter/FilterWorker.ts`
- Modify: `src/filter/FilterWorker.test.ts`

**Step 1: Write the failing test**

Update `src/filter/FilterWorker.test.ts`:

```ts
const batch: RawEventBatch = {
  cursor: 1,
  events: [
    {
      kind: "commit",
      operation: "create",
      collection: "app.bsky.feed.post",
      did: "did:plc:1",
      uri: "at://did:plc:1/app.bsky.feed.post/1",
      cid: "cid",
      record: { text: "https://arxiv.org/abs/2401.00001" },
      timeUs: 1
    },
    {
      kind: "commit",
      operation: "delete",
      collection: "app.bsky.feed.post",
      did: "did:plc:1",
      uri: "at://did:plc:1/app.bsky.feed.post/1",
      cid: "cid",
      record: undefined,
      timeUs: 2
    }
  ]
};

expect(inserted).toBe(1);
expect(deleted).toBe(1);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/filter/FilterWorker.test.ts`
Expected: FAIL (missing `markDeletedMany` or batching changes).

**Step 3: Write minimal implementation**

Refactor `src/filter/FilterWorker.ts` to:
- Use `Match.value(event)` and `Option` pipelines to map events → `Option<PostsWriteRequest>`.
- Use `Array.filterMap` to collect requests.
- Use `Effect.request` + `Effect.forEach` with batching enabled.

Suggested implementation:

```ts
import { Array, Effect, Match, Option } from "effect";
import { RawEvent, RawEventBatch } from "../domain/types";
import { buildSearchText, containsPaperLink } from "../filters/paperFilter";
import { DeletePost, PutPost, PostsWriteResolver } from "../services/PostsWriteResolver";

const toRequest = (event: RawEvent) =>
  Match.value(event).pipe(
    Match.when({ collection: "app.bsky.feed.post", operation: "delete" }, (e) =>
      Option.some(new DeletePost({ uri: e.uri }))
    ),
    Match.when({ collection: "app.bsky.feed.post" }, (e) =>
      Option.fromNullable(e.record).pipe(
        Option.map((record) => ({ record, event: e })),
        Option.map(({ record, event }) => {
          const searchText = buildSearchText(record as any);
          return { event, searchText };
        }),
        Option.filter((entry) => containsPaperLink(entry.searchText)),
        Option.map((entry) => new PutPost({
          post: {
            uri: entry.event.uri,
            cid: entry.event.cid ?? "",
            authorDid: entry.event.did,
            createdAt: Math.floor(entry.event.timeUs / 1000),
            indexedAt: Date.now(),
            searchText: entry.searchText,
            replyRoot: null,
            replyParent: null,
            status: "active" as const
          }
        }))
      )
    ),
    Match.orElse(() => Option.none())
  );

export const processBatch = (batch: RawEventBatch) =>
  Effect.forEach(
    Array.filterMap(batch.events, toRequest),
    (req) => Effect.request(req, PostsWriteResolver),
    { concurrency: "unbounded", discard: true }
  ).pipe(
    Effect.withRequestBatching(true),
    Effect.withRequestCaching(false)
  );
```

**Step 4: Run test to verify it passes**

Run: `bun test src/filter/FilterWorker.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/filter/FilterWorker.ts src/filter/FilterWorker.test.ts

git commit -m "refactor: batch filter writes with requests"
```

---

## Verification

- `bun test`
