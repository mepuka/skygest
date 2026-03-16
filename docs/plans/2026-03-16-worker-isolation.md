# Worker Isolation — Safe DO Cutover + Service Separation Plan

Date: 2026-03-16
Status: Revised draft after architecture review

## Objective

Protect the agent worker from ingest coordination CPU by moving ingest control-plane traffic and Durable Object execution off the agent worker without introducing migration-domain drift.

This plan is specifically about:

- `/admin/ingest/*` HTTP ownership
- `ExpertPollCoordinatorDo` ownership and alarm execution
- keeping the Effect layer graph, env types, tests, and runtime docs aligned with the new worker split

This plan is not a valid incident fix if production evidence shows the live DO namespace is already executing on the ingest worker.

## Decision Summary

- Do not proceed from assumptions. Production DO ownership must be proven first.
- Do not use `transferred_classes` into the ingest worker's existing `ExpertPollCoordinatorDo`. That destination class already exists and is not a safe transfer target.
- Preferred cutover: transfer the agent-owned production DO namespace into a new ingest-only destination class, then move `/admin/ingest/*` behind a Service Binding, then clean up the agent worker after old workflow activity drains.
- Staging validates route/auth/service-binding/layer/test changes, but does not prove production DO ownership and does not safely rehearse the exact transfer unless we use a dedicated one-off transfer config.
- Treat the DO transfer as a one-way production migration. Rollback is not "redeploy the old config"; rollback requires an explicit reverse migration plan.

## Current State

### Agent worker

Current source: `src/worker/feed.ts`

Responsibilities today:

- `GET /health`
- `POST /api/*`
- `POST /mcp`
- `POST /admin/ingest/*`
- other admin routes
- exports `ExpertPollCoordinatorDo`
- exports `IngestRunWorkflow`

### Ingest worker

Current source: `src/worker/filter.ts`

Responsibilities today:

- `GET /health`
- `scheduled()`
- exports `ExpertPollCoordinatorDo`
- exports `IngestRunWorkflow`

### Config state

- `wrangler.agent.toml` defines `ExpertPollCoordinatorDo` with migration tag `v1`
- `wrangler.toml` defines `ExpertPollCoordinatorDo` with migration tag `v5`
- both workers currently bind `INGEST_RUN_WORKFLOW`
- both workers currently bind `EXPERT_POLL_COORDINATOR`

### Effect state

- `src/edge/Layer.ts` still defines `makeAgentWorkerLayer` as `admin + ingest`
- `src/edge/Layer.ts` still includes query services in `makeIngestWorkerLayer`
- `src/platform/Env.ts` still uses one broad env shape with ingest bindings optional at the base layer

### Durable Object state nuance

The previous draft overstated state safety.

What is recoverable from D1:

- run/item terminal state
- summary counters
- last-known errors

What is not fully recoverable from D1:

- backfill continuation state such as `remainingMaxPosts`
- reconcile continuation state such as `cursor`
- exact pending/current queue ordering inside the DO

That means "drain and recreate" is operationally viable, but it is replay/restart behavior, not exact continuation.

## Hard Gates

This plan only proceeds if all of the following are true.

1. Production evidence shows the hot `ExpertPollCoordinatorDo` namespace is currently executing on the agent worker.
2. There is agreement on whether we are preserving live DO state via transfer or accepting replay semantics via drain-and-recreate.
3. Manual `backfill` and `reconcile` launches are frozen during the cutover window.
4. We have a documented rollback story for the chosen migration branch.

If gate 1 fails and production DO execution is already on ingest, stop. Re-open the incident diagnosis instead of applying this plan.

## Phase 0 — Prove Production Root Cause

Do this against production first. Staging is useful for rehearsals, not for branch selection.

### 0.1 Check production DO ownership

Run against production code names, not `--env staging`:

```bash
bunx wrangler durable-objects list --config wrangler.agent.toml
bunx wrangler durable-objects list --config wrangler.toml
```

Record:

- which worker currently lists the active expert coordinator objects
- whether both workers have live objects
- whether object counts roughly match the incident scale

### 0.2 Correlate worker errors during a poll window

Use worker logs/tails/observability to confirm which worker emits the 1101/1102 failures during a live poll window.

Required output from this step:

- "agent worker is overloaded by DO alarms"
- or "ingest worker is overloaded"
- or "ownership is mixed/unclear"

### 0.3 Check active ingest activity

Before any migration decision, record whether there are active `queued` or `running` ingest runs and whether manual `backfill` or `reconcile` activity is in progress.

If there are active backfill/reconcile runs, do not use a replay-based drain path without explicit approval.

### 0.4 Decision

- If production DOs already execute on ingest: stop this plan and investigate a different cause.
- If production DOs execute on agent: continue with the preferred transfer path below.
- If ownership is mixed or unclear: resolve that first; do not deploy based on guesswork.

## Chosen Migration Strategy

### Preferred path: transfer to a new ingest-only destination class

Use Cloudflare DO transfer semantics, but transfer into a new destination class name on the ingest worker.

Rationale:

- preserves live DO state
- avoids the invalid "transfer into an already-created destination class" problem
- allows existing bindings to the source class to auto-forward after the transfer deploy
- minimizes the time the incident-producing alarms remain on the agent worker

### Explicitly rejected path: transfer into ingest's existing `ExpertPollCoordinatorDo`

Do not do this.

Why it is rejected:

- the ingest worker already created `ExpertPollCoordinatorDo`
- transfer into an already-created destination class is not the safe migration shape
- it makes the rollout mechanically ambiguous and difficult to reason about

### Fallback path: drain and recreate

Only use this if:

- the transfer path is blocked operationally
- manual backfill/reconcile is frozen
- the team explicitly accepts replay/restart behavior for in-flight coordinator state

Drain-and-recreate is not the default path.

## Target End State

### Agent worker

- serves `/api/*`
- serves `/mcp`
- serves non-ingest admin routes
- authenticates `/admin/ingest/*` at the edge and forwards the request to the ingest worker
- does not own the expert coordinator namespace
- does not start new ingest workflows locally
- no longer exports the ingest DO class after cleanup
- no longer exports the ingest workflow class after cleanup

### Ingest worker

- serves `/health`
- serves authenticated `/admin/ingest/*`
- owns cron-triggered head sweeps
- owns `ExpertPollCoordinatorDo` execution via a new destination class name
- owns all new ingest workflow launches

### Effect graph

- query/admin layers stay on the agent side
- ingest execution layers stay on the ingest side
- `makeAgentWorkerLayer` is removed or narrowed so it no longer means "admin + ingest"
- `makeIngestWorkerLayer` is narrowed to ingest-only services
- env types reflect real runtime ownership instead of broad optional bindings

## Implementation Detail

### 1. Tighten env and layer boundaries

#### `src/platform/Env.ts`

Replace the "one wide env plus one ingest alias" model with explicit runtime shapes:

- `AgentWorkerEnvBindings`
- `IngestWorkerEnvBindings`

Expected direction:

- `AgentWorkerEnvBindings` includes `DB`, auth/config vars, optional `ONTOLOGY_KV`, and `INGEST_SERVICE: Fetcher`
- `AgentWorkerEnvBindings` does not require `INGEST_RUN_WORKFLOW`
- `AgentWorkerEnvBindings` does not require `EXPERT_POLL_COORDINATOR`
- `IngestWorkerEnvBindings` requires `INGEST_RUN_WORKFLOW`
- `IngestWorkerEnvBindings` requires `EXPERT_POLL_COORDINATOR`

Keep helper functions that make the requirement boundary explicit.

#### `src/edge/Layer.ts`

Make the layer graph match the runtime split.

Required changes:

- remove or retire `makeAgentWorkerLayer`
- keep a query/admin layer for the agent worker
- keep an ingest-only layer for the ingest worker
- remove `shared.queryLayer` from the ingest worker layer unless a specific ingest dependency proves it is still required

The plan should not ship a route split while leaving the canonical Effect ownership graph stale.

### 2. Add the ingest fetch surface

#### `src/worker/filter.ts`

Add authenticated `/admin/ingest/*` request handling.

Rules:

- use the same operator auth helpers used by the agent worker
- keep the route path shape unchanged
- return the existing `handleIngestRequest(...)` responses unchanged

This worker becomes the canonical execution surface for ingest admin operations.

#### `src/ingest/Router.ts`

Expected change surface is small:

- the existing router logic should remain the source of truth
- no domain-level behavior change is required

### 3. Add agent-side forwarding

#### `src/worker/feed.ts`

Change `/admin/ingest/*` handling from local execution to forwarding.

Required behavior:

- preserve the existing agent-side operator auth gate
- preserve existing auth scopes
- forward the original request to `env.INGEST_SERVICE.fetch(request)` only after auth succeeds
- keep non-ingest admin routes local

Why agent-side auth stays:

- preserves the current public boundary
- preserves current denial logging on the public worker
- keeps direct ingest-worker access protected independently

The ingest worker should still re-authenticate for defense in depth and direct-call safety.

### 4. Create a new ingest-only DO destination class

#### `src/ingest/ExpertPollCoordinatorDo.ts`

Do not reuse the existing class name for the transfer destination.

Add a new exported class name for the ingest-owned destination, for example:

- `ExpertPollCoordinatorDoIsolated`

Implementation guidance:

- keep one shared implementation body
- export two class names temporarily if that makes the cutover easier
- do not change the domain behavior of the coordinator itself as part of this plan

This is a migration-compatibility change, not a behavior rewrite.

### 5. Wrangler config changes

#### 5.1 Agent worker config

File: `wrangler.agent.toml`

Phase 1 changes:

- add `INGEST_SERVICE` service binding in production
- add `INGEST_SERVICE` service binding in `env.staging`
- keep existing local workflow and DO bindings temporarily during the cutover window

Reason for keeping them temporarily:

- old agent-owned workflow executions may still be running when the route-forward deploy lands
- removing them too early creates avoidable inter-deploy risk

Phase 2 cleanup:

- remove agent-local `[[workflows]]` for ingest after old agent-owned workflow activity drains
- remove agent-local `[[durable_objects.bindings]]` for the coordinator after the transfer is complete and cleanup criteria pass
- do not add `deleted_classes` for the transferred source class as part of this transfer path

#### 5.2 Ingest worker config

File: `wrangler.toml`

Permanent changes:

- bind `EXPERT_POLL_COORDINATOR` to the new destination class name
- keep `INGEST_RUN_WORKFLOW` on ingest

Transfer migration shape:

```toml
[[durable_objects.bindings]]
name = "EXPERT_POLL_COORDINATOR"
class_name = "ExpertPollCoordinatorDoIsolated"

[[migrations]]
tag = "vNEXT"

[[migrations.transferred_classes]]
from = "ExpertPollCoordinatorDo"
from_script = "skygest-bi-agent"
to = "ExpertPollCoordinatorDoIsolated"
```

Important note:

- `migrations` are top-level-only in Wrangler
- production and staging source script names differ
- the exact transfer migration cannot be expressed once in shared env-based config without care

Because of that, use one of these two approaches:

1. Preferred: validate route/auth/service-binding behavior in staging, but execute the actual DO transfer only in production via a one-off production transfer config that names the real production source script.
2. Alternative: create a dedicated temporary transfer config per environment, not one shared migration block that pretends prod and staging are interchangeable.

Do not let the shared `wrangler.toml` hide this distinction.

#### 5.3 Service binding config

Agent service bindings must be defined separately for production and staging because service bindings are non-inheritable.

Expected shape:

```toml
[[services]]
binding = "INGEST_SERVICE"
service = "skygest-bi-ingest"

[[env.staging.services]]
binding = "INGEST_SERVICE"
service = "skygest-bi-ingest-staging"
```

### 6. Workflow ownership cleanup

There is no equivalent "transfer existing workflow instances to another worker" step in this plan.

Practical rule:

- after the agent forward deploy lands, all new ingest admin launches must go through the ingest worker
- old agent-owned workflow activity is allowed to drain
- only after drain verification do we remove the local workflow export/binding from the agent worker

Operational guardrails:

- freeze manual `backfill` and `reconcile` during the cutover window
- hold cleanup until no pre-cutover runs remain `queued` or `running`

### 7. Tests

The previous draft incorrectly said no test files needed changes.

Required test updates:

- `tests/feed.test.ts`
  - assert `/admin/ingest/*` is auth-gated and forwarded through `INGEST_SERVICE`
  - assert non-ingest admin routes remain local
- add a new worker-entry test for `src/worker/filter.ts`
  - assert `/admin/ingest/*` is auth-gated on the ingest worker
  - assert the request reaches `handleIngestRequest`
- `tests/ingest-admin.test.ts`
  - keep router-level behavior coverage
- `tests/operator-auth.test.ts`
  - verify ingest route scopes remain unchanged
- update any env-type-dependent tests such as workflow launcher / DO tests if env types are narrowed or renamed

### 8. Docs

Update the runtime docs in the same change set.

Required docs update:

- `docs/architecture/2026-03-09-current-system-architecture.md`

That doc must no longer describe `/admin/ingest/*` as agent-owned once the implementation lands.

## Rollout Plan

### Phase A — staging validation of non-transfer changes

Goal: validate the HTTP boundary, auth parity, and layer/env refactor safely.

Deploy to staging:

1. ingest worker fetch-route changes
2. agent service-binding forward
3. env/layer refactor
4. test updates

Validate in staging:

- `/admin/ingest/*` still returns the same HTTP shapes
- unauthorized requests still return the same `401`/`403`
- `/api/*`, `/mcp`, and non-ingest admin routes are unaffected
- cron still launches from ingest worker

What staging does not validate:

- production DO ownership
- the exact production transfer migration

### Phase B — production preflight

Immediately before the transfer:

1. run the production ownership checks
2. freeze manual `backfill` and `reconcile`
3. record current `queued` / `running` ingest runs
4. confirm the production transfer config names the real production source worker

### Phase C — production DO transfer deploy

Deploy ingest worker first using the production transfer config.

Expected result:

- the coordinator namespace now lives on the ingest worker under the new destination class
- old bindings to the source class auto-forward after the transfer

Immediate verification:

- production DO list now reflects the transferred namespace on ingest
- new alarm execution is observed on ingest, not agent
- no spike of failed ingest items appears in D1

### Phase D — production agent forward deploy

Deploy the agent worker with:

- service binding configured
- `/admin/ingest/*` forwarding enabled
- old workflow/DO bindings still present temporarily

Expected result:

- all new HTTP-triggered ingest operations now enter through agent auth and execute on ingest
- no new ingest workflows are started locally by the agent worker

### Phase E — cleanup deploy

Only after pre-cutover runs have drained:

1. remove local agent workflow binding/export
2. remove local agent DO binding/export
3. remove any temporary compatibility code that exists only for the transfer

This cleanup is a separate deploy on purpose.

## Rollback

### Before the production transfer deploy

Standard rollback is available.

### After the production transfer deploy

Do not treat rollback as "redeploy the old agent config."

At that point, rollback requires one of:

- a new explicit reverse transfer plan
- or continuing forward with a fix on the ingest-owned destination class

The transfer deploy is therefore a gated, one-way migration step.

## Acceptance Criteria

1. Production preflight proves the incident-producing DO namespace is on the agent worker before any transfer is attempted.
2. The plan does not use `transferred_classes` into ingest's existing `ExpertPollCoordinatorDo`.
3. `/admin/ingest/*` continues to return the same success and auth-failure shapes after forwarding.
4. During and after cutover, new coordinator alarm execution is observed on the ingest worker, not the agent worker.
5. Agent-side query surfaces (`/api/*`, `/mcp`, non-ingest admin routes) remain responsive during a full head sweep.
6. The Effect layer graph and env types reflect the new runtime split; no stale `agent + ingest` composite remains as the canonical ownership model.
7. Worker-boundary tests exist for both the forwarding path and the ingest-worker fetch path.
8. Runtime docs are updated in the same implementation change.
9. Cleanup of agent-local workflow/DO bindings happens only after pre-cutover activity drains.

## Files Expected To Change

- `docs/plans/2026-03-16-worker-isolation.md`
- `docs/architecture/2026-03-09-current-system-architecture.md`
- `src/platform/Env.ts`
- `src/edge/Layer.ts`
- `src/worker/feed.ts`
- `src/worker/filter.ts`
- `src/ingest/ExpertPollCoordinatorDo.ts`
- `wrangler.agent.toml`
- `wrangler.toml`
- `tests/feed.test.ts`
- new ingest-worker entry test file
- any env-type-dependent ingest tests

## Files Expected To Stay Behaviorally Stable

- `src/ingest/Router.ts`
- `src/ingest/IngestRunWorkflow.ts`
- `src/ingest/IngestRepairService.ts`
- domain schemas outside env/layer boundary changes

The point of this plan is to move runtime ownership, not to rewrite ingest behavior.
