import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { PostUri } from "../src/domain/types";
import { EnrichmentTriggerClient } from "../src/services/EnrichmentTriggerClient";

const asPostUri = Schema.decodeUnknownSync(PostUri);

describe("EnrichmentTriggerClient", () => {
  it.effect("start returns queued response on success", () => {
    const mockBinding = {
      startEnrichment: async () => ({
        ok: true as const,
        value: {
            runId: "test-run-id",
            workflowInstanceId: "test-run-id",
            status: "queued"
        }
      })
    };

    const layer = EnrichmentTriggerClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client.start({
        postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz"),
        enrichmentType: "source-attribution"
      });
      expect(result.status).toBe("queued");
      expect(result.runId).toBe("test-run-id");
    }).pipe(Effect.provide(layer));
  });

  it.effect("start fails with EnrichmentTriggerError on 409", () => {
    const mockBinding = {
      startEnrichment: async () => ({
        ok: false as const,
        error: {
          message: "enrichment run already exists",
          status: 409,
          postUri: "at://did:plc:abc/app.bsky.feed.post/xyz"
        }
      })
    };

    const layer = EnrichmentTriggerClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      const result = yield* client
        .start({
          postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz"),
          enrichmentType: "vision"
        })
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(layer));
  });

  it.effect("start sends the normalized RPC payload", () => {
    let capturedInput: Record<string, unknown> | null = null;
    const mockBinding = {
      startEnrichment: async (input: Record<string, unknown>) => {
        capturedInput = input;
        return {
          ok: true as const,
          value: {
            runId: "run-1",
            workflowInstanceId: "run-1",
            status: "queued"
          }
        };
      }
    };

    const layer = EnrichmentTriggerClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* EnrichmentTriggerClient;
      yield* client.start({
        postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz"),
        enrichmentType: "vision",
        requestedBy: "operator@example.com"
      });
      expect(capturedInput).toEqual({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        enrichmentType: "vision",
        schemaVersion: "v2",
        requestedBy: "operator@example.com"
      });
    }).pipe(Effect.provide(layer));
  });
});
