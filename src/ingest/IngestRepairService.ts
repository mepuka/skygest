import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import {
  HistoricalRunRepairError,
  StaleDispatchedIngestItemError,
  StaleRunningIngestItemError,
  toIngestErrorEnvelope
} from "../domain/errors";
import type {
  IngestRepairSummary,
  IngestRunItemRecord,
  IngestRunItemSummary,
  IngestRunRecoverySummary,
  IngestRunRecord
} from "../domain/polling";
import { IngestRunItemsRepo } from "../services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../services/IngestRunsRepo";

export const STALE_DISPATCHED_MS = 5 * 60 * 1000;
export const STALE_RUNNING_MS = 15 * 60 * 1000;

const emptyRecoverySummary = (): IngestRunRecoverySummary => ({
  failedItems: 0,
  requeuedItems: 0
});

const emptyRepairSummary = (): IngestRepairSummary => ({
  repairedRuns: 0,
  failedItems: 0,
  requeuedItems: 0,
  untouchedRuns: 0
});

const addRepairSummary = (
  left: IngestRepairSummary,
  right: IngestRepairSummary
): IngestRepairSummary => ({
  repairedRuns: left.repairedRuns + right.repairedRuns,
  failedItems: left.failedItems + right.failedItems,
  requeuedItems: left.requeuedItems + right.requeuedItems,
  untouchedRuns: left.untouchedRuns + right.untouchedRuns
});

const staleDispatchedBefore = (now: number) => now - STALE_DISPATCHED_MS;
const staleRunningBefore = (now: number) => now - STALE_RUNNING_MS;

const isIncompleteItem = (item: IngestRunItemRecord) =>
  item.status !== "complete" && item.status !== "failed";

const isHistoricallyStaleDispatched = (item: IngestRunItemRecord, now: number) =>
  item.status === "dispatched" &&
  (item.lastProgressAt ?? item.enqueuedAt ?? Number.POSITIVE_INFINITY) <= staleDispatchedBefore(now);

const isHistoricallyStaleRunning = (item: IngestRunItemRecord, now: number) =>
  item.status === "running" &&
  (item.lastProgressAt ?? item.startedAt ?? Number.POSITIVE_INFINITY) <= staleRunningBefore(now);

const itemFailureAttemptCount = (item: IngestRunItemRecord) =>
  item.status === "running"
    ? Math.max(item.attemptCount, 1)
    : item.attemptCount;

export class IngestRepairService extends Context.Tag("@skygest/IngestRepairService")<
  IngestRepairService,
  {
    readonly repairLiveRun: (
      runId: string,
      now?: number
    ) => Effect.Effect<IngestRunRecoverySummary, SqlError | DbError>;
    readonly repairHistoricalRuns: (
      now?: number
    ) => Effect.Effect<IngestRepairSummary, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(
    IngestRepairService,
    Effect.gen(function* () {
      const runs = yield* IngestRunsRepo;
      const items = yield* IngestRunItemsRepo;

      const finalizeRunFromSummary = (
        runId: string,
        summary: IngestRunItemSummary,
        finishedAt: number,
        fallbackMessage: string,
        operation: string
      ) =>
        summary.expertsFailed > 0
          ? runs.markFailed({
              id: runId,
              finishedAt,
              ...summary,
              error: summary.error ?? toIngestErrorEnvelope(
                HistoricalRunRepairError.make({
                  message: fallbackMessage,
                  runId,
                  operation
                })
              )
            })
          : runs.markComplete({
              id: runId,
              finishedAt,
              ...summary
            });

      const repairLiveRun = Effect.fn("IngestRepairService.repairLiveRun")(function* (
        runId: string,
        now = Date.now()
      ) {
        const staleDispatched = yield* items.listStaleDispatchedByRun(
          runId,
          staleDispatchedBefore(now)
        );
        const staleRunning = yield* items.listStaleRunningByRun(
          runId,
          staleRunningBefore(now)
        );

        yield* Effect.forEach(
          staleDispatched,
          (item) =>
            items.markQueued({
              runId: item.runId,
              did: item.did,
              mode: item.mode,
              lastProgressAt: now
            }).pipe(
              Effect.zipRight(
                Effect.logInfo("requeued stale dispatched ingest item").pipe(
                  Effect.annotateLogs(
                    toIngestErrorEnvelope(
                      StaleDispatchedIngestItemError.make({
                        message: "requeued stale dispatched ingest item",
                        did: item.did,
                        runId: item.runId,
                        operation: "IngestRepairService.repairLiveRun"
                      })
                    )
                  )
                )
              )
            ),
          { discard: true }
        );

        yield* Effect.forEach(
          staleRunning,
          (item) =>
            items.markFailed({
              runId: item.runId,
              did: item.did,
              mode: item.mode,
              attemptCount: itemFailureAttemptCount(item),
              pagesFetched: item.pagesFetched,
              postsSeen: item.postsSeen,
              postsStored: item.postsStored,
              postsDeleted: item.postsDeleted,
              finishedAt: now,
              error: toIngestErrorEnvelope(
                StaleRunningIngestItemError.make({
                  message: "failed stale running ingest item",
                  did: item.did,
                  runId: item.runId,
                  operation: "IngestRepairService.repairLiveRun"
                })
              )
            }),
          { discard: true }
        );

        return {
          failedItems: staleRunning.length,
          requeuedItems: staleDispatched.length
        } satisfies IngestRunRecoverySummary;
      });

      const repairHistoricalRun = Effect.fn("IngestRepairService.repairHistoricalRun")(function* (
        run: IngestRunRecord,
        now: number
      ) {
        const runItems = yield* items.listByRun(run.id);

        if (runItems.length === 0) {
          yield* runs.markFailed({
            id: run.id,
            finishedAt: now,
            totalExperts: 0,
            expertsSucceeded: 0,
            expertsFailed: 0,
            pagesFetched: 0,
            postsSeen: 0,
            postsStored: 0,
            postsDeleted: 0,
            error: toIngestErrorEnvelope(
              HistoricalRunRepairError.make({
                message: "repaired abandoned run with no ingest items",
                runId: run.id,
                operation: "IngestRepairService.repairHistoricalRuns"
              })
            )
          });

          return {
            repairedRuns: 1,
            failedItems: 0,
            requeuedItems: 0,
            untouchedRuns: 0
          } satisfies IngestRepairSummary;
        }

        const incomplete = runItems.filter(isIncompleteItem);

        if (incomplete.length === 0) {
          const summary = yield* items.summarizeByRun(run.id);

          yield* finalizeRunFromSummary(
            run.id,
            summary,
            now,
            "repaired historical run with terminal ingest items",
            "IngestRepairService.repairHistoricalRuns"
          );

          return {
            repairedRuns: 1,
            failedItems: 0,
            requeuedItems: 0,
            untouchedRuns: 0
          } satisfies IngestRepairSummary;
        }

        const allIncompleteStale = incomplete.every(
          (item) =>
            isHistoricallyStaleDispatched(item, now) ||
            isHistoricallyStaleRunning(item, now)
        );

        if (!allIncompleteStale) {
          return {
            repairedRuns: 0,
            failedItems: 0,
            requeuedItems: 0,
            untouchedRuns: 1
          } satisfies IngestRepairSummary;
        }

        yield* Effect.forEach(
          incomplete,
          (item) =>
            items.markFailed({
              runId: item.runId,
              did: item.did,
              mode: item.mode,
              attemptCount: itemFailureAttemptCount(item),
              pagesFetched: item.pagesFetched,
              postsSeen: item.postsSeen,
              postsStored: item.postsStored,
              postsDeleted: item.postsDeleted,
              finishedAt: now,
              error: toIngestErrorEnvelope(
                HistoricalRunRepairError.make({
                  message: `repaired historical ${item.status} ingest item`,
                  runId: item.runId,
                  did: item.did,
                  operation: "IngestRepairService.repairHistoricalRuns"
                })
              )
            }),
          { discard: true }
        );

        const summary = yield* items.summarizeByRun(run.id);

        yield* finalizeRunFromSummary(
          run.id,
          summary,
          now,
          "repaired historical run with stale incomplete ingest items",
          "IngestRepairService.repairHistoricalRuns"
        );

        return {
          repairedRuns: 1,
          failedItems: incomplete.length,
          requeuedItems: 0,
          untouchedRuns: 0
        } satisfies IngestRepairSummary;
      });

      const repairHistoricalRuns = Effect.fn("IngestRepairService.repairHistoricalRuns")(function* (
        now = Date.now()
      ) {
        const runningRuns = yield* runs.listRunning();
        const summaries = yield* Effect.forEach(
          runningRuns,
          (run) => repairHistoricalRun(run, now)
        );

        return summaries.reduce(addRepairSummary, emptyRepairSummary());
      });

      return IngestRepairService.of({
        repairLiveRun,
        repairHistoricalRuns
      });
    })
  );
}
