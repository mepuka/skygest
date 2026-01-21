import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Array, Effect, Schema } from "effect";
import { FeedCache } from "../services/FeedCache";
import { AppConfig } from "../platform/Config";
import { AuthService } from "../auth/AuthService";

const FeedQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.Union(Schema.NumberFromString, Schema.Literal("eof"))),
  feed: Schema.optional(Schema.String)
});

export const app = HttpRouter.empty.pipe(
  HttpRouter.get(
    "/xrpc/app.bsky.feed.describeFeedGenerator",
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      return HttpServerResponse.unsafeJson({
        did: cfg.feedDid,
        feeds: [
          {
            uri: `at://${cfg.feedDid}/app.bsky.feed.generator/skygest`,
            cid: "",
            name: "Skygest",
            description: "Paper Skygest"
          }
        ]
      });
    })
  ),
  HttpRouter.get(
    "/xrpc/app.bsky.feed.getFeedSkeleton",
    Effect.gen(function* () {
      const cfg = yield* AppConfig;
      const cache = yield* FeedCache;
      const auth = yield* AuthService;
      const params = yield* HttpServerRequest.schemaSearchParams(FeedQuery);
      if (params.cursor === "eof") {
        return HttpServerResponse.unsafeJson({ cursor: "eof", feed: [] });
      }

      const limit = Math.min(params.limit ?? cfg.feedLimit, cfg.feedLimit);
      const start = typeof params.cursor === "number" ? params.cursor : 0;
      const header = (yield* HttpServerRequest.HttpServerRequest).headers["authorization"] ?? null;
      const did = yield* auth.decodeBearer(header);
      const feed = did ? (yield* cache.getFeed(did, "default")) ?? [] : [];
      const sliced = Array.take(Array.drop(feed, start), limit);
      const nextCursor = start + limit;

      return HttpServerResponse.unsafeJson({
        cursor: sliced.length > 0 ? String(nextCursor) : "eof",
        feed: sliced.map((post) => ({ post }))
      });
    })
  )
);
