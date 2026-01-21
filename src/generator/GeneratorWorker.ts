import { Array, Effect } from "effect";
import { AppConfig } from "../platform/Config";
import { FeedGenMessage } from "../domain/types";
import { FeedCache } from "../services/FeedCache";
import { PostsRepo } from "../services/PostsRepo";
import { BlueskyClient } from "../bluesky/BlueskyClient";

const feedAlgorithm = "default";
const feedTtlSeconds = 60 * 15;
const perAuthorLimit = 10;

const buildFeed = (items: ReadonlyArray<{ uri: string }>, limit: number) =>
  Array.take(Array.map(items, (item) => item.uri), limit);

export const GeneratorWorker = {
  process: (message: FeedGenMessage) =>
    Effect.gen(function* () {
      const cache = yield* FeedCache;
      const posts = yield* PostsRepo;
      const bluesky = yield* BlueskyClient;
      const cfg = yield* AppConfig;

      const processUser = Effect.fn("GeneratorWorker.processUser")(function* (user: string) {
        const follows = yield* bluesky.getFollows(user, null, cfg.followLimit);
        const followPosts = yield* Effect.forEach(
          follows.dids,
          (did) => posts.listRecentByAuthor(did, perAuthorLimit),
          { concurrency: 10 }
        );
        const feed = buildFeed(Array.flatten(followPosts), cfg.feedLimit);
        yield* cache.putFeed(user, feedAlgorithm, feed, feedTtlSeconds);
      });

      yield* Effect.forEach(message.users, processUser, { concurrency: 5, discard: true });
    })
};
