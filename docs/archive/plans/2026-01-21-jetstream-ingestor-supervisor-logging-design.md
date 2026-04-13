> **Archived 2026-04-13.** This plan predates the 2026-04-12 resolver cutover and describes an architecture that no longer matches `main`. See `docs/architecture/system-context.md`, `docs/architecture/product-alignment.md`, and `docs/plans/2026-04-13-product-loop-cleanup-and-ship.md` for the current story.

---

# Jetstream Ingestor Supervisor + Logging Design

## Goal
- Keep the Jetstream ingestor running without external pings.
- Auto-restart quickly after disconnects, errors, or DO eviction.
- Standardize Effect-native, structured logging to console (JSON).

## Non-goals
- Hibernatable WebSockets refactor (not applicable to outbound Jetstream client).
- Log sinks beyond console (D1/Queue/Logpush) in this phase.
- Changing the Jetstream batching semantics or payload schema.

## Current State
`JetstreamIngestorDoV2.fetch()` starts `runIngestor` once. If the WebSocket closes or an error occurs inside the stream pipeline, the Effect completes and the DO goes idle. A cron ping in `src/worker/dispatch.ts` restarts it.

## Proposed Architecture
Introduce an in-DO supervisor plus a 20s alarm heartbeat.

- **Supervisor state (in-memory):** `ingestorFiber`, `lastStartAt`, `lastFailureAt`, `restartCount`.
- **Ensure loop:** `ensureIngestor()` runs on both `fetch()` and `alarm()`. If the fiber is missing or completed, start a new fiber.
- **Retry policy:** Wrap `runIngestor` with exponential backoff + jitter, capped at a max delay. Failures are logged and counted; the fiber keeps retrying.
- **Alarm heartbeat:** `alarm()` re-schedules itself for `now + 20s` and calls `ensureIngestor()`. This revives the ingestor after hibernation/eviction.
- **Fallback:** Keep the cron ping temporarily. Remove after the alarm+supervisor proves stable.

## Data Flow
1. `fetch()` or `alarm()` calls `ensureIngestor()`.
2. Supervisor starts (or verifies) the ingestor fiber.
3. `runIngestor` streams Jetstream, batches events, sends to `RAW_EVENTS`, updates cursor storage.
4. If the stream fails, the retry schedule restarts it.

## Error Handling
- Log failures with `Cause` rendering and tagged context (component, doId, cursor).
- Persist minimal operational metadata in DO storage if needed (e.g., last failure time).
- Avoid tight retry loops; enforce backoff and jitter.

## Logging (Effect-native, JSON to console)
Create `src/platform/Logging.ts` that provides a structured console logger.

- **Logger layer:** JSON line encoder; no multi-line output.
- **Annotations:** component, worker/do name, cursor, batch size, queue name.
- **Spans:** `runIngestor`, `sendRawEvents`, `cursorUpdate`.
- **Usage:** `Effect.logInfo`/`logWarning`/`logError` + `Effect.annotateLogs`.

## Implementation Surface
- `src/ingest/IngestorDo.ts`: add supervisor state, `ensureIngestor()`, `alarm()` handler, retry policy.
- `src/ingest/JetstreamIngestor.ts`: add span/log annotations around batch send and cursor updates.
- `src/platform/Logging.ts`: shared logging layer and helper utilities.
- `src/worker/dispatch.ts`: keep ping for now; plan removal.

## Testing + Rollout
- Unit: logging encoder shape, basic supervisor state transitions.
- Manual: simulate Jetstream disconnect; verify retry and alarm restart.
- Deploy with 20s alarm; monitor log output; remove cron ping once stable.
