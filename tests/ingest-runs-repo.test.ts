import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import { IngestRunsRepo } from "../src/services/IngestRunsRepo";
import { IngestRunsRepoD1 } from "../src/services/d1/IngestRunsRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const makeLayer = () => {
  const sqliteLayer = makeSqliteLayer();

  return Layer.mergeAll(
    sqliteLayer,
    IngestRunsRepoD1.layer.pipe(Layer.provideMerge(sqliteLayer))
  );
};

describe("IngestRunsRepoD1", () => {
  it.effect("updateProgress writes summary counters and lastProgressAt to the run row", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const runs = yield* IngestRunsRepo;

      yield* runs.createQueuedIfAbsent({
        id: "run-progress",
        workflowInstanceId: "run-progress",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: "operator@example.com",
        startedAt: 1
      });
      yield* runs.markPreparing({
        id: "run-progress",
        lastProgressAt: 2
      });
      yield* runs.markDispatching({
        id: "run-progress",
        totalExperts: 5,
        lastProgressAt: 3
      });

      yield* runs.updateProgress({
        id: "run-progress",
        totalExperts: 5,
        expertsSucceeded: 3,
        expertsFailed: 1,
        pagesFetched: 8,
        postsSeen: 20,
        postsStored: 15,
        postsDeleted: 2,
        lastProgressAt: 100
      });

      const updated = yield* runs.getById("run-progress");

      expect(updated).toEqual(
        expect.objectContaining({
          id: "run-progress",
          status: "running",
          phase: "dispatching",
          totalExperts: 5,
          expertsSucceeded: 3,
          expertsFailed: 1,
          pagesFetched: 8,
          postsSeen: 20,
          postsStored: 15,
          postsDeleted: 2,
          lastProgressAt: 100,
          finishedAt: null
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("updateProgress is idempotent and later calls overwrite earlier values", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const runs = yield* IngestRunsRepo;

      yield* runs.createQueuedIfAbsent({
        id: "run-idem",
        workflowInstanceId: "run-idem",
        kind: "head-sweep",
        triggeredBy: "admin",
        requestedBy: null,
        startedAt: 1
      });
      yield* runs.markDispatching({
        id: "run-idem",
        totalExperts: 3,
        lastProgressAt: 2
      });

      yield* runs.updateProgress({
        id: "run-idem",
        totalExperts: 3,
        expertsSucceeded: 1,
        expertsFailed: 0,
        pagesFetched: 2,
        postsSeen: 5,
        postsStored: 4,
        postsDeleted: 0,
        lastProgressAt: 50
      });

      yield* runs.updateProgress({
        id: "run-idem",
        totalExperts: 3,
        expertsSucceeded: 2,
        expertsFailed: 1,
        pagesFetched: 5,
        postsSeen: 12,
        postsStored: 10,
        postsDeleted: 1,
        lastProgressAt: 100
      });

      const final = yield* runs.getById("run-idem");

      expect(final).toEqual(
        expect.objectContaining({
          totalExperts: 3,
          expertsSucceeded: 2,
          expertsFailed: 1,
          pagesFetched: 5,
          postsSeen: 12,
          postsStored: 10,
          postsDeleted: 1,
          lastProgressAt: 100
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );
});
