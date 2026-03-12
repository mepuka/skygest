import { describe, expect, it } from "@effect/vitest";
import {
  emptyCoordinatorState,
  enqueueBackfillTask,
  enqueueHeadTask,
  enqueueReconcileTask,
  insertContinuationTask,
  normalizeStoredCoordinatorState
} from "../src/ingest/ExpertPollCoordinatorState";

describe("ExpertPollCoordinatorState", () => {
  it("coalesces duplicate head requests across runs", () => {
    const first = enqueueHeadTask(emptyCoordinatorState(), "run-1", 1).state;
    const second = enqueueHeadTask(first, "run-2", 2);

    expect(second.coalesced).toBe(true);
    expect(second.state.pending).toHaveLength(1);
    expect(second.state.pending[0]?.mode).toBe("head");
    expect(second.state.pending[0]?.runIds).toEqual(["run-1", "run-2"]);
  });

  it("dedupes backfill requests within the same run", () => {
    const first = enqueueBackfillTask(emptyCoordinatorState(), "run-1", 1, {
      maxPosts: 400
    }).state;
    const second = enqueueBackfillTask(first, "run-1", 2, {
      maxPosts: 400
    });

    expect(second.deduped).toBe(true);
    expect(second.state.pending).toHaveLength(1);
  });

  it("dedupes reconcile requests by run and depth", () => {
    const first = enqueueReconcileTask(emptyCoordinatorState(), "run-1", 1, "deep").state;
    const second = enqueueReconcileTask(first, "run-1", 2, "deep");
    const third = enqueueReconcileTask(second.state, "run-1", 3, "recent");

    expect(second.deduped).toBe(true);
    expect(third.deduped).toBe(false);
    expect(third.state.pending).toHaveLength(2);
  });

  it("requeues bulk continuation after pending head work", () => {
    const base = enqueueBackfillTask(emptyCoordinatorState(), "run-1", 1, {}).state;
    const withHead = enqueueHeadTask(base, "run-head", 2).state;
    const continuation = withHead.pending[0]!;
    const resumed = insertContinuationTask(
      {
        ...withHead,
        pending: withHead.pending.slice(1)
      },
      continuation
    );

    expect(resumed.pending.map((task) => task.mode)).toEqual(["head", "backfill"]);
  });

  it("normalizes legacy string coordinator failures from DO storage", () => {
    const normalized = normalizeStoredCoordinatorState({
      did: null,
      state: {
        current: null,
        pending: [],
        lastCompletedRunId: null,
        lastFailure: "legacy coordinator failure"
      }
    });

    expect(normalized.state.lastFailure).toEqual({
      tag: "LegacyError",
      message: "legacy coordinator failure",
      retryable: false
    });
  });
});
