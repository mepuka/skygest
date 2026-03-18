import {
  Cache,
  Context,
  Duration,
  Effect,
  Layer,
  Option
} from "effect";
import { buildTypedEmbed, extractEmbedKind } from "../bluesky/EmbedExtract";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import type { ThreadPostView } from "../bluesky/ThreadTypes";
import {
  emptyKnowledgePostHydration,
  type KnowledgePostHydration,
  type KnowledgePostResult
} from "../domain/bi";

const CACHE_CAPACITY = 2048;
const CACHE_TTL = Duration.minutes(5);
const GET_POSTS_CHUNK_SIZE = 25;
const GET_POSTS_CONCURRENCY = 3;

type HydratablePost = KnowledgePostResult;

const chunk = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const toHydration = (post: ThreadPostView): KnowledgePostHydration => ({
  replyCount: post.replyCount ?? null,
  embedType: extractEmbedKind(post.embed as { readonly $type?: string } | null | undefined),
  embedContent: buildTypedEmbed(post.embed)
});

export class PostHydrationService extends Context.Tag("@skygest/PostHydrationService")<
  PostHydrationService,
  {
    readonly hydratePosts: <A extends HydratablePost>(
      items: ReadonlyArray<A>
    ) => Effect.Effect<ReadonlyArray<A>>;
  }
>() {
  static readonly layer = Layer.effect(
    PostHydrationService,
    Effect.gen(function* () {
      const bluesky = yield* BlueskyClient;
      const cache = yield* Cache.make<string, KnowledgePostHydration>({
        capacity: CACHE_CAPACITY,
        timeToLive: CACHE_TTL,
        lookup: () => Effect.dieMessage("PostHydrationService cache is write-through only")
      });

      const populateChunk = Effect.fn("PostHydrationService.populateChunk")(function* (
        uris: ReadonlyArray<string>
      ) {
        const posts = yield* bluesky.getPosts(uris);
        const hydratedByUri = new Map(
          posts.map((post) => [post.uri, toHydration(post)] as const)
        );

        yield* Effect.forEach(
          uris,
          (uri) => cache.set(uri, hydratedByUri.get(uri) ?? emptyKnowledgePostHydration()),
          { discard: true }
        );
      });

      const hydratePostsInternal = Effect.fn("PostHydrationService.hydratePosts")(function* (
        items: ReadonlyArray<HydratablePost>
      ) {
        if (items.length === 0) {
          return [];
        }

        const uniqueUris = Array.from(new Set(items.map((item) => item.uri)));
        const cachedEntries = yield* Effect.forEach(
          uniqueUris,
          (uri) =>
            cache.getOption(uri).pipe(
              Effect.map((maybeHydration) => [uri, maybeHydration] as const)
            ),
          { concurrency: "unbounded" }
        );

        const hydrationByUri = new Map<string, KnowledgePostHydration>();
        const misses: Array<string> = [];

        for (const [uri, maybeHydration] of cachedEntries) {
          if (Option.isSome(maybeHydration)) {
            hydrationByUri.set(uri, maybeHydration.value);
          } else {
            misses.push(uri);
          }
        }

        yield* Effect.forEach(
          chunk(misses, GET_POSTS_CHUNK_SIZE),
          (uris) =>
            populateChunk(uris).pipe(
              Effect.catchAll(() => Effect.void)
            ),
          {
            concurrency: GET_POSTS_CONCURRENCY,
            discard: true
          }
        );

        const loadedEntries = yield* Effect.forEach(
          misses,
          (uri) =>
            cache.getOption(uri).pipe(
              Effect.map((maybeHydration) => [uri, maybeHydration] as const)
            ),
          { concurrency: "unbounded" }
        );

        for (const [uri, maybeHydration] of loadedEntries) {
          if (Option.isSome(maybeHydration)) {
            hydrationByUri.set(uri, maybeHydration.value);
          }
        }

        return items.map((item) => ({
          ...item,
          ...(hydrationByUri.get(item.uri) ?? emptyKnowledgePostHydration())
        }));
      });

      const hydratePosts = <A extends HydratablePost>(items: ReadonlyArray<A>) =>
        hydratePostsInternal(items).pipe(
          Effect.map((hydrated) => hydrated as unknown as ReadonlyArray<A>)
        );

      return PostHydrationService.of({
        hydratePosts
      });
    })
  );
}
