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

const postUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as AtUri;

const queuedInput = {
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
  startedAt: 1
};

const seedPickedPayload = () =>
  Effect.gen(function* () {
    yield* seedKnowledgeBase();
    const sql = yield* SqlClient.SqlClient;
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
        ${postUri},
        'picked',
        'img',
        ${'{"kind":"img","images":[]}'},
        1,
        1,
        NULL
      )
      ON CONFLICT(post_uri) DO UPDATE SET
        capture_stage = 'picked',
        updated_at = 1
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
      yield* seedPickedPayload();

      const runs = yield* EnrichmentRunsRepo;

      yield* runs.createQueuedIfAbsent(queuedInput);
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

      yield* runs.markNeedsReview({
        id: "enrich-run-1",
        lastProgressAt: 40,
        error: {
          tag: "EnrichmentReviewRequired",
          message: "operator review required",
          retryable: false
        }
      });

      const review = yield* runs.getById("enrich-run-1");

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
});
