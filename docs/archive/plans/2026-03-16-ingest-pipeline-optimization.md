# Ingest Pipeline Optimization Plan

## Problem Statement

The ingest pipeline takes ~78 minutes to poll 793 experts for new posts. The actual work (fetching from Bluesky, filtering, writing to D1) takes ~2 minutes. The remaining 76 minutes is structural overhead: sleep-polling, conservative fanout, sequential D1 round-trips, and single-writer serialization.

## Architecture Overview

```
Workflow (IngestRunWorkflow)
  └─ dispatchUntilTerminal loop
       ├─ step.do: dispatch up to FANOUT=3 DOs
       ├─ step.sleep: 15 seconds
       └─ repeat until countIncompleteByRun == 0

Each DO (ExpertPollCoordinatorDo)
  └─ alarm handler (2s gap between alarms)
       ├─ Fetch 1-2 pages from Bluesky API (~200 posts)
       ├─ Filter by topic ontology (unmatched posts dropped before D1)
       ├─ Per-post idempotency SELECT (sequential, for matched posts only)
       ├─ Batch write to D1 (BATCH_LIMIT=100 statements)
       └─ Mark item complete in D1
```

## Identified Bottlenecks

### 1. Workflow Polling Overhead — 66 min of pure sleep

- WORKFLOW_FANOUT=3 with 15s sleep = 265 cycles x 15s = 66 minutes minimum
- Each cycle consumes 2 workflow steps (dispatch + sleep) = 530 of 1,024 step limit
- Workflow discovers DO completion by polling D1, not by event notification
- Cloudflare Workflows supports `step.waitForEvent()` but it is not used

### 2. D1 Write Inefficiency — per-post sequential reads

- Matched posts (post-ontology-filter) issue sequential per-post `SELECT ingest_id` checks
- Then batch writes at BATCH_LIMIT=100 (~8 statements per post = ~12 posts per batch)
- D1 supports up to 10,000 statements per batch — current limit is conservative
- Note: the 200-post chunk is the raw Bluesky page; only ontology-matched posts hit D1. Actual D1 pressure varies by expert topic density.

### 3. D1 Single-Writer Serialization

- D1 is SQLite: one writer at a time, concurrent writes serialize
- With FANOUT=3, three DOs may issue batch writes simultaneously — they queue
- FTS5 maintenance (delete + re-insert per post) roughly doubles per-post write cost
- The 2-second DO alarm gap is per-DO and cannot coordinate across DOs

### 4. Progress Reporting Gap

- Run-level counters (expertsSucceeded, postsSeen, etc.) stay at 0 during dispatching
- Only updated at finalization via `summarizeByRun` (SUM over all items)
- Item-level progress is accurate (790/793 complete) but not surfaced in the run API
- Misleading for operators monitoring ingest runs

## Design Guardrails

Before touching performance knobs, the implementation needs one coherent contract story across `domain/*`, service tags, repo methods, and worker layers.

- **Schema-first changes:** shared ingest lifecycle stays in `src/domain/polling.ts`; any new transport payloads or workflow wake events live in a dedicated ingest domain module such as `src/domain/ingest.ts`; queue/wake failures are added to `src/domain/errors.ts` as `Schema.TaggedError`s.
- **One canonical ingest pipeline:** `FilterWorker.processBatch` remains the public composition point. If classification and persistence are split, they are split once and then reused by `ExpertPollExecutor`, staging ops, and any queue consumer.
- **Layer-selected behavior, not ambient env checks:** runtime wiring in `src/edge/Layer.ts` decides whether ingest uses direct persistence or queue-backed dispatch. `ExpertPollExecutor`, `ExpertPollCoordinatorDo`, and consumer code should not branch on `env.INGEST_QUEUE !== undefined`.
- **Reuse existing identifiers:** `runId` already equals the workflow instance id in `IngestRunWorkflow`. Do not introduce a parallel `workflowInstanceId` field through the coordinator schemas.
- **Prefer existing lifecycle states:** if post writes become asynchronous, keep items `running` until the async write commits instead of inventing a `writing` status in the first pass. Add a new status only if observability or repair semantics truly require it, and then update the shared domain, repos, repair logic, and admin/API schemas together.
- **Error taxonomy stays unified:** queue publish/decode failures must round-trip through `toIngestErrorEnvelope`, not create a second ad hoc error system.

## Recommended Changes

### Phase 0: Contract Tightening (required groundwork)

#### 0A. Introduce shared ingest transport models

**Files:** `src/domain/ingest.ts`, `src/filter/FilterWorker.ts`, `src/ingest/ExpertPollExecutor.ts`

Create a small ingest-domain module for transport-safe, schema-first payloads:

- `IngestBatchActions`
  - `upserts: ReadonlyArray<KnowledgePost>`
  - `deletions: ReadonlyArray<DeletedKnowledgePost>`
  - `dropped: NonNegativeInt`
- `IngestWriteEnvelope`
  - `runId`
  - `did`
  - `mode`
  - `attemptCount`
  - `pagesFetched`
  - `postsSeen`
  - `postsDeletedExpected`
  - `actions: IngestBatchActions`
  - `producedAt`
- `IngestBatchWriteOutcome`
  - `Persisted` variant for direct D1 writes
  - `Queued` variant for async queue acceptance
- `IngestWorkflowWakeEvent`
  - small typed payload for `waitForEvent()` / `sendEvent()`

These schemas must **reuse** the existing domain models instead of duplicating them:

- `KnowledgePost`, `DeletedKnowledgePost` from `src/domain/bi.ts`
- `Did` and `AtUri` brands from `src/domain/types.ts`
- `PollMode` and counter conventions from `src/domain/polling.ts`

The goal is that queue messages and workflow wake events are wrappers around existing domain types, not a parallel ingest model.

#### 0B. Keep one canonical batch processor

**Files:** `src/filter/FilterWorker.ts`, optional new `src/ingest/IngestBatchSink.ts`

Refactor `processBatch` into smaller reusable pieces, but keep one public pipeline:

- `classifyBatch(rawBatch) -> IngestBatchActions`
- `persistBatchActions(actions) -> Persisted counts`
- `processBatch(rawBatch) -> ProcessBatchSummary`

If Phase 3 lands, add an Effect service boundary:

```ts
export class IngestBatchSink extends Context.Tag("@skygest/IngestBatchSink")<
  IngestBatchSink,
  {
    readonly accept: (
      input: IngestWriteEnvelope
    ) => Effect.Effect<
      IngestBatchWriteOutcome,
      IngestQueuePublishError | SqlError | DbError
    >
  }
>() {}
```

Rules:

- `processBatch` stays the thin orchestrator used by staging ops and direct-write paths.
- Queue consumers must decode `IngestWriteEnvelope` and then call the same canonical persistence function; they should not reimplement classification or post-to-D1 translation.
- Direct vs queue-backed behavior is chosen by the provided layer, not by conditional logic inside `ExpertPollExecutor`.

#### 0C. Add missing repo/domain mutations before workflow changes

**Files:** `src/domain/polling.ts`, `src/services/IngestRunsRepo.ts`, `src/services/d1/IngestRunsRepoD1.ts`

Model progress rollup as a first-class repo mutation:

- Add `UpdateIngestRunProgress` schema/type to `src/domain/polling.ts`
- Reuse the existing `IngestRunSummaryCounterFields`
- Add `runs.updateProgress(input)` to the repo tag and D1 implementation

Do **not** pass a loose object from workflow code into the repo. The schema should be the source of truth for:

- `id`
- summary counters
- `lastProgressAt`

#### 0D. Extend the error algebra, not the runtime only

**Files:** `src/domain/errors.ts`

If Phase 2 or 3 is implemented, add tagged errors such as:

- `IngestQueuePublishError`
- `IngestQueuePayloadDecodeError`
- `IngestWorkflowWakeEventDecodeError`

Then update:

- `sanitizeIngestErrorEnvelope`
- `toIngestErrorEnvelope`
- any admin/API mapping that depends on ingest failures

This keeps queue and event failures visible through the same persisted/run-level error mechanisms as current DO and workflow failures.

### Phase 1: Quick Wins (code-only, no infra changes)

#### 1A. Mode-dependent fanout

**File:** `src/ingest/IngestRunWorkflow.ts`

Replace the single `WORKFLOW_FANOUT = 3` constant with mode-dependent values:

- Head sweep: `FANOUT_HEAD = 10`
- Backfill: `FANOUT_BACKFILL = 3`
- Reconcile: `FANOUT_RECONCILE = 5`

**Expected impact:** Head sweeps drop from ~78 min to ~15-20 min. The 15s dispatch cadence and DO alarm delay still cap the floor at roughly `ceil(793/10) * 15s = ~20 min` until Phase 2 lands.

#### 1B. Batch idempotency checks

**File:** `src/services/d1/KnowledgeRepoD1.ts`

Replace per-post sequential `SELECT ingest_id FROM posts WHERE uri = ?` with chunked batched lookups:

```sql
SELECT uri, ingest_id FROM posts WHERE uri IN (?, ?, ?, ...)
```

Rules:

- Chunk to stay under the repo’s existing D1-safe bound-parameter convention.
- Build a `Map<uri, ingestId>` once per chunk.
- Reuse the current `KnowledgePostSchema` validation path; do not add a second, queue-only validation shape.

**Expected impact:** Sequential reads reduce from `N` to `ceil(N / chunkSize)`.

#### 1C. Raise `BATCH_LIMIT`

**File:** `src/services/d1/KnowledgeRepoD1.ts`

Raise `BATCH_LIMIT` from `100` to `500` as a conservative first step. This reduces D1 round-trips without jumping straight to D1’s theoretical batch maximum.

#### 1D. Periodic counter rollup

**Files:** `src/ingest/IngestRunWorkflow.ts`, `src/domain/polling.ts`, `src/services/IngestRunsRepo.ts`, `src/services/d1/IngestRunsRepoD1.ts`

After each `dispatchAvailable()` call:

1. call `items.summarizeByRun(runId)`
2. persist the result through the new schema-backed `runs.updateProgress(...)`

This keeps progress visibility accurate without inventing a one-off repo payload shape in workflow code.

### Phase 2: Hybrid event-driven dispatch

#### 2A. Augment sleep-poll with `waitForEvent`, keep repair loop

**Files:** `src/ingest/IngestRunWorkflow.ts`, `src/ingest/ExpertPollCoordinatorDo.ts`, `src/domain/ingest.ts`

Keep the current liveness model and add a fast wake-up path.

Approach:

- Reuse the existing `runId` as the workflow instance id
- Do **not** add a duplicate `workflowInstanceId` field to `EnqueueHeadCoordinatorInput`, `EnqueueBackfillCoordinatorInput`, or `EnqueueReconcileCoordinatorInput`
- On coordinator completion or failure, call `this.env.INGEST_RUN_WORKFLOW.get(runId).sendEvent(...)`
- Encode the payload with the shared `IngestWorkflowWakeEvent` schema
- Replace fixed `step.sleep(15s)` with `step.waitForEvent({ type, timeout: 30s })`
- On timeout, fall through to the existing `dispatchAvailable()` path, which still calls `repairLiveRun()` and checks `countIncompleteByRun()`

This preserves the current repair semantics while removing most idle time between fast-completing head-sweep items.

**Expected impact:** Typical dispatch cadence drops from fixed 15s to roughly DO completion time plus event latency, with timeout fallback for liveness.

### Phase 3: Queue-based write isolation

#### 3A. Scope the first queue rollout to head sweeps

**Files:** `wrangler.toml`, `src/ingest/ExpertPollExecutor.ts`, new queue consumer code, `src/edge/Layer.ts`

The optimization target is the 793-expert head sweep. Queue isolation should therefore land in the narrowest safe slice first:

- `head` mode can use queue-backed post writes
- `backfill` and `reconcile` stay on the direct-write path in the first rollout

Reason:

- head sweeps are single-chunk per item in the current coordinator flow
- backfill/reconcile can span continuation chunks, so async completion semantics are materially more complex

This reduces domain churn and avoids designing multi-chunk async item completion in the first pass.

#### 3B. Use a transport layer around the canonical persistence contract

**Files:** `src/domain/ingest.ts`, optional new `src/ingest/IngestBatchSink.ts`, `src/edge/Layer.ts`, `src/worker/filter.ts`

Implement two `IngestBatchSink` layers:

- `directIngestBatchSinkLayer`
  - validates `IngestWriteEnvelope`
  - calls canonical persistence
  - returns `Persisted`
- `queueIngestBatchSinkLayer`
  - validates `IngestWriteEnvelope`
  - sends it to `INGEST_QUEUE`
  - returns `Queued`

The queue consumer:

- decodes `IngestWriteEnvelope`
- calls the canonical persistence function
- updates run-item completion using existing repo methods

`src/edge/Layer.ts` chooses which sink is provided to the ingest worker. Tests should provide the direct sink explicitly. No transport selection by env-presence inside the executor.

#### 3C. Preserve run correctness by reusing `running` until commit

**Files:** `src/ingest/ExpertPollCoordinatorDo.ts`, queue consumer code, `src/services/IngestRunItemsRepo.ts`, `src/ingest/IngestRepairService.ts`

For the initial queue rollout:

- the DO continues to mark the item `running`
- after enqueue, the DO does **not** mark the item `complete`
- the queue consumer marks the item `complete` only after D1 commit succeeds
- if the queue publish fails, the DO fails the item as it does today

This keeps the lifecycle model tight:

- no new `writing` status in Phase 3 v1
- `finalizeRun()` still waits for `countIncompleteByRun() == 0`
- a run is only terminal when the consumer has durably committed the posts

If operator visibility later needs an explicit queue-backed status, that should be a separate coordinated domain change touching:

- `src/domain/polling.ts`
- `src/services/IngestRunItemsRepo.ts`
- `src/services/d1/IngestRunItemsRepoD1.ts`
- `src/ingest/IngestRepairService.ts`
- admin/API schemas that expose item status

#### 3D. Queue payload owns the persisted completion counts

Because the consumer is the component that knows persistence actually succeeded, `IngestWriteEnvelope` must carry the item counters needed for final completion:

- `attemptCount`
- `pagesFetched`
- `postsSeen`
- `mode`
- `runId`
- `did`

That lets the consumer call existing repo completion methods without inventing an implicit side-channel or querying partially-updated item rows.

#### 3E. Queue-specific worker changes

**Files:** `src/platform/Env.ts`, `src/worker/filter.ts`, `wrangler.toml`

- Add `INGEST_QUEUE` binding to the ingest worker env
- Add a `queue()` export on the ingest worker
- Keep the consumer layer minimal and explicit
- Reuse existing logging/runtime helpers instead of open-coded `Effect.runPromise` branches

### Phase 4: D1 read-replica tuning (optional follow-up)

Read replicas may still help query-side latency, but they are downstream of the contract/lifecycle fixes above.

If pursued:

- keep the sessions choice inside the layer graph
- keep ingest admin/status endpoints on primary reads if freshness matters
- do not mix replica policy into domain/repo code

## Impact Summary

| Phase | Changes | Head Sweep Time | Effort |
|-------|---------|-----------------|--------|
| Current | — | ~78 min | — |
| Phase 0 + 1 | Contract tightening + fanout + batched D1 | ~15-20 min | Small to medium |
| Phase 0 + 1 + 2 | + hybrid `waitForEvent` | ~5-8 min | Medium |
| Phase 0 + 1 + 2 + 3 | + queue-backed head-sweep writes | ~3-5 min | Larger |

## Verification

Each phase should add or update tests at the same abstraction layer as the change.

1. `bunx tsc --noEmit`
2. `bun run test`
3. Schema round-trip tests for any new `src/domain/ingest.ts` payloads
4. Repo tests for any new `UpdateIngestRunProgress` mutation
5. Workflow tests covering timeout fallback plus wake-event dispatch
6. Queue consumer tests that decode the shared payload and call canonical persistence
7. Repair tests proving queue-backed items still self-heal or fail predictably under stalled consumer conditions
8. Staging head-sweep run comparing wall-clock time, error rate, and final counters against baseline
9. Verify run counters and item terminal states correspond to durable D1 writes, not enqueue acceptance

## Decision Log

- **DO-per-expert remains the right partition** for cursor state, alarm scheduling, and expert-local backfill progress.
- **Optimization must not outrun the domain model.** New statuses, repo mutations, queue payloads, and wake events must be schema-backed before workflow or worker code depends on them.
- **`runId` is already the workflow instance id.** Reusing it avoids unnecessary schema drift through the coordinator boundary.
- **`processBatch` remains canonical.** Classification and persistence may be factored apart for reuse, but there should still be one source of truth for turning Bluesky events into domain writes.
- **Transport selection belongs in layers.** Direct vs queue-backed ingest is an environment wiring concern, not business logic hidden behind `if (env.INGEST_QUEUE)`.
- **Phase 3 is head-sweep-first by design.** That keeps the initial async-write rollout aligned with the actual incident and avoids prematurely redesigning multi-chunk backfill/reconcile semantics.
- **Queue mode must preserve current completion semantics.** "Complete" means "D1 commit succeeded", not "message accepted by the queue".
