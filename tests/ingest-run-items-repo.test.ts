import { SqlClient } from "effect/unstable/sql";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import type { IngestErrorEnvelope } from "../src/domain/errors";
import type { Did } from "../src/domain/types";
import { IngestRunItemsRepo } from "../src/services/IngestRunItemsRepo";
import { IngestRunItemsRepoD1 } from "../src/services/d1/IngestRunItemsRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const asDid = (value: string) => value as Did;

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();

  return Layer.mergeAll(
    sqliteLayer,
    IngestRunItemsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer))
  );
};

describe("IngestRunItemsRepoD1", () => {
  it.effect("batches large run item inserts so head sweeps with many experts do not exceed SQL parameter limits", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const sql = yield* SqlClient.SqlClient;
      const itemsRepo = yield* IngestRunItemsRepo;
      const expertCount = 120;

      yield* sql`
        INSERT INTO ingest_runs (
          id,
          workflow_instance_id,
          kind,
          triggered_by,
          requested_by,
          status,
          phase,
          started_at,
          finished_at,
          last_progress_at,
          total_experts,
          experts_succeeded,
          experts_failed,
          pages_fetched,
          posts_seen,
          posts_stored,
          posts_deleted,
          error
        ) VALUES (
          'run-batch',
          'run-batch',
          'head-sweep',
          'admin',
          'operator@example.com',
          'queued',
          'queued',
          1,
          NULL,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          NULL
        )
      `.pipe(Effect.asVoid);

      yield* Effect.forEach(
        Array.from({ length: expertCount }, (_, index) => asDid(`did:plc:expert-${index + 1}`)),
        (did, index) =>
          sql`
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
              ${`expert-${index + 1}.test`},
              NULL,
              NULL,
              'energy',
              'manual',
              NULL,
              0,
              1,
              ${index + 1},
              NULL
            )
          `.pipe(Effect.asVoid),
        { discard: true }
      );

      yield* itemsRepo.createMany(
        Array.from({ length: expertCount }, (_, index) => ({
          runId: "run-batch",
          did: asDid(`did:plc:expert-${index + 1}`),
          mode: "head" as const
        }))
      );

      const inserted = yield* itemsRepo.listByRun("run-batch");

      expect(inserted).toHaveLength(expertCount);
      expect(inserted.every((item) => item.status === "queued")).toBe(true);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("summarizes run progress with aggregate SQL instead of row-by-row workflow reads", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const sql = yield* SqlClient.SqlClient;
      const itemsRepo = yield* IngestRunItemsRepo;
      const failedError: IngestErrorEnvelope = {
        tag: "BlueskyApiError",
        message: "Bluesky API request failed",
        retryable: true,
        status: 429,
        did: asDid("did:plc:expert-2"),
        runId: "run-summary",
        operation: "ExpertPollCoordinatorDo.alarm"
      };

      yield* sql`
        INSERT INTO ingest_runs (
          id,
          workflow_instance_id,
          kind,
          triggered_by,
          requested_by,
          status,
          phase,
          started_at,
          finished_at,
          last_progress_at,
          total_experts,
          experts_succeeded,
          experts_failed,
          pages_fetched,
          posts_seen,
          posts_stored,
          posts_deleted,
          error
        ) VALUES (
          'run-summary',
          'run-summary',
          'head-sweep',
          'admin',
          'operator@example.com',
          'running',
          'dispatching',
          1,
          NULL,
          1,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          NULL
        )
      `.pipe(Effect.asVoid);

      yield* Effect.forEach(
        [asDid("did:plc:expert-1"), asDid("did:plc:expert-2"), asDid("did:plc:expert-3")],
        (did, index) =>
          sql`
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
              ${`expert-summary-${index + 1}.test`},
              NULL,
              NULL,
              'energy',
              'manual',
              NULL,
              0,
              1,
              ${index + 1},
              NULL
            )
          `.pipe(Effect.asVoid),
        { discard: true }
      );

      yield* itemsRepo.createMany([
        { runId: "run-summary", did: asDid("did:plc:expert-1"), mode: "head" },
        { runId: "run-summary", did: asDid("did:plc:expert-2"), mode: "head" },
        { runId: "run-summary", did: asDid("did:plc:expert-3"), mode: "head" }
      ]);

      yield* itemsRepo.markDispatched({
        runId: "run-summary",
        did: asDid("did:plc:expert-1"),
        mode: "head",
        enqueuedAt: 10,
        lastProgressAt: 10
      });
      yield* itemsRepo.markDispatched({
        runId: "run-summary",
        did: asDid("did:plc:expert-2"),
        mode: "head",
        enqueuedAt: 11,
        lastProgressAt: 11
      });
      yield* itemsRepo.markRunning({
        runId: "run-summary",
        did: asDid("did:plc:expert-1"),
        mode: "head",
        startedAt: 12,
        lastProgressAt: 12
      });
      yield* itemsRepo.markRunning({
        runId: "run-summary",
        did: asDid("did:plc:expert-2"),
        mode: "head",
        startedAt: 13,
        lastProgressAt: 13
      });
      yield* itemsRepo.markComplete({
        runId: "run-summary",
        did: asDid("did:plc:expert-1"),
        mode: "head",
        attemptCount: 1,
        pagesFetched: 2,
        postsSeen: 4,
        postsStored: 3,
        postsDeleted: 0,
        finishedAt: 20
      });
      yield* itemsRepo.markFailed({
        runId: "run-summary",
        did: asDid("did:plc:expert-2"),
        mode: "head",
        attemptCount: 1,
        pagesFetched: 1,
        postsSeen: 2,
        postsStored: 0,
        postsDeleted: 0,
        finishedAt: 21,
        error: failedError
      });

      const incomplete = yield* itemsRepo.countIncompleteByRun("run-summary");
      const summary = yield* itemsRepo.summarizeByRun("run-summary");

      expect(incomplete).toBe(1);
      expect(summary).toEqual({
        totalExperts: 3,
        expertsSucceeded: 1,
        expertsFailed: 1,
        pagesFetched: 3,
        postsSeen: 6,
        postsStored: 3,
        postsDeleted: 0,
        error: failedError
      });
    }).pipe(Effect.provide(makeLayer()))
  );
});
