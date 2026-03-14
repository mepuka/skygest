# Proposal: Polling-Based Ingestion Architecture

## Status

This is the recommended target architecture after reviewing the current worker
topology, the polling thesis, and the Skygent sync reference.

## Executive Summary

Replace the Jetstream Durable Object + queue pipeline with a **cron-driven,
PDS-aware `listRecords` poller** that processes records directly through the
existing `processBatch` filter/write path.

Resolved decisions:

1. **Direct processing, no queue**
   Polling already controls batch size and retry boundaries. Keep retries at the
   expert/page level instead of carrying the queue forward.
2. **Drop active shard orchestration**
   Shards were solving WebSocket subscription partitioning. The target poller
   should operate over a flat active-expert list.
3. **Backfill defaults to 300 posts or 90 days per expert**
   Same poller, deeper pagination, page-aligned checkpoints, hard cap override
   to 1000 for one-off operator runs.
4. **Target a single worker**
   One worker should own fetch/admin/MCP/scheduled ingest. Keep the two-worker
   layout only as a migration step if we want to cut risk.

## Non-Obvious Constraints

These are the design constraints the original proposal was missing.

### 1. `listRecords` is a repo/PDS read, not just an AppView read

`com.atproto.repo.listRecords` is the right endpoint because it returns raw
`app.bsky.feed.post` records in repo shape, but it is a **repo endpoint**.
That means the poller needs a DID -> PDS service resolution step and a small
cache of the resolved service URL per expert. Treating this like a plain
`public.api.bsky.app` call is not a safe assumption.

### 2. `listRecords` does not emit deletes

Inference from the lexicon: `listRecords` returns the current `records[]`
(`uri`, `cid`, `value`) for a collection. It does **not** give us Jetstream-style
delete commits. If we switch to polling, delete handling becomes a reconciliation
problem rather than an event-stream problem.

### 3. Cron execution can overlap

Scheduled triggers are not a perfect singleton. Manual backfill and cron can also
collide. We need an explicit D1 lease/lock so two runs cannot advance expert state
at the same time.

### 4. Opaque pagination cursors are not the same as Jetstream cursors

Do not replace the Jetstream `time_us` cursor with a single `last_synced_at`
watermark and call it done. For steady-state polling, the correct resume boundary
is a known head record. For backfill, the correct resume boundary is a **page-aligned**
repo cursor.

## Recommended Target Architecture

### Data Flow

```text
Cron trigger or admin POST
  -> PollCoordinator acquires D1 lease
  -> load active experts
  -> resolve or reuse expert PDS endpoint
  -> ExpertPoller.listRecords(repo=did, collection=app.bsky.feed.post, reverse=true)
  -> map records to RawEventBatch
  -> processBatch (direct)
  -> update expert sync state
  -> optional recent-window reconcile for deletes
```

### Core Services

- `PollCoordinator`
  Owns run lease acquisition, expert enumeration, concurrency limits, and run summaries.
- `ExpertPoller`
  Polls a single expert in one of three modes: `head`, `backfill`, `reconcile`.
- `ExpertSyncStateRepo`
  Persists per-expert polling state and error metadata.
- `IngestLeaseRepo`
  Prevents overlapping cron/manual runs.
- `BlueskyClient`
  Extended with:
  - `resolveRepoService(did)`
  - `listRecords(serviceUrl, repo, collection, cursor?, limit, reverse?)`

### State Model

Keep `experts.last_synced_at`, but stop using it as the sole correctness boundary.
It should remain an operator-facing timestamp, not the resume token.

Add a dedicated sync-state table:

```sql
CREATE TABLE expert_sync_state (
  did TEXT PRIMARY KEY REFERENCES experts(did),
  pds_url TEXT,
  pds_verified_at INTEGER,
  head_uri TEXT,
  head_rkey TEXT,
  head_created_at INTEGER,
  last_polled_at INTEGER,
  last_completed_at INTEGER,
  backfill_cursor TEXT,
  backfill_status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT
);

CREATE TABLE ingest_leases (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
```

Why this split matters:

- `head_uri` / `head_rkey` is the steady-state stop marker.
- `backfill_cursor` is the deeper-pagination checkpoint.
- `last_synced_at` remains useful for UI/admin reporting, but not as the only resume primitive.

## Polling Modes

### 1. Steady-State Head Poll

Run every 15 minutes.

- Fetch newest-first with `reverse=true`
- Page size: `100`
- Per-expert max pages: `2` by default
- Stop when:
  - the prior `head_uri` is encountered, or
  - the max page budget is reached
- Only update `head_uri` / `head_rkey` / `head_created_at` after the entire expert run succeeds

This gives us a clean retry model: if page 2 fails, the next run may reprocess page 1,
but idempotent writes handle duplicates and we do not advance the boundary incorrectly.

### 2. Backfill

Backfill is the same poller with deeper pagination.

- Default depth: **300 posts or 90 days**, whichever comes first
- Hard cap: `1000` posts via explicit admin override
- Resume with `backfill_cursor`
- Checkpoint **only after a full page has been processed successfully**

This is the one place where page-aligned cursor checkpoints from Skygent apply directly.

### 3. Reconcile

Because polling loses delete events, run a shallow reconciliation pass:

- On every head poll, compare the most recent local posts for that expert against the
  just-fetched recent window and mark missing posts as deleted
- Run a deeper reconcile weekly or on demand:
  - default: `1000` posts or 180 days

That keeps the current `markDeleted(...)` path useful without pretending polling has
firehose-level delete fidelity.

## Processing Strategy

### Recommended: direct `processBatch`

The poller should call `processBatch` directly in the same invocation.

Why:

- polling already defines natural retry boundaries at the expert/page level
- queue buffering was valuable for unbounded WebSocket input, not for bounded pulls
- direct processing keeps failure handling local and removes queue/DLQ/config overhead

When to reconsider the queue later:

- if enrichment becomes materially heavier than topic match + link extraction
- if we add additional async fan-out steps unrelated to ingest correctness

## Concurrency and Rate Limiting

Carry the Skygent client discipline forward:

- per-client semaphore
- minimum inter-call delay
- jittered exponential retry on `429`, `5xx`, and transient network errors
- bounded `Effect.forEach` concurrency

Recommended starting point:

- expert polling concurrency: `5`
- max concurrent requests per PDS host: `2`
- page size: `100`

Host-aware throttling matters because many experts may resolve to the same PDS.

## Shards

The target design should **not** depend on shards.

Pragmatic migration guidance:

- keep the `experts.shard` column temporarily so current admin responses and seed logic
  do not need to change in the same cut
- stop using shard refresh RPCs for ingest orchestration
- replace `/admin/shards/refresh` with poll-oriented endpoints

Recommended replacements:

- `POST /admin/ingest/poll`
- `POST /admin/ingest/backfill`
- `POST /admin/ingest/reconcile`

If compatibility matters during rollout, `/admin/shards/refresh` can temporarily proxy
to a full poll run and return a deprecated success payload.

## Worker Topology

### Target: single worker

One worker should own:

- `fetch`
- `scheduled`
- admin routes
- MCP routes
- D1 access

The current two-worker split exists mainly because the agent worker references the ingest
worker's Durable Object via `script_name`. Once the DO disappears, the split stops buying
us much and adds config/migration overhead instead.

### Transitional option

If we want a safer cut:

1. land the poller in the current ingest worker first
2. stop using the DO and queue
3. merge the worker surfaces after the poller is stable

That is a migration tactic, not the target architecture.

## What Gets Removed

- `src/ingest/IngestorDo.ts`
- `src/ingest/JetstreamIngestor.ts`
- `src/ingest/IngestorSupervisor.ts`
- `src/ingest/JetstreamCursorStore.ts`
- `src/services/IngestShardRefresher.ts`
- DO bindings and DO migrations from Wrangler config
- queue producer/consumer config for raw ingest
- `effect-jetstream`

## What Gets Added

- `src/ingest/PollCoordinator.ts`
- `src/ingest/ExpertPoller.ts`
- `src/services/d1/ExpertSyncStateRepoD1.ts`
- `src/services/d1/IngestLeaseRepoD1.ts`
- `listRecords` and repo-service resolution in `src/bluesky/BlueskyClient.ts`
- scheduled handler config
- admin endpoints for poll/backfill/reconcile

## What Stays the Same

- `processBatch`
- `KnowledgeRepo` and D1 post/topic/link storage
- expert registry and seed model
- MCP query surface and read-side schema

## Skygent Patterns Worth Reusing

Skygent is useful here, but only in specific places.

Reuse:

- paginated sync shape from `services/sync-engine.ts`
- page-aligned checkpointing from `services/sync-checkpoint-store.ts`
- bounded concurrency and retry discipline from `services/bsky-client.ts`

Do not copy:

- Jetstream-specific cursor logic
- stream supervision assumptions
- websocket batching rules

Important carry-over invariant:

- checkpoint progression must stay aligned with fully durable pages

## Migration Order

1. Add sync-state and lease tables
2. Extend `BlueskyClient` with repo-service resolution + `listRecords`
3. Build `ExpertPoller` and direct `processBatch` path
4. Add manual admin endpoints
5. Add scheduled head poll
6. Run initial backfill
7. Remove DO/queue/shard refresh path
8. Collapse to one worker

## Final Recommendation

Proceed with a **single-worker, direct-processing, PDS-aware `listRecords` poller**
with:

- D1 lease protection
- dedicated sync-state checkpoints
- default backfill of 300 posts / 90 days
- shallow delete reconciliation on head polls
- deeper reconcile as a weekly or manual maintenance run

That preserves the good part of the existing design, which is `processBatch` and the
knowledge schema, while removing the parts that only existed to support the Jetstream
firehose.
