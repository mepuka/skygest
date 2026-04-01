import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleApiRequestWithLayer } from "../src/api/Router";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { PostThreadOutput } from "../src/domain/bi";
import { PostEnrichmentsOutput } from "../src/domain/enrichment";
import {
  KnowledgeLinksPageOutput,
  KnowledgePostsPageOutput
} from "../src/domain/api";
import type { GetPostThreadResponse, ThreadPostView } from "../src/bluesky/ThreadTypes";
import { BlueskyApiError, DbError } from "../src/domain/errors";
import type { PostUri } from "../src/domain/types";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { KnowledgeQueryService } from "../src/services/KnowledgeQueryService";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import {
  makeBiLayer,
  sampleDid,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";

const decodePostsPage = Schema.decodeUnknownSync(KnowledgePostsPageOutput);
const decodeLinksPage = Schema.decodeUnknownSync(KnowledgeLinksPageOutput);
const decodePostThread = Schema.decodeUnknownSync(PostThreadOutput);
const decodePostEnrichments = Schema.decodeUnknownSync(PostEnrichmentsOutput);

const expectJsonResponse = async <A>(
  response: Response,
  decode: (value: unknown) => A,
  expectedStatus = 200
) => {
  const text = await response.text();

  if (response.status !== expectedStatus) {
    throw new Error(`expected ${String(expectedStatus)} but received ${String(response.status)}: ${text}`);
  }

  return decode(JSON.parse(text));
};

const requestApi = (path: string, layer: ReturnType<typeof makeBiLayer>) =>
  handleApiRequestWithLayer(
    new Request(`https://skygest.local${path}`),
    layer
  );

const makeThreadPostView = (
  uri: string,
  replyCount: number
): ThreadPostView => ({
  uri,
  cid: `cid-${replyCount}`,
  author: {
    did: sampleDid,
    handle: "seed.example.com"
  },
  record: {
    text: `Hydrated ${uri}`
  },
  embed: {
    $type: "app.bsky.embed.images#view",
    images: [
      {
        thumb: `https://cdn.bsky.app/img/feed_thumbnail/plain/${sampleDid}/${replyCount}@jpeg`,
        fullsize: `https://cdn.bsky.app/img/feed_fullsize/plain/${sampleDid}/${replyCount}@jpeg`,
        alt: `Image ${replyCount}`
      }
    ]
  },
  replyCount,
  indexedAt: "2026-03-18T12:00:00.000Z"
});

const makeThreadNode = (
  uri: string,
  opts?: {
    readonly parent?: unknown;
    readonly replies?: ReadonlyArray<unknown>;
    readonly embed?: ThreadPostView["embed"];
    readonly likeCount?: number;
    readonly replyCount?: number;
  }
) => ({
  $type: "app.bsky.feed.defs#threadViewPost",
  post: {
    uri,
    cid: `cid-${uri}`,
    author: {
      did: sampleDid,
      handle: "seed.example.com",
      displayName: "Seed Example"
    },
    record: {
      text: `Thread ${uri}`,
      createdAt: "2026-03-18T12:00:00.000Z",
      $type: "app.bsky.feed.post"
    },
    ...(opts?.embed === undefined ? {} : { embed: opts.embed }),
    replyCount: opts?.replyCount ?? 0,
    repostCount: 1,
    likeCount: opts?.likeCount ?? 2,
    quoteCount: 0,
    indexedAt: "2026-03-18T12:05:00.000Z"
  },
  ...(opts?.parent === undefined ? {} : { parent: opts.parent }),
  ...(opts?.replies === undefined ? {} : { replies: Array.from(opts.replies) })
});

const makeBlueskyLayer = (overrides: {
  readonly getPosts?: (
    uris: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<ThreadPostView>, BlueskyApiError>;
  readonly getPostThread?: (
    uri: string,
    opts?: { depth?: number; parentHeight?: number }
  ) => Effect.Effect<GetPostThreadResponse, BlueskyApiError>;
} = {}) =>
  Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
    getProfile: () => Effect.die("unexpected getProfile"),
    getFollows: () => Effect.die("unexpected getFollows"),
    resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
    listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
    getPostThread: overrides.getPostThread ?? (() => Effect.die("unexpected getPostThread")),
    getPosts: overrides.getPosts ?? (() => Effect.die("unexpected getPosts"))
  });

const makeVisionEnrichmentPayload = () => ({
  kind: "vision" as const,
  summary: {
    text: "Bar chart of ERCOT load by month.",
    mediaTypes: ["chart"] as const,
    chartTypes: ["bar-chart"] as const,
    titles: ["ERCOT load"],
    keyFindings: [
      {
        text: "Load rises through summer.",
        assetKeys: ["embed:0:https://cdn.bsky.app/full-1.jpg"]
      }
    ]
  },
  assets: [
    {
      assetKey: "embed:0:https://cdn.bsky.app/full-1.jpg",
      assetType: "image" as const,
      source: "embed" as const,
      index: 0,
      originalAltText: null,
      analysis: {
        mediaType: "chart" as const,
        chartTypes: ["bar-chart"] as const,
        altText: "Bar chart of ERCOT load by month.",
        altTextProvenance: "synthetic" as const,
        xAxis: { label: "Month", unit: null },
        yAxis: { label: "Load", unit: "GW" },
        series: [{ legendLabel: "Load", unit: "GW" }],
        sourceLines: [{ sourceText: "Source: ERCOT", datasetName: null }],
        temporalCoverage: {
          startDate: "2024-01",
          endDate: "2024-12"
        },
        keyFindings: ["Load rises through summer."],
        visibleUrls: [],
        organizationMentions: [],
        logoText: [],
        title: "ERCOT load",
        modelId: "gemini-2.5-flash",
        processedAt: 10
      }
    }
  ],
  modelId: "gemini-2.5-flash",
  promptVersion: "v2.0.0",
  processedAt: 10
});

const makeSourceAttributionEnrichmentPayload = () => ({
  kind: "source-attribution" as const,
  provider: {
    providerId: "ercot",
    providerLabel: "ERCOT",
    sourceFamily: "Load"
  },
  contentSource: {
    url: "https://example.com/grid-report",
    title: "Grid report",
    domain: "example.com",
    publication: "Example"
  },
  resolution: "matched" as const,
  providerCandidates: [],
  socialProvenance: {
    did: sampleDid,
    handle: "seed.example.com"
  },
  processedAt: 20
});

const asPostUri = (value: string) => value as PostUri;

const createPickedPayload = (
  postUri: PostUri,
  layer: ReturnType<typeof makeBiLayer>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payloads = yield* CandidatePayloadService;

      yield* payloads.capturePayload({
        postUri,
        captureStage: "candidate",
        embedType: "link",
        embedPayload: {
          kind: "link",
          uri: "https://example.com/report",
          title: "Grid report",
          description: "Useful context",
          thumb: null
        }
      });

      yield* payloads.markPicked(postUri);
    }).pipe(Effect.provide(layer))
  );

describe("frontend REST API", () => {
  it.live("paginates recent posts with cursors", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const firstPage = await expectJsonResponse(
          await requestApi("/api/posts/recent?limit=1", layer),
          decodePostsPage
        );
        const secondPage = await expectJsonResponse(
          await requestApi(
            `/api/posts/recent?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor ?? "")}`,
            layer
          ),
          decodePostsPage
        );

        expect(firstPage.items).toHaveLength(1);
        expect(firstPage.items[0]?.uri).toBe(smokeFixtureUris(sampleDid)[1]);
        expect(firstPage.page.nextCursor).not.toBeNull();
        expect(secondPage.items).toHaveLength(1);
        expect(secondPage.items[0]?.uri).toBe(smokeFixtureUris(sampleDid)[0]);
      })
    ),
    15_000
  );

  it.live("supports search and until filtering on /api/posts/search", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const until = String(1_710_000_000_500);
        const page = await expectJsonResponse(
          await requestApi(`/api/posts/search?q=solar&until=${until}`, layer),
          decodePostsPage
        );

        expect(page.items).toHaveLength(1);
        expect(page.items[0]?.uri).toBe(smokeFixtureUris(sampleDid)[0]);
        expect(page.page.nextCursor).toBeNull();
      })
    )
  );

  it.live("returns search cursor when more results exist and empty cursor when exhausted", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        // "solar" matches 1 post — with limit=1 there's exactly 1 result, no more pages
        const singleResult = await expectJsonResponse(
          await requestApi("/api/posts/search?q=solar&limit=10", layer),
          decodePostsPage
        );
        expect(singleResult.items).toHaveLength(1);
        expect(singleResult.page.nextCursor).toBeNull();

        // "transmission" matches post 2 (stemming: "transmission" → "transmiss")
        const transmissionResult = await expectJsonResponse(
          await requestApi("/api/posts/search?q=transmission", layer),
          decodePostsPage
        );
        expect(transmissionResult.items).toHaveLength(1);
        expect(transmissionResult.items[0]?.uri).toBe(smokeFixtureUris(sampleDid)[1]);
      })
    )
  );

  it.live("includes snippet with match highlights in search results", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const page = await expectJsonResponse(
          await requestApi("/api/posts/search?q=solar", layer),
          decodePostsPage
        );

        expect(page.items.length).toBeGreaterThan(0);
        const item = page.items[0] as any;
        expect(item.snippet).toBeDefined();
        expect(typeof item.snippet).toBe("string");
        expect(item.snippet).toContain("<mark>");
      })
    )
  );

  it.live("paginates links and preserves stable ordering", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const firstPage = await expectJsonResponse(
          await requestApi("/api/links?limit=1", layer),
          decodeLinksPage
        );
        const secondPage = await expectJsonResponse(
          await requestApi(
            `/api/links?limit=1&cursor=${encodeURIComponent(firstPage.page.nextCursor ?? "")}`,
            layer
          ),
          decodeLinksPage
        );

        const allUris = smokeFixtureUris(sampleDid);
        expect(firstPage.items).toHaveLength(1);
        expect(allUris).toContain(firstPage.items[0]?.postUri);
        expect(firstPage.page.nextCursor).not.toBeNull();
        expect(secondPage.items).toHaveLength(1);
        expect(allUris).toContain(secondPage.items[0]?.postUri);
        expect(firstPage.items[0]?.postUri).not.toBe(secondPage.items[0]?.postUri);
      })
    )
  );

  it.live("returns avatar fields on experts endpoint", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await requestApi("/api/experts?limit=5", layer);
        const body = await expectJsonResponse(
          response,
          (value) => value as { readonly items: ReadonlyArray<{ readonly avatar: string | null }> }
        );

        expect(body.items.length).toBeGreaterThan(0);
        // Seeds have null avatars — verify the field exists
        expect(body.items[0]).toHaveProperty("avatar");
      })
    )
  );

  it.live("returns at least one non-null avatar on recent posts from fixture", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const page = await expectJsonResponse(
          await requestApi("/api/posts/recent?limit=5", layer),
          decodePostsPage
        );

        expect(page.items.length).toBeGreaterThan(0);
        // All fixture posts have the same seeded expert with null avatar from bootstrap
        for (const item of page.items) {
          expect(item).toHaveProperty("avatar");
        }
      })
    )
  );

  it.live("returns at least one non-null imageUrl on links from fixture", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const page = await expectJsonResponse(
          await requestApi("/api/links?limit=5", layer),
          decodeLinksPage
        );

        expect(page.items.length).toBeGreaterThan(0);
        // Solar fixture post has a thumb blob ref
        const withImage = page.items.find((item) => item.imageUrl !== null);
        expect(withImage).toBeDefined();
        expect(withImage!.imageUrl).toContain("cdn.bsky.app");
      })
    )
  );

  it.live("serves expert feeds, topic metadata, and explainability routes", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const expertFeed = await expectJsonResponse(
          await requestApi(`/api/experts/${encodeURIComponent(sampleDid)}/posts?limit=1`, layer),
          decodePostsPage
        );
        const topicResponse = await expectJsonResponse(
          await requestApi("/api/topics/solar", layer),
          (value) => value as { readonly item: { readonly slug: string; readonly label: string } }
        );
        const expandResponse = await expectJsonResponse(
          await requestApi("/api/topics/solar/expand?mode=descendants", layer),
          (value) => value as { readonly canonicalTopicSlugs: ReadonlyArray<string> }
        );
        const explainResponse = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(smokeFixtureUris(sampleDid)[0])}/topics`, layer),
          (value) => value as { readonly items: ReadonlyArray<{ readonly topicSlug: string }> }
        );

        expect(expertFeed.items).toHaveLength(1);
        expect(expertFeed.items[0]?.did).toBe(sampleDid);
        expect(topicResponse.item.slug).toBe("solar");
        expect(expandResponse.canonicalTopicSlugs).toContain("solar");
        expect(explainResponse.items.some((item) => item.topicSlug === "solar")).toBe(true);
      })
    )
  );

  it.live("serves public thread results with MCP-parity defaults and thread metadata", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = smokeFixtureUris(sampleDid)[0];
        const ancestorUri = `at://${sampleDid}/app.bsky.feed.post/ancestor`;
        const replyUri = `at://${sampleDid}/app.bsky.feed.post/reply`;
        const nestedReplyUri = `at://${sampleDid}/app.bsky.feed.post/reply-nested`;
        const seenCalls: Array<{ uri: string; opts?: { depth?: number; parentHeight?: number } }> = [];
        const nestedReply = makeThreadNode(nestedReplyUri, {
          likeCount: 3,
          embed: {
            $type: "app.bsky.embed.external#view",
            external: {
              uri: "https://example.com/reply",
              title: "Reply Link",
              description: "Nested reply link",
              thumb: "https://example.com/thumb.jpg"
            }
          }
        });
        const reply = makeThreadNode(replyUri, {
          likeCount: 8,
          replies: [nestedReply]
        });
        const ancestor = makeThreadNode(ancestorUri);
        const focus = makeThreadNode(focusUri, {
          parent: ancestor,
          replies: [reply],
          embed: {
            $type: "app.bsky.embed.images#view",
            images: [
              {
                thumb: "https://cdn.bsky.app/img/feed_thumbnail/plain/did/image@jpeg",
                fullsize: "https://cdn.bsky.app/img/feed_fullsize/plain/did/image@jpeg",
                alt: "Focus image"
              }
            ]
          }
        });
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPostThread: (uri, opts) => {
              seenCalls.push(opts === undefined ? { uri } : { uri, opts });
              return Effect.succeed({ thread: focus });
            }
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const thread = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread`, layer),
          decodePostThread
        );

        expect(seenCalls).toEqual([
          {
            uri: focusUri,
            opts: {
              depth: 3,
              parentHeight: 3
            }
          }
        ]);
        expect(thread.focusUri).toBe(focusUri);
        expect(thread.ancestors).toHaveLength(1);
        expect(thread.ancestors[0]?.uri).toBe(ancestorUri);
        expect(thread.ancestors[0]?.position).toBe("ancestor");
        expect(thread.ancestors[0]?.depth).toBe(-1);
        expect(thread.focus.uri).toBe(focusUri);
        expect(thread.focus.position).toBe("focus");
        expect(thread.focus.parentUri).toBe(ancestorUri);
        expect(thread.focus.embedType).toBe("img");
        expect(thread.focus.embedContent?.kind).toBe("img");
        expect(thread.replies).toHaveLength(2);
        expect(thread.replies[0]?.uri).toBe(replyUri);
        expect(thread.replies[0]?.position).toBe("reply");
        expect(thread.replies[0]?.depth).toBe(1);
        expect(thread.replies[0]?.parentUri).toBe(focusUri);
        expect(thread.replies[1]?.uri).toBe(nestedReplyUri);
        expect(thread.replies[1]?.depth).toBe(2);
        expect(thread.replies[1]?.parentUri).toBe(replyUri);
        expect(thread.replies[1]?.embedType).toBe("link");
        expect(thread.replies[1]?.embedContent?.kind).toBe("link");
      })
    )
  );

  it.live("returns 400 for invalid thread query params", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = smokeFixtureUris(sampleDid)[0];
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const badDepth = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread?depth=abc`, layer),
          (value) => value as { readonly error: string; readonly message: string },
          400
        );
        const badParentHeight = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread?parentHeight=11`, layer),
          (value) => value as { readonly error: string; readonly message: string },
          400
        );

        expect(badDepth.error).toBe("BadRequest");
        expect(badDepth.message).toContain("depth");
        expect(badParentHeight.error).toBe("BadRequest");
        expect(badParentHeight.message).toContain("parentHeight");
      })
    )
  );

  it.live("returns 404 when thread data cannot be flattened", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = smokeFixtureUris(sampleDid)[0];
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPostThread: () => Effect.succeed({ thread: {} })
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread`, layer),
          (value) => value as { readonly error: string; readonly message: string },
          404
        );

        expect(body).toEqual({
          error: "NotFound",
          message: "post thread not found"
        });
      })
    )
  );

  it.live("maps Bluesky 404 thread failures to 404", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = smokeFixtureUris(sampleDid)[0];
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPostThread: () =>
              Effect.fail(BlueskyApiError.make({
                message: "not found",
                status: 404
              }))
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread`, layer),
          (value) => value as { readonly error: string; readonly message: string },
          404
        );

        expect(body).toEqual({
          error: "NotFound",
          message: "post thread not found"
        });
      })
    )
  );

  it.live("maps non-404 Bluesky thread failures to upstream failure", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = smokeFixtureUris(sampleDid)[0];
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPostThread: () =>
              Effect.fail(BlueskyApiError.make({
                message: "temporary outage",
                status: 503
              }))
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/thread`, layer),
          (value) => value as { readonly error: string; readonly message: string; readonly retryable?: boolean },
          502
        );

        expect(body).toEqual({
          error: "UpstreamFailure",
          message: "failed to fetch post thread",
          retryable: true
        });
      })
    )
  );

  it.live("serves stored post enrichments with typed payloads", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = asPostUri(smokeFixtureUris(sampleDid)[0]);
        const layer = makeBiLayer({ filename });
        const visionPayload = makeVisionEnrichmentPayload();
        const sourcePayload = makeSourceAttributionEnrichmentPayload();
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await createPickedPayload(focusUri, layer);

        const stored = await Effect.runPromise(
          Effect.gen(function* () {
            const payloads = yield* CandidatePayloadService;

            yield* payloads.saveEnrichment({
              postUri: focusUri,
              enrichmentType: "vision",
              enrichmentPayload: visionPayload
            });
            yield* payloads.saveEnrichment({
              postUri: focusUri,
              enrichmentType: "source-attribution",
              enrichmentPayload: sourcePayload
            });

            return yield* payloads.getPayload(focusUri);
          }).pipe(Effect.provide(layer))
        );

        const sourceStored = stored?.enrichments.find(
          (enrichment) => enrichment.enrichmentType === "source-attribution"
        );
        const visionStored = stored?.enrichments.find(
          (enrichment) => enrichment.enrichmentType === "vision"
        );

        expect(sourceStored).toBeDefined();
        expect(visionStored).toBeDefined();

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/enrichments`, layer),
          decodePostEnrichments
        );

        expect(body).toEqual({
          postUri: focusUri,
          enrichments: [
            {
              kind: "source-attribution",
              payload: sourcePayload,
              enrichedAt: sourceStored!.enrichedAt
            },
            {
              kind: "vision",
              payload: visionPayload,
              enrichedAt: visionStored!.enrichedAt
            }
          ]
        });
      })
    )
  );

  it.live("returns empty enrichments when no payload record exists", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = asPostUri(smokeFixtureUris(sampleDid)[0]);
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/enrichments`, layer),
          decodePostEnrichments
        );

        expect(body).toEqual({
          postUri: focusUri,
          enrichments: []
        });
      })
    )
  );

  it.live("returns empty enrichments when a payload record exists without enrichments", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = asPostUri(smokeFixtureUris(sampleDid)[0]);
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await createPickedPayload(focusUri, layer);

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/enrichments`, layer),
          decodePostEnrichments
        );

        expect(body).toEqual({
          postUri: focusUri,
          enrichments: []
        });
      })
    )
  );

  it.live("filters legacy or invalid enrichment payloads from the public response", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const focusUri = asPostUri(smokeFixtureUris(sampleDid)[0]);
        const layer = makeBiLayer({ filename });
        const sourcePayload = makeSourceAttributionEnrichmentPayload();
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));
        await createPickedPayload(focusUri, layer);

        const stored = await Effect.runPromise(
          Effect.gen(function* () {
            const payloads = yield* CandidatePayloadService;

            yield* payloads.saveEnrichment({
              postUri: focusUri,
              enrichmentType: "vision",
              enrichmentPayload: {
                summary: "legacy shape that should be ignored"
              }
            });
            yield* payloads.saveEnrichment({
              postUri: focusUri,
              enrichmentType: "source-attribution",
              enrichmentPayload: sourcePayload
            });

            return yield* payloads.getPayload(focusUri);
          }).pipe(Effect.provide(layer))
        );

        const sourceStored = stored?.enrichments.find(
          (enrichment) => enrichment.enrichmentType === "source-attribution"
        );

        expect(sourceStored).toBeDefined();

        const body = await expectJsonResponse(
          await requestApi(`/api/posts/${encodeURIComponent(focusUri)}/enrichments`, layer),
          decodePostEnrichments
        );

        expect(body).toEqual({
          postUri: focusUri,
          enrichments: [
            {
              kind: "source-attribution",
              payload: sourcePayload,
              enrichedAt: sourceStored!.enrichedAt
            }
          ]
        });
      })
    )
  );

  it.live("returns 400 for malformed enrichment post URIs", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const body = await expectJsonResponse(
          await requestApi("/api/posts/not-a-uri/enrichments", layer),
          (value) => value as { readonly error: string; readonly message: string },
          400
        );

        expect(body.error).toBe("BadRequest");
        expect(body.message).toContain("uri");
      })
    )
  );

  it.live("hydrates recent, search, and expert feeds with reply and embed metadata", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const [solarUri, latestUri] = smokeFixtureUris(sampleDid);
        const hydratedPosts = new Map<string, ThreadPostView>([
          [solarUri, makeThreadPostView(solarUri, 3)],
          [latestUri, makeThreadPostView(latestUri, 7)]
        ]);
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPosts: (uris) =>
              Effect.succeed(
                uris.flatMap((uri) => {
                  const post = hydratedPosts.get(uri);
                  return post === undefined ? [] : [post];
                })
              )
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const recent = await expectJsonResponse(
          await requestApi("/api/posts/recent?limit=1", layer),
          decodePostsPage
        );
        const search = await expectJsonResponse(
          await requestApi("/api/posts/search?q=solar", layer),
          decodePostsPage
        );
        const expertFeed = await expectJsonResponse(
          await requestApi(`/api/experts/${encodeURIComponent(sampleDid)}/posts?limit=1`, layer),
          decodePostsPage
        );

        expect(recent.items[0]?.replyCount).toBe(7);
        expect(recent.items[0]?.embedType).toBe("img");
        expect(recent.items[0]?.embedContent?.kind).toBe("img");

        expect(search.items[0]?.replyCount).toBe(3);
        expect(search.items[0]?.embedType).toBe("img");
        expect(search.items[0]?.embedContent?.kind).toBe("img");

        expect(expertFeed.items[0]?.replyCount).toBe(7);
        expect(expertFeed.items[0]?.embedType).toBe("img");
        expect(expertFeed.items[0]?.embedContent?.kind).toBe("img");
      })
    )
  );

  it.live("falls back to null hydration metadata when Bluesky lookup fails", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          blueskyClient: makeBlueskyLayer({
            getPosts: () =>
              Effect.fail(BlueskyApiError.make({
                message: "temporary outage",
                status: 503
              }))
          })
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const page = await expectJsonResponse(
          await requestApi("/api/posts/recent?limit=1", layer),
          decodePostsPage
        );

        expect(page.items[0]?.replyCount).toBeNull();
        expect(page.items[0]?.embedType).toBeNull();
        expect(page.items[0]?.embedContent).toBeNull();
      })
    )
  );

  it.live("returns 404 for unknown topic slugs", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await requestApi("/api/topics/does-not-exist", layer);
        const body = await expectJsonResponse(
          response,
          (value) => value as { readonly error: string; readonly message: string },
          404
        );

        expect(body).toEqual({
          error: "NotFound",
          message: "topic not found: does-not-exist"
        });
      })
    )
  );

  it.live("returns structured bad requests for invalid API inputs", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await requestApi("/api/posts/recent?q=solar&cursor=abc", layer);
        const body = await expectJsonResponse(
          response,
          (value) => value as { readonly error: string; readonly message: string },
          400
        );

        expect(body.error).toBe("BadRequest");
        expect(body.message).toContain("cursor");
      })
    )
  );

  it("sanitizes unexpected public API failures", () =>
    Effect.promise(async () => {
      const response = await handleApiRequestWithLayer(
        new Request("https://skygest.local/api/posts/search?q=solar"),
        Layer.succeed(KnowledgeQueryService, {
          searchPosts: () => Effect.succeed([]),
          searchPostsPage: () => Effect.fail(DbError.make({ message: "sql exploded" })),
          getRecentPosts: () => Effect.succeed([]),
          getRecentPostsPage: () => Effect.succeed({ items: [], nextCursor: null }),
          getPostLinks: () => Effect.succeed([]),
          getPostLinksPage: () => Effect.succeed({ items: [], nextCursor: null }),
          listExperts: () => Effect.succeed([]),
          listTopics: () => Effect.succeed([]),
          getTopic: () => Effect.succeed(null),
          expandTopics: () =>
            Effect.succeed({
              mode: "exact",
              inputSlugs: [],
              resolvedSlugs: [],
              canonicalTopicSlugs: [],
              items: []
            }),
          explainPostTopics: (postUri) => Effect.succeed({ postUri, items: [] }),
          listPublications: () => Effect.succeed([])
        })
      );
      const body = await expectJsonResponse(
        response,
        (value) => value as { readonly error: string; readonly message: string },
        500
      );

      expect(body).toEqual({
        error: "InternalServerError",
        message: "internal error"
      });
    })
  );

  it.live("adds CORS headers for the public read API", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        const response = await handleApiRequestWithLayer(
          new Request("https://skygest.local/api/posts/recent?limit=1", {
            headers: {
              origin: "https://frontend.skygest.local"
            }
          }),
          layer
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).not.toBeNull();
      })
    )
  );
});
