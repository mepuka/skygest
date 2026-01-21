# Skygest Effect-Native Vertical Slice Design (Global Feed)

**Goal**
Ship an end-to-end ingestion and global feed slice on Cloudflare using Effect services/layers. This slice ingests Jetstream commit events, filters paper posts, stores them in D1, and serves a global feed skeleton from D1 with a timestamp cursor. Personalization, caching, and generator workers are deferred.

**Architecture**
- Jetstream Durable Object (DO) streams commit events and enqueues batches to a Queue.
- Filter worker consumes batches, extracts paper posts, and writes to D1.
- Feed API worker serves the Bluesky feed skeleton endpoints from D1.
- All components are modeled as Effect services/layers for testability.

**Components & Data Flow**
1) **Jetstream DO**
   - On `fetch`, reads cursor from DO SQL (`jetstream_state`).
   - Streams `effect-jetstream` commit events.
   - Normalizes commit events into `RawEvent`, batches them, and sends `RawEventBatch` to `raw-events` queue.
   - Updates cursor to last `timeUs` after enqueue.

2) **Filter Worker**
   - Consumes `raw-events` queue batches.
   - For each event, builds `searchText` and checks paper patterns.
   - Inserts qualifying posts into D1 (`posts` table). Deletes mark `status = 'deleted'`.

3) **Feed API Worker**
   - Exposes `/xrpc/app.bsky.feed.describeFeedGenerator` and `/xrpc/app.bsky.feed.getFeedSkeleton`.
   - Queries D1 for recent posts ordered by `created_at DESC, uri DESC`.
   - Cursor is timestamp-based: `cursor = created_at` of the last row. Pagination uses `created_at < cursor`.

**Cursoring**
- Timestamp-based cursor avoids skipping on new inserts.
- If `cursor` is missing, fetch most recent posts.
- If no rows, return `cursor = "eof"`.
- If we need strict stability later, upgrade to composite cursor (`created_at + uri`).

**Error Handling**
- DO stream failures surface and require manual restart (acceptable for v1).
- Queue processing is idempotent via primary key on `posts.uri` and `INSERT OR IGNORE`.
- Queue messages are only `ack()`'d after successful processing; failed batches retry.
- Feed API errors return `500` with a minimal body.

**Testing**
- `migrations.test.ts`: posts table exists.
- `PostsRepoD1.test.ts`: insert + list by author/time; delete handling.
- `JetstreamCursorStore.test.ts`: cursor persistence in DO SQL.
- `FilterWorker.test.ts`: paper post inserts; delete events mark deleted.
- `FeedRouter.test.ts`: feed skeleton response and timestamp cursor progression.

