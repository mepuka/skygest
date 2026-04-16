# Skygest Polling: Workflow + Durable Object Redesign

**Date:** 2026-03-08
**Status:** Implemented

> Historical design doc. The workflow-first ingest path is now live, and lease-era references below are retained only as implementation history.

## Goal

Replace the current request-bound, D1-lease-based polling coordinator with a Cloudflare-native design:

- **Workflows** for durable run orchestration and operator-visible status
- **Durable Objects** for per-expert coordination and alarms
- **D1** for queryable system state and ingest results
- **Queues** as an optional later optimization, not the first coordination primitive

This redesign covers:

- scheduled head polling
- manual head polling
- manual and bulk backfill
- manual and bulk reconcile

## Why the Current Design Should Be Replaced

Today, cron and admin mutations both run the same synchronous coordinator path:

- [`src/worker/filter.ts`](/Users/pooks/Dev/skygest-cloudflare/src/worker/filter.ts)
- [`src/ingest/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/Router.ts)
- [`src/ingest/PollCoordinator.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/PollCoordinator.ts)

The current coordinator:

- acquires a single global D1 lease row
- processes all experts inside a single Worker invocation
- renews the lease while expert polls are running concurrently

That creates the wrong ownership model:

- **D1 is acting as a lock manager.** It should be the source of truth, not the runtime coordinator.
- **All work shares one global lease.** A single backfill blocks scheduled head polls for unrelated experts.
- **The run is request-bound.** Backfill and reconcile are held open by the HTTP request path.
- **Lease correctness depends on time and read-after-write checks.** That is the exact class of failure seen in the lease-renewal incident.

The existing schema also makes the current design visible:

- [`src/db/migrations.ts`](/Users/pooks/Dev/skygest-cloudflare/src/db/migrations.ts) creates `ingest_leases`
- [`src/platform/Env.ts`](/Users/pooks/Dev/skygest-cloudflare/src/platform/Env.ts) has no Workflow or DO bindings yet

## Cloudflare Primitive Assignment

Use each product for one job:

- **Workflow**: durable run orchestration, operator lifecycle, bulk fan-out, summary, retries at the run level
- **Durable Object**: per-expert ownership, enqueue/dequeue, coalescing duplicate requests, alarm-driven recovery
- **D1**: experts, sync state, run metadata, run items, queryable admin status
- **Queue**: optional later isolation layer if poll execution needs buffering or backpressure

Do **not** use:

- **D1 row leases** as the primary coordination primitive
- **a single global Durable Object** for all experts
- **Queues alone** for correctness, since delivery is at-least-once and consumers autoscale

## Design Principles

### 1. Coordinate at the expert boundary

The natural atom of coordination is an expert DID.

Each expert already has independent sync state in D1:

- `head_uri`
- `backfill_cursor`
- `backfill_status`
- `last_polled_at`
- `last_completed_at`

That means the correct runtime owner is one `ExpertPollCoordinatorDo` per expert DID, not one global poller.

### 2. Make workflows own runs, not locks

A workflow should represent an operator-visible run such as:

- "cron head sweep at 2026-03-08T15:00:00Z"
- "backfill all active experts"
- "reconcile did:plc:expert-a with depth=deep"

The workflow should:

- determine target experts
- create a run record in D1
- enqueue work to expert DOs
- poll durable status until completion
- write the final run summary

The workflow should not be the exclusive lock for a single expert. That belongs to the DO.

### 3. Keep long-running state transitions durable

The current HTTP response shape assumes synchronous completion. That is the wrong model for:

- backfill
- bulk reconcile
- any future larger expert set

The redesigned admin API should return `202 Accepted` with a workflow instance ID and run ID, then expose status via a run endpoint.

### 4. Bound work inside each alarm execution

The expert DO should not try to finish an entire deep backfill in one activation.

Instead:

- head poll: usually one execution
- recent reconcile: usually one execution
- backfill: chunked by pages or posts
- deep reconcile: chunked by pages or posts

After each chunk, persist progress and re-arm if more work remains.

## Target Runtime Architecture

### Components

#### 1. Ingest API Worker

Responsibilities:

- authenticate operator requests
- create workflow instances
- return run IDs and workflow IDs
- expose run status endpoints

It no longer performs polling inline.

#### 2. `IngestRunWorkflow`

Single workflow class with mode-specific params:

```ts
type IngestRunParams =
  | { kind: "head-sweep"; dids?: ReadonlyArray<string>; triggeredBy: "cron" | "admin" }
  | { kind: "backfill"; dids?: ReadonlyArray<string>; maxPosts?: number; maxAgeDays?: number; triggeredBy: "admin" }
  | { kind: "reconcile"; dids?: ReadonlyArray<string>; depth?: "recent" | "deep"; triggeredBy: "admin" };
```

Responsibilities:

- create and update an `ingest_runs` row
- resolve target experts from D1
- enqueue expert work in batches
- wait and poll for completion
- compute final summary from D1 run-item rows

#### 3. `ExpertPollCoordinatorDo`

Keyed by DID via `idFromName(did)`.

Responsibilities:

- serialize work for one expert
- coalesce duplicate intents
- prioritize head polls over low-priority bulk work when needed
- schedule alarms to continue unfinished work
- recover after eviction or restart

This DO owns coordination state, not reporting state.

#### 4. Poll Execution Services

The existing domain logic remains reusable:

- [`src/ingest/ExpertPoller.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/ExpertPoller.ts)
- repo layers under [`src/services`](/Users/pooks/Dev/skygest-cloudflare/src/services)

The business logic should move behind a single-expert executor such as:

`runExpertPoll(expertDid, request, chunkOptions)`

This lets the same code run under the DO alarm path without going through the current global `PollCoordinator`.

#### 5. D1 Run Tracking

Add queryable run tables:

```sql
ingest_runs (
  id TEXT PRIMARY KEY,
  workflow_instance_id TEXT,
  kind TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  requested_by TEXT,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  total_experts INTEGER DEFAULT 0,
  experts_succeeded INTEGER DEFAULT 0,
  experts_failed INTEGER DEFAULT 0,
  error TEXT
)

ingest_run_items (
  run_id TEXT NOT NULL,
  did TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  finished_at INTEGER,
  pages_fetched INTEGER DEFAULT 0,
  posts_seen INTEGER DEFAULT 0,
  posts_stored INTEGER DEFAULT 0,
  posts_deleted INTEGER DEFAULT 0,
  error TEXT,
  PRIMARY KEY (run_id, did, mode)
)
```

`expert_sync_state` remains the source of truth for per-expert ingest position.

`ingest_leases` becomes obsolete after cutover.

## Coordination Model

### Expert DO state

Persist only coordination data in DO storage:

```ts
type ExpertDoState = {
  current: null | {
    runId: string;
    mode: "head" | "backfill" | "reconcile";
    startedAt: number;
    cursor?: string | null;
    depth?: "recent" | "deep";
    maxPosts?: number;
    maxAgeDays?: number;
  };
  pending: ReadonlyArray<{
    runId: string;
    mode: "head" | "backfill" | "reconcile";
    requestedAt: number;
    depth?: "recent" | "deep";
    maxPosts?: number;
    maxAgeDays?: number;
  }>;
  lastCompletedRunId: string | null;
  lastFailure: string | null;
};
```

### Request coalescing rules

Suggested rules:

- multiple head requests collapse into one pending head request
- backfill requests for the same run merge by `runId`
- reconcile requests merge by `(runId, depth)`
- if head arrives while backfill is active, record it as pending and run it after the current chunk

This gives correctness without a global lock.

### Alarm behavior

`alarm()` should:

1. load durable DO state
2. if `current` is null, claim the next pending item
3. execute one bounded chunk
4. write D1 run-item progress
5. clear or reschedule depending on remaining work

The DO should never depend on in-memory flags alone.

## Workflow Behavior

### Cron head poll

1. `scheduled()` creates a workflow instance with a deterministic slot ID such as `head-sweep:2026-03-08T15:00`
2. workflow resolves active experts from D1
3. workflow inserts `ingest_runs` and `ingest_run_items`
4. workflow enqueues `head` intent to each expert DO in batches
5. workflow sleeps and polls run-item status until completion
6. workflow marks the run complete

### Manual backfill

1. admin API creates a workflow instance and returns `202`
2. workflow resolves target experts
3. workflow enqueues `backfill` intent to each expert DO
4. each expert DO processes chunked backfill until `backfill_cursor` is null
5. workflow waits until all run items are terminal

### Manual reconcile

Same shape as backfill, with request parameters carried into each run item.

## Why Workflow + DO Is Better Than Workflow Alone

A workflow alone is not a per-expert coordination owner.

Without the DO layer, you still need a correctness story for:

- cron head poll overlapping with manual backfill
- duplicate manual requests
- retrying child work without double-running one expert

The DO gives each expert a single durable owner. The workflow gives each operator action a durable run record.

That separation matches the problem.

## Why Queue Is Optional, Not Primary

Queues become useful if one of these becomes true:

- polling needs strict backpressure against the Bluesky API
- per-expert execution becomes too bursty for direct DO alarm execution
- execution needs a dead-letter lane separate from coordination

If that happens later, the DO should remain the owner and a queue consumer should become the executor.

The design stays:

- workflow creates run
- DO owns coordination
- queue worker executes chunk work
- D1 stores results

Do not replace the DO with a queue consumer for correctness.

## API Changes

### Current behavior

- `POST /admin/ingest/poll` returns a completed summary
- `POST /admin/ingest/backfill` returns a completed summary
- `POST /admin/ingest/reconcile` returns a completed summary

### Target behavior

- `POST /admin/ingest/poll` returns `202 Accepted`
- `POST /admin/ingest/backfill` returns `202 Accepted`
- `POST /admin/ingest/reconcile` returns `202 Accepted`

Response body:

```json
{
  "runId": "ingest-run-123",
  "workflowInstanceId": "wf-123",
  "status": "queued"
}
```

Add:

- `GET /admin/ingest/runs/:runId`
- `GET /admin/ingest/runs/:runId/items`

## Wrangler and Binding Changes

Add to the ingest worker config:

```toml
[[workflows]]
name = "ingest-run"
binding = "INGEST_RUN_WORKFLOW"
class_name = "IngestRunWorkflow"

[[durable_objects.bindings]]
name = "EXPERT_POLL_COORDINATOR"
class_name = "ExpertPollCoordinatorDo"
```

Add new env bindings to [`src/platform/Env.ts`](/Users/pooks/Dev/skygest-cloudflare/src/platform/Env.ts).

## Cloudflare Guardrails

This design assumes the following implementation rules:

- keep workflow steps deterministic and small
- keep workflow step output under platform state limits
- use D1 for durable run status instead of giant workflow return payloads
- do not use one global DO for all experts
- do not rely on DO in-memory state across eviction
- if a DO performs external `fetch()`, persist state before and after I/O and make alarm execution idempotent

## Migration Strategy

### Phase 1

- add Workflow and DO bindings
- add run tracking tables
- add workflow-triggering admin endpoints
- keep current `ExpertPoller` logic, but adapt it to single-expert execution

### Phase 2

- route cron head polls through workflow
- move manual backfill and reconcile to workflow-only entry
- stop using `PollCoordinator` in the request path

### Phase 3

- remove `IngestLeaseRepo`
- remove `ingest_leases`
- remove the synchronous completed-summary response model

## Not Chosen

### Single global workflow without DOs

Rejected because it still lacks per-expert serialization and coalescing.

### Single global DO

Rejected because it recreates the current singleton bottleneck with a different primitive.

### D1 job table only

Rejected because it keeps coordination inside the database instead of inside a Cloudflare stateful compute owner.

## References

- [Cloudflare Workflows overview](https://developers.cloudflare.com/workflows/)
- [Cloudflare Workflows Workers API](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Cloudflare Workflows rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/)
- [Cloudflare Durable Objects rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare Durable Objects alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
