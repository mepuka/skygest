import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Effect, Schema } from "effect";
import { PostsRepo } from "../services/PostsRepo";
import { AppConfig } from "../platform/Config";

const FeedQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString)
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
      const posts = yield* PostsRepo;
      const params = yield* HttpServerRequest.schemaSearchParams(FeedQuery);
      const limit = params.limit ?? 50;
      const cursor = params.cursor ?? null;

      const rows = yield* posts.listRecent(cursor, limit);
      const last = rows.at(-1);

      return HttpServerResponse.unsafeJson({
        cursor: last ? String(last.createdAt) : "eof",
        feed: rows.map((post) => ({ post: post.uri }))
      });
    })
  )
);
