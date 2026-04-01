# Multi-Platform Post Abstraction Design

**Goal:** Add Twitter/X as a second post source alongside Bluesky, using a local operator CLI that ingests normalized tweet data into the existing Cloudflare Worker via a platform-agnostic import endpoint.

**Approach:** The Twitter scraper runs locally (requires browser cookies, TLS fingerprinting). It normalizes tweets into the same PostData shape as Bluesky ingest. A new admin endpoint receives this data and runs the same topic matching + curation flagging. No schema changes for v1.

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Local CLI (Bun)    │     │  Cloudflare Worker    │     │  D1 Database    │
│                     │     │                       │     │                 │
│  Twitter Scraper    │────▶│  POST /admin/ingest   │────▶│  posts          │
│  Tweet → PostData   │     │  /import              │     │  post_topics    │
│  Profile → Expert   │     │  Topic match          │     │  experts        │
│                     │     │  Curation flag        │     │  post_curation  │
│                     │     │  Store                │     │  links          │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
     runs locally               existing worker              existing DB
     has cookies/TLS            platform-agnostic             no schema
     operator-triggered         bulk import endpoint          changes v1
```

The normalization boundary is at the API. The local CLI does all platform-specific work (scraping, auth, embed extraction). The worker receives platform-agnostic data and runs the same processing as Bluesky ingest.

### Why the scraper runs locally

The Twitter scraper (`/Users/pooks/Dev/better_twitter_scraper`) requires:
- `cycletls` for TLS fingerprinting (requires Node.js/Bun, not Workers)
- Browser cookies for authenticated endpoints (user session)
- Auth pool with multiple sessions for rate limit rotation

None of this can run in Cloudflare Workers. The scraper is a local Bun tool.

---

## Identity Model

### Post URIs

Synthetic URI scheme for Twitter: `x://user_id/status/tweet_id`

- Uses numeric user ID (stable across username changes), not handle
- Platform detected by prefix: `at://` = Bluesky, `x://` = Twitter
- Stored in existing `uri TEXT PRIMARY KEY` column, no migration needed
- Helper: `platformFromUri(uri): "bluesky" | "twitter"`

### Expert Identity

Twitter experts use synthetic DIDs: `did:x:44196397` (numeric user ID).

Same experts table, same fields, same semantics:

| Field | Bluesky | Twitter | Semantics |
|-------|---------|---------|-----------|
| did (PK) | `did:plc:abc123` | `did:x:44196397` | Opaque identifier |
| handle | `@shaffer.bsky.social` | `@blaborgnol` | Display handle |
| tier | `energy-focused` | `energy-focused` | Same tier system |
| domain | `energy` | `energy` | Same ontology |
| source | `seed` | `twitter-import` | How they entered |

An expert can exist on both platforms as two separate records with the same tier and domain. Their posts flow into the same curation queue.

### Ontological Coherence

The expert model is identical regardless of platform:
- Same tiers (energy-focused, independent, general-outlet)
- Same domain taxonomy
- Same curation predicates (tier, topic matches, link domains, media richness)
- Same enrichment pipeline (vision, source-attribution)
- Same editorial pick workflow

Engagement metrics (likes, reposts) are kept uniform across platforms. Quality determination is left to the operator through the curation workflow, not automated engagement thresholds.

---

## Import Endpoint

### `POST /admin/ingest/import`

New admin endpoint. Receives normalized post data from any platform.

**Request body:**

```ts
{
  experts: [{
    did: "did:x:44196397",
    handle: "blaborgnol",
    displayName: "Blake Laborgnol",
    domain: "energy",
    source: "twitter-import",
    tier: "energy-focused"
  }],
  posts: [{
    uri: "x://44196397/status/1899477362348818662",
    did: "did:x:44196397",
    text: "Solar curtailment in CAISO hit a new record...",
    createdAt: 1741234567000,
    embedType: "img",
    embedPayload: { kind: "img", images: [{ url: "...", alt: "..." }] },
    links: [{ url: "https://gridstatus.io/...", domain: "gridstatus.io" }]
  }]
}
```

**Server-side processing (same pipeline as Bluesky):**

1. Upsert experts (if not already known)
2. For each post: run `OntologyCatalog.match(text, links)` for topics
3. Upsert posts with topics and links via `KnowledgeRepo`
4. Run `CurationService.flagBatch()` on the batch
5. Return: `{ imported: N, flagged: N, skipped: N }`

**Auth:** Same bearer token as all other admin endpoints. Requires `ops:refresh` scope.

**Implementation note:** Topic matching is currently inline in `FilterWorker.ts`. It needs to be extracted into a reusable function that both FilterWorker and the import endpoint call.

---

## Local CLI Commands

Added to the existing `src/scripts/ops.ts` CLI:

### `ops twitter import-timeline <handle> [--limit N] [--since <date>]`

Fetches recent tweets from a Twitter expert's timeline. Maps each tweet to PostData. Ensures expert exists (creates with specified tier if new). Calls the import endpoint.

### `ops twitter import-tweet <tweet-id>`

Fetches a single tweet/thread by ID. Imports the focal tweet. Useful for "I saw something interesting on Twitter, ingest it."

### `ops twitter add-expert <handle> --tier <tier>`

Resolves the Twitter profile via scraper. Creates the expert record via the import endpoint. Does not fetch tweets.

### Usage

```bash
# Register Twitter energy experts
bun src/scripts/ops.ts twitter add-expert blaborgnol --tier energy-focused
bun src/scripts/ops.ts twitter add-expert JesseJenkins --tier energy-focused

# Import their recent posts
bun src/scripts/ops.ts twitter import-timeline blaborgnol --limit 20
bun src/scripts/ops.ts twitter import-timeline JesseJenkins --since 2026-03-28

# Import a specific interesting tweet
bun src/scripts/ops.ts twitter import-tweet 1899477362348818662

# Now use MCP as normal — imported tweets appear in:
#   search_posts, get_recent_posts, list_curation_candidates
```

### Scraper auth

The CLI reads Twitter cookies from env or a cookie file. The operator provides their own authenticated session. This is a local concern.

---

## Tweet Normalization

The CLI maps Twitter's `TweetDetailNode` to the import endpoint's `PostData`:

| Twitter field | PostData field | Notes |
|---------------|----------------|-------|
| `id` | `uri` | `x://{userId}/status/{id}` |
| `userId` | `did` | `did:x:{userId}` |
| `text` | `text` | Direct mapping |
| `timestamp` | `createdAt` | Epoch ms |
| `photos[]` | `embedPayload` | `{ kind: "img", images: [...] }` |
| `videos[]` | `embedPayload` | `{ kind: "video", ... }` |
| `urls[]` | `links` | Extract domain from each URL |
| `likes` | engagement fields | Stored as-is |
| `retweets` | engagement fields | Stored as-is |
| `replies` | engagement fields | Stored as-is |
| `isQuoted + quotedTweetId` | `embedPayload` | `{ kind: "quote", ... }` |

When a tweet has both photos and a quoted tweet, use `{ kind: "media" }` composite embed (same as Bluesky's recordWithMedia).

---

## v1 Scope Boundary

### What changes in skygest-cloudflare (small)

1. **New admin endpoint:** `POST /admin/ingest/import` — receives normalized PostData, runs topic matching + curation flagging + storage
2. **Widen URI validation:** Accept `x://` prefix alongside `at://` at the import boundary
3. **Extract topic matching:** Move from inline FilterWorker into a reusable function

### What changes in ops CLI (medium)

1. Three new commands: `twitter import-timeline`, `twitter import-tweet`, `twitter add-expert`
2. Normalization layer: Tweet to PostData mapping
3. Twitter scraper as a dependency

### What does NOT change

- Database schema (no migrations)
- MCP tools (query from D1, work on URIs)
- Enrichment pipeline (works on embed payloads)
- Curation predicates (work on post data)
- Editorial picks (work on post URIs)
- API routes (query from D1)

### What does NOT work for Twitter posts in v1

- **`get_post_thread` / `get_thread_document`** — call BlueskyClient live. For Twitter URIs they would error. Acceptable for v1 since the operator evaluated the thread locally before importing.
- **`curate_post`** — calls BlueskyClient to fetch embeds. For Twitter posts, embeds are already captured at import time. The curate operation would need to skip the live fetch. Deferred to v2.

### v1 value proposition

Twitter posts appear in `search_posts`, `get_recent_posts`, `list_curation_candidates`. The operator evaluates threads locally via the scraper, imports the best content, and it flows through the existing enrichment and editorial pipeline.

---

## v2: Polymorphic Thread Client

v2 introduces a `ThreadClient` interface so `curate_post` and `get_post_thread` dispatch by platform:

```ts
interface ThreadClient {
  readonly getThread: (
    postUri: PostUri,
    options: { depth?: number; parentHeight?: number }
  ) => Effect<PlatformThread, ThreadFetchError>;
}
```

- **BlueskyThreadClient** — calls Bluesky API live (existing behavior)
- **TwitterThreadClient** — returns stored data from the import (since everything was captured at ingest time). No live API call needed.

Dispatch via `platformFromUri(uri)`. The MCP tools become fully platform-agnostic.

`curate_post` for Twitter posts would skip the live thread fetch and use the already-stored embed payload from the import.

---

## Open Questions

1. **Twitter image accessibility** — Do tweet photo URLs remain publicly accessible without auth? The vision enrichment pipeline needs to fetch them.
2. **Expert cross-linking** — Should we support linking a Bluesky expert and Twitter expert as the same person? (e.g., Blake Shaffer posts on both). Not needed for v1 but worth considering.
3. **Retweet handling** — Should retweets be imported, or only original tweets? Retweets duplicate content and inflate volume.
