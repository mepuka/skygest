import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "@effect/platform";
import { BlueskyApiError } from "../domain/errors";
import { AppConfig } from "../platform/Config";
import type { BlueskyProfile, ResolvedDidOrHandle } from "../domain/bi";
import { Did } from "../domain/types";

const FollowsResponse = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  follows: Schema.Array(Schema.Struct({
    did: Schema.String,
    handle: Schema.optional(Schema.String)
  }))
});

const ResolveHandleResponse = Schema.Struct({
  did: Did
});

const ProfileResponse = Schema.Struct({
  did: Did,
  handle: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String)
});

const toBlueskyApiError = (error: unknown) =>
  BlueskyApiError.make({
    message: error instanceof Error ? error.message : String(error),
    status: 500
  });

export class BlueskyClient extends Context.Tag("@skygest/BlueskyClient")<
  BlueskyClient,
  {
    readonly resolveDidOrHandle: (
      didOrHandle: string
    ) => Effect.Effect<ResolvedDidOrHandle, BlueskyApiError>;
    readonly getProfile: (
      didOrHandle: string
    ) => Effect.Effect<BlueskyProfile, BlueskyApiError>;
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

    const resolveDidOrHandle = (didOrHandle: string) =>
      didOrHandle.startsWith("did:")
        ? getProfile(didOrHandle).pipe(
          Effect.map(({ did, handle }) => ({ did, handle }))
        )
        : http.get(`${base}/xrpc/com.atproto.identity.resolveHandle`, {
          urlParams: {
            handle: didOrHandle
          }
        }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(ResolveHandleResponse)),
          Effect.map((body) => ({
            did: body.did,
            handle: null
          })),
          Effect.mapError(toBlueskyApiError)
        );

    const getProfile = (didOrHandle: string) =>
      http.get(`${base}/xrpc/app.bsky.actor.getProfile`, {
        urlParams: {
          actor: didOrHandle
        }
      }).pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ProfileResponse)),
        Effect.map((body) => ({
          did: body.did,
          handle: body.handle ?? null,
          displayName: body.displayName ?? null,
          description: body.description ?? null
        })),
        Effect.mapError(toBlueskyApiError)
      );

    const getFollows = (did: string, cursor: string | null, limit: number) =>
      http.get(`${base}/xrpc/app.bsky.graph.getFollows`, {
        urlParams: {
          actor: did,
          cursor: cursor ?? undefined,
          limit: String(limit)
        }
      }).pipe(
        Effect.tap((response) => Effect.log(`Bluesky API status: ${response.status}`)),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(FollowsResponse)),
        Effect.map((body) => ({
          dids: body.follows.map((follow) => follow.did),
          cursor: body.cursor ?? null
        })),
        Effect.mapError(toBlueskyApiError)
      );

    return BlueskyClient.of({
      resolveDidOrHandle,
      getProfile,
      getFollows
    });
  });

export const layer = Layer.effect(
  BlueskyClient,
  Effect.gen(function* () {
    const cfg = yield* AppConfig;
    return yield* makeBlueskyClient(cfg.publicApi);
  })
).pipe(Layer.provide(FetchHttpClient.layer));
