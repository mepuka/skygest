import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  DbError,
  EnrichmentPayloadMissingError,
  EnrichmentSchemaDecodeError
} from "../src/domain/errors";
import { ResolverService } from "../src/resolver/ResolverService";
import { handleResolverRequestWithLayer } from "../src/resolver/Router";
import { encodeJsonString } from "../src/platform/Json";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri);
const makeKernelOutcome = (postUri: string) => ({
  _tag: "NoMatch" as const,
  bundle: {
    postUri: asPostUri(postUri),
    postText: ["Stored post text"],
    series: [],
    keyFindings: [],
    sourceLines: [],
    publisherHints: []
  },
  reason: "no checked-in registry match"
});

const resolveBulkSuccess = () =>
  Effect.succeed({
    results: {
      "at://did:plc:test/app.bsky.feed.post/post-1": {
        postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
        stage1: {
          matches: [],
          residuals: []
        },
        kernel: [
          makeKernelOutcome("at://did:plc:test/app.bsky.feed.post/post-1")
        ],
        resolverVersion: "resolution-kernel@sky-314",
        latencyMs: {
          stage1: 2,
          kernel: 1,
          total: 4
        }
      }
    },
    errors: {}
  });

const searchCandidatesSuccess = () =>
  Effect.succeed({
    bundles: []
  });

const expectJsonResponse = async <A>(
  response: Response,
  expectedStatus = 200
): Promise<A> => {
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`expected ${String(expectedStatus)} but received ${String(response.status)}: ${text}`);
  }

  return JSON.parse(text) as A;
};

const successLayer = Layer.succeed(ResolverService, {
  resolvePost: () =>
    Effect.succeed({
      postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
      stage1: {
        matches: [],
        residuals: []
      },
      kernel: [makeKernelOutcome("at://did:plc:test/app.bsky.feed.post/post-1")],
      resolverVersion: "resolution-kernel@sky-314",
      latencyMs: {
        stage1: 2,
        kernel: 1,
        total: 4
      }
    }),
  resolveBulk: () =>
    resolveBulkSuccess(),
  searchCandidates: () =>
    searchCandidatesSuccess()
});

describe("resolver router", () => {
  it("serves an unauthenticated health payload", async () => {
    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/health"),
      successLayer
    );

    const body = await expectJsonResponse<{ readonly status: string }>(response);
    expect(body.status).toBe("ok");
  });

  it("serves the single-post resolve endpoint", async () => {
    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/post", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
        })
      }),
      successLayer
    );

    const body = await expectJsonResponse<{
      readonly postUri: string;
    }>(response);
    expect(body.postUri).toBe("at://did:plc:test/app.bsky.feed.post/post-1");
  });

  it("serves the bulk resolve endpoint with keyed results", async () => {
    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/bulk", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          posts: [
            {
              postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
            }
          ]
        })
      }),
      successLayer
    );

    const body = await expectJsonResponse<{
      readonly results: Record<string, { readonly postUri: string }>;
      readonly errors: Record<string, unknown>;
    }>(response);
    expect(
      body.results["at://did:plc:test/app.bsky.feed.post/post-1"]?.postUri
    ).toBe("at://did:plc:test/app.bsky.feed.post/post-1");
    expect(body.errors).toEqual({});
  });

  it("serves the grouped search-candidates endpoint", async () => {
    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/search-candidates", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
        })
      }),
      successLayer
    );

    const body = await expectJsonResponse<{
      readonly bundles: ReadonlyArray<unknown>;
    }>(response);
    expect(body.bundles).toEqual([]);
  });

  it("maps decode errors to a 400 response", async () => {
    const layer = Layer.succeed(ResolverService, {
      resolvePost: () =>
        Effect.fail(
          new EnrichmentSchemaDecodeError({
            message: "invalid resolver input",
            operation: "ResolverService.resolvePost"
          })
        ),
      resolveBulk: () => resolveBulkSuccess(),
      searchCandidates: () => searchCandidatesSuccess()
    });

    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/post", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
        })
      }),
      layer
    );

    const body = await expectJsonResponse<{ readonly error: string }>(response, 400);
    expect(body.error).toBe("BadRequest");
  });

  it("maps missing post context to a 404 response", async () => {
    const layer = Layer.succeed(ResolverService, {
      resolvePost: () =>
        Effect.fail(
          new EnrichmentPayloadMissingError({
            postUri: asPostUri("at://did:plc:test/app.bsky.feed.post/post-1")
          })
        ),
      resolveBulk: () => resolveBulkSuccess(),
      searchCandidates: () => searchCandidatesSuccess()
    });

    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/post", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
        })
      }),
      layer
    );

    const body = await expectJsonResponse<{ readonly error: string }>(response, 404);
    expect(body.error).toBe("NotFound");
  });

  it("sanitizes unexpected resolver failures into a 500", async () => {
    const layer = Layer.succeed(ResolverService, {
      resolvePost: () =>
        Effect.fail(new DbError({
          message: "boom"
        })),
      resolveBulk: () => resolveBulkSuccess(),
      searchCandidates: () => searchCandidatesSuccess()
    });

    const response = await handleResolverRequestWithLayer(
      new Request("https://skygest.local/v1/resolve/post", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: encodeJsonString({
          postUri: "at://did:plc:test/app.bsky.feed.post/post-1"
        })
      }),
      layer
    );

    const body = await expectJsonResponse<{ readonly error: string; readonly message: string }>(
      response,
      500
    );
    expect(body.error).toBe("InternalServerError");
    expect(body.message).toBe("internal error");
  });
});
