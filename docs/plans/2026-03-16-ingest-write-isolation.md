# Ingest Write Isolation — Architecture Plan

Date: 2026-03-16
Status: Draft — awaiting review

## Problem

A 793-expert head sweep poll caused worker CPU limit errors (1101/1102) on staging, taking down MCP and API endpoints. Root cause: `upsertPosts` in `KnowledgeRepoD1` processes each post as an individual `db.batch()` call — 60 matched posts × 5 concurrent DOs = 300 D1 round-trips in a tight window. The API worker's reads back up behind these write transactions until CPU time expires.

## Current Write Path

```
DO alarm
  → ExpertPollExecutor.runDid()
    → RepoRecordsClient.listRecords() [Bluesky API fetch]
    → FilterWorker.processBatch() [ontology match + D1 writes fused]
      → KnowledgeRepo.upsertPosts() [per-post db.batch() — NO cross-post batching]
      → KnowledgeRepo.markDeleted()
    → ExpertSyncStateRepo.upsert() [small D1 write]
    → ExpertsRepo.setLastSyncedAt() [small D1 write]
```

## Bottleneck Data

| Metric | Value |
|--------|-------|
| Experts per sweep | 793 |
| Workflow fan-out | 5 concurrent DOs |
| Pages per DO alarm | 2 (100 records each) |
| Match rate | ~30% (60 posts stored per expert) |
| D1 statements per post | 8-9 (SELECT + batch of upsert/topics/links/FTS/publications) |
| D1 round-trips per expert | ~60 individual `db.batch()` calls |
| Peak concurrent D1 ops | 300+ batch calls in tight window |
| DO alarm re-arm delay | 0ms (`Date.now()`) |
| MCP layer caching | Effective (reference-equality on env) — not the bottleneck |

## Design

### Phase 0: Quick Wins (Immediate Pressure Relief)

#### 0.1 Batch `upsertPosts` across posts

**File:** `src/services/d1/KnowledgeRepoD1.ts`

Current: `Effect.forEach(posts, upsertOne)` — each post gets its own `db.batch()`.

Fix: Collect all statements from all posts into a single `db.batch()` call. This collapses 60 individual round-trips to 1-2.

The `makeUpsertStatements` helper already returns an array of `D1PreparedStatement` per post. Combine them:

```typescript
const allStatements = posts.flatMap(post => makeUpsertStatements(post));
await db.batch(allStatements);
```

D1 batch limit is 100 statements. If the batch exceeds 100, chunk it.

**Impact:** ~60x fewer D1 round-trips per expert poll. Biggest single win.

#### 0.2 Add inter-alarm delay

**File:** `src/ingest/ExpertPollCoordinatorDo.ts`

Current: `setAlarmIfPending` arms at `Date.now()` (line 114) — zero gap between chunks.

Fix: Arm at `Date.now() + 2000` (2-second gap between chunk alarms). This spaces out D1 writes per DO, reducing burst pressure.

#### 0.3 Reduce `WORKFLOW_FANOUT` (optional, reversible)

**File:** `src/ingest/IngestRunWorkflow.ts`

Current: `WORKFLOW_FANOUT = 5` (line 37).

Fix: Reduce to 3. Trade-off: sweep takes ~60 min instead of ~40 min. Reversible once Phase 1 is in place.

### Phase 1: Queue-Based Write Isolation

#### Architecture

```
ExpertPollCoordinatorDo
  → alarm fires
  → ExpertPollExecutor.runDid()
    → fetches posts from Bluesky API
    → classifyBatch() [ontology match — CPU only, no D1]
    → IngestWriter.writeBatch() [enqueues to INGEST_QUEUE]
  → sync state writes to D1 directly (small, tolerable)
        |
        v
INGEST_QUEUE (Cloudflare Queue, max_concurrency=1)
        |
        v
Queue consumer handler
  → KnowledgeRepo.upsertPosts() [serialized D1 writes]
  → KnowledgeRepo.markDeleted()
        |
        v
D1 Database (primary)
        |
        v (async replication)
API/MCP Worker reads from D1 (no write contention)
```

#### Key Decision: Split `processBatch` into classify + write

**File:** `src/filter/FilterWorker.ts`

Current `processBatch` fuses ontology matching and D1 writes. Split into:

1. `classifyBatch(rawBatch)` — ontology match, build upserts/deletions (CPU-only, returns `BatchActions`)
2. `writeBatch(actions)` — call `KnowledgeRepo.upsertPosts` / `markDeleted`

Existing `processBatch` becomes `classifyBatch` + `writeBatch` for backward compat (`StagingOpsService` still calls it).

#### IngestWriter Service

```typescript
// src/services/IngestWriter.ts
export class IngestWriter extends Context.Tag("@skygest/IngestWriter")<
  IngestWriter,
  {
    readonly writeBatch: (batch: IngestWriteBatch) => Effect.Effect<void, QueueError | SqlError | DbError>;
  }
>() {}
```

Two implementations:

- `IngestWriterQueue` — production: serializes to `env.INGEST_QUEUE.send()`
- `IngestWriterDirect` — tests/local: calls `KnowledgeRepo` directly

Toggle: env binding presence (`env.INGEST_QUEUE !== undefined`).

#### Queue Message Schema

```typescript
// src/domain/ingest-queue.ts
export const IngestWriteBatch = Schema.Struct({
  batchId: Schema.String,
  did: Did,
  runId: Schema.String,
  mode: Schema.Literal("head", "backfill", "reconcile"),
  producedAt: Schema.Number,
  upserts: Schema.Array(KnowledgePost),    // already ontology-matched
  deletions: Schema.Array(DeletedKnowledgePost)
});
```

Ontology matching stays on the producer (DO worker). Consumer only needs `D1Client` + `KnowledgeRepoD1`.

#### Consumer Worker

The queue consumer lives in the ingest worker (`src/worker/filter.ts`) as a `queue()` export. Its layer is minimal: `D1Client` + `KnowledgeRepoD1` + `PublicationsRepoD1` (for discovered domains) + `Logging`.

#### Wrangler Config

```toml
# wrangler.toml (ingest worker)
[[queues.producers]]
queue = "skygest-ingest"
binding = "INGEST_QUEUE"

[[queues.consumers]]
queue = "skygest-ingest"
max_batch_size = 50
max_batch_timeout = 10
max_retries = 3
max_concurrency = 1
dead_letter_queue = "skygest-ingest-dlq"
```

`max_concurrency = 1` is critical — serializes all D1 writes through a single consumer.

#### Files Changed

| File | Change |
|------|--------|
| Create: `src/domain/ingest-queue.ts` | `IngestWriteBatch` schema |
| Create: `src/services/IngestWriter.ts` | Service tag + `QueueError` |
| Create: `src/services/IngestWriterQueue.ts` | Queue-backed implementation |
| Create: `src/services/IngestWriterDirect.ts` | Direct D1 implementation |
| Modify: `src/filter/FilterWorker.ts` | Extract `classifyBatch` from `processBatch` |
| Modify: `src/ingest/ExpertPollExecutor.ts` | Use `IngestWriter` instead of direct `processBatch` |
| Modify: `src/edge/Layer.ts` | Add `IngestWriter` to executor layer, add `makeConsumerLayer` |
| Modify: `src/platform/Env.ts` | Add `INGEST_QUEUE?: Queue` binding |
| Modify: `src/worker/filter.ts` | Add `queue()` export handler |
| Modify: `wrangler.toml` | Add queue producer/consumer config |

#### Files NOT Changed

- `ExpertPollCoordinatorDo.ts` — still calls `ExpertPollExecutor.runDid()`, unaware of queue
- `IngestRunWorkflow.ts` — dispatch orchestration unchanged
- `KnowledgeRepo.ts` / `KnowledgeRepoD1.ts` — interface and implementation untouched
- All query-side code (API, MCP, frontend) — untouched
- All existing repo tests — untouched

### Phase 2: D1 Read Replicas

Enable D1 read replication via dashboard. Update the agent worker's D1 client to use Sessions API:

```typescript
const session = env.DB.withSession("first-unconstrained");
```

This routes API/MCP reads to nearby replicas. Admin ingest status endpoints use `withSession("first-primary")` for fresh reads.

**Files:** `src/edge/Layer.ts` (wrap D1Client layer for read path).

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Queue message size (128 KB limit) | Low | 200 posts × 500 bytes = 100 KB; chunk if needed |
| Queue throughput (5,000 msg/s) | Low | Peak ~5 enqueues per 15s cycle |
| Eventual consistency (stats inflation) | Medium | DO records `postsStored` before consumer writes; DLQ catches failures |
| Schema evolution | Medium | Version message schema from day one |
| DLQ monitoring gap | Medium | Add cron check for DLQ depth |
| Consumer CPU (10K upserts per batch) | Medium | Set `limits.cpu_ms = 60000`; batch D1 statements |

## Quick Win vs Full Solution

Phase 0 (batching + alarm delay) can be deployed in hours and may resolve the immediate issue. Phase 1 (queue isolation) is the structural fix for long-term reliability. Both should proceed — Phase 0 first for immediate relief, Phase 1 for durability.

## Acceptance Criteria

1. A 793-expert head sweep completes without 1101/1102 errors
2. MCP and API endpoints remain responsive during polling
3. All 230+ tests pass
4. Staging smoke tests pass
5. Queue consumer drains within minutes of poll completion
6. No data loss (DLQ empty after normal sweep)
