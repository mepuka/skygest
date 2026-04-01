# Twitter Import v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a platform-agnostic bulk import endpoint and local CLI commands so an operator can ingest Twitter posts into the existing Skygest pipeline without modifying the Bluesky-specific code paths.

**Architecture:** Keep `AtUri` untouched — introduce a separate `PostUri` type that accepts both `at://` and `x://` schemes. The import endpoint uses `PostUri` and writes to the same D1 tables. Twitter experts use synthetic DIDs (`did:x:user_id`) and are filtered from the Bluesky poller by DID prefix. Embed payloads are stored at import time (not during curate). `PostHydrationService` skips live Bluesky fetch for `x://` URIs and uses stored data instead.

**Tech Stack:** Effect.ts, D1 SQL, Cloudflare Workers admin API, Bun CLI, better_twitter_scraper

---

## Design Decisions (locked in during brainstorming)

1. **`AtUri` stays intact** — only Bluesky paths use it. New `PostUri` type accepts both `at://` and `x://`. Existing schemas naturally reject Twitter URIs until explicitly widened.
2. **No schema migration** — DID prefix (`did:x:`) discriminates platform. Expert `source` field gets a new literal value.
3. **Poller protection via DID prefix** — `IngestRunWorkflow.resolveTargets` filters out non-`did:plc:` experts. Zero migration, zero config.
4. **Embed payloads stored at import time** — written to `post_payloads` during import so enrichment works without a live fetch.
5. **PostHydrationService skips live fetch for `x://`** — returns stored data (expert avatar/display name from DB, embed from post_payloads) instead of calling BlueskyClient.

---

## Task 1: Introduce `PostUri` Type

**Files:**
- Modify: `src/domain/types.ts`
- Test: `tests/post-uri.test.ts`

### Step 1: Write the failing test

Create `tests/post-uri.test.ts`:

```ts
import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { PostUri, platformFromUri } from "../src/domain/types";

describe("PostUri", () => {
  const decode = Schema.decodeUnknownSync(PostUri);

  it("accepts at:// URIs", () => {
    expect(decode("at://did:plc:abc/app.bsky.feed.post/xyz")).toBe(
      "at://did:plc:abc/app.bsky.feed.post/xyz"
    );
  });

  it("accepts x:// URIs", () => {
    expect(decode("x://12345/status/9876543210")).toBe(
      "x://12345/status/9876543210"
    );
  });

  it("rejects other schemes", () => {
    expect(() => decode("https://example.com")).toThrow();
    expect(() => decode("tweet://123")).toThrow();
    expect(() => decode("")).toThrow();
  });
});

describe("platformFromUri", () => {
  it("returns bluesky for at:// URIs", () => {
    expect(platformFromUri("at://did:plc:abc/app.bsky.feed.post/xyz" as any))
      .toBe("bluesky");
  });

  it("returns twitter for x:// URIs", () => {
    expect(platformFromUri("x://12345/status/9876543210" as any))
      .toBe("twitter");
  });
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/post-uri.test.ts`
Expected: FAIL — `PostUri` and `platformFromUri` not exported

### Step 3: Implement

In `src/domain/types.ts`, add after the `AtUri` definition:

```ts
export const PostUri = Schema.String.pipe(
  Schema.pattern(/^(at|x):\/\//),
  Schema.brand("PostUri")
).annotations({ description: "Post URI — at:// (Bluesky) or x:// (Twitter)" });
export type PostUri = Schema.Schema.Type<typeof PostUri>;

export type Platform = "bluesky" | "twitter";

export const platformFromUri = (uri: PostUri): Platform =>
  (uri as string).startsWith("at://") ? "bluesky" : "twitter";
```

NOTE: `AtUri` stays untouched. `PostUri` is a separate, wider type. The two are not related by extends — they're independent branded types. Code that uses `AtUri` still rejects `x://` URIs.

### Step 4: Run test to verify it passes

Run: `bun run test tests/post-uri.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/domain/types.ts tests/post-uri.test.ts
git commit -m "feat(domain): add PostUri type accepting at:// and x:// schemes (SKY-XX)"
```

---

## Task 2: Widen ExpertSource for Twitter Imports

**Files:**
- Modify: `src/domain/bi.ts`
- Test: verify existing tests still pass

### Step 1: Add `"twitter-import"` to ExpertSource

In `src/domain/bi.ts`, the current `ExpertSource` is:

```ts
export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network");
```

Add `"twitter-import"`:

```ts
export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network", "twitter-import");
```

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass — this is an additive change to a literal union

### Step 3: Commit

```bash
git add src/domain/bi.ts
git commit -m "feat(domain): add twitter-import expert source (SKY-XX)"
```

---

## Task 3: Import Request/Response Schemas

**Files:**
- Modify: `src/domain/api.ts`
- Test: `tests/import-schema.test.ts`

### Step 1: Write the failing test

Create `tests/import-schema.test.ts`:

```ts
import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { ImportPostsInput, ImportPostsOutput } from "../src/domain/api";

describe("ImportPostsInput", () => {
  const decode = Schema.decodeUnknownSync(ImportPostsInput);

  it("decodes a valid import payload with experts and posts", () => {
    const result = decode({
      experts: [{
        did: "did:x:12345",
        handle: "energyexpert",
        domain: "energy",
        source: "twitter-import",
        tier: "energy-focused"
      }],
      posts: [{
        uri: "x://12345/status/9876543210",
        did: "did:x:12345",
        text: "Solar curtailment hit a new record in CAISO",
        createdAt: 1741234567000,
        embedType: "img",
        links: []
      }]
    });
    expect(result.experts).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
  });

  it("accepts posts without embed data", () => {
    const result = decode({
      experts: [],
      posts: [{
        uri: "x://12345/status/111",
        did: "did:x:12345",
        text: "Just a text post",
        createdAt: 1741234567000,
        links: []
      }]
    });
    expect(result.posts[0]?.embedType).toBeUndefined();
  });
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/import-schema.test.ts`
Expected: FAIL — `ImportPostsInput` not exported

### Step 3: Implement

In `src/domain/api.ts`, add the import schemas. Read the file first to find the right location (after existing admin schemas, before the `AdminRequestSchemas` / `AdminResponseSchemas` objects).

```ts
// Add imports at top:
import { PostUri } from "./types";

// Import schemas:
const ImportExpertInput = Schema.Struct({
  did: Did,
  handle: Schema.String,
  displayName: Schema.optional(Schema.String),
  avatar: Schema.optional(Schema.String),
  domain: Schema.String,
  source: ExpertSource,
  tier: ExpertTier
});

const ImportPostInput = Schema.Struct({
  uri: PostUri,
  did: Did,
  text: Schema.String,
  createdAt: Schema.Number,
  embedType: Schema.optional(Schema.NullOr(ThreadEmbedType)),
  embedPayload: Schema.optional(Schema.NullOr(EmbedPayload)),
  links: Schema.Array(Schema.Struct({
    url: Schema.String,
    title: Schema.optional(Schema.NullOr(Schema.String)),
    description: Schema.optional(Schema.NullOr(Schema.String)),
    domain: Schema.optional(Schema.NullOr(Schema.String))
  }))
});

export const ImportPostsInput = Schema.Struct({
  experts: Schema.Array(ImportExpertInput),
  posts: Schema.Array(ImportPostInput)
});
export type ImportPostsInput = Schema.Schema.Type<typeof ImportPostsInput>;

export const ImportPostsOutput = Schema.Struct({
  imported: Schema.Number,
  flagged: Schema.Number,
  skipped: Schema.Number
});
export type ImportPostsOutput = Schema.Schema.Type<typeof ImportPostsOutput>;
```

Also add to `AdminRequestSchemas` and `AdminResponseSchemas`:

```ts
// In AdminRequestSchemas:
importPosts: ImportPostsInput,

// In AdminResponseSchemas:
importPosts: ImportPostsOutput,
```

NOTE: `ImportPostInput.uri` uses `PostUri` (accepts `x://`), NOT `AtUri`. `ImportPostInput.did` uses `Did` (which accepts `did:x:` since the regex is `/^did:/`). `embedPayload` is optional — the CLI includes it for Twitter posts with media; the server stores it in `post_payloads` if present.

### Step 4: Run test to verify it passes

Run: `bun run test tests/import-schema.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/domain/api.ts tests/import-schema.test.ts
git commit -m "feat(domain): add import posts request/response schemas (SKY-XX)"
```

---

## Task 4: Extract Topic Matching from FilterWorker

**Files:**
- Create: `src/filter/TopicMatcher.ts`
- Modify: `src/filter/FilterWorker.ts`
- Test: `tests/topic-matcher.test.ts`

### Step 1: Write the failing test

Create `tests/topic-matcher.test.ts`:

```ts
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { matchTopics } from "../src/filter/TopicMatcher";
import { OntologyCatalog } from "../src/services/OntologyCatalog";

describe("matchTopics", () => {
  it.effect("matches topics from text and domains", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "Solar power capacity reached new records in California",
        links: [{ url: "https://gridstatus.io/data", domain: "gridstatus.io" }]
      });
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.some((t) => t.topicSlug === "solar")).toBe(true);
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );

  it.effect("returns empty array for irrelevant text", () =>
    Effect.gen(function* () {
      const topics = yield* matchTopics({
        text: "The weather is nice today",
        links: []
      });
      expect(topics).toHaveLength(0);
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );
});
```

### Step 2: Run test to verify it fails

Run: `bun run test tests/topic-matcher.test.ts`
Expected: FAIL — `matchTopics` not found

### Step 3: Implement

Create `src/filter/TopicMatcher.ts`:

```ts
import { Effect } from "effect";
import type { MatchedTopic } from "../domain/bi";
import { OntologyCatalog } from "../services/OntologyCatalog";

/**
 * Match topics for a post from its text content and link domains.
 *
 * Extracted from FilterWorker so both the Bluesky ingest path and
 * the platform-agnostic import endpoint can reuse the same matching.
 */
export const matchTopics = (input: {
  readonly text: string;
  readonly links: ReadonlyArray<{ readonly domain?: string | null }>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly metadataTexts?: ReadonlyArray<string>;
}) =>
  Effect.flatMap(OntologyCatalog, (ontology) =>
    ontology.match({
      text: input.text,
      metadataTexts: input.metadataTexts ?? [],
      hashtags: input.hashtags ?? [],
      domains: input.links
        .map((l) => l.domain)
        .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
    })
  );
```

Then update `src/filter/FilterWorker.ts` to use `matchTopics` instead of inline `ontology.match()`. Read the file and replace the inline call (around line 96-101) with:

```ts
import { matchTopics } from "./TopicMatcher";

// Replace the inline ontology.match() call with:
return matchTopics({
  text,
  links,
  hashtags: decoded.tags ?? [],
  metadataTexts: collectMetadataTexts(decoded)
}).pipe(
  Effect.map((topics) => ...)
);
```

Remove the `yield* OntologyCatalog` line since `matchTopics` handles it internally.

### Step 4: Run tests

Run: `bun run test tests/topic-matcher.test.ts`
Expected: PASS

Run: `bun run test`
Expected: Full suite passes — FilterWorker behavior unchanged

### Step 5: Commit

```bash
git add src/filter/TopicMatcher.ts src/filter/FilterWorker.ts tests/topic-matcher.test.ts
git commit -m "refactor(filter): extract topic matching into reusable TopicMatcher (SKY-XX)"
```

---

## Task 5: Import Admin Endpoint

**Files:**
- Modify: `src/admin/Router.ts`
- Modify: `src/worker/operatorAuth.ts`
- Test: `tests/import-endpoint.test.ts`

### Step 1: Add operator auth policy

In `src/worker/operatorAuth.ts`, add to the `operatorRequestPolicy` function:

```ts
if (request.method === "POST" && pathname === "/admin/ingest/import") {
  return {
    action: "import_posts",
    scopes: ["ops:refresh"]
  };
}
```

### Step 2: Add the API endpoint and handler

In `src/admin/Router.ts`:

1. Add the endpoint to the `AdminApi` definition (in a new group or existing group):

```ts
.add(
  HttpApiGroup.make("import")
    .add(
      HttpApiEndpoint.post("importPosts", "/admin/ingest/import")
        .setPayload(AdminRequestSchemas.importPosts)
        .addSuccess(AdminResponseSchemas.importPosts)
    )
)
```

2. Add the handler layer. The handler needs to:
   a. Upsert experts (via ExpertsRepo or ExpertRegistryService)
   b. For each post: run `matchTopics()` for topics
   c. Build `KnowledgePost` objects (using `PostUri as unknown as AtUri` for the DB write — the DB column is TEXT, the branded type is just TypeScript enforcement)
   d. Upsert posts via `KnowledgeRepo.upsertPosts()`
   e. For posts with `embedPayload`: write to `post_payloads` via `CandidatePayloadService.capturePayload()` + `markPicked()`
   f. Run `CurationService.flagBatch()` on the batch
   g. Return counts

The handler implementation should:

```ts
.handle("importPosts", ({ payload }) =>
  withAdminErrors("/admin/ingest/import", Effect.gen(function* () {
    const expertsRepo = yield* ExpertsRepo;
    const knowledgeRepo = yield* KnowledgeRepo;
    const payloadService = yield* CandidatePayloadService;
    const curationService = yield* CurationService;
    const now = Date.now();

    // 1. Upsert experts
    if (payload.experts.length > 0) {
      yield* expertsRepo.upsertMany(
        payload.experts.map((e) => ({
          did: e.did,
          handle: e.handle,
          displayName: e.displayName ?? null,
          description: null,
          avatar: e.avatar ?? null,
          domain: e.domain,
          source: e.source,
          sourceRef: null,
          shard: 1,
          active: false,  // Twitter experts are inactive (not polled)
          tier: e.tier,
          addedAt: now,
          lastSyncedAt: null
        }))
      );
    }

    // 2. Match topics + build KnowledgePost objects
    let skipped = 0;
    const posts: KnowledgePost[] = [];

    for (const post of payload.posts) {
      const topics = yield* matchTopics({
        text: post.text,
        links: post.links
      });

      if (topics.length === 0) {
        skipped++;
        continue;
      }

      const links = post.links.map((l) => ({
        url: l.url,
        title: l.title ?? null,
        description: l.description ?? null,
        imageUrl: null,
        domain: l.domain ?? null,
        extractedAt: now
      }));

      posts.push({
        uri: post.uri as unknown as AtUri,  // DB is TEXT, safe
        did: post.did,
        cid: null,
        text: post.text,
        createdAt: post.createdAt,
        indexedAt: now,
        hasLinks: links.length > 0,
        status: "active",
        ingestId: `import-${post.uri}-${now}`,
        embedType: post.embedType ?? null,
        topics,
        links
      } as KnowledgePost);
    }

    // 3. Store posts
    if (posts.length > 0) {
      yield* knowledgeRepo.upsertPosts(posts);
    }

    // 4. Store embed payloads for posts that have them
    for (const post of payload.posts) {
      if (post.embedPayload != null) {
        yield* payloadService.capturePayload({
          postUri: post.uri as unknown as AtUri,
          captureStage: "picked",
          embedType: post.embedType ?? null,
          embedPayload: post.embedPayload
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

        yield* payloadService.markPicked(
          post.uri as unknown as AtUri
        ).pipe(Effect.catchAll(() => Effect.succeed(false)));
      }
    }

    // 5. Flag for curation
    const flagged = yield* curationService.flagBatch(posts).pipe(
      Effect.catchAll(() => Effect.succeed(0))
    );

    return {
      imported: posts.length,
      flagged,
      skipped
    };
  }))
)
```

IMPORTANT: Read the existing `src/admin/Router.ts` carefully before modifying. Match the exact patterns for error handling (`withAdminErrors`), layer composition, and handler structure.

The `as unknown as AtUri` cast is necessary because the DB column is TEXT — the branded type is only TypeScript enforcement. The import endpoint accepts `PostUri` (wider), stores it as TEXT, and the cast satisfies the `KnowledgePost.uri: AtUri` type without changing the existing schema.

### Step 3: Write the test

Create `tests/import-endpoint.test.ts` — test that the endpoint accepts valid import data, stores posts, and flags candidates. Use `makeBiLayer` + `withTempSqliteFile` pattern from existing tests.

### Step 4: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 5: Commit

```bash
git add src/admin/Router.ts src/worker/operatorAuth.ts tests/import-endpoint.test.ts
git commit -m "feat(admin): add /admin/ingest/import endpoint for platform-agnostic post import (SKY-XX)"
```

---

## Task 6: Protect Bluesky Poller from Twitter Experts

**Files:**
- Modify: `src/ingest/IngestRunWorkflow.ts`
- Test: `tests/ingest-run-workflow.test.ts`

### Step 1: Add DID prefix filter

In `src/ingest/IngestRunWorkflow.ts`, find the `resolveTargets` method (around line 121). After getting the list of active experts, filter to Bluesky-only DIDs:

```ts
private async resolveTargets(params: IngestRunParams): Promise<ReadonlyArray<Did>> {
  return await this.runEffect(
    Effect.gen(function* () {
      if (params.dids !== undefined) {
        return dedupe(params.dids);
      }

      const experts = yield* ExpertsRepo;
      const active = yield* experts.listActive();
      // Only poll Bluesky experts — synthetic DIDs (did:x:*) are not pollable
      return active
        .filter((e) => (e.did as string).startsWith("did:plc:"))
        .map((e) => e.did);
    }),
    "IngestRunWorkflow.resolveTargets"
  );
}
```

Read the existing code first — the filter needs to go after `experts.listActive()` but before returning the DID list.

### Step 2: Run tests

Run: `bun run test tests/ingest-run-workflow.test.ts`
Expected: PASS (existing tests use `did:plc:` DIDs, so filter is transparent)

### Step 3: Commit

```bash
git add src/ingest/IngestRunWorkflow.ts
git commit -m "fix(ingest): filter non-Bluesky experts from poll targets (SKY-XX)"
```

---

## Task 7: PostHydrationService Skips Live Fetch for Twitter

**Files:**
- Modify: `src/services/PostHydrationService.ts`
- Test: `tests/post-hydration.test.ts` (if exists, otherwise add to existing test)

### Step 1: Modify hydration to skip `x://` URIs

In `src/services/PostHydrationService.ts`, read the `populateChunk` function. It calls `bluesky.getPosts(uris)`. Before calling, filter to Bluesky URIs only. For Twitter URIs, return empty hydration (the avatar/display name come from the experts table join, and embed data is in post_payloads).

In the `hydratePostsInternal` function (or wherever URIs are collected for hydration), partition into Bluesky and non-Bluesky:

```ts
const blueskyUris = items
  .filter((item) => (item.uri as string).startsWith("at://"))
  .map((item) => item.uri as string);
```

Only pass Bluesky URIs to `populateChunk`. Non-Bluesky items keep their existing data (from the DB join) with `emptyKnowledgePostHydration()`.

Read the existing code carefully — the hydration logic batches URIs into chunks and caches results. The change should only affect which URIs get sent to `bluesky.getPosts()`.

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 3: Commit

```bash
git add src/services/PostHydrationService.ts
git commit -m "fix(hydration): skip live Bluesky fetch for non-at:// URIs (SKY-XX)"
```

---

## Task 8: Ops CLI — Twitter Import Commands

**Files:**
- Modify: `src/ops/Cli.ts`
- Modify: `src/ops/StagingOperatorClient.ts`
- Test: manual testing against staging

This task adds the CLI commands that use the scraper and call the import endpoint. This is the largest task and involves integrating the `better_twitter_scraper` package.

### Step 1: Add import method to StagingOperatorClient

In `src/ops/StagingOperatorClient.ts`, add:

```ts
readonly importPosts: (
  baseUrl: URL,
  secret: Redacted.Redacted<string>,
  input: ImportPostsInput
) => Effect.Effect<ImportPostsOutput, StagingClientError>;
```

Implementation follows the existing pattern — POST to `/admin/ingest/import` with the payload.

### Step 2: Add CLI commands

In `src/ops/Cli.ts`, add three new subcommands under a `twitter` group:

- `twitter add-expert <handle> --tier <tier> --base-url <url>`
- `twitter import-timeline <handle> --limit <N> --since <date> --base-url <url>`
- `twitter import-tweet <tweet-id> --base-url <url>`

Each command:
1. Initializes the Twitter scraper (reads cookies from env)
2. Fetches data via scraper
3. Normalizes to `ImportPostsInput`
4. Calls `StagingOperatorClient.importPosts()`

### Step 3: Tweet normalization

The normalization maps `TweetDetailNode` → `ImportPostInput`:

```ts
const tweetToImportPost = (tweet: TweetDetailNode): ImportPostInput => ({
  uri: `x://${tweet.userId}/status/${tweet.id}` as PostUri,
  did: `did:x:${tweet.userId}` as Did,
  text: tweet.text ?? "",
  createdAt: (tweet.timestamp ?? 0) * 1000,  // scraper uses SECONDS, DB uses MILLISECONDS
  embedType: tweet.photos.length > 0 ? "img"
    : tweet.videos.length > 0 ? "video"
    : tweet.urls.length > 0 ? "link"
    : null,
  embedPayload: extractTwitterEmbedPayload(tweet),
  links: tweet.urls.map((url) => ({
    url,
    domain: new URL(url).hostname
  }))
});
```

The `extractTwitterEmbedPayload` function maps:
- `photos[]` → `{ kind: "img", images: [{ thumb, fullsize, alt }] }`
- `videos[]` → `{ kind: "video", ... }`
- `urls[]` (with no media) → `{ kind: "link", uri, title, description }` (title/description may be null)
- Quote tweet → `{ kind: "quote", ... }`

IMPORTANT: Validate that `tweet.userId` is present before constructing the URI. If missing, skip the tweet with a warning. The scraper's models allow `userId` to be optional.

### Step 4: Commit

```bash
git add src/ops/Cli.ts src/ops/StagingOperatorClient.ts
git commit -m "feat(ops): add twitter import CLI commands (SKY-XX)"
```

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all tests pass
3. Existing Bluesky pipeline completely unaffected:
   - `AtUri` unchanged — all existing schemas reject `x://`
   - Poller skips `did:x:` experts
   - PostHydrationService skips `x://` URIs
4. Import endpoint:
   - Accepts `PostUri` (both schemes)
   - Upserts experts with `active: false`
   - Matches topics via extracted `TopicMatcher`
   - Stores posts in D1
   - Stores embed payloads in `post_payloads`
   - Flags candidates via `CurationService.flagBatch`
5. Imported Twitter posts appear in:
   - `search_posts` (FTS on post text)
   - `get_recent_posts` (chronological from D1)
   - `list_curation_candidates` (if flagged)
6. Imported Twitter posts gracefully handled by:
   - `PostHydrationService` (skips live fetch, empty hydration)
   - `get_post_thread` / `curate_post` (will error — expected for v1)

## Explicitly Out of Scope (v2)

- `ThreadClient` interface for platform-agnostic thread expansion
- `curate_post` support for Twitter URIs (skip live fetch, use stored payload)
- `get_post_thread` / `get_thread_document` for Twitter URIs
- `platform` column on experts/posts tables
- Thread graph storage for imported conversations
- Twitter expert cross-linking with Bluesky experts
- Automated Twitter polling
