# Phase 2: Reduced Poll Interval

## Goal

Cut the idle time between dispatch cycles from 15s to 5s, reducing head sweep wall-clock time by ~3x with zero complexity risk.

## Baseline (after Phase 1)

- Head sweep: ~35 min for 793 experts (fanout=10, 15s poll cadence)
- The 15s sleep is the dominant remaining idle time — most DOs complete in 2-5s
- Progress rollup works, repair loop works

## Why Not waitForEvent

The original Phase 2 design proposed `step.waitForEvent` with DO-emitted wake events. Code review identified a critical step budget issue:

- 793 DOs each emit one completion event
- Cloudflare buffers events until `waitForEvent` is reached
- Each `waitForEvent` call drains one buffered event and returns instantly
- This causes rapid-fire dispatch iterations, each consuming a workflow step
- With 793 events: potentially 793 dispatch steps instead of ~80, blowing the 1,024 step limit

Additional issues: under-scoped DO test coverage, missing multi-runId emit for coalesced tasks, weak rollout observability. The complexity-to-benefit ratio doesn't justify the risk.

`step.sleep` is free (doesn't count toward the step limit). Reducing the interval from 15s to 5s captures most of the benefit with none of the step budget, event buffering, or DO-workflow coupling concerns.

## Design

### Single Change

**File:** `src/ingest/IngestRunWorkflow.ts`

```typescript
// Before:
const WORKFLOW_POLL_INTERVAL_MS = 15_000;

// After:
const WORKFLOW_POLL_INTERVAL_MS = 5_000;
```

That's it. No new schemas, no DO changes, no event system.

### Math

With fanout=10, 793 experts, 5s sleep:
- ~80 dispatch cycles × 5s = ~400s = ~7 min of sleep overhead
- Plus DO processing time (~2-5s per expert, overlapped via fanout)
- Expected total: ~12-15 min

Step budget: ~80 iterations × 1 step (dispatch) = ~80 steps. `step.sleep` is free. Well under 1,024.

### What Does NOT Change

- `dispatchAvailable()` — untouched
- Repair loop — runs every 5s instead of every 15s (more responsive)
- Progress rollup — updates every 5s instead of every 15s (more granular)
- DO code — no changes
- Error handling — no changes

## Cron Overlap Risk

Production cron fires every 15 minutes (`*/15 * * * *` in wrangler.toml). Each slot gets a unique ID via `toCronSlotId(scheduledTime)` — e.g., `head-sweep:2026-03-16T22:15`. The launcher's `createQueuedIfAbsent` only dedupes within the same slot, not across slots. If a run takes longer than 15 minutes, the next cron slot fires a second concurrent run.

This is pre-existing behavior, not introduced by Phase 2. But Phase 2 makes it more visible because the target runtime (~12-15 min) is close to the 15-minute boundary. At the upper end, overlapping runs would stack D1 polling load.

**Mitigation options (not in scope for Phase 2):**
- Widen cron interval to 20 or 30 minutes
- Add a `listRunning` guard in `startCronHeadSweep` that skips launch if another head sweep is already running
- Accept overlap as harmless (duplicate polls are idempotent; DOs dedup work via task coalescing)

For now, staging runs are admin-triggered, not cron. Monitor production after deploy.

## Verification

1. `bunx tsc --noEmit` — clean
2. `bun run test` — all pass
3. Deploy staging, trigger head sweep
4. Compare wall-clock time against Phase 1 baseline (~35 min)
5. Verify repair still catches stalled items
6. Monitor D1 query load — progress rollup now runs 3x more frequently
7. Check for cron overlap: if a staging run exceeds 15 min, verify a second concurrent run does not cause errors or data corruption

## Future: Event-Driven Dispatch (Phase 2b)

If sub-10-min head sweeps are needed, revisit DO→Workflow signaling with coalesced events rather than per-item events. Possible approaches:

- **Coalesce at a queue layer** (Phase 3): queue consumer emits one event per drained batch, not per item
- **Workflow self-wake**: dispatch step sends an event to itself when it detects completed items, instead of DOs sending events
- **Reduced fanout with instant wake**: lower fanout so fewer events are buffered, staying under the step budget

These require the queue infrastructure from Phase 3 to be in place first, which provides a natural coalescing point.
