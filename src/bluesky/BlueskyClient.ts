import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform";
import { BlueskyApiError } from "../domain/errors";
import { AppConfig } from "../platform/Config";

const FollowsResponse = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  follows: Schema.Array(Schema.Struct({
    did: Schema.String,
    handle: Schema.optional(Schema.String)
  }))
});

export class BlueskyClient extends Context.Tag("@skygest/BlueskyClient")<
  BlueskyClient,
  {
    readonly getFollows: (
      did: string,
      cursor: string | null,
      limit: number
    ) => Effect.Effect<{
      readonly dids: ReadonlyArray<string>;
      readonly cursor: string | null;
    }, BlueskyApiError>;
  }
>() {}

const makeBlueskyClient = (base: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const getFollows = (did: string, cursor: string | null, limit: number) =>
      http.get(`${base}/xrpc/app.bsky.graph.getFollows`, {
        urlParams: {
          actor: did,
          cursor: cursor ?? undefined,
          limit: String(limit)
        }
      }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(FollowsResponse)),
        Effect.map((body) => ({
          dids: body.follows.map((follow) => follow.did),
          cursor: body.cursor ?? null
        })),
        Effect.mapError((error) =>
          BlueskyApiError.make({ message: String(error), status: 500 })
        )
      );

    return BlueskyClient.of({ getFollows });
  });

export const layer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return yield* makeBlueskyClient(cfg.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));
