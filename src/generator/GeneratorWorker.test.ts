import { it, expect } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { GeneratorWorker } from "./GeneratorWorker";
import { FeedCache } from "../services/FeedCache";
import { PostsRepo } from "../services/PostsRepo";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { FeedGenMessage } from "../domain/types";
import { AppConfig } from "../platform/Config";

it("builds a feed and writes cache", async () => {
  let stored = 0;
  const FeedCacheTest = Layer.succeed(FeedCache, {
    getFeed: () => Effect.succeed(null),
    putFeed: () => Effect.sync(() => void (stored += 1)),
    getMeta: () => Effect.succeed(null),
    putMeta: () => Effect.void
  });
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.void,
    listRecent: () => Effect.succeed([]),
    listRecentByAuthor: () =>
      Effect.succeed([
        {
          uri: "at://did:plc:1/app.bsky.feed.post/1",
          cid: "cid",
          authorDid: "did:plc:1",
          createdAt: 100,
          createdAtDay: "1970-01-01",
          indexedAt: 200,
          searchText: "arxiv",
          replyRoot: null,
          replyParent: null,
          status: "active"
        }
      ]),
    markDeleted: () => Effect.void,
    markDeletedMany: () => Effect.void
  });
  const BlueskyTest = Layer.succeed(BlueskyClient, {
    getFollows: () => Effect.succeed({ dids: ["did:plc:1"], cursor: null })
  });
  const ConfigTest = Layer.succeed(AppConfig, {
    feedDid: "did:plc:test",
    algFeedDid: "did:plc:alg",
    publicApi: "https://public.api.bsky.app",
    jetstreamEndpoint: "wss://example",
    followLimit: 100,
    feedLimit: 150,
    consentThreshold: 5
  });

  const message = Schema.decodeSync(FeedGenMessage)({
    users: ["did:plc:viewer"],
    batchId: 1,
    generateAgg: false
  });

  await Effect.runPromise(
    GeneratorWorker.process(message).pipe(
      Effect.provide(Layer.mergeAll(FeedCacheTest, PostsTest, BlueskyTest, ConfigTest))
    )
  );

  expect(stored).toBe(1);
});
