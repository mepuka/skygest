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
      yield* Effect.logInfo("GeneratorWorker.process").pipe(
        Effect.annotateLogs({
          batchId: message.batchId,
          userCount: message.users.length,
          generateAgg: message.generateAgg
        })
      );
      const cache = yield* FeedCache;
      const bluesky = yield* BlueskyClient;
      const cfg = yield* AppConfig;
      const resolver = RequestResolver.contextFromServices(PostsRepo)(PostsReadResolver);

      const processUser = Effect.fn("GeneratorWorker.processUser")(function* (user: string) {
        yield* Effect.logInfo("GeneratorWorker.processUser").pipe(
          Effect.annotateLogs({ user })
        );
        const follows = yield* bluesky.getFollows(user, null, cfg.followLimit);
        yield* Effect.logInfo("GeneratorWorker.follows").pipe(
          Effect.annotateLogs({ user, followCount: follows.dids.length })
        );
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
        const totalPosts = Array.flatten(followPosts).length;
        yield* Effect.logInfo("GeneratorWorker.followPosts").pipe(
          Effect.annotateLogs({ user, postCount: totalPosts })
        );
        const feed = buildFeed(Array.flatten(followPosts), cfg.feedLimit);
        yield* Effect.logInfo("GeneratorWorker.feedBuilt").pipe(
          Effect.annotateLogs({ user, feedSize: feed.length })
        );
        yield* cache.putFeed(user, feedAlgorithm, feed, feedTtlSeconds);
        yield* Effect.logInfo("GeneratorWorker.feedCached").pipe(
          Effect.annotateLogs({ user })
        );
      });

      yield* Effect.forEach(message.users, processUser, { concurrency: 5, discard: true });
    })
};
