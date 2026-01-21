import * as HttpRouter from "@effect/platform/HttpRouter";
import * as HttpServerRequest from "@effect/platform/HttpServerRequest";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import { Array, Clock, Effect, Option, Schema } from "effect";
import { FeedCache } from "../services/FeedCache";
import { AppConfig } from "../platform/Config";
import { AuthService } from "../auth/AuthService";
import { CloudflareEnv } from "../platform/Env";
import { PostprocessMessage } from "../domain/types";
import { QueueError } from "../domain/errors";

const FeedQuery = Schema.Struct({
  limit: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.Union(Schema.NumberFromString, Schema.Literal("eof"))),
  feed: Schema.optional(Schema.String)
});

const decodePostprocess = (payload: {
  readonly viewer: string;
  readonly accessAt: number;
  readonly limit: number;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly defaultFrom?: number;
  readonly recs: ReadonlyArray<{ readonly post: string }>;
}) =>
  Schema.decodeUnknown(PostprocessMessage)(payload).pipe(
    Effect.mapError((error) => QueueError.make({ message: String(error) }))
  );

const enqueuePostprocess = (payload: {
  readonly viewer: string;
  readonly accessAt: number;
  readonly limit: number;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly defaultFrom?: number;
  readonly recs: ReadonlyArray<{ readonly post: string }>;
}) =>
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    const message = yield* decodePostprocess(payload);
    yield* Effect.tryPromise({
      try: () => env.POSTPROCESS.send(message, { contentType: "json" }),
      catch: (error) => QueueError.make({ message: String(error) })
    });
  }).pipe(
    Effect.catchAll((error) =>
      Effect.logWarning(`postprocess queue send failed: ${error.message}`).pipe(
        Effect.asVoid
      )
    )
  );

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
      const feedItems = Array.map(sliced, (post) => ({ post }));
      const nextCursor = start + limit;

      const accessAt = yield* Clock.currentTimeMillis;
      yield* Option.match(Option.fromNullable(did), {
        onNone: () => Effect.void,
        onSome: (viewer) => {
          const payload = {
            viewer,
            accessAt,
            limit,
            cursorStart: start,
            cursorEnd: start + feedItems.length,
            recs: feedItems
          };

          return enqueuePostprocess(
            params.cursor === undefined
              ? { ...payload, defaultFrom: start }
              : payload
          );
        }
      });

      return HttpServerResponse.unsafeJson({
        cursor: sliced.length > 0 ? String(nextCursor) : "eof",
        feed: feedItems
      });
    })
  )
);
