import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import { app } from "./FeedRouter";
import { PostsRepo } from "../services/PostsRepo";
import { AppConfig } from "../platform/Config";

it("serves feed skeleton", async () => {
  const PostsTest = Layer.succeed(PostsRepo, {
    putMany: () => Effect.void,
    listRecent: () =>
      Effect.succeed([
        {
          uri: "at://did:plc:1/app.bsky.feed.post/1",
          cid: "cid",
          authorDid: "did:plc:1",
          createdAt: 200,
          indexedAt: 210,
          searchText: "arxiv",
          replyRoot: null,
          replyParent: null,
          status: "active"
        }
      ]),
    markDeleted: () => Effect.void,
    markDeletedMany: () => Effect.void
  });
  const ConfigTest = Layer.succeed(AppConfig, {
    feedDid: "did:plc:test",
    algFeedDid: "did:plc:alg",
    publicApi: "https://public.api.bsky.app",
    jetstreamEndpoint: "wss://example",
    followLimit: 5000,
    feedLimit: 150,
    consentThreshold: 5
  });

  const appLayer = Layer.mergeAll(PostsTest, ConfigTest);
  const handler = HttpApp.toWebHandler(
    app.pipe(Effect.provide(appLayer))
  );

  const res = await handler(
    new Request("http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?limit=1")
  );
  const body = await res.json() as { feed: Array<{ post: string }>; cursor: string };

  expect(res.status).toBe(200);
  expect(body.feed.length).toBe(1);
  expect(body.cursor).toBe("200");
});
