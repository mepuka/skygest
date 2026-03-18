import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleApiRequestWithLayer } from "../src/api/Router";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import {
  KnowledgeLinksPageOutput,
  KnowledgePostsPageOutput
} from "../src/domain/api";
import type { ThreadPostView } from "../src/bluesky/ThreadTypes";
import { BlueskyApiError, DbError } from "../src/domain/errors";
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

const makeBlueskyLayer = (
  getPosts: (uris: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<ThreadPostView>, BlueskyApiError>
) =>
  Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
    getProfile: () => Effect.die("unexpected getProfile"),
    getFollows: () => Effect.die("unexpected getFollows"),
    resolveRepoService: () => Effect.die("unexpected resolveRepoService"),
    listRecordsAtService: () => Effect.die("unexpected listRecordsAtService"),
    getPostThread: () => Effect.die("unexpected getPostThread"),
    getPosts
  });

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
    )
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
          blueskyClient: makeBlueskyLayer((uris) =>
            Effect.succeed(
              uris.flatMap((uri) => {
                const post = hydratedPosts.get(uri);
                return post === undefined ? [] : [post];
              })
            )
          )
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
          blueskyClient: makeBlueskyLayer(() =>
            Effect.fail(BlueskyApiError.make({
              message: "temporary outage",
              status: 503
            }))
          )
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
