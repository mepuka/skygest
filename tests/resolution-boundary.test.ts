import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { chartAssetIdFromBluesky } from "../src/domain/data-layer/post-ids";
import {
  ResolveBulkRequest,
  ResolveBulkResponse,
  ResolvePostRequest,
  ResolvePostResponse
} from "../src/domain/resolution";
import { PostUri } from "../src/domain/types";

const asPostUri = Schema.decodeUnknownSync(PostUri);
const decodeResolvePostRequest = Schema.decodeUnknownSync(ResolvePostRequest);
const decodeResolveBulkRequest = Schema.decodeUnknownSync(ResolveBulkRequest);
const decodeResolvePostResponse = Schema.decodeUnknownSync(ResolvePostResponse);
const decodeResolveBulkResponse = Schema.decodeUnknownSync(ResolveBulkResponse);
const encodeResolvePostResponse = Schema.encodeSync(ResolvePostResponse);
const encodeResolveBulkResponse = Schema.encodeSync(ResolveBulkResponse);

const postUri = asPostUri(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary"
);
const secondPostUri = asPostUri(
  "at://did:plc:test/app.bsky.feed.post/resolution-boundary-2"
);

const resolvedAssetBundle = {
  assetKey: chartAssetIdFromBluesky(postUri, "bafkreiresolutionboundary"),
  resolution: {
    agents: [
      {
        entityId: "https://id.skygest.io/agent/ag_1234567890AB" as any,
        signal: {
          kind: "source-attribution-provider-label" as const,
          field: "sourceAttribution.provider.providerLabel",
          value: "Example Provider"
        },
        score: null,
        scoped: false,
        matchKind: "exact-hostname" as const
      }
    ],
    datasets: [
      {
        entityId: "https://id.skygest.io/dataset/ds_1234567890AB" as any,
        signal: {
          kind: "source-line-dataset-name" as const,
          field: "asset.analysis.sourceLines[].datasetName",
          value: "Example Dataset"
        },
        score: 0.91,
        scoped: true,
        matchKind: "lexical" as const
      }
    ],
    series: [],
    variables: [],
    trail: []
  }
};

describe("resolution boundary schemas", () => {
  it("decodes single-post requests", () => {
    const request = decodeResolvePostRequest({
      postUri
    });

    expect(request.postUri).toBe(postUri);
  });

  it("rejects empty bulk requests", () => {
    expect(() =>
      decodeResolveBulkRequest({
        posts: []
      })
    ).toThrow();
  });

  it("encodes and decodes resolver responses carrying asset-keyed resolution bundles", () => {
    const response = decodeResolvePostResponse({
      postUri,
      stage1: {
        matches: [],
        residuals: []
      },
      resolution: [resolvedAssetBundle],
      resolverVersion: "bundle-resolution@sky-367",
      latencyMs: {
        stage1: 1,
        resolution: 1,
        total: 2
      }
    });

    const encoded = encodeResolvePostResponse(response);
    const roundTripped = decodeResolvePostResponse(encoded);

    expect(roundTripped.resolution).toHaveLength(1);
    expect(roundTripped.resolution[0]?.assetKey).toBe(resolvedAssetBundle.assetKey);
    expect(roundTripped.resolution[0]?.resolution.agents[0]?.entityId).toBe(
      "https://id.skygest.io/agent/ag_1234567890AB"
    );
  });

  it("encodes and decodes bulk resolver responses with keyed errors", () => {
    const response = decodeResolveBulkResponse({
      results: {
        [postUri]: {
          postUri,
          stage1: {
            matches: [],
            residuals: []
          },
          resolution: [resolvedAssetBundle],
          resolverVersion: "bundle-resolution@sky-367",
          latencyMs: {
            stage1: 1,
            resolution: 1,
            total: 2
          }
        }
      },
      errors: {
        [secondPostUri]: {
          tag: "ResolverSourceAttributionMissingError",
          message: "missing source attribution",
          retryable: false
        }
      }
    });

    const encoded = encodeResolveBulkResponse(response);
    const roundTripped = decodeResolveBulkResponse(encoded);

    expect(roundTripped.results[postUri]?.resolution[0]?.assetKey).toBe(
      resolvedAssetBundle.assetKey
    );
    expect(roundTripped.errors[secondPostUri]?.tag).toBe(
      "ResolverSourceAttributionMissingError"
    );
  });
});
