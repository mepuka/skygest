import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { ResolverClient, RESOLVER_REQUEST_ID_HEADER } from "../src/resolver/Client";
import { ResolverClientError } from "../src/domain/errors";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri);

describe("ResolverClient", () => {
  it.effect("forwards request correlation and decodes the resolver response", () => {
    let capturedInput: Record<string, unknown> | null = null;
    let capturedOptions: Record<string, unknown> | undefined;
    const mockBinding = {
      resolvePost: async (
        input: Record<string, unknown>,
        options?: Record<string, unknown>
      ) => {
        capturedInput = input;
        capturedOptions = options;
        return {
          ok: true as const,
          value: {
            postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
            stage1: {
              matches: [],
              residuals: []
            },
            resolverVersion: "stage1-resolver@sky-238",
            latencyMs: {
              stage1: 2,
              total: 3
            }
          }
        };
      }
    };

    const layer = ResolverClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* ResolverClient;
      const result = yield* client.resolvePost(
        {
          postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz"),
          dispatchStage3: false
        },
        {
          requestId: "req-123"
        }
      );

      expect(result.resolverVersion).toBe("stage1-resolver@sky-238");
      expect(result.stage1.matches).toEqual([]);
      expect(result.stage3).toBeUndefined();
      expect(capturedOptions).toEqual({
        requestId: "req-123",
        [RESOLVER_REQUEST_ID_HEADER]: "req-123"
      });
      expect(capturedInput).toEqual({
        postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
        dispatchStage3: false
      });
    }).pipe(Effect.provide(layer));
  });

  it.effect("decodes keyed bulk responses", () => {
    const mockBinding = {
      resolveBulk: async () => ({
        ok: true as const,
        value: {
          results: {
            "at://did:plc:abc/app.bsky.feed.post/xyz": {
              postUri: "at://did:plc:abc/app.bsky.feed.post/xyz",
              stage1: {
                matches: [],
                residuals: []
              },
              resolverVersion: "stage1-resolver@sky-238",
              latencyMs: {
                stage1: 2,
                total: 3
              }
            }
          },
          errors: {
            "at://did:plc:def/app.bsky.feed.post/uvw": {
              tag: "EnrichmentSchemaDecodeError",
              message: "invalid input",
              retryable: false
            }
          }
        }
      })
    };

    const layer = ResolverClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* ResolverClient;
      const successKey = asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz");
      const errorKey = asPostUri("at://did:plc:def/app.bsky.feed.post/uvw");
      const result = yield* client.resolveBulk({
        posts: [
          {
            postUri: successKey
          },
          {
            postUri: errorKey
          }
        ]
      });

      expect(result.results[successKey]?.postUri).toBe(successKey);
      expect(result.errors[errorKey]?.tag).toBe("EnrichmentSchemaDecodeError");
    }).pipe(Effect.provide(layer));
  });

  it.effect("surfaces upstream resolver errors as ResolverClientError", () => {
    const mockBinding = {
      resolvePost: async () => ({
        ok: false as const,
        error: {
          message: "resolver said no",
          status: 400,
          operation: "ResolverEntrypoint.resolvePost"
        }
      })
    };

    const layer = ResolverClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* ResolverClient;
      const error = yield* client.resolvePost({
        postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz")
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ResolverClientError);
      expect(error.status).toBe(400);
      expect(error.message).toContain("resolver said no");
    }).pipe(Effect.provide(layer));
  });

  it.effect("treats malformed RPC success bodies as client errors", () => {
    const mockBinding = {
      resolvePost: async () => ({
        ok: true as const,
        value: {
          nope: "not-a-resolver-response"
        }
      })
    };

    const layer = ResolverClient.layerFromBinding(
      mockBinding as never
    );

    return Effect.gen(function* () {
      const client = yield* ResolverClient;
      const error = yield* client.resolvePost({
        postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz")
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ResolverClientError);
      expect(error.message).toContain("postUri");
    }).pipe(Effect.provide(layer));
  });
});
