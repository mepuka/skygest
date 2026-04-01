# Multi-Platform Post Abstraction Design

**Goal:** Add Twitter/X as a second post source alongside Bluesky, using shared abstractions so the MCP surface, enrichment pipeline, and curation workflow remain platform-agnostic.

**Approach:** Incremental, additive. Three phases: widen types + schema, wire Twitter ingest, unify MCP dispatch. Each phase independently shippable.

---

## Identity Model

### PostUri

`PostUri` replaces `AtUri` as the universal post identifier. Branded `string` accepting two schemes:

- `at://did:plc:xxx/app.bsky.feed.post/rkey` (Bluesky)
- `x://user_id/status/tweet_id` (Twitter)

A helper `platformFromUri(uri: PostUri): "bluesky" | "twitter"` extracts the platform from the prefix. Twitter uses the numeric user ID (stable across username changes), not the handle.

`AtUri` stays as-is for Bluesky-specific services. `PostUri` is a wider type used at platform-agnostic boundaries. References migrate incrementally.

### Expert Identity

Same `experts` table with a new `platform` column:

| Column | Type | Notes |
|--------|------|-------|
| did | TEXT PK | `did:plc:xxx` (Bluesky) or `did:x:user_id` (Twitter) |
| platform | TEXT NOT NULL | `"bluesky"` or `"twitter"`, default `"bluesky"` |
| handle | TEXT | `@handle.bsky.social` or `@username` |
| tier | TEXT NOT NULL | Same tier system for both platforms |
| avatar | TEXT | Avatar URL |

### Migration

Add `platform TEXT NOT NULL DEFAULT 'bluesky'` to `experts` and `posts` tables. Non-breaking -- all existing rows get `"bluesky"`.

---

## ThreadClient Interface

Platform-agnostic interface for fetching thread context and embed data.

```ts
interface ThreadClient {
  readonly getThread: (
    postUri: PostUri,
    options: { depth?: number; parentHeight?: number }
  ) => Effect<PlatformThread, ThreadFetchError>;
}

interface PlatformThread {
  platform: "bluesky" | "twitter";
  focusUri: PostUri;
  focusPost: PlatformPost;
  ancestors: ReadonlyArray<PlatformPost>;
  replies: ReadonlyArray<PlatformPost>;
}

interface PlatformPost {
  uri: PostUri;
  authorId: string;
  handle: string | null;
  displayName: string | null;
  text: string;
  createdAt: string;
  likeCount: number | null;
  repostCount: number | null;
  replyCount: number | null;
  quoteCount: number | null;
  embedType: string | null;
  embedPayload: EmbedPayload | null;
  depth: number;
  parentUri: PostUri | null;
}
```

### Implementations

**BlueskyThreadClient** -- wraps existing `BlueskyClient.getPostThread()` + `flattenThread()` + embed extraction. Extracts what `get_post_thread` does today into the interface.

**TwitterThreadClient** -- wraps the scraper's `TweetConversationProjection`. Maps `TweetDetailNode` fields to `PlatformPost` (photos -> img embed, urls -> link embed, etc.).

### Dispatch

`ThreadClientRouter` checks the URI prefix and delegates:

```ts
platformFromUri(uri) === "bluesky"
  ? blueskyThreadClient.getThread(uri, opts)
  : twitterThreadClient.getThread(uri, opts)
```

MCP handlers (`get_post_thread`, `get_thread_document`, `curate_post`) switch from calling `BlueskyClient` directly to calling `ThreadClientRouter`.

---

## Ingest Pipeline

### Bluesky (unchanged)

Automated polling via ExpertPollCoordinatorDo on a cron. No changes.

### Twitter (manual/on-demand)

Operator-triggered, not polled. Twitter scraping is expensive and rate-limited -- no cron.

**Entry points** (operator-authenticated):

1. **Fetch expert timeline** -- "Get recent tweets from @username" -> scraper fetches timeline -> normalize -> filter -> store. Via admin endpoint or MCP tool.
2. **Fetch specific tweet/thread** -- "Ingest this tweet" -> scraper fetches conversation -> normalize -> store.

Both paths produce the same normalized post data that flows into FilterWorker -> topic matching -> D1.

**No ExpertPollCoordinatorDo for Twitter** -- Twitter experts exist in the experts table for metadata (tier, handle) but are not automatically polled.

**Polling cadence** is platform-specific and config-driven. Twitter has no automated cadence.

### Normalization Boundary

Each platform executor maps native data into the shared `KnowledgePost` shape before it hits the filter:

- `Tweet.text` -> `KnowledgePost.text`
- `Tweet.photos` -> `embedType: "img"`
- `Tweet.urls` -> `embedType: "link"`
- `Tweet.likes` -> `KnowledgePost.likeCount`
- `Tweet.permanentUrl` -> `x://user_id/status/tweet_id` (PostUri)
- `Tweet.conversationId` -> thread grouping

---

## Embed Extraction

`EmbedPayload` (img, link, video, quote, media) is already platform-agnostic. Only the extraction logic is platform-specific.

Two extraction functions, same output type:

```ts
// Existing (Bluesky)
extractBlueskyEmbed(bskyEmbed: unknown): { embedType, embedPayload }

// New (Twitter)
extractTwitterEmbed(tweet: TweetDetailNode): { embedType, embedPayload }
```

Twitter mapping:
- `Tweet.photos[]` -> `{ kind: "img", images: [...] }`
- `Tweet.videos[]` -> `{ kind: "video", ... }`
- `Tweet.urls[]` -> `{ kind: "link", uri, title, description }`
- Quote tweets -> `{ kind: "quote", ... }`

Downstream code (enrichment, curation, MCP display) is unaware of which extractor produced the payload.

---

## What Stays Unchanged

- **Enrichment pipeline** -- vision and source-attribution work on embed payloads, not platform data
- **Curation predicates** -- signal scoring uses expert tier, engagement, topic matches
- **Editorial picks** -- operates on post URIs and enrichment readiness
- **MCP tool surface** -- all tools keep the same interface, platform-blind
- **Ontology / topic matching** -- works on post text
- **Provider registry / source attribution** -- matches on link domains and vision output

---

## Implementation Phases

### Phase 1: Widen Types + Schema (low risk, additive)

- Introduce `PostUri` branded type accepting `at://` and `x://`
- Introduce `Platform` literal type (`"bluesky" | "twitter"`)
- Add `platform` column to `experts` and `posts` tables (default `"bluesky"`)
- Create `ThreadClient` interface (no implementations yet beyond wrapping existing BlueskyClient)
- Add `platformFromUri` helper
- All existing behavior unchanged, all existing tests pass

### Phase 2: Wire Twitter Ingest (new code only)

- `TwitterThreadClient` implementation using the scraper
- `extractTwitterEmbed` function
- Twitter post normalization into `KnowledgePost` shape
- Admin endpoints for manual Twitter ingest (fetch timeline, fetch tweet)
- Twitter expert seeding

### Phase 3: Unify MCP Surface (integration)

- Platform dispatch in `curate_post`, `get_post_thread`, `get_thread_document`
- `ThreadClientRouter` replaces direct `BlueskyClient` calls in MCP handlers
- MCP tools work transparently for both platforms
- End-to-end testing with real Twitter data

---

## Twitter Scraper Integration

The scraper lives at `/Users/pooks/Dev/better_twitter_scraper` and is Effect-native. Key types:

- `Tweet` -- post data with text, photos, videos, urls, engagement metrics
- `TweetDetailNode` -- enriched tweet with conversation metadata
- `TweetConversationProjection` -- full thread structure (ancestors, replies, self-thread, quoted tweets)
- `Profile` -- user profile data

The scraper handles auth (guest auth, cookie-based sessions, auth pooling) and rate limiting internally.

---

## Open Questions

1. **Twitter image accessibility** -- Do scraper photo URLs require auth headers for the vision pipeline to fetch them? Need to verify.
2. **Scraper deployment** -- Does the scraper run as a separate service, or embedded in the ingest worker? Rate limiting and session management may favor a separate service.
3. **Twitter expert discovery** -- How do we identify which Twitter accounts to follow? Manual seeding only, or some discovery mechanism?
