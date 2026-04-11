import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { ResolverClient, RESOLVER_REQUEST_ID_HEADER } from "../src/resolver/Client";
import { ResolverClientError } from "../src/domain/errors";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri);

describe("ResolverClient", () => {
  it.effect("forwards request correlation and decodes the resolver response", () => {
    let capturedRequest: Request | null = null;
    const mockFetcher = {
      fetch: async (input: RequestInfo | URL) => {
        capturedRequest = input as Request;
        return new Response(
          JSON.stringify({
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
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }
    } as unknown as Fetcher;

    const layer = ResolverClient.layerFromFetcher(
      mockFetcher,
      "resolver-secret"
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
      expect(capturedRequest).not.toBeNull();
      expect(
        capturedRequest!.headers.get(RESOLVER_REQUEST_ID_HEADER)
      ).toBe("req-123");
      expect(capturedRequest!.headers.get("authorization")).toBe(
        "Bearer resolver-secret"
      );

      const body = yield* Effect.promise(
        () => capturedRequest!.json() as Promise<Record<string, unknown>>
      );
      expect(body.postUri).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");
      expect(body.dispatchStage3).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.effect("decodes keyed bulk responses", () => {
    const mockFetcher = {
      fetch: async () =>
        new Response(
          JSON.stringify({
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
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
    } as unknown as Fetcher;

    const layer = ResolverClient.layerFromFetcher(
      mockFetcher,
      "resolver-secret"
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
    const mockFetcher = {
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: "BadRequest",
            message: "resolver said no"
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" }
          }
        )
    } as unknown as Fetcher;

    const layer = ResolverClient.layerFromFetcher(
      mockFetcher,
      "resolver-secret"
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

  it.effect("treats malformed JSON success bodies as client errors", () => {
    const mockFetcher = {
      fetch: async () =>
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    } as unknown as Fetcher;

    const layer = ResolverClient.layerFromFetcher(
      mockFetcher,
      "resolver-secret"
    );

    return Effect.gen(function* () {
      const client = yield* ResolverClient;
      const error = yield* client.resolvePost({
        postUri: asPostUri("at://did:plc:abc/app.bsky.feed.post/xyz")
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ResolverClientError);
      expect(error.message).toContain("Expected");
    }).pipe(Effect.provide(layer));
  });
});
