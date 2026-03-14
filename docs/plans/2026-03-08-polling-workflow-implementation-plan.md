# Skygest Polling Workflow Redesign: Implementation Plan

**Date:** 2026-03-08
**Status:** Implemented

> Historical rollout plan. The live codebase is workflow-native now, so references to removed lease-era files are archival rather than current guidance.

## Goal

Implement the polling redesign described in:

- [`docs/plans/2026-03-08-polling-workflow-redesign.md`](/Users/pooks/Dev/skygest-cloudflare/docs/plans/2026-03-08-polling-workflow-redesign.md)

Outcome:

- head, backfill, and reconcile run through Cloudflare Workflows
- per-expert coordination moves to Durable Objects
- D1 stores run status and expert sync state
- D1 leases are removed from the hot path

## Constraints

- preserve existing poll semantics in [`src/ingest/ExpertPoller.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/ExpertPoller.ts) as much as possible
- avoid a big-bang schema and runtime cutover
- keep the admin auth surface intact
- keep cron head poll behavior available throughout migration

## Phase 0: Preconditions

### Task 0.1: Freeze the current design in docs

Files:

- existing: [`docs/plans/2026-03-08-polling-workflow-redesign.md`](/Users/pooks/Dev/skygest-cloudflare/docs/plans/2026-03-08-polling-workflow-redesign.md)

Done when:

- the target architecture is explicit
- primitive boundaries are clear

### Task 0.2: Stabilize the current lease bug until cutover

Files:

- [`src/services/d1/IngestLeaseRepoD1.ts`](/Users/pooks/Dev/skygest-cloudflare/src/services/d1/IngestLeaseRepoD1.ts)

Done when:

- the local lease-renewal fix is deployed or otherwise replaced by the first DO cutover

## Phase 1: Add Run Tracking and Bindings

### Task 1.1: Add D1 run tables

Files:

- modify: [`src/db/migrations.ts`](/Users/pooks/Dev/skygest-cloudflare/src/db/migrations.ts)
- add tests near migration coverage

Add:

- `ingest_runs`
- `ingest_run_items`
- indexes on `status`, `kind`, `started_at`, `did`

Done when:

- D1 can answer "what run is active?", "which experts are done?", and "what failed?"

### Task 1.2: Add repositories for run tracking

Files:

- create: `src/services/IngestRunsRepo.ts`
- create: `src/services/IngestRunItemsRepo.ts`
- create: `src/services/d1/IngestRunsRepoD1.ts`
- create: `src/services/d1/IngestRunItemsRepoD1.ts`

Capabilities:

- create run
- mark run started, complete, failed
- create run items
- update item status and metrics
- aggregate summary for a run

### Task 1.3: Add Workflow and DO bindings

Files:

- modify: [`wrangler.toml`](/Users/pooks/Dev/skygest-cloudflare/wrangler.toml)
- modify: [`src/platform/Env.ts`](/Users/pooks/Dev/skygest-cloudflare/src/platform/Env.ts)

Add:

- `INGEST_RUN_WORKFLOW`
- `EXPERT_POLL_COORDINATOR`

Done when:

- both bindings are available from Effect layers and Worker entrypoints

## Phase 2: Build the Per-Expert Coordinator DO

### Task 2.1: Create the DO class and state model

Files:

- create: `src/ingest/ExpertPollCoordinatorDo.ts`
- create: `src/ingest/ExpertPollCoordinatorDo.test.ts`

Methods:

- `enqueueHead(...)`
- `enqueueBackfill(...)`
- `enqueueReconcile(...)`
- `getStatus(...)`
- `alarm()`

Persist:

- current work item
- pending queue
- last completion metadata
- last failure metadata

### Task 2.2: Extract single-expert execution from the global coordinator

Files:

- modify: [`src/ingest/ExpertPoller.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/ExpertPoller.ts)
- create: `src/ingest/ExpertPollExecutor.ts`
- create tests as needed

Refactor goal:

- keep the existing poll logic
- make it runnable for exactly one expert and one bounded chunk
- remove any dependency on the global lease

### Task 2.3: Add chunking rules for long operations

Files:

- likely modify: [`src/domain/polling.ts`](/Users/pooks/Dev/skygest-cloudflare/src/domain/polling.ts)
- modify executor and tests

Rules:

- head: full single pass
- backfill: capped chunk size, cursor persisted between chunks
- reconcile recent: full single pass
- reconcile deep: capped chunk size

Done when:

- `alarm()` never has to own an unbounded backfill

## Phase 3: Build the Workflow

### Task 3.1: Create `IngestRunWorkflow`

Files:

- create: `src/ingest/IngestRunWorkflow.ts`
- create: `src/ingest/IngestRunWorkflow.test.ts`

Responsibilities:

- create the run row
- resolve target experts
- insert run items
- enqueue work to expert DOs
- sleep and poll until terminal
- write final summary

### Task 3.2: Add workflow-aware service layer assembly

Files:

- modify: [`src/ingest/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/Router.ts)
- possibly create shared ingest layers for worker, workflow, and DO execution

Done when:

- Worker routes, Workflow code, and DO code can all reuse the same repo and poll execution layers

### Task 3.3: Add workflow instance ID strategy

Use deterministic IDs where helpful:

- cron head sweep: slot-based ID
- admin requests: run ID or request ID based

This should prevent duplicate cron runs and make retries observable.

## Phase 4: Change the API Surface

### Task 4.1: Change admin ingest endpoints to create workflows

Files:

- modify: [`src/ingest/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/Router.ts)
- modify tests under [`tests/ingest-admin.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/ingest-admin.test.ts)

Behavior change:

- `POST /admin/ingest/poll` returns `202`
- `POST /admin/ingest/backfill` returns `202`
- `POST /admin/ingest/reconcile` returns `202`

Payload:

```json
{
  "runId": "run-123",
  "workflowInstanceId": "wf-123",
  "status": "queued"
}
```

### Task 4.2: Add run-status endpoints

Files:

- modify: [`src/ingest/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/Router.ts)
- add route tests

Add:

- `GET /admin/ingest/runs/:runId`
- `GET /admin/ingest/runs/:runId/items`

## Phase 5: Route Cron Through Workflow

### Task 5.1: Replace direct cron coordinator execution

Files:

- modify: [`src/worker/filter.ts`](/Users/pooks/Dev/skygest-cloudflare/src/worker/filter.ts)

Current:

- cron directly calls `PollCoordinator.run({ mode: "head" })`

Target:

- cron creates an `IngestRunWorkflow` instance for the current slot

Done when:

- scheduled head polls no longer depend on the request-bound coordinator path

## Phase 6: Remove the Lease-Based Coordinator

### Task 6.1: Stop using `PollCoordinator` in production paths

Files:

- modify: [`src/ingest/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ingest/Router.ts)
- modify: [`src/worker/filter.ts`](/Users/pooks/Dev/skygest-cloudflare/src/worker/filter.ts)

### Task 6.2: Remove lease repo and schema

Files:

- delete or retire: [`src/services/IngestLeaseRepo.ts`](/Users/pooks/Dev/skygest-cloudflare/src/services/IngestLeaseRepo.ts)
- delete or retire: [`src/services/d1/IngestLeaseRepoD1.ts`](/Users/pooks/Dev/skygest-cloudflare/src/services/d1/IngestLeaseRepoD1.ts)
- modify: [`src/db/migrations.ts`](/Users/pooks/Dev/skygest-cloudflare/src/db/migrations.ts)

Done when:

- `ingest_leases` is no longer referenced in the active ingest path

## Testing Strategy

### Unit tests

- DO enqueue and coalescing behavior
- DO alarm continuation behavior
- workflow enqueue and completion polling
- run summary aggregation
- idempotent cron instance IDs

### Integration tests

- single-expert head poll via workflow
- multi-expert backfill via workflow
- manual request arriving during active expert work
- cron head request arriving during backfill

### Regression tests

- preserve current `ExpertPoller` semantics for:
  - head stop-at behavior
  - backfill cursor advancement
  - reconcile delete detection

## Rollout Plan

### Step 1

- deploy schema and bindings
- keep old coordinator live

### Step 2

- enable workflow-backed admin endpoints behind a feature flag

### Step 3

- switch cron to workflow

### Step 4

- remove lease-based path after stable runs in production

## Risks to Manage

- admin clients expecting synchronous completed summaries
- workflow step count growth if expert counts scale sharply
- overly large workflow state if summaries are stored in step returns instead of D1
- DO alarm logic becoming non-idempotent
- hidden coupling between current `PollCoordinator` and `ExpertPoller`

## Recommended Implementation Order

1. add run tables and repos
2. add bindings and env types
3. build `ExpertPollCoordinatorDo`
4. extract single-expert executor
5. build `IngestRunWorkflow`
6. change admin routes
7. change cron path
8. remove leases
