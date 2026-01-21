import { it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import * as HttpApp from "@effect/platform/HttpApp";
import { app } from "./FeedRouter";
import { FeedCache } from "../services/FeedCache";
import { AppConfig } from "../platform/Config";
import { AuthService } from "../auth/AuthService";

it("serves feed skeleton from cache", async () => {
  const FeedCacheTest = Layer.succeed(FeedCache, {
    getFeed: () => Effect.succeed([
      "at://did:plc:1/app.bsky.feed.post/1",
      "at://did:plc:2/app.bsky.feed.post/2"
    ]),
    putFeed: () => Effect.void,
    getMeta: () => Effect.succeed(null),
    putMeta: () => Effect.void
  });
  const AuthTest = Layer.succeed(AuthService, {
    decodeBearer: () => Effect.succeed("did:plc:viewer")
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

  const appLayer = Layer.mergeAll(FeedCacheTest, AuthTest, ConfigTest);
  const handler = HttpApp.toWebHandler(
    app.pipe(Effect.provide(appLayer))
  );

  const res = await handler(
    new Request("http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?limit=1", {
      headers: { authorization: "bearer test" }
    })
  );
  const body = await res.json() as { feed: Array<{ post: string }>; cursor: string };

  expect(res.status).toBe(200);
  expect(body.feed.length).toBe(1);
  expect(body.feed[0]?.post).toBe("at://did:plc:1/app.bsky.feed.post/1");
  expect(body.cursor).toBe("1");
});
