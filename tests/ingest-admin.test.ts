import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { AccessIdentity } from "../src/auth/AuthService";
import { IngestWorkflowLaunchError } from "../src/domain/errors";
import type { IngestRunItemRecord, IngestRunRecord } from "../src/domain/polling";
import { IngestRepairService } from "../src/ingest/IngestRepairService";
import { handleIngestRequestWithLayer } from "../src/ingest/Router";
import { IngestWorkflowLauncher } from "../src/ingest/IngestWorkflowLauncher";
import { encodeJsonString } from "../src/platform/Json";
import { IngestRunItemsRepo } from "../src/services/IngestRunItemsRepo";
import { IngestRunsRepo } from "../src/services/IngestRunsRepo";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  scopes: ["ops:read", "ops:refresh"]
};

const sampleQueued = {
  runId: "run-1",
  workflowInstanceId: "run-1",
  status: "queued" as const
};

const sampleRun: IngestRunRecord = {
  id: "run-1",
  workflowInstanceId: "run-1",
  kind: "head-sweep",
  triggeredBy: "admin",
  requestedBy: "operator@example.com",
  status: "running",
  phase: "dispatching",
  startedAt: 1,
  finishedAt: null,
  lastProgressAt: 1,
  totalExperts: 1,
  expertsSucceeded: 0,
  expertsFailed: 0,
  pagesFetched: 0,
  postsSeen: 0,
  postsStored: 0,
  postsDeleted: 0,
  error: null
};

const sampleItems: ReadonlyArray<IngestRunItemRecord> = [
  {
    runId: "run-1",
    did: "did:plc:expert-a" as IngestRunItemRecord["did"],
    mode: "head",
    status: "complete",
    enqueuedAt: 1,
    attemptCount: 1,
    startedAt: 2,
    finishedAt: 3,
    lastProgressAt: 3,
    pagesFetched: 1,
    postsSeen: 2,
    postsStored: 1,
    postsDeleted: 0,
    error: null
  }
];

const makeLayer = (requests: Array<unknown> = []) =>
  Layer.mergeAll(
    Layer.succeed(IngestWorkflowLauncher, {
      start: (request) =>
        Effect.sync(() => {
          requests.push(request);
          return sampleQueued;
        }),
      startCronHeadSweep: () => Effect.void
    }),
    Layer.succeed(IngestRunsRepo, {
      createQueuedIfAbsent: () => Effect.succeed(true),
      getById: () => Effect.succeed(sampleRun),
      listRunning: () => Effect.succeed([]),
      markPreparing: () => Effect.void,
      markDispatching: () => Effect.void,
      markFinalizing: () => Effect.void,
      updateProgress: () => Effect.void,
      markComplete: () => Effect.void,
      markFailed: () => Effect.void
    }),
    Layer.succeed(IngestRunItemsRepo, {
      createMany: () => Effect.void,
      markDispatched: () => Effect.void,
      markQueued: () => Effect.void,
      markRunning: () => Effect.void,
      markProgress: () => Effect.void,
      markComplete: () => Effect.void,
      markFailed: () => Effect.void,
      listByRun: () => Effect.succeed(sampleItems),
      countActiveByRun: () => Effect.succeed(0),
      countIncompleteByRun: () => Effect.succeed(0),
      listUndispatchedByRun: () => Effect.succeed([]),
      listStaleDispatchedByRun: () => Effect.succeed([]),
      listStaleRunningByRun: () => Effect.succeed([]),
      summarizeByRun: () =>
        Effect.succeed({
          totalExperts: 1,
          expertsSucceeded: 1,
          expertsFailed: 0,
          pagesFetched: 1,
          postsSeen: 2,
          postsStored: 1,
          postsDeleted: 0,
          error: null
        })
    }),
    Layer.succeed(IngestRepairService, {
      repairLiveRun: () =>
        Effect.succeed({
          failedItems: 0,
          requeuedItems: 0
        }),
      repairHistoricalRuns: () =>
        Effect.succeed({
          repairedRuns: 0,
          failedItems: 0,
          requeuedItems: 0,
          untouchedRuns: 0
        })
    })
  );

describe("ingest admin routes", () => {
  it.live("starts head polls through the workflow launcher", () =>
    Effect.promise(async () => {
      const requests: Array<unknown> = [];
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/poll", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({})
        }),
        operatorIdentity,
        makeLayer(requests)
      );
      const body = await response.json() as typeof sampleQueued;

      expect(response.status).toBe(202);
      expect(body).toEqual(sampleQueued);
      expect(requests).toEqual([
        {
          kind: "head-sweep",
          triggeredBy: "admin",
          requestedBy: "operator@example.com"
        }
      ]);
    })
  );

  it.live("returns run status from the run repo", () =>
    Effect.promise(async () => {
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/runs/run-1", {
          method: "GET"
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as IngestRunRecord;

      expect(response.status).toBe(200);
      expect(body).toEqual(sampleRun);
    })
  );

  it.live("returns run items from the run items repo", () =>
    Effect.promise(async () => {
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/runs/run-1/items", {
          method: "GET"
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as {
        readonly items: ReadonlyArray<IngestRunItemRecord>;
      };

      expect(response.status).toBe(200);
      expect(body.items).toEqual(sampleItems);
    })
  );

  it.live("validates backfill inputs", () =>
    Effect.promise(async () => {
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/backfill", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({ maxPosts: -1 })
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as {
        readonly error: string;
        readonly message: string;
      };

      expect(response.status).toBe(400);
      expect(body.error).toBe("BadRequest");
      expect(body.message).toContain("invalid request parameters");
    })
  );

  it.live("maps workflow launch failures to a structured 503 response", () =>
    Effect.promise(async () => {
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/poll", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({})
        }),
        operatorIdentity,
        Layer.mergeAll(
          Layer.succeed(IngestWorkflowLauncher, {
            start: () =>
              Effect.fail(
                new IngestWorkflowLaunchError({
                  message: "workflow create failed",
                  operation: "test"
                })
              ),
            startCronHeadSweep: () => Effect.void
          }),
          Layer.succeed(IngestRunsRepo, {
            createQueuedIfAbsent: () => Effect.succeed(true),
            getById: () => Effect.succeed(sampleRun),
            listRunning: () => Effect.succeed([]),
            markPreparing: () => Effect.void,
            markDispatching: () => Effect.void,
            markFinalizing: () => Effect.void,
            updateProgress: () => Effect.void,
            markComplete: () => Effect.void,
            markFailed: () => Effect.void
          }),
          Layer.succeed(IngestRunItemsRepo, {
            createMany: () => Effect.void,
            markDispatched: () => Effect.void,
            markQueued: () => Effect.void,
            markRunning: () => Effect.void,
            markProgress: () => Effect.void,
            markComplete: () => Effect.void,
            markFailed: () => Effect.void,
            listByRun: () => Effect.succeed(sampleItems),
            countActiveByRun: () => Effect.succeed(0),
            countIncompleteByRun: () => Effect.succeed(0),
            listUndispatchedByRun: () => Effect.succeed([]),
            listStaleDispatchedByRun: () => Effect.succeed([]),
            listStaleRunningByRun: () => Effect.succeed([]),
            summarizeByRun: () =>
              Effect.succeed({
                totalExperts: 1,
                expertsSucceeded: 1,
                expertsFailed: 0,
                pagesFetched: 1,
                postsSeen: 2,
                postsStored: 1,
                postsDeleted: 0,
                error: null
              })
          }),
          Layer.succeed(IngestRepairService, {
            repairLiveRun: () =>
              Effect.succeed({
                failedItems: 0,
                requeuedItems: 0
              }),
            repairHistoricalRuns: () =>
              Effect.succeed({
                repairedRuns: 0,
                failedItems: 0,
                requeuedItems: 0,
                untouchedRuns: 0
              })
          })
        )
      );
      const body = await response.json() as {
        readonly error: string;
        readonly message: string;
        readonly retryable?: boolean;
      };

      expect(response.status).toBe(503);
      expect(body).toEqual({
        error: "ServiceUnavailable",
        message: "failed to launch ingest workflow",
        retryable: true
      });
    })
  );

  it.live("repairs historical ingest state through the repair endpoint", () =>
    Effect.promise(async () => {
      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/repair", {
          method: "POST",
          body: encodeJsonString({})
        }),
        operatorIdentity,
        Layer.mergeAll(
          makeLayer(),
          Layer.succeed(IngestRepairService, {
            repairLiveRun: () =>
              Effect.succeed({
                failedItems: 0,
                requeuedItems: 0
              }),
            repairHistoricalRuns: () =>
              Effect.succeed({
                repairedRuns: 2,
                failedItems: 3,
                requeuedItems: 1,
                untouchedRuns: 4
              })
          })
        )
      );
      const body = await response.json() as {
        readonly repairedRuns: number;
        readonly failedItems: number;
        readonly requeuedItems: number;
        readonly untouchedRuns: number;
      };

      expect(response.status).toBe(200);
      expect(body).toEqual({
        repairedRuns: 2,
        failedItems: 3,
        requeuedItems: 1,
        untouchedRuns: 4
      });
    })
  );
});
