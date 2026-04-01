import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { AccessIdentity } from "../src/auth/AuthService";
import { EnrichmentRetryNotAllowedError } from "../src/domain/errors";
import type {
  EnrichmentQueuedResponse,
  EnrichmentRepairSummary,
  EnrichmentRunRecord
} from "../src/domain/enrichmentRun";
import { EnrichmentPlanner } from "../src/enrichment/EnrichmentPlanner";
import { handleEnrichmentRequestWithLayer } from "../src/enrichment/Router";
import { EnrichmentRepairService } from "../src/enrichment/EnrichmentRepairService";
import { EnrichmentWorkflowLauncher } from "../src/enrichment/EnrichmentWorkflowLauncher";
import { encodeJsonString } from "../src/platform/Json";
import { EnrichmentRunsRepo } from "../src/services/EnrichmentRunsRepo";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  scopes: ["ops:read", "ops:refresh"]
};

const sampleRun: EnrichmentRunRecord = {
  id: "run-1",
  workflowInstanceId: "run-1",
  postUri: "at://did:plc:test/app.bsky.feed.post/post-1" as any,
  enrichmentType: "vision",
  schemaVersion: "v1",
  triggeredBy: "admin",
  requestedBy: "operator@example.com",
  status: "failed",
  phase: "failed",
  attemptCount: 1,
  modelLane: null,
  promptVersion: null,
  inputFingerprint: null,
  startedAt: 1,
  finishedAt: 2,
  lastProgressAt: 2,
  resultWrittenAt: null,
  error: null
};

const sampleRepairSummary: EnrichmentRepairSummary = {
  repairedRuns: 1,
  staleQueuedRuns: 1,
  staleRunningRuns: 0,
  untouchedRuns: 0
};

const makeLayer = (state?: {
  readonly listRuns?: (input: { readonly status?: EnrichmentRunRecord["status"]; readonly limit: number }) => unknown;
  readonly getRun?: (runId: string) => unknown;
  readonly retry?: (
    runId: string
  ) => Effect.Effect<EnrichmentQueuedResponse, EnrichmentRetryNotAllowedError>;
  readonly repair?: () => Effect.Effect<EnrichmentRepairSummary, never>;
  readonly plan?: (input: unknown) => unknown;
}) =>
  Layer.mergeAll(
    Layer.succeed(EnrichmentWorkflowLauncher, {
      start: (input) =>
        Effect.sync(() => {
          const runId = typeof input.postUri === "string"
            ? `${input.enrichmentType}-queued`
            : "enrichment-queued";
          return {
            runId,
            workflowInstanceId: runId,
            status: "queued" as const
          };
        }),
      startIfAbsent: () => Effect.succeed(true)
    }),
    Layer.succeed(EnrichmentRunsRepo, {
      createQueuedIfAbsent: () => Effect.succeed(true),
      getById: (runId: string) =>
        Effect.sync(() => (state?.getRun?.(runId) as EnrichmentRunRecord | null | undefined) ?? sampleRun),
      listRunning: () => Effect.succeed([]),
      listRecent: (input) =>
        Effect.sync(() => (state?.listRuns?.(input as any) as ReadonlyArray<EnrichmentRunRecord> | undefined) ?? [sampleRun]),
      listActive: () => Effect.succeed([]),
      listStaleActive: () => Effect.succeed([]),
      markPhase: () => Effect.void,
      markComplete: () => Effect.void,
      markFailed: () => Effect.void,
      markNeedsReview: () => Effect.void,
      resetForRetry: () => Effect.succeed(false)
    }),
    Layer.succeed(EnrichmentRepairService, {
      retryRun: (runId: string, _now?: number) =>
        state?.retry?.(runId) ?? Effect.succeed({
          runId,
          workflowInstanceId: runId,
          status: "queued" as const
        }),
      repairHistoricalRuns: (_now?: number) =>
        state?.repair?.() ?? Effect.succeed(sampleRepairSummary)
    }),
    Layer.succeed(EnrichmentPlanner, {
      plan: (input) =>
        Effect.sync(() =>
          (state?.plan?.(input) as any) ?? ({
            enrichmentType:
              (input as { readonly enrichmentType?: string }).enrichmentType ??
              "vision",
            decision: "execute"
          })
        )
    })
  );

describe("enrichment admin routes", () => {
  it.live("starts an enrichment run through the launcher", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/start", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({
            postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
            enrichmentType: "vision",
            schemaVersion: "v1"
          })
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as EnrichmentQueuedResponse;

      expect(response.status).toBe(202);
      expect(body).toEqual({
        runId: "vision-queued",
        workflowInstanceId: "vision-queued",
        status: "queued"
      });
    })
  );

  it.live("rejects source attribution starts while vision enrichment is still required", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/start", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({
            postUri: "at://did:plc:test/app.bsky.feed.post/post-1",
            enrichmentType: "source-attribution",
            schemaVersion: "v2"
          })
        }),
        operatorIdentity,
        makeLayer({
          plan: () => ({
            enrichmentType: "source-attribution",
            decision: "skip",
            stopReason: "awaiting-vision"
          })
        })
      );
      const body = await response.json() as {
        readonly error: string;
        readonly message: string;
        readonly retryable?: boolean;
      };

      expect(response.status).toBe(409);
      expect(body).toEqual({
        error: "Conflict",
        message:
          "vision enrichment must complete before source attribution can start for at://did:plc:test/app.bsky.feed.post/post-1",
        retryable: true
      });
    })
  );

  it.live("lists recent enrichment runs through the run repo", () =>
    Effect.promise(async () => {
      const calls: Array<unknown> = [];
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/runs?status=failed&limit=5", {
          method: "GET"
        }),
        operatorIdentity,
        makeLayer({
          listRuns: (input) => {
            calls.push(input);
            return [sampleRun];
          }
        })
      );
      const body = await response.json() as {
        readonly items: ReadonlyArray<EnrichmentRunRecord>;
      };

      expect(response.status).toBe(200);
      expect(body.items).toEqual([sampleRun]);
      expect(calls).toEqual([{ status: "failed", limit: 5 }]);
    })
  );

  it.live("returns a single enrichment run by id", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/runs/run-1", {
          method: "GET"
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as EnrichmentRunRecord;

      expect(response.status).toBe(200);
      expect(body).toEqual(sampleRun);
    })
  );

  it.live("retries enrichment runs through the repair service", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/runs/run-1/retry", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({})
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as {
        readonly runId: string;
        readonly workflowInstanceId: string;
        readonly status: "queued";
      };

      expect(response.status).toBe(202);
      expect(body).toEqual({
        runId: "run-1",
        workflowInstanceId: "run-1",
        status: "queued"
      });
    })
  );

  it.live("maps retry conflicts to structured 409 responses", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/runs/run-1/retry", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({})
        }),
        operatorIdentity,
        makeLayer({
          retry: () =>
            Effect.fail(
              EnrichmentRetryNotAllowedError.make({
                runId: "run-1",
                status: "running"
              })
            )
        })
      );
      const body = await response.json() as {
        readonly error: string;
        readonly message: string;
      };

      expect(response.status).toBe(409);
      expect(body.error).toBe("Conflict");
      expect(body.message).toContain("run-1");
    })
  );

  it.live("repairs stale enrichment runs through the repair service", () =>
    Effect.promise(async () => {
      const response = await handleEnrichmentRequestWithLayer(
        new Request("https://skygest.local/admin/enrichment/repair", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: encodeJsonString({})
        }),
        operatorIdentity,
        makeLayer()
      );
      const body = await response.json() as EnrichmentRepairSummary;

      expect(response.status).toBe(200);
      expect(body).toEqual(sampleRepairSummary);
    })
  );
});
