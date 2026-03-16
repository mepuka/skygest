# Worker Isolation — DO Migration + Service Separation Plan

Date: 2026-03-16
Status: Draft — awaiting review

## Root Cause

`ExpertPollCoordinatorDo` is homed on the agent worker (`wrangler.agent.toml`). All 793 DO alarms run in the same isolate as API/MCP/admin. During polls, DO alarm CPU consumption causes worker resource limit errors (1101/1102), taking down MCP and degrading API.

The direct API path (lighter) survives under pressure; the MCP path (heavier Effect layer) does not. `list_topics` — which doesn't even touch D1 — fails during polls because the MCP handler competes for CPU with DO alarms in the same isolate.

## Solution

Move DO and Workflow ownership to the ingest worker. The agent worker becomes a pure read/query + admin control plane. Forward `/admin/ingest/*` to the ingest worker via Service Binding.

## Architecture: Before vs After

### Before
```
AGENT WORKER (wrangler.agent.toml)
├── /api/*          (KnowledgeQueryService, EditorialService)
├── /mcp            (same + MCP layer)
├── /admin/*        (all admin routes)
├── ExpertPollCoordinatorDo  ← 793 DOs competing for CPU
├── IngestRunWorkflow
└── Static assets
```

### After
```
AGENT WORKER (wrangler.agent.toml)          INGEST WORKER (wrangler.toml)
├── /api/*                                   ├── /admin/ingest/*
├── /mcp                                     ├── Cron trigger (*/15)
├── /admin/experts/*                         ├── ExpertPollCoordinatorDo (homes here)
├── /admin/editorial/*                       ├── IngestRunWorkflow (homes here)
├── /admin/ops/*                             └── Queue consumer (future Phase 1)
├── /admin/ingest/* → Service Binding ──────→
└── Static assets
```

## Pre-Flight: Determine DO Ownership

Both workers have `new_sqlite_classes = ["ExpertPollCoordinatorDo"]`. Run this FIRST to determine which worker actually owns the 793 instances:

```bash
bunx wrangler durable-objects list --config wrangler.agent.toml --env staging
bunx wrangler durable-objects list --config wrangler.toml --env staging
```

This determines whether we need `transferred_classes` or can simply delete from the agent worker.

## DO State Safety

DO coordinator state is **ephemeral coordination data**, not source of truth:
- `current` + `pending` tasks → mapped to D1 `ingest_run_items`
- `lastCompletedRunId` → derivable from D1
- `lastFailure` → also in D1 `ingest_run_items.error`

**Total DO state loss self-heals within one cron cycle (~15 min):**
1. `IngestRepairService` marks stale items as failed (dispatched >5min, running >15min)
2. Workflow finalizes runs with all-terminal items
3. Next cron creates fresh DOs that start empty

## Implementation

### Step 1: Add Service Binding to agent worker

**File: `wrangler.agent.toml`**

Add service binding (both production and staging):
```toml
[[services]]
binding = "INGEST_SERVICE"
service = "skygest-bi-ingest"

[[env.staging.services]]
binding = "INGEST_SERVICE"
service = "skygest-bi-ingest-staging"
```

### Step 2: Add `AgentWorkerEnvBindings` type

**File: `src/platform/Env.ts`**

```typescript
export interface AgentWorkerEnvBindings extends EnvBindings {
  readonly INGEST_SERVICE: Fetcher;
}
```

### Step 3: Update agent worker entry point

**File: `src/worker/feed.ts`**

- Remove `ExpertPollCoordinatorDo` and `IngestRunWorkflow` imports and re-exports
- Remove `handleIngestRequest` import
- Change env type to `AgentWorkerEnvBindings`
- Replace `/admin/ingest/*` handler with Service Binding forward:

```typescript
if (url.pathname.startsWith("/admin/ingest/")) {
  return env.INGEST_SERVICE.fetch(request);
}
```

### Step 4: Add ingest admin routes to ingest worker

**File: `src/worker/filter.ts`**

Add `/admin/ingest/*` route handling with auth:

```typescript
if (url.pathname.startsWith("/admin/ingest/")) {
  let identity;
  try {
    identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
  } catch (error) {
    await logDeniedOperatorRequest(request, error);
    return toAuthErrorResponse(error);
  }
  return handleIngestRequest(request, env, identity);
}
```

Import `authorizeOperator`, `handleIngestRequest`, etc.

### Step 5: Migrate DO ownership in wrangler configs

**Option A: If ingest worker already owns the DOs** (likely based on v5 migration)

`wrangler.agent.toml` — add DO deletion + cross-worker bindings:
```toml
# Change existing bindings to use script_name
[[durable_objects.bindings]]
name = "EXPERT_POLL_COORDINATOR"
class_name = "ExpertPollCoordinatorDo"
script_name = "skygest-bi-ingest"

[[workflows]]
name = "ingest-run"
binding = "INGEST_RUN_WORKFLOW"
class_name = "IngestRunWorkflow"
script_name = "skygest-bi-ingest"

# Add deletion migration
[[migrations]]
tag = "v2"
deleted_classes = ["ExpertPollCoordinatorDo"]
```

`wrangler.toml` — no changes needed (already has v5 migration with the class).

**Option B: If agent worker owns the DOs** (v1 migration won)

`wrangler.toml` — add transfer migration:
```toml
[[migrations]]
tag = "v6"

[[migrations.transferred_classes]]
from = "ExpertPollCoordinatorDo"
from_script = "skygest-bi-agent"
to = "ExpertPollCoordinatorDo"
```

`wrangler.agent.toml` — same as Option A (delete + script_name).

### Step 6: Deploy order

1. **Deploy ingest worker first** (adds `/admin/ingest/*` routes + transfer migration if needed)
2. **Deploy agent worker second** (removes DO exports, adds Service Binding + script_name bindings)

Between steps 1 and 2, the agent worker's existing DO binding auto-forwards to the ingest worker. Zero-downtime.

### Step 7: Verify

```bash
# Trigger a poll via agent worker (forwards to ingest)
curl -X POST "$AGENT_URL/admin/ingest/poll" -H "x-skygest-operator-secret: $SECRET" -d '{}'

# Check MCP stays responsive during poll
curl -X POST "$AGENT_URL/mcp" ... -d '{"method":"tools/call","params":{"name":"list_topics",...}}'
```

## Files Changed

| File | Change |
|------|--------|
| `wrangler.agent.toml` | Add `[[services]]`, change DO/workflow bindings to `script_name`, add `deleted_classes` migration |
| `wrangler.toml` | Possibly add `transferred_classes` v6 migration (depends on pre-flight) |
| `src/platform/Env.ts` | Add `AgentWorkerEnvBindings` with `INGEST_SERVICE: Fetcher` |
| `src/worker/feed.ts` | Remove DO/workflow exports, forward `/admin/ingest/*` via Service Binding |
| `src/worker/filter.ts` | Add `/admin/ingest/*` route handling with auth |

## Files NOT Changed

| File | Why |
|------|-----|
| `src/edge/Layer.ts` | `makeAdminWorkerLayer` and `makeIngestWorkerLayer` already exist with correct compositions |
| `src/ingest/ExpertPollCoordinatorDo.ts` | DO implementation untouched |
| `src/ingest/IngestRunWorkflow.ts` | Workflow untouched |
| `src/ingest/Router.ts` (ingest) | `handleIngestRequest` already works standalone |
| `src/admin/Router.ts` | Admin routes untouched |
| All test files | No behavior changes to test |

## Impact

| Metric | Before | After |
|--------|--------|-------|
| Agent worker services | ~22 | ~14 (remove 8 ingest services) |
| Agent worker module load | Full DO + workflow + filter pipeline | Read/query only |
| CPU isolation | DO alarms + API/MCP shared | Fully isolated |
| MCP during polls | Fails (1101/1102) | Unaffected |
| Cold-start estimate | ~60-80ms | ~40-55ms |
| Ingest admin routes | Direct on agent | Service Binding forward (zero-latency) |

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Dual-ownership ambiguity | Medium | Pre-flight `durable-objects list` check |
| `transferred_classes` rejected | Low | Fallback: drain-and-recreate (DO state is recoverable) |
| Service Binding latency | None | In-datacenter, sub-millisecond |
| Auth on forwarded requests | None | Ingest worker re-authenticates |
| In-flight alarms during deploy | Low | Transfer is atomic; repair service catches stragglers |

## Acceptance Criteria

1. MCP stays responsive during a 793-expert head sweep
2. `/admin/ingest/*` routes work via Service Binding (same auth, same responses)
3. Cron-triggered polls execute on the ingest worker
4. DO alarms fire on the ingest worker, not the agent worker
5. All 230+ tests pass
6. Agent worker no longer exports DO or Workflow classes
