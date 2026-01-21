import { Array, Effect, RequestResolver } from "effect";
import { AppConfig } from "../platform/Config";
import { FeedGenMessage } from "../domain/types";
import { FeedCache } from "../services/FeedCache";
import { PostsRepo } from "../services/PostsRepo";
import { ListRecentByAuthor, PostsReadResolver } from "../services/PostsReadResolver";
import { BlueskyClient } from "../bluesky/BlueskyClient";

const feedAlgorithm = "default";
const feedTtlSeconds = 60 * 15;
const perAuthorLimit = 10;

const buildFeed = (items: ReadonlyArray<{ uri: string }>, limit: number) =>
  Array.take(Array.map(items, (item) => item.uri), limit);

export const GeneratorWorker = {
  process: (message: FeedGenMessage) =>
    Effect.gen(function* () {
      console.log("GeneratorWorker.process called with", JSON.stringify(message));
      const cache = yield* FeedCache;
      const bluesky = yield* BlueskyClient;
      const cfg = yield* AppConfig;
      const resolver = RequestResolver.contextFromServices(PostsRepo)(PostsReadResolver);

      const processUser = Effect.fn("GeneratorWorker.processUser")(function* (user: string) {
        console.log(`Processing user: ${user}`);
        const follows = yield* bluesky.getFollows(user, null, cfg.followLimit);
        console.log(`Got ${follows.dids.length} follows`);
        const followPosts = yield* Effect.forEach(
          follows.dids,
          (did) => Effect.request(
            new ListRecentByAuthor({ authorDid: did, limit: perAuthorLimit }),
            resolver
          ),
          { concurrency: 10, batching: "inherit" }
        ).pipe(
          Effect.withRequestBatching(true),
          Effect.withRequestCaching(true)
        );
        console.log(`Got ${Array.flatten(followPosts).length} total posts from follows`);
        const feed = buildFeed(Array.flatten(followPosts), cfg.feedLimit);
        console.log(`Built feed with ${feed.length} items`);
        yield* cache.putFeed(user, feedAlgorithm, feed, feedTtlSeconds);
        console.log(`Saved feed to cache`);
      });

      yield* Effect.forEach(message.users, processUser, { concurrency: 5, discard: true });
    })
};
