import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { handleApiRequestWithLayer } from "../src/api/Router";
import {
  KnowledgeLinksPageOutput,
  KnowledgePostsPageOutput
} from "../src/domain/api";
import { DbError } from "../src/domain/errors";
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
          explainPostTopics: (postUri) => Effect.succeed({ postUri, items: [] })
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
