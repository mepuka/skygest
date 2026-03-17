# Phase 2: Hybrid Event-Driven Dispatch

## Goal

Replace the fixed 15-second sleep between dispatch cycles with a wake hint from DOs, so the workflow reacts instantly when experts complete while preserving the existing repair/poll fallback for liveness.

## Baseline (after Phase 1)

- Head sweep: ~35 min for 793 experts (fanout=10, 15s poll cadence)
- The 15s sleep is the dominant idle time — most DOs complete in 2-5s but the workflow doesn't notice until the next poll
- Progress rollup works, repair loop works, all on the existing sleep-poll path

## Design

### Event Schema

Add to `src/domain/polling.ts`:

```typescript
export class IngestWorkflowWakeEvent extends Schema.TaggedClass<IngestWorkflowWakeEvent>()(
  "IngestWorkflowWakeEvent",
  {
    runId: Schema.String,
    did: Did,
    terminal: Schema.Literal("complete", "failed")
  }
) {}
```

- `_tag: "IngestWorkflowWakeEvent"` gives safe decode on the workflow side
- `terminal` covers both success and failure — the workflow cares that a slot opened, not why
- Lives in `polling.ts` alongside the other ingest lifecycle types, not a new module

### DO Signal — Best-Effort sendEvent

In `ExpertPollCoordinatorDo.ts`, after the terminal item transition is fully committed:

```typescript
// After: markComplete/markFailed + recordCoordinatorCompletion + saveState + setAlarmIfPending
try {
  const payload = IngestWorkflowWakeEvent.make({ runId, did, terminal: "complete" });
  const instance = await this.env.INGEST_RUN_WORKFLOW.get(runId);
  await instance.sendEvent({ type: "ingest-item-terminal", payload });
} catch {
  // Advisory only — workflow's timeout fallback handles missed events
}
```

Rules:
- **After terminal commit, not before.** The durable state write must succeed before the event fires.
- **try/catch, never fail the DO.** If sendEvent throws, the DO's work is already committed.
- **Emit per runId.** If a DO processes tasks for multiple runs in one alarm cycle, emit once per distinct runId that reached a terminal transition.
- **console.warn inside catch** for observability, but no Effect error channel.
- The DO does not import the schema for encoding — uses `IngestWorkflowWakeEvent.make()` for type safety, sends the plain object as the sendEvent payload.

Cloudflare confirms Workflow bindings are accessible from DOs: the DO already has `this.env.INGEST_RUN_WORKFLOW` via `WorkflowIngestEnvBindings`.

### Workflow Side — Hybrid waitForEvent + Timeout

In `dispatchUntilTerminal`, replace `step.sleep` with `step.waitForEvent`:

```typescript
// Replace:
await step.sleep(`wait-${iteration}`, WORKFLOW_POLL_INTERVAL_MS);

// With:
try {
  await step.waitForEvent(`wake-${iteration}`, {
    type: "ingest-item-terminal",
    timeout: "15s"
  });
} catch {
  // Timeout — fall through to existing dispatch + repair path
}
```

The loop structure stays identical:
1. `step.do(`dispatch-${iteration}`)` — dispatchAvailable() does repair + dispatch + progress rollup
2. If not terminal, `step.waitForEvent` with 15s timeout
3. Whether woken by event or timeout, loops back to step 1

Key properties:
- **Same 15s timeout as current sleep.** No regression in worst-case detection. When events arrive, it's instant. When missed, same cadence as before.
- **Repair loop runs every iteration** regardless of how the workflow woke. `dispatchAvailable()` still calls `repairLiveRun()` and `countIncompleteByRun()`.
- **Workflow does not inspect event payload** for dispatch decisions. The event is purely a wake hint. Dispatch logic queries D1 for the actual state.
- **Step budget:** At fanout=10 with 793 experts, ~80 iterations × 2 steps (dispatch + waitForEvent) = ~160 steps. Well under 1,024.
- **Step naming is deterministic:** `wake-${iteration}` satisfies the Workflows non-deterministic step name gotcha.

## Files

| File | Change |
|------|--------|
| `src/domain/polling.ts` | Add `IngestWorkflowWakeEvent` tagged class |
| `src/ingest/ExpertPollCoordinatorDo.ts` | After terminal commit, best-effort `sendEvent` per runId |
| `src/ingest/IngestRunWorkflow.ts` | Replace `step.sleep` with `step.waitForEvent` + 15s timeout catch |
| `tests/ingest-run-workflow.test.ts` | Update mock step, add event/timeout path tests |

### What Does NOT Change

- `dispatchAvailable()` — untouched
- Enqueue input schemas — `runId` already present
- Error taxonomy — sendEvent failures are caught, not domain errors
- Repair loop — runs every iteration
- Progress rollup — runs every iteration

## Testing

- **Workflow happy path:** Mock `step.waitForEvent` to resolve immediately. Verify workflow dispatches without delay when events arrive.
- **Workflow timeout path:** Mock `step.waitForEvent` to throw (simulating timeout). Verify workflow still completes via poll fallback — identical behavior to Phase 1.
- **DO signal test:** Verify `sendEvent` is called after terminal commit. Verify a `sendEvent` failure does not affect item completion status.

## Expected Impact

- Typical dispatch cadence drops from fixed 15s to ~2-5s (DO completion time + event latency)
- With fanout=10, head sweeps should complete in ~10-15 min (down from ~35 min)
- Worst case (all events missed): identical to Phase 1 (~35 min)

## Verification

1. `bunx tsc --noEmit` — clean
2. `bun run test` — all pass
3. Deploy staging, trigger head sweep
4. Compare wall-clock time against Phase 1 baseline (~35 min)
5. Monitor for sendEvent failures in DO logs
6. Verify repair loop still catches stalled items when events are missed
