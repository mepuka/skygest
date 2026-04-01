# Twitter Import v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import Twitter posts into Skygest so they can be searched, curated, enriched, and editorially accepted. Thread expansion and live thread display are out of scope for v1 — imported posts work through the pipeline but `get_post_thread` / `get_thread_document` are Bluesky-only.

**Architecture:** Introduce `PostUri` (`/^(at|x):\/\//`) as a separate type from `AtUri` (`/^at:\/\//`). Migrate platform-agnostic schemas (posts, curation, enrichment, editorial) to `PostUri`. Leave Bluesky-specific schemas (firehose events, polling, sync state, feed items) on `AtUri`. Add a platform-agnostic import endpoint and local CLI commands.

**Tech Stack:** Effect.ts, D1 SQL, Cloudflare Workers admin API, Bun CLI, better_twitter_scraper

---

## Design Decisions

1. **Two URI types** — `AtUri` stays `/^at:\/\//` for Bluesky-only paths. New `PostUri` accepts `/^(at|x):\/\//` for platform-agnostic paths. Both are branded strings. `AtUri` is assignable to `PostUri` (narrower to wider).
2. **Explicit schema migration** — Each schema that needs to handle both platforms changes from `AtUri` to `PostUri`. Bluesky-only schemas stay on `AtUri`. ~15 files, all mechanical.
3. **No DB migration** — URIs are `TEXT` in D1. The branded type is TypeScript-only enforcement.
4. **Poller protection** — `did:x:` blacklist in `resolveTargets`.
5. **Payload handling** — Import stores payloads as `captureStage: "candidate"` for posts with embeds. Plain-text tweets get no payload row. `curate_post` Twitter branch checks post existence (not payload existence) and transitions to `"picked"` if a payload exists. Plain-text tweets can be curated but not enriched (no visual/link content).
6. **Enrichment stage gate** — `start_enrichment` checks `captureStage === "picked"`, not just payload existence.
7. **Hydration** — `PostHydrationService` skips live Bluesky fetch for `x://` URIs. Empty hydration is acceptable — expert handle/avatar come from DB join.
8. **Import path** — `POST /admin/import/posts` (not `/admin/ingest/*` which is proxied to ingest worker).
9. **curate_post Twitter branch** — detects `x://` prefix, skips Bluesky thread fetch, uses stored payload if present, transitions to `"picked"`, queues enrichment.
10. **Tool/schema descriptions** — Updated to say "post URI" instead of "AT Protocol URI".

---

## Task 1: Introduce PostUri Type

**Files:**
- Modify: `src/domain/types.ts`
- Test: `tests/post-uri.test.ts`

Add `PostUri` as a new branded type alongside `AtUri`:

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

`AtUri` stays exactly as-is. Test that `PostUri` accepts both schemes and `AtUri` still rejects `x://`.

### Commit

```bash
git commit -m "feat(domain): add PostUri type for platform-agnostic post identity"
```

---

## Task 2: Migrate Platform-Agnostic Schemas to PostUri

**Files to change `AtUri` → `PostUri` for post URI fields:**

Each file below has specific fields that change from `AtUri` to `PostUri`. The changes are mechanical — import `PostUri` from `../domain/types` (or adjust existing import), change the field type.

**Domain schemas:**
- `src/domain/bi.ts` — `KnowledgePost.uri`, `KnowledgePostResult.uri`, `DeletedKnowledgePost.uri`, `KnowledgeLinkResult.postUri`, `GetPostThreadInput.postUri`, `GetThreadDocumentInput.postUri`, `ExplainPostTopicsInput.postUri`
- `src/domain/curation.ts` — `CuratePostInput.postUri`, `CuratePostOutput.postUri`, `CurationPostNotFoundError.postUri`
- `src/domain/editorial.ts` — `SubmitEditorialPickInput.postUri`, `SubmitEditorialPickOutput.postUri`, `EditorialPickOutput.postUri`
- `src/domain/enrichment.ts` — `GetPostEnrichmentsInput.postUri`, `GetPostEnrichmentsOutput.postUri`, `PostEnrichmentsOutput.postUri`
- `src/domain/candidatePayload.ts` — `CandidatePayloadRecord.postUri`, `SaveCandidatePayloadInput.postUri`, `SaveCandidateEnrichmentInput.postUri`, `CandidatePayloadNotPickedError.postUri`
- `src/domain/enrichmentRun.ts` — `EnrichmentRunRecord.postUri`, `CreateQueuedEnrichmentRun.postUri`, `EnrichmentRunParams.postUri`
- `src/domain/api.ts` — `StartEnrichmentInput.postUri`, API path params that take post URIs

**DO NOT change these (Bluesky-only):**
- `src/domain/types.ts` — `RawEvent.uri`, `RawEvent.did`, `FeedItem.post` — stay `AtUri`
- `src/domain/polling.ts` — all polling schemas stay `AtUri`/`Did`
- `src/domain/types.ts` — `PostprocessMessage` stays `Did`

**D1 repos that decode rows** — these read `TEXT` from D1 and decode through schemas. Once the schema field changes to `PostUri`, the decode automatically accepts `x://` values from the database:
- `src/services/d1/KnowledgeRepoD1.ts` — row decode schemas
- `src/services/d1/CurationRepoD1.ts` — row decode schemas  
- `src/services/d1/EditorialRepoD1.ts` — row decode schemas
- `src/services/d1/CandidatePayloadRepoD1.ts` — row decode schemas
- `src/services/d1/EnrichmentRunsRepoD1.ts` — row decode schemas

**Service interfaces:**
- `src/services/CandidatePayloadService.ts` — method signatures use `AtUri` for `postUri` params
- `src/services/CandidatePayloadRepo.ts` — same
- `src/services/PostEnrichmentReadService.ts` — `getPost` param is `string`, no change needed
- `src/services/EnrichmentRunsRepo.ts` — `listLatestByPostUri` param is `string`, no change needed

**MCP layer:**
- `src/mcp/Toolkit.ts` — input schemas reference domain types, will pick up `PostUri` automatically
- `src/mcp/OutputSchemas.ts` — extends domain types, will pick up `PostUri` automatically

**Strategy:** Start from the domain schemas (leaf types), then work outward. Each file change is: add `PostUri` import, replace `AtUri` with `PostUri` on the specific fields. Run `bunx tsc --noEmit` after each file to catch cascading type errors.

**CRITICAL:** Do NOT blindly find-and-replace `AtUri` → `PostUri`. Only change the fields listed above. Read each file and understand which fields are post URIs (platform-agnostic) vs. which are AT Protocol URIs (Bluesky-only).

### Verify

Run: `bunx tsc --noEmit` — zero errors
Run: `bun run test` — all tests pass (existing tests use `at://` which matches both types)

### Commit

```bash
git commit -m "refactor(domain): migrate platform-agnostic schemas from AtUri to PostUri"
```

---

## Task 3: Update Tool and Schema Descriptions

**Files:**
- `src/domain/curation.ts` — `CuratePostInput.postUri` annotation: change "AT Protocol URI" to "Post URI (at:// or x://)"
- `src/domain/editorial.ts` — `SubmitEditorialPickInput.postUri` annotation: same
- `src/domain/enrichment.ts` — `GetPostEnrichmentsInput.postUri` annotation: same
- `src/mcp/Toolkit.ts` — `CuratePostTool` description: change "Curating fetches live embed data from Bluesky" to "Curating captures embed data for enrichment. For Bluesky posts, fetches live data. For Twitter posts, uses stored import data."
- `src/mcp/glossary.ts` — update `curate_post` description similarly

### Commit

```bash
git commit -m "docs(mcp): update tool descriptions for multi-platform support"
```

---

## Task 4: Widen ExpertSource

**Files:**
- Modify: `src/domain/bi.ts:26`

Add `"twitter-import"` to `ExpertSource`:

```ts
export const ExpertSource = Schema.Literal("manual", "starter_pack", "list", "network", "twitter-import");
```

### Commit

```bash
git commit -m "feat(domain): add twitter-import expert source"
```

---

## Task 5: Extract TopicMatcher from FilterWorker

**Files:**
- Create: `src/filter/TopicMatcher.ts`
- Modify: `src/filter/FilterWorker.ts`
- Test: `tests/topic-matcher.test.ts`

Extract the `ontology.match()` call into a reusable `matchTopics` function. Update FilterWorker to use it. Test that topic matching works independently.

The function signature:

```ts
export const matchTopics = (input: {
  readonly text: string;
  readonly links: ReadonlyArray<{ readonly domain?: string | null }>;
  readonly hashtags?: ReadonlyArray<string>;
  readonly metadataTexts?: ReadonlyArray<string>;
}): Effect.Effect<ReadonlyArray<MatchedTopic>, never, OntologyCatalog>
```

### Commit

```bash
git commit -m "refactor(filter): extract topic matching into reusable TopicMatcher"
```

---

## Task 6: Import Request/Response Schemas

**Files:**
- Modify: `src/domain/api.ts`
- Test: `tests/import-schema.test.ts`

Add `ImportPostsInput` and `ImportPostsOutput` schemas. The import post input uses `PostUri` for `uri` (not `AtUri`). Expert input uses `Did` (which already accepts `did:x:`). Add to `AdminRequestSchemas` and `AdminResponseSchemas`.

Key schema shapes:

```ts
ImportExpertInput: { did: Did, handle: string, domain: string, source: ExpertSource, tier: ExpertTier, displayName?: string, avatar?: string }
ImportPostInput: { uri: PostUri, did: Did, text: string, createdAt: number, embedType?: EmbedKind | null, embedPayload?: EmbedPayload | null, links: Array<{ url, title?, description?, domain? }> }
ImportPostsInput: { experts: Array<ImportExpertInput>, posts: Array<ImportPostInput> }
ImportPostsOutput: { imported: number, flagged: number, skipped: number }
```

### Commit

```bash
git commit -m "feat(domain): add import posts request/response schemas"
```

---

## Task 7: Import Admin Endpoint

**Files:**
- Modify: `src/admin/Router.ts`
- Modify: `src/worker/operatorAuth.ts`
- Test: `tests/import-endpoint.test.ts`

### Operator auth

Add to `operatorRequestPolicy` in `src/worker/operatorAuth.ts`:

```ts
if (request.method === "POST" && pathname === "/admin/import/posts") {
  return { action: "import_posts", scopes: ["ops:refresh"] };
}
```

### Endpoint + handler

Add `POST /admin/import/posts` to `AdminApi` and handler layer.

Handler logic:

1. Upsert experts with `active: false` (not polled)
2. For each post: run `matchTopics()` — skip if no topics
3. Build `KnowledgePost` objects, upsert via `KnowledgeRepo`
4. For imported posts that have `embedPayload`: store in `post_payloads` with `captureStage: "candidate"`
5. Flag all imported posts via `CurationService.flagBatch()` (error-tolerant)
6. Return `{ imported, flagged, skipped }`

**Payload handling rules:**
- Only store payloads for posts that were actually imported (survived topic matching)
- Posts with `embedPayload: null` get NO payload row — they're plain-text, cannot be enriched
- Do NOT swallow payload-save failures silently — log them as warnings

### Commit

```bash
git commit -m "feat(admin): add /admin/import/posts endpoint"
```

---

## Task 8: Protect Bluesky Poller

**Files:**
- Modify: `src/ingest/IngestRunWorkflow.ts`

In `resolveTargets`, after getting active experts, filter out `did:x:` experts:

```ts
return active
  .filter((e) => !(e.did as string).startsWith("did:x:"))
  .map((e) => e.did);
```

### Commit

```bash
git commit -m "fix(ingest): exclude did:x: experts from Bluesky poll targets"
```

---

## Task 9: PostHydrationService Skips Twitter

**Files:**
- Modify: `src/services/PostHydrationService.ts`

Filter URIs before sending to `bluesky.getPosts()`:

```ts
const blueskyUris = uris.filter((uri) => uri.startsWith("at://"));
```

Only send Bluesky URIs for live fetch. Non-Bluesky URIs get empty hydration (default cache miss behavior). Expert handle/avatar come from the DB join, not hydration.

### Commit

```bash
git commit -m "fix(hydration): skip Bluesky API fetch for non-at:// URIs"
```

---

## Task 10: curate_post Twitter Branch

**Files:**
- Modify: `src/services/CurationService.ts`

In `curatePost`, after the post existence check and idempotency guard, detect platform:

```ts
const isTwitter = (input.postUri as string).startsWith("x://");

if (isTwitter && input.action === "curate") {
  // Twitter: skip Bluesky thread fetch
  // Check if payload exists (may not for plain-text tweets)
  const existingPayload = yield* payloadService.getPayload(input.postUri);

  if (existingPayload !== null && existingPayload.captureStage !== "picked") {
    yield* payloadService.markPicked(input.postUri);
  }

  yield* curationRepo.updateStatus(input.postUri, "curated", curator, input.note ?? null, now);

  if (existingPayload !== null) {
    yield* queuePickedEnrichment(input.postUri, existingPayload.embedPayload, curator)
      .pipe(Effect.catchAll(() => Effect.succeed(false)));
  }

  return { postUri: input.postUri, action: input.action, previousStatus, newStatus: "curated" as const };
}

// Bluesky path (existing, unchanged)...
```

**Plain-text tweets:** No payload → curated but no enrichment queued. That's correct — nothing to enrich.

**Tweets with embeds:** Payload transitions `"candidate"` → `"picked"`, enrichment queued.

### Commit

```bash
git commit -m "feat(curation): add Twitter branch in curate_post"
```

---

## Task 11: Enforce Picked Stage in start_enrichment

**Files:**
- Modify: `src/mcp/Toolkit.ts`

In `makeStartEnrichmentHandler`, after checking the payload exists, verify stage:

```ts
if (payload.captureStage !== "picked") {
  return yield* McpToolQueryError.make({
    tool: "start_enrichment",
    message: "Post must be curated before starting enrichment. Call curate_post first.",
    error: new Error("payload not picked")
  });
}
```

This enforces the curation-before-enrichment rule for both platforms.

### Commit

```bash
git commit -m "fix(mcp): enforce picked stage before enrichment trigger"
```

---

## Task 12: StagingOperatorClient Import Method

**Files:**
- Modify: `src/ops/StagingOperatorClient.ts`

Add `importPosts` method following the existing pattern (POST to `/admin/import/posts`).

### Commit

```bash
git commit -m "feat(ops): add importPosts to StagingOperatorClient"
```

---

## Task 13: Twitter Normalizer + CLI Commands

**Files:**
- Create: `src/ops/TwitterNormalizer.ts`
- Modify: `src/ops/Cli.ts`
- Test: `tests/twitter-normalizer.test.ts`

### TwitterNormalizer

Two normalization functions:

`normalizeTweet(tweet: Tweet)` — for timeline API (lighter model):
- URI: `x://{userId}/status/{id}` — skip if `userId` missing
- DID: `did:x:{userId}`
- `createdAt`: `tweet.timestamp * 1000` (scraper uses seconds, DB uses milliseconds)
- Embed: `photos[]` → img, `videos[]` → video, `urls[]` → link
- Links: extract domain from each URL

`normalizeTweetDetail(node: TweetDetailNode)` — for detail API (richer model):
- Same mapping but richer embed extraction
- Access to conversation metadata

`normalizeProfile(profile: Profile, tier: ExpertTier)` → expert input:
- Skip if `userId` missing
- DID: `did:x:{userId}`

### CLI Commands

Three commands under `twitter` subcommand:

- `twitter add-expert <handle> --tier <tier> --base-url <url>`
- `twitter import-timeline <handle> --limit <N> --since <date> --base-url <url>`  
- `twitter import-tweet <tweet-id> --base-url <url>`

Scraper auth from env (`TWITTER_COOKIES` or cookie file path).

### Commit

```bash
git commit -m "feat(ops): add Twitter normalizer and CLI import commands"
```

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all tests pass
3. **Bluesky pipeline untouched:**
   - `AtUri` still `/^at:\/\//` — Bluesky-only schemas reject `x://`
   - `RawEvent`, `FeedItem`, polling schemas stay `AtUri`
   - Poller filters out `did:x:` experts
   - Hydration skips `x://` URIs
   - `curate_post` with `at://` takes existing Bluesky path
4. **Twitter posts work through pipeline:**
   - Import stores posts, experts (inactive), payloads (candidate stage), topics, curation flags
   - `search_posts`, `get_recent_posts`, `list_curation_candidates` return imported tweets
   - `curate_post` with `x://` uses stored payload, transitions to picked
   - `start_enrichment` enforces picked stage
   - `get_post_enrichments` shows readiness
   - `submit_editorial_pick` accepts enriched tweet
5. **Type safety:**
   - `PostUri` used for platform-agnostic schemas
   - `AtUri` used for Bluesky-only schemas
   - No `as unknown as` casts between the two (AtUri is assignable to PostUri)

## Out of Scope (v2)

- `get_post_thread` / `get_thread_document` for Twitter URIs — `ThreadClient` interface
- Enhanced hydration reading from post_payloads
- Thread graph storage for imported conversations
- `platform` column on experts/posts tables
- Automated Twitter polling
- Twitter expert cross-linking with Bluesky experts
