import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import type { ThreadPostView } from "../src/bluesky/ThreadTypes";
import { BlueskyApiError } from "../src/domain/errors";
import {
  emptyKnowledgePostHydration,
  type KnowledgePostResult
} from "../src/domain/bi";
import { PostHydrationService } from "../src/services/PostHydrationService";

const makePost = (uri: string): KnowledgePostResult => ({
  uri: uri as any,
  did: "did:plc:expert-a" as any,
  handle: "expert-a.bsky.social",
  avatar: null,
  text: `Post for ${uri}`,
  createdAt: Date.UTC(2026, 2, 18, 12, 0, 0),
  topics: ["solar"],
  tier: "independent",
  ...emptyKnowledgePostHydration()
});

const makeThreadPostView = (
  uri: string,
  overrides: Partial<ThreadPostView> = {}
): ThreadPostView => ({
  uri,
  cid: "cid-1",
  author: {
    did: "did:plc:expert-a",
    handle: "expert-a.bsky.social"
  },
  record: {
    text: `Hydrated ${uri}`
  },
  indexedAt: "2026-03-18T12:00:00.000Z",
  ...overrides
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

const makeHydrationLayer = (
  getPosts: (uris: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<ThreadPostView>, BlueskyApiError>
) => {
  const blueskyLayer = makeBlueskyLayer(getPosts);
  return PostHydrationService.layer.pipe(
    Layer.provideMerge(blueskyLayer)
  );
};

describe("PostHydrationService", () => {
  it.effect("cached posts do not refetch", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const layer = makeHydrationLayer((uris) =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as(
            uris.map((uri) =>
              makeThreadPostView(uri, {
                replyCount: 4
              })
            )
          )
        )
      );

      const items = [makePost("at://did:plc:expert-a/app.bsky.feed.post/post-1")];
      const [first, second] = yield* Effect.gen(function* () {
        const service = yield* PostHydrationService;
        const initial = yield* service.hydratePosts(items);
        const cached = yield* service.hydratePosts(items);
        return [initial, cached] as const;
      }).pipe(Effect.provide(layer));

      expect(first[0]?.replyCount).toBe(4);
      expect(second[0]?.replyCount).toBe(4);
      expect(yield* Ref.get(calls)).toBe(1);
    })
  );

  it.effect("dedupes duplicate uris within a request", () =>
    Effect.gen(function* () {
      const batches = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
      const uri = "at://did:plc:expert-a/app.bsky.feed.post/post-1";
      const layer = makeHydrationLayer((uris) =>
        Ref.update(batches, (items) => items.concat([uris])).pipe(
          Effect.as([makeThreadPostView(uri, { replyCount: 2 })])
        )
      );

      const hydrated = yield* PostHydrationService.use( (service) =>
        service.hydratePosts([makePost(uri), makePost(uri)])
      ).pipe(Effect.provide(layer));

      expect(hydrated).toHaveLength(2);
      expect(hydrated[0]?.replyCount).toBe(2);
      expect(hydrated[1]?.replyCount).toBe(2);
      expect(yield* Ref.get(batches)).toEqual([[uri]]);
    })
  );

  it.effect("splits more than 25 misses into multiple batches", () =>
    Effect.gen(function* () {
      const batches = yield* Ref.make<ReadonlyArray<number>>([]);
      const uris = Array.from({ length: 60 }, (_, index) =>
        `at://did:plc:expert-a/app.bsky.feed.post/post-${index}`
      );
      const layer = makeHydrationLayer((chunk) =>
        Ref.update(batches, (sizes) => sizes.concat(chunk.length)).pipe(
          Effect.as(chunk.map((uri) => makeThreadPostView(uri, { replyCount: 1 })))
        )
      );

      const hydrated = yield* PostHydrationService.use( (service) =>
        service.hydratePosts(uris.map(makePost))
      ).pipe(Effect.provide(layer));

      expect(hydrated).toHaveLength(60);
      expect((yield* Ref.get(batches)).slice().sort((a, b) => a - b)).toEqual([10, 25, 25]);
    })
  );

  it.effect("caches missing posts as null metadata", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const missingUri = "at://did:plc:expert-a/app.bsky.feed.post/missing";
      const layer = makeHydrationLayer((_uris) =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.as([])
        )
      );

      const [first, second] = yield* Effect.gen(function* () {
        const service = yield* PostHydrationService;
        const initial = yield* service.hydratePosts([makePost(missingUri)]);
        const cached = yield* service.hydratePosts([makePost(missingUri)]);
        return [initial, cached] as const;
      }).pipe(Effect.provide(layer));

      expect(first[0]?.replyCount).toBeNull();
      expect(first[0]?.embedType).toBeNull();
      expect(second[0]?.replyCount).toBeNull();
      expect(yield* Ref.get(calls)).toBe(1);
    })
  );

  it.effect("falls back to null metadata without caching transient failures", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const uri = "at://did:plc:expert-a/app.bsky.feed.post/flaky";
      const layer = makeHydrationLayer((_uris) =>
        Ref.update(calls, (count) => count + 1).pipe(
          Effect.andThen(Effect.fail(new BlueskyApiError({
            message: "temporary outage",
            status: 503
          })))
        )
      );

      const [first, second] = yield* Effect.gen(function* () {
        const service = yield* PostHydrationService;
        const initial = yield* service.hydratePosts([makePost(uri)]);
        const retried = yield* service.hydratePosts([makePost(uri)]);
        return [initial, retried] as const;
      }).pipe(Effect.provide(layer));

      expect(first[0]?.replyCount).toBeNull();
      expect(second[0]?.replyCount).toBeNull();
      expect(yield* Ref.get(calls)).toBe(2);
    })
  );

  it.effect("unexpected hydration defects still surface", () =>
    Effect.gen(function* () {
      const uri = "at://did:plc:expert-a/app.bsky.feed.post/broken";
      const layer = makeHydrationLayer((_uris) =>
        Effect.die("unexpected hydration defect")
      );

      const exit = yield* Effect.exit(
        PostHydrationService.use( (service) =>
          service.hydratePosts([makePost(uri)])
        ).pipe(Effect.provide(layer))
      );

      expect(exit._tag).toBe("Failure");
    })
  );
});
