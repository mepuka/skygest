import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { EnrichmentTriggerClient } from "../src/services/EnrichmentTriggerClient";

describe("EnrichmentTriggerClient", () => {
  it.effect("start returns queued response on success", () => {
    const mockFetcher = {
      fetch: async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            runId: "test-run-id",
            workflowInstanceId: "test-run-id",
            status: "queued"
          }),
          {
            status: 202,
            headers: { "content-type": "application/json" }
          }
        );
      }
    } as unknown as Fetcher;

    const layer = EnrichmentTriggerClient.layerFromFetcher(
      mockFetcher,
      "test-secret"
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client.start({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        enrichmentType: "source-attribution"
      });
      expect(result.status).toBe("queued");
      expect(result.runId).toBe("test-run-id");
    }).pipe(Effect.provide(layer));
  });

  it.effect("start fails with EnrichmentTriggerError on 409", () => {
    const mockFetcher = {
      fetch: async () => {
        return new Response(
          JSON.stringify({
            message: "enrichment run already exists"
          }),
          {
            status: 409,
            headers: { "content-type": "application/json" }
          }
        );
      }
    } as unknown as Fetcher;

    const layer = EnrichmentTriggerClient.layerFromFetcher(
      mockFetcher,
      "test-secret"
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client
        .start({
          postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
          enrichmentType: "vision"
        })
        .pipe(Effect.result);
      expect(result._tag).toBe("Err");
    }).pipe(Effect.provide(layer));
  });

  it.effect("start sends correct auth header and body", () => {
    let capturedRequest: Request | null = null;
    const mockFetcher = {
      fetch: async (input: RequestInfo | URL) => {
        capturedRequest = input as Request;
        return new Response(
          JSON.stringify({
            runId: "run-1",
            workflowInstanceId: "run-1",
            status: "queued"
          }),
          { status: 202, headers: { "content-type": "application/json" } }
        );
      }
    } as unknown as Fetcher;

    const layer = EnrichmentTriggerClient.layerFromFetcher(
      mockFetcher,
      "my-secret-123"
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      yield* client.start({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        enrichmentType: "vision"
      });
      expect(capturedRequest).not.toBeNull();
      expect(capturedRequest!.headers.get("authorization")).toBe(
        "Bearer my-secret-123"
      );
      const body = yield* Effect.promise(
        () => capturedRequest!.json() as Promise<Record<string, unknown>>
      );
      expect(body.postUri).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");
      expect(body.enrichmentType).toBe("vision");
      expect(body.schemaVersion).toBe("v2");
    }).pipe(Effect.provide(layer));
  });
});
