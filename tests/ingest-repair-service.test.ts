import { SqlClient } from "effect/unstable/sql";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import type { Did } from "../src/domain/types";
import {
  IngestRepairService,
  STALE_DISPATCHED_MS,
  STALE_RUNNING_MS
} from "../src/ingest/IngestRepairService";
import { IngestRunItemsRepo } from "../src/services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../src/services/IngestRunsRepo";
import { IngestRunItemsRepoD1 } from "../src/services/d1/IngestRunItemsRepoD1";
import { IngestRunsRepoD1 } from "../src/services/d1/IngestRunsRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const asDid = (value: string) => value as Did;

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  const runsLayer = IngestRunsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));
  const itemsLayer = IngestRunItemsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer));

  return Layer.mergeAll(
    sqliteLayer,
    runsLayer,
    itemsLayer,
    IngestRepairService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(runsLayer, itemsLayer))
    )
  );
};

const insertExpert = (did: Did, addedAt: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO experts (
        did,
        handle,
        display_name,
        description,
        domain,
        source,
        source_ref,
        shard,
        active,
        added_at,
        last_synced_at
      ) VALUES (
        ${did},
        ${`${did.split(":").at(-1)}.test`},
        NULL,
        NULL,
        'energy',
        'manual',
        NULL,
        0,
        1,
        ${addedAt},
        NULL
      )
    `.pipe(Effect.asVoid);
  });

describe("IngestRepairService", () => {
  it.effect("requeues stale dispatched items and fails stale running items for a live run", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const runs = yield* IngestRunsRepo;
      const items = yield* IngestRunItemsRepo;
      const repair = yield* IngestRepairService;
      const dispatchedDid = asDid("did:plc:expert-dispatched");
      const runningDid = asDid("did:plc:expert-running");
      const now = STALE_RUNNING_MS + 10_000;

      yield* insertExpert(dispatchedDid, 1);
      yield* insertExpert(runningDid, 2);

      yield* runs.createQueuedIfAbsent({
        id: "run-live",
        workflowInstanceId: "run-live",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1
      });
      yield* runs.markPreparing({
        id: "run-live",
        lastProgressAt: 2
      });
      yield* runs.markDispatching({
        id: "run-live",
        totalExperts: 2,
        lastProgressAt: 3
      });

      yield* items.createMany([
        { runId: "run-live", did: dispatchedDid, mode: "head" },
        { runId: "run-live", did: runningDid, mode: "head" }
      ]);
      yield* items.markDispatched({
        runId: "run-live",
        did: dispatchedDid,
        mode: "head",
        enqueuedAt: 1,
        lastProgressAt: 1
      });
      yield* items.markDispatched({
        runId: "run-live",
        did: runningDid,
        mode: "head",
        enqueuedAt: 2,
        lastProgressAt: 2
      });
      yield* items.markRunning({
        runId: "run-live",
        did: runningDid,
        mode: "head",
        startedAt: 3,
        lastProgressAt: 3
      });

      const summary = yield* repair.repairLiveRun("run-live", now);
      const repairedItems = yield* items.listByRun("run-live");

      expect(summary).toEqual({
        failedItems: 1,
        requeuedItems: 1
      });
      expect(repairedItems).toEqual([
        expect.objectContaining({
          runId: "run-live",
          did: dispatchedDid,
          mode: "head",
          status: "queued",
          enqueuedAt: null,
          startedAt: null,
          finishedAt: null,
          lastProgressAt: now,
          error: null
        }),
        expect.objectContaining({
          runId: "run-live",
          did: runningDid,
          mode: "head",
          status: "failed",
          attemptCount: 1,
          finishedAt: now,
          error: expect.objectContaining({
            tag: "StaleRunningIngestItemError",
            runId: "run-live",
            did: runningDid
          })
        })
      ]);
      expect(yield* items.countActiveByRun("run-live")).toBe(0);
      expect(yield* items.countIncompleteByRun("run-live")).toBe(1);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("repairs orphaned running runs without deleting history and remains idempotent", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const runs = yield* IngestRunsRepo;
      const repair = yield* IngestRepairService;

      yield* runs.createQueuedIfAbsent({
        id: "run-orphan",
        workflowInstanceId: "run-orphan",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1
      });
      yield* runs.markPreparing({
        id: "run-orphan",
        lastProgressAt: 2
      });

      const first = yield* repair.repairHistoricalRuns(STALE_DISPATCHED_MS + 1);
      const repaired = yield* runs.getById("run-orphan");
      const second = yield* repair.repairHistoricalRuns(STALE_DISPATCHED_MS + 2);

      expect(first).toEqual({
        repairedRuns: 1,
        failedItems: 0,
        requeuedItems: 0,
        untouchedRuns: 0
      });
      expect(repaired).toEqual(
        expect.objectContaining({
          id: "run-orphan",
          status: "failed",
          phase: "failed",
          totalExperts: 0,
          expertsSucceeded: 0,
          expertsFailed: 0,
          error: expect.objectContaining({
            tag: "HistoricalRunRepairError",
            runId: "run-orphan"
          })
        })
      );
      expect(second).toEqual({
        repairedRuns: 0,
        failedItems: 0,
        requeuedItems: 0,
        untouchedRuns: 0
      });
    }).pipe(Effect.provide(makeLayer()))
  );
});
