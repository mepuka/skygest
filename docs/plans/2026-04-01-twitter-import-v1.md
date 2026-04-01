# Twitter Import v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import Twitter posts into the Skygest pipeline so they appear in search, curation candidates, and can flow through curation, enrichment, and editorial picks — the same end-to-end workflow as Bluesky posts.

**Architecture:** Widen the `AtUri` regex to accept both `at://` and `x://` schemes. This single change unlocks every read and write schema in the app. Add a platform-agnostic import endpoint at `POST /admin/import/posts`. The local CLI uses the Twitter scraper to fetch tweets, normalizes them, and uploads via this endpoint. `curate_post` gains a Twitter branch that skips the live Bluesky fetch and uses stored payloads. Hydration skips live Bluesky fetch for `x://` URIs (empty hydration — expert metadata comes from DB join).

**Tech Stack:** Effect.ts, D1 SQL, Cloudflare Workers admin API, Bun CLI, better_twitter_scraper

---

## Design Decisions

1. **Widen `AtUri` regex** — Change `/^at:\/\//` to `/^(at|x):\/\//` in `src/domain/types.ts`. One-line change. Every schema that uses `AtUri` instantly accepts Twitter URIs. No find-and-replace needed.
2. **No schema migration** — DID prefix (`did:x:`) discriminates platform. The `Did` regex (`/^did:/`) already accepts `did:x:...`.
3. **Poller protection via `did:x:` blacklist** — `IngestRunWorkflow.resolveTargets` filters out `did:x:` experts. Future non-PLC Bluesky identities (`did:web:`) are not affected.
4. **Payload stored at import as `"candidate"` stage** — not `"picked"`. Curation transitions to `"picked"`. Enrichment requires `"picked"` (same rule for both platforms).
5. **`curate_post` gains a Twitter branch** — detects `x://`, skips Bluesky fetch, verifies stored payload, transitions to `"picked"`, queues enrichment.
6. **Hydration: empty for Twitter v1** — `PostHydrationService` skips live fetch for `x://` URIs. Expert handle/avatar come from the DB join, not hydration. Enrichment data comes from payloads.
7. **Import endpoint at `/admin/import/posts`** — NOT `/admin/ingest/import` (that path is intercepted by the ingest service proxy in feed.ts).
8. **Two normalization functions** — `Tweet` (lighter, from timeline API) and `TweetDetailNode` (richer, from detail API) map differently.

---

## Task 1: Widen AtUri Regex

**Files:**
- Modify: `src/domain/types.ts:23-26`

### Step 1: Change the regex

Current:
```ts
export const AtUri = Schema.String.pipe(
  Schema.pattern(/^at:\/\//),
  Schema.brand("AtUri")
).annotations({ description: "AT Protocol URI, e.g. at://did:plc:abc/app.bsky.feed.post/rkey" });
```

New:
```ts
export const AtUri = Schema.String.pipe(
  Schema.pattern(/^(at|x):\/\//),
  Schema.brand("AtUri")
).annotations({ description: "Post URI — at:// (Bluesky) or x:// (Twitter)" });
```

Also add the platform helper:

```ts
export type Platform = "bluesky" | "twitter";

export const platformFromUri = (uri: AtUri): Platform =>
  (uri as string).startsWith("at://") ? "bluesky" : "twitter";
```

### Step 2: Run tests

Run: `bun run test`
Expected: All 540 tests pass — existing tests all use `at://` URIs which still match.

### Step 3: Add a test for the new scheme

Add to an existing test file or create `tests/post-uri.test.ts`:

```ts
import { Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { AtUri, platformFromUri } from "../src/domain/types";

describe("AtUri accepts x:// scheme", () => {
  const decode = Schema.decodeUnknownSync(AtUri);

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
    expect(() => decode("")).toThrow();
  });
});

describe("platformFromUri", () => {
  it("returns bluesky for at://", () => {
    expect(platformFromUri("at://did:plc:abc/app.bsky.feed.post/xyz" as any)).toBe("bluesky");
  });

  it("returns twitter for x://", () => {
    expect(platformFromUri("x://12345/status/9876543210" as any)).toBe("twitter");
  });
});
```

### Step 4: Run tests

Run: `bun run test`
Expected: All tests pass including new ones

### Step 5: Commit

```bash
git add src/domain/types.ts tests/post-uri.test.ts
git commit -m "feat(domain): widen AtUri to accept x:// scheme for Twitter posts"
```

---

## Task 2: Widen ExpertSource + Add PostUri Helper

**Files:**
- Modify: `src/domain/bi.ts:26`

### Step 1: Add `"twitter-import"` to ExpertSource

Current:
```ts
export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network");
```

New:
```ts
export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network", "twitter-import");
```

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 3: Commit

```bash
git add src/domain/bi.ts
git commit -m "feat(domain): add twitter-import expert source"
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

  it("decodes valid import with Twitter expert and post", () => {
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
        links: []
      }]
    });
    expect(result.experts).toHaveLength(1);
    expect(result.posts).toHaveLength(1);
  });

  it("decodes import with embed payload", () => {
    const result = decode({
      experts: [],
      posts: [{
        uri: "x://12345/status/111",
        did: "did:x:12345",
        text: "Chart shows solar growth",
        createdAt: 1741234567000,
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [{ thumb: "https://pbs.twimg.com/media/abc_small.jpg", fullsize: "https://pbs.twimg.com/media/abc.jpg", alt: "Solar chart" }]
        },
        links: []
      }]
    });
    expect(result.posts[0]?.embedType).toBe("img");
    expect(result.posts[0]?.embedPayload).toBeDefined();
  });

  it("also accepts Bluesky URIs", () => {
    const result = decode({
      experts: [],
      posts: [{
        uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        did: "did:plc:abc",
        text: "Test",
        createdAt: 1741234567000,
        links: []
      }]
    });
    expect(result.posts).toHaveLength(1);
  });
});
```

### Step 2: Run test — should fail

Run: `bun run test tests/import-schema.test.ts`
Expected: FAIL — `ImportPostsInput` not exported

### Step 3: Implement

Read `src/domain/api.ts` to understand existing patterns. Add after the existing admin schemas:

```ts
// Import schemas
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
  uri: AtUri,
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

NOTE: `ImportPostInput.uri` uses `AtUri` — which now accepts `x://` thanks to Task 1. `embedPayload` uses `EmbedPayload` from `src/domain/embed.ts` — check the import exists. `ThreadEmbedType` for `embedType`.

Add to `AdminRequestSchemas` and `AdminResponseSchemas`:

```ts
importPosts: ImportPostsInput,
// and
importPosts: ImportPostsOutput,
```

### Step 4: Run tests

Run: `bun run test tests/import-schema.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/domain/api.ts tests/import-schema.test.ts
git commit -m "feat(domain): add import posts request/response schemas"
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
        links: [{ domain: "gridstatus.io" }]
      });
      expect(topics.length).toBeGreaterThan(0);
      expect(topics.some((t) => t.topicSlug === "solar")).toBe(true);
    }).pipe(Effect.provide(OntologyCatalog.layer))
  );

  it.effect("returns empty for irrelevant text", () =>
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

### Step 2: Run test — should fail

Run: `bun run test tests/topic-matcher.test.ts`
Expected: FAIL

### Step 3: Implement

Create `src/filter/TopicMatcher.ts`:

```ts
import { Effect } from "effect";
import type { MatchedTopic } from "../domain/bi";
import { OntologyCatalog } from "../services/OntologyCatalog";

export const matchTopics = (input: {
  readonly text: string;
  readonly links: ReadonlyArray<{ readonly domain?: string | null }>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly metadataTexts?: ReadonlyArray<string>;
}): Effect.Effect<ReadonlyArray<MatchedTopic>, never, OntologyCatalog> =>
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

Then update `src/filter/FilterWorker.ts` to import and use `matchTopics` instead of the inline `ontology.match()` call. Read the file carefully — remove the `yield* OntologyCatalog` line and replace the inline `ontology.match(...)` (around line 96) with `matchTopics(...)`.

### Step 4: Run tests

Run: `bun run test`
Expected: All tests pass — FilterWorker behavior unchanged

### Step 5: Commit

```bash
git add src/filter/TopicMatcher.ts src/filter/FilterWorker.ts tests/topic-matcher.test.ts
git commit -m "refactor(filter): extract topic matching into reusable TopicMatcher"
```

---

## Task 5: Import Admin Endpoint

**Files:**
- Modify: `src/admin/Router.ts`
- Modify: `src/worker/operatorAuth.ts`
- Test: `tests/import-endpoint.test.ts`

### Step 1: Add operator auth policy

In `src/worker/operatorAuth.ts`, add to `operatorRequestPolicy`:

```ts
if (request.method === "POST" && pathname === "/admin/import/posts") {
  return {
    action: "import_posts",
    scopes: ["ops:refresh"]
  };
}
```

NOTE: Path is `/admin/import/posts`, NOT `/admin/ingest/import`. The `/admin/ingest/*` prefix is intercepted by `feed.ts:36` and proxied to the ingest worker.

### Step 2: Add API endpoint

In `src/admin/Router.ts`, add a new API group to `AdminApi`:

```ts
.add(
  HttpApiGroup.make("import")
    .add(
      HttpApiEndpoint.post("importPosts", "/admin/import/posts")
        .setPayload(AdminRequestSchemas.importPosts)
        .addSuccess(AdminResponseSchemas.importPosts)
    )
)
```

### Step 3: Add handler

Add handler layer. Read existing handlers to match the exact pattern (error wrapping, layer composition).

The handler:

```ts
HttpApiBuilder.group(AdminApi, "import", (handlers) =>
  handlers
    .handle("importPosts", ({ payload }) =>
      withAdminErrors("/admin/import/posts", Effect.gen(function* () {
        const expertsRepo = yield* ExpertsRepo;
        const knowledgeRepo = yield* KnowledgeRepo;
        const payloadService = yield* CandidatePayloadService;
        const curationService = yield* CurationService;
        const now = Date.now();

        // 1. Upsert experts (inactive — not polled by Bluesky ingest)
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
              active: false,
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
            uri: post.uri,
            did: post.did,
            cid: null,
            text: post.text,
            createdAt: post.createdAt,
            indexedAt: now,
            hasLinks: links.length > 0,
            status: "active",
            ingestId: `import-${String(post.uri)}-${now}`,
            embedType: post.embedType ?? null,
            topics,
            links
          } as KnowledgePost);
        }

        // 3. Store posts
        if (posts.length > 0) {
          yield* knowledgeRepo.upsertPosts(posts);
        }

        // 4. Store embed payloads as "candidate" stage
        for (const post of payload.posts) {
          if (post.embedPayload != null) {
            yield* payloadService.capturePayload({
              postUri: post.uri,
              captureStage: "candidate",
              embedType: post.embedType ?? null,
              embedPayload: post.embedPayload
            }).pipe(Effect.catchAll(() => Effect.succeed(false)));
          }
        }

        // 5. Flag for curation (error-tolerant)
        const flagged = yield* curationService.flagBatch(posts).pipe(
          Effect.catchAll(() => Effect.succeed(0))
        );

        return { imported: posts.length, flagged, skipped };
      }))
    )
)
```

Add necessary imports: `matchTopics` from `../filter/TopicMatcher`, `ExpertsRepo`, `KnowledgeRepo`, `CandidatePayloadService`, `CurationService`, `KnowledgePost` type.

### Step 4: Write test

Create `tests/import-endpoint.test.ts`. Use `makeBiLayer` + `withTempSqliteFile` pattern. Test:
- Import with valid expert + post → returns `{ imported: 1, flagged: ?, skipped: 0 }`
- Post with no topic matches → skipped
- Post with embed payload → stored in post_payloads

### Step 5: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 6: Commit

```bash
git add src/admin/Router.ts src/worker/operatorAuth.ts tests/import-endpoint.test.ts
git commit -m "feat(admin): add /admin/import/posts endpoint for platform-agnostic post import"
```

---

## Task 6: Protect Bluesky Poller

**Files:**
- Modify: `src/ingest/IngestRunWorkflow.ts`

### Step 1: Add DID prefix filter

In `resolveTargets` (around line 121), after getting active experts, filter out `did:x:` experts:

```ts
const active = yield* experts.listActive();
// Exclude non-Bluesky experts (e.g. did:x: for Twitter)
return active
  .filter((e) => !(e.did as string).startsWith("did:x:"))
  .map((e) => e.did);
```

### Step 2: Run tests

Run: `bun run test tests/ingest-run-workflow.test.ts`
Expected: PASS

### Step 3: Commit

```bash
git add src/ingest/IngestRunWorkflow.ts
git commit -m "fix(ingest): exclude did:x: experts from Bluesky poll targets"
```

---

## Task 7: PostHydrationService Skips Twitter

**Files:**
- Modify: `src/services/PostHydrationService.ts`

### Step 1: Filter URIs before Bluesky fetch

Read `PostHydrationService.ts`. In the hydration flow, before sending URIs to `bluesky.getPosts()`, filter to Bluesky-only:

In the `populateChunk` function or wherever URIs are batched, filter:

```ts
const blueskyUris = uris.filter((uri) => uri.startsWith("at://"));
if (blueskyUris.length > 0) {
  const posts = yield* bluesky.getPosts(blueskyUris);
  // ... populate cache for Bluesky URIs
}
// Non-Bluesky URIs get empty hydration (already the default cache miss behavior)
```

Read the full hydration flow to understand where URIs enter and how the cache works. The key is: don't send `x://` URIs to the Bluesky API. Let them fall through to empty hydration.

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass

### Step 3: Commit

```bash
git add src/services/PostHydrationService.ts
git commit -m "fix(hydration): skip Bluesky API fetch for non-at:// URIs"
```

---

## Task 8: curate_post Twitter Branch

**Files:**
- Modify: `src/services/CurationService.ts`

### Step 1: Add platform branch in curatePost

In `CurationService.ts`, the `curatePost` function (around line 176) calls `bskyClient.getPostThread()` to fetch embed data. For Twitter posts, skip this — the payload was already stored at import time.

Read the full `curatePost` function. After the post existence check and before the Bluesky thread fetch, add:

```ts
// Platform-aware curation
const isTwitter = (input.postUri as string).startsWith("x://");

if (isTwitter) {
  // Twitter: payload already stored at import time — just mark picked + update status
  const existingPayload = yield* payloadService.getPayload(input.postUri as AtUri);
  if (existingPayload === null) {
    return yield* new BlueskyApiError({
      message: `No stored payload for Twitter post ${input.postUri} — import the tweet first`
    });
  }

  if (existingPayload.captureStage !== "picked") {
    yield* payloadService.markPicked(input.postUri as AtUri);
  }

  yield* curationRepo.updateStatus(
    input.postUri,
    "curated",
    curator,
    input.note ?? null,
    now
  );

  yield* queuePickedEnrichment(
    input.postUri as AtUri,
    existingPayload.embedPayload,
    curator
  ).pipe(Effect.catchAll(() => Effect.succeed(false)));

  return {
    postUri: input.postUri,
    action: input.action,
    previousStatus,
    newStatus: "curated" as const
  };
}

// Bluesky: existing live fetch path (unchanged)
const threadResponse = yield* bskyClient.getPostThread(input.postUri, { ... });
```

### Step 2: Run tests

Run: `bun run test`
Expected: All tests pass — existing tests use `at://` URIs and hit the Bluesky branch

### Step 3: Commit

```bash
git add src/services/CurationService.ts
git commit -m "feat(curation): add Twitter branch in curate_post — use stored payload"
```

---

## Task 9: Ops CLI — Import Method on StagingOperatorClient

**Files:**
- Modify: `src/ops/StagingOperatorClient.ts`

### Step 1: Add importPosts method

Follow the existing pattern in `StagingOperatorClient`. Add:

```ts
readonly importPosts: (
  baseUrl: URL,
  secret: Redacted.Redacted<string>,
  input: ImportPostsInput
) => Effect.Effect<ImportPostsOutput, StagingClientError>;
```

Implementation: POST to `/admin/import/posts` with the payload, decode response as `ImportPostsOutput`.

### Step 2: Run tests

Run: `bun run test`
Expected: PASS

### Step 3: Commit

```bash
git add src/ops/StagingOperatorClient.ts
git commit -m "feat(ops): add importPosts method to StagingOperatorClient"
```

---

## Task 10: Ops CLI — Twitter Commands

**Files:**
- Modify: `src/ops/Cli.ts`
- Create: `src/ops/TwitterNormalizer.ts`

### Step 1: Create TwitterNormalizer

Create `src/ops/TwitterNormalizer.ts` with two functions:

```ts
// For timeline API (returns Tweet — lighter model)
export const normalizeTweet = (tweet: Tweet): ImportPostInput | null => {
  if (tweet.userId === undefined) return null;  // Can't construct URI without userId

  return {
    uri: `x://${tweet.userId}/status/${tweet.id}` as AtUri,
    did: `did:x:${tweet.userId}` as Did,
    text: tweet.text ?? "",
    createdAt: (tweet.timestamp ?? 0) * 1000,  // Scraper uses SECONDS
    embedType: tweet.photos.length > 0 ? "img"
      : tweet.videos.length > 0 ? "video"
      : tweet.urls.length > 0 ? "link"
      : null,
    embedPayload: extractTweetEmbed(tweet),
    links: tweet.urls.map((url) => {
      try { return { url, domain: new URL(url).hostname }; }
      catch { return { url, domain: null }; }
    })
  };
};

// For detail API (returns TweetDetailNode — richer model)
export const normalizeTweetDetail = (node: TweetDetailNode): ImportPostInput | null => {
  if (node.userId === undefined) return null;

  return {
    uri: `x://${node.userId}/status/${node.id}` as AtUri,
    did: `did:x:${node.userId}` as Did,
    text: node.text ?? "",
    createdAt: (node.timestamp ?? 0) * 1000,
    embedType: node.photos.length > 0 ? "img"
      : node.videos.length > 0 ? "video"
      : node.urls.length > 0 ? "link"
      : null,
    embedPayload: extractTweetDetailEmbed(node),
    links: node.urls.map((url) => {
      try { return { url, domain: new URL(url).hostname }; }
      catch { return { url, domain: null }; }
    })
  };
};

// Profile → ImportExpertInput
export const normalizeProfile = (
  profile: Profile,
  tier: ExpertTier
): ImportExpertInput | null => {
  if (profile.userId === undefined) return null;

  return {
    did: `did:x:${profile.userId}` as Did,
    handle: profile.username ?? profile.userId,
    displayName: profile.name,
    avatar: profile.avatar,
    domain: "energy",
    source: "twitter-import",
    tier
  };
};
```

The `extractTweetEmbed` and `extractTweetDetailEmbed` functions map:
- `photos[]` → `{ kind: "img", images: [{ thumb: photo.url, fullsize: photo.url, alt: photo.altText ?? "" }] }`
- `videos[]` → `{ kind: "video", playlist: video.url, thumbnail: video.preview }`
- `urls[]` (no media) → `{ kind: "link", uri: urls[0], title: null, description: null }`

### Step 2: Add CLI commands

In `src/ops/Cli.ts`, add three commands under a `twitter` subcommand group:

- `twitter add-expert <handle> --tier <tier> --base-url <url>`
- `twitter import-timeline <handle> --limit <N> --since <date> --base-url <url>`
- `twitter import-tweet <tweet-id> --base-url <url>`

Each reads `TWITTER_COOKIES` or similar from env for scraper auth.

Read the existing CLI structure to match the pattern (Effect CLI, `Options`, `Args`, `Command`).

### Step 3: Commit

```bash
git add src/ops/TwitterNormalizer.ts src/ops/Cli.ts
git commit -m "feat(ops): add twitter import CLI commands"
```

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all tests pass
3. **Bluesky pipeline completely unaffected:**
   - Existing tests all pass (they use `at://` URIs)
   - Poller filters out `did:x:` experts
   - Hydration skips `x://` URIs
   - `curate_post` with `at://` takes the existing Bluesky path
4. **Twitter posts flow end-to-end:**
   - Import endpoint stores posts, experts, payloads, topics, curation flags
   - `search_posts` returns imported tweets
   - `list_curation_candidates` shows flagged tweets
   - `curate_post` with `x://` uses stored payload, transitions to picked
   - `start_enrichment` queues enrichment (payload already picked)
   - `get_post_enrichments` shows readiness
   - `submit_editorial_pick` accepts enriched tweet
5. **Import endpoint:**
   - Path: `POST /admin/import/posts` (not `/admin/ingest/*`)
   - Auth: `ops:refresh` scope
   - Experts stored with `active: false`
   - Payloads stored as `captureStage: "candidate"`
   - Topics matched via `TopicMatcher`
   - Curation flagging via `CurationService.flagBatch`

## Explicitly Out of Scope

- `get_post_thread` / `get_thread_document` for Twitter URIs (errors gracefully — v2 ThreadClient)
- Thread graph storage for imported conversations
- Enhanced hydration reading from post_payloads (v2)
- `platform` column on experts/posts tables (v2)
- Twitter expert cross-linking with Bluesky experts
- Automated Twitter polling
