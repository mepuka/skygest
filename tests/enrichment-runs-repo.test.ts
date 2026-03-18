import { SqlClient } from "@effect/sql";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import type { AtUri } from "../src/domain/types";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";
import { EnrichmentRunsRepoD1 } from "../src/services/d1/EnrichmentRunsRepoD1";
import {
  makeBiLayer,
  sampleDid,
  seedKnowledgeBase
} from "./support/runtime";

const makeLayer = () => {
  const baseLayer = makeBiLayer();

  return Layer.mergeAll(
    baseLayer,
    EnrichmentRunsRepoD1.layer.pipe(Layer.provideMerge(baseLayer))
  );
};

const makePostUri = (suffix: string) =>
  `at://${sampleDid}/app.bsky.feed.post/${suffix}` as AtUri;

const postUri = makePostUri("post-solar");

type QueuedInput = {
  readonly id: string;
  readonly workflowInstanceId: string;
  readonly postUri: AtUri;
  readonly enrichmentType: "vision";
  readonly schemaVersion: string;
  readonly triggeredBy: "pick";
  readonly requestedBy: string;
  readonly modelLane: null;
  readonly promptVersion: null;
  readonly inputFingerprint: null;
  readonly startedAt: number;
};

const makeQueuedInput = (
  overrides: Partial<QueuedInput> = {}
): QueuedInput => ({
  id: "enrich-run-1",
  workflowInstanceId: "enrich-run-1",
  postUri,
  enrichmentType: "vision" as const,
  schemaVersion: "v1",
  triggeredBy: "pick" as const,
  requestedBy: "operator@example.com",
  modelLane: null,
  promptVersion: null,
  inputFingerprint: null,
  startedAt: 1,
  ...overrides
});

const queuedInput = makeQueuedInput();

const seedPickedPayload = (uri: AtUri = postUri, timestamp = 1) =>
  Effect.gen(function* () {
    yield* seedKnowledgeBase();
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO posts (
        uri,
        did,
        cid,
        text,
        created_at,
        indexed_at,
        has_links,
        status,
        ingest_id
      ) VALUES (
        ${uri},
        ${sampleDid},
        ${`cid-${timestamp}`},
        ${`Stored post text for ${uri}`},
        ${timestamp},
        ${timestamp},
        0,
        'active',
        ${`ingest-${timestamp}-${uri.split("/").pop() ?? "post"}`}
      )
      ON CONFLICT(uri) DO UPDATE SET
        text = excluded.text,
        indexed_at = excluded.indexed_at
    `.pipe(Effect.asVoid);
    yield* sql`
      INSERT INTO post_payloads (
        post_uri,
        capture_stage,
        embed_type,
        embed_payload_json,
        captured_at,
        updated_at,
        enriched_at
      ) VALUES (
        ${uri},
        'picked',
        'img',
        ${'{"kind":"img","images":[]}'},
        ${timestamp},
        ${timestamp},
        NULL
      )
      ON CONFLICT(post_uri) DO UPDATE SET
        capture_stage = 'picked',
        updated_at = ${timestamp}
    `.pipe(Effect.asVoid);
  });

describe("EnrichmentRunsRepoD1", () => {
  it.effect("dedupes queued runs by the logical post/type/schema key", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPickedPayload();

      const runs = yield* EnrichmentRunsRepo;

      const firstInserted = yield* runs.createQueuedIfAbsent(queuedInput);
      const secondInserted = yield* runs.createQueuedIfAbsent({
        ...queuedInput,
        id: "enrich-run-2",
        workflowInstanceId: "enrich-run-2"
      });
      const stored = yield* runs.getById("enrich-run-1");

      expect(firstInserted).toBe(true);
      expect(secondInserted).toBe(false);
      expect(stored).toEqual(
        expect.objectContaining({
          id: "enrich-run-1",
          workflowInstanceId: "enrich-run-1",
          postUri: queuedInput.postUri,
          enrichmentType: "vision",
          schemaVersion: "v1",
          triggeredBy: "pick",
          status: "queued",
          phase: "queued",
          attemptCount: 0,
          finishedAt: null,
          resultWrittenAt: null,
          error: null
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("markPhase starts the first attempt and later phase changes do not increment it again", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPickedPayload();

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(queuedInput);
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "assembling",
        lastProgressAt: 10
      });
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "planning",
        lastProgressAt: 20
      });

      const stored = yield* runs.getById("enrich-run-1");

      expect(stored).toEqual(
        expect.objectContaining({
          status: "running",
          phase: "planning",
          attemptCount: 1,
          lastProgressAt: 20,
          finishedAt: null
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("stores terminal failed and needs-review states with enrichment error envelopes", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      const reviewUri = makePostUri("post-review");
      yield* seedPickedPayload(postUri, 1);
      yield* seedPickedPayload(reviewUri, 2);

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(queuedInput);
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "planning",
        lastProgressAt: 10
      });
      yield* runs.markFailed({
        id: "enrich-run-1",
        finishedAt: 30,
        error: {
          tag: "EnrichmentWorkflowLaunchError",
          message: "failed to launch enrichment workflow",
          retryable: true,
          operation: "EnrichmentWorkflowLauncher.start",
          runId: "enrich-run-1"
        }
      });

      const failed = yield* runs.getById("enrich-run-1");

      expect(failed).toEqual(
        expect.objectContaining({
          status: "failed",
          phase: "failed",
          finishedAt: 30,
          lastProgressAt: 30,
          error: {
            tag: "EnrichmentWorkflowLaunchError",
            message: "failed to launch enrichment workflow",
            retryable: true,
            operation: "EnrichmentWorkflowLauncher.start",
            runId: "enrich-run-1"
          }
        })
      );

      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "enrich-run-2",
        workflowInstanceId: "enrich-run-2",
        postUri: reviewUri,
        startedAt: 2
      }));
      yield* runs.markPhase({
        id: "enrich-run-2",
        phase: "planning",
        lastProgressAt: 35
      });
      yield* runs.markNeedsReview({
        id: "enrich-run-2",
        lastProgressAt: 40,
        error: {
          tag: "EnrichmentReviewRequired",
          message: "operator review required",
          retryable: false
        }
      });

      const review = yield* runs.getById("enrich-run-2");

      expect(review).toEqual(
        expect.objectContaining({
          status: "needs-review",
          phase: "needs-review",
          finishedAt: 40,
          lastProgressAt: 40,
          error: {
            tag: "EnrichmentReviewRequired",
            message: "operator review required",
            retryable: false
          }
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("increments attempts across retries and resets terminal fields for the same run", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPickedPayload();

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(queuedInput);
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "assembling",
        lastProgressAt: 10
      });
      yield* runs.markFailed({
        id: "enrich-run-1",
        finishedAt: 20,
        error: {
          tag: "EnrichmentWorkflowLaunchError",
          message: "failed to launch enrichment workflow",
          retryable: true,
          operation: "test"
        }
      });
      yield* runs.resetForRetry({
        id: "enrich-run-1",
        queuedAt: 30
      });
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "assembling",
        lastProgressAt: 31
      });
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "planning",
        lastProgressAt: 32
      });

      const stored = yield* runs.getById("enrich-run-1");

      expect(stored).toEqual(
        expect.objectContaining({
          id: "enrich-run-1",
          workflowInstanceId: "enrich-run-1",
          status: "running",
          phase: "planning",
          attemptCount: 2,
          startedAt: 30,
          finishedAt: null,
          lastProgressAt: 32,
          resultWrittenAt: null,
          error: null
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("keeps terminal runs stable when late workflow writes arrive", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPickedPayload();

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(queuedInput);
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "planning",
        lastProgressAt: 10
      });
      yield* runs.markNeedsReview({
        id: "enrich-run-1",
        lastProgressAt: 20,
        error: {
          tag: "EnrichmentReviewRequired",
          message: "operator review required",
          retryable: false
        }
      });
      yield* runs.markPhase({
        id: "enrich-run-1",
        phase: "executing",
        lastProgressAt: 30
      });
      yield* runs.markComplete({
        id: "enrich-run-1",
        finishedAt: 31,
        resultWrittenAt: 31
      });
      yield* runs.markFailed({
        id: "enrich-run-1",
        finishedAt: 32,
        error: {
          tag: "EnrichmentWorkflowControlError",
          message: "late write",
          retryable: true,
          operation: "test",
          runId: "enrich-run-1"
        }
      });

      const stored = yield* runs.getById("enrich-run-1");

      expect(stored).toEqual(
        expect.objectContaining({
          status: "needs-review",
          phase: "needs-review",
          finishedAt: 20,
          lastProgressAt: 20,
          resultWrittenAt: null,
          error: {
            tag: "EnrichmentReviewRequired",
            message: "operator review required",
            retryable: false
          }
        })
      );
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("lists recent runs by newest first and filters by status", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const postUri2 = makePostUri("post-wind");
      const postUri3 = makePostUri("post-storage");
      yield* seedPickedPayload(postUri, 1);
      yield* seedPickedPayload(postUri2, 2);
      yield* seedPickedPayload(postUri3, 3);

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "enrich-run-1",
        workflowInstanceId: "enrich-run-1",
        postUri,
        startedAt: 10
      }));
      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "enrich-run-2",
        workflowInstanceId: "enrich-run-2",
        postUri: postUri2,
        startedAt: 20
      }));
      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "enrich-run-3",
        workflowInstanceId: "enrich-run-3",
        postUri: postUri3,
        startedAt: 30
      }));
      yield* runs.markPhase({
        id: "enrich-run-2",
        phase: "planning",
        lastProgressAt: 21
      });
      yield* runs.markFailed({
        id: "enrich-run-2",
        finishedAt: 22,
        error: {
          tag: "EnrichmentWorkflowLaunchError",
          message: "launch failed",
          retryable: true,
          operation: "test"
        }
      });

      const recent = yield* runs.listRecent({ limit: 2 });
      const failed = yield* runs.listRecent({ status: "failed", limit: 10 });

      expect(recent.map((run) => run.id)).toEqual([
        "enrich-run-3",
        "enrich-run-2"
      ]);
      expect(failed.map((run) => run.id)).toEqual(["enrich-run-2"]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("finds stale queued and running runs without returning fresh ones", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const staleQueuedUri = makePostUri("post-stale-queued");
      const staleRunningUri = makePostUri("post-stale-running");
      const freshQueuedUri = makePostUri("post-fresh-queued");
      const freshRunningUri = makePostUri("post-fresh-running");
      yield* seedPickedPayload(staleQueuedUri, 1);
      yield* seedPickedPayload(staleRunningUri, 2);
      yield* seedPickedPayload(freshQueuedUri, 3);
      yield* seedPickedPayload(freshRunningUri, 4);

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "stale-queued",
        workflowInstanceId: "stale-queued",
        postUri: staleQueuedUri,
        startedAt: 10
      }));
      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "stale-running",
        workflowInstanceId: "stale-running",
        postUri: staleRunningUri,
        startedAt: 20
      }));
      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "fresh-queued",
        workflowInstanceId: "fresh-queued",
        postUri: freshQueuedUri,
        startedAt: 90
      }));
      yield* runs.createQueuedIfAbsent(makeQueuedInput({
        id: "fresh-running",
        workflowInstanceId: "fresh-running",
        postUri: freshRunningUri,
        startedAt: 95
      }));
      yield* runs.markPhase({
        id: "stale-running",
        phase: "planning",
        lastProgressAt: 25
      });
      yield* runs.markPhase({
        id: "fresh-running",
        phase: "planning",
        lastProgressAt: 99
      });

      const stale = yield* runs.listStaleActive({
        queuedBefore: 50,
        runningBefore: 50
      });

      expect(stale.map((run) => run.id)).toEqual([
        "stale-queued",
        "stale-running"
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
});
