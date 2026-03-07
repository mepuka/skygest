import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { AccessIdentity } from "../src/auth/AuthService";
import { PollerBusyError } from "../src/domain/errors";
import { handleIngestRequestWithLayer } from "../src/ingest/Router";
import { PollCoordinator } from "../src/ingest/PollCoordinator";
import { encodeJsonString } from "../src/platform/Json";

const operatorIdentity: AccessIdentity = {
  subject: "did:example:operator",
  email: "operator@example.com",
  issuer: "https://access.example.com",
  audience: ["skygest-mcp"],
  scopes: ["ops:refresh"],
  payload: {
    sub: "did:example:operator",
    email: "operator@example.com",
    scope: "ops:refresh"
  }
};

const sampleSummary = {
  runId: "run-1",
  mode: "head" as const,
  startedAt: 1,
  finishedAt: 2,
  expertsTotal: 1,
  expertsSucceeded: 1,
  expertsFailed: 0,
  pagesFetched: 1,
  postsSeen: 1,
  postsStored: 1,
  postsDeleted: 0,
  failures: []
};

describe("ingest admin routes", () => {
  it.live("runs head polls through the coordinator", () =>
    Effect.promise(async () => {
      const requests: Array<unknown> = [];
      const layer = Layer.succeed(PollCoordinator, {
        run: (request) =>
          Effect.sync(() => {
            requests.push(request);
            return sampleSummary;
          })
      });

      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/poll", {
          method: "POST",
          body: encodeJsonString({})
        }),
        operatorIdentity,
        layer
      );
      const body = await response.json() as typeof sampleSummary;

      expect(response.status).toBe(200);
      expect(body).toEqual(sampleSummary);
      expect(requests).toEqual([{ mode: "head" }]);
    })
  );

  it.live("returns 409 when the poller lease is held", () =>
    Effect.promise(async () => {
      const layer = Layer.succeed(PollCoordinator, {
        run: () =>
          Effect.fail(
            PollerBusyError.make({
              lease: "expert-poller",
              message: "already running"
            })
          )
      });

      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/poll", {
          method: "POST",
          body: encodeJsonString({})
        }),
        operatorIdentity,
        layer
      );
      const body = await response.json() as { readonly error: string };

      expect(response.status).toBe(409);
      expect(body.error).toBe("PollerBusyError");
    })
  );

  it.live("validates backfill inputs", () =>
    Effect.promise(async () => {
      const layer = Layer.succeed(PollCoordinator, {
        run: () => Effect.succeed(sampleSummary)
      });

      const response = await handleIngestRequestWithLayer(
        new Request("https://skygest.local/admin/ingest/backfill", {
          method: "POST",
          body: encodeJsonString({ maxPosts: -1 })
        }),
        operatorIdentity,
        layer
      );
      const body = await response.json() as { readonly error: string };

      expect(response.status).toBe(400);
      expect(body.error).toContain("NonNegativeInt");
    })
  );
});
