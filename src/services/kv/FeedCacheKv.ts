import { Effect, Layer, Option, Schema } from "effect";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { SystemError } from "@effect/platform/Error";
import { CloudflareEnv } from "../../platform/Env";
import { FeedCache } from "../FeedCache";

const key = (did: string, algorithm: string) => `feed:${did}:${algorithm}`;
const metaKey = (did: string, algorithm: string) => `feed-meta:${did}:${algorithm}`;

const kvError = (method: string, error: unknown) =>
  SystemError.make({
    reason: "Unknown",
    module: "KeyValueStore",
    method,
    description: String(error)
  });

const FeedItemsJson = Schema.parseJson(Schema.Array(Schema.String));
const MetaJson = Schema.parseJson(
  Schema.Record({
    key: Schema.String,
    value: Schema.Unknown
  })
);

const decodeItems = (value: string) =>
  Schema.decodeUnknown(FeedItemsJson)(value).pipe(
    Effect.mapError((error) =>
      SystemError.make({
        reason: "InvalidData",
        module: "KeyValueStore",
        method: "decode",
        description: String(error)
      })
    )
  );

const encodeItems = (value: ReadonlyArray<string>) =>
  Schema.encode(FeedItemsJson)(value).pipe(
    Effect.mapError((error) =>
      SystemError.make({
        reason: "InvalidData",
        module: "KeyValueStore",
        method: "encode",
        description: String(error)
      })
    )
  );

const decodeMeta = (value: string) =>
  Schema.decodeUnknown(MetaJson)(value).pipe(
    Effect.mapError((error) =>
      SystemError.make({
        reason: "InvalidData",
        module: "KeyValueStore",
        method: "decode",
        description: String(error)
      })
    )
  );

const encodeMeta = (value: Record<string, unknown>) =>
  Schema.encode(MetaJson)(value).pipe(
    Effect.mapError((error) =>
      SystemError.make({
        reason: "InvalidData",
        module: "KeyValueStore",
        method: "encode",
        description: String(error)
      })
    )
  );

export const FeedCacheKv = {
  layer: Layer.effect(FeedCache, Effect.gen(function* () {
    const env = yield* CloudflareEnv;

    const getValue = (itemKey: string) =>
      Effect.tryPromise({
        try: () => env.FEED_CACHE.get(itemKey),
        catch: (error) => kvError("get", error)
      });

    const putValue = (itemKey: string, value: string, ttlSeconds: number) =>
      Effect.tryPromise({
        try: () => env.FEED_CACHE.put(itemKey, value, { expirationTtl: ttlSeconds }),
        catch: (error) => kvError("put", error)
      });

    const getFeed = (did: string, algorithm: string) =>
      getValue(key(did, algorithm)).pipe(
        Effect.flatMap((value) =>
          value === null
            ? Effect.succeed(null)
            : decodeItems(value)
        )
      );

    const putFeed = (
      did: string,
      algorithm: string,
      items: ReadonlyArray<string>,
      ttlSeconds: number
    ) =>
      encodeItems(items).pipe(
        Effect.flatMap((value) => putValue(key(did, algorithm), value, ttlSeconds)),
        Effect.asVoid
      );

    const getMeta = (did: string, algorithm: string) =>
      getValue(metaKey(did, algorithm)).pipe(
        Effect.flatMap((value) =>
          value === null
            ? Effect.succeed(null)
            : decodeMeta(value)
        )
      );

    const putMeta = (
      did: string,
      algorithm: string,
      meta: Record<string, unknown>,
      ttlSeconds: number
    ) =>
      encodeMeta(meta).pipe(
        Effect.flatMap((value) => putValue(metaKey(did, algorithm), value, ttlSeconds)),
        Effect.asVoid
      );

    return FeedCache.of({ getFeed, putFeed, getMeta, putMeta });
  })),
  layerTest: Layer.effect(FeedCache, Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;

    const getFeed = (did: string, algorithm: string) =>
      store.get(key(did, algorithm)).pipe(
        Effect.flatMap((value) =>
          Option.match(value, {
            onNone: () => Effect.succeed(null),
            onSome: (item) => decodeItems(item)
          })
        )
      );

    const putFeed = (
      did: string,
      algorithm: string,
      items: ReadonlyArray<string>,
      _ttlSeconds: number
    ) =>
      encodeItems(items).pipe(
        Effect.flatMap((value) => store.set(key(did, algorithm), value)),
        Effect.asVoid
      );

    const getMeta = (did: string, algorithm: string) =>
      store.get(metaKey(did, algorithm)).pipe(
        Effect.flatMap((value) =>
          Option.match(value, {
            onNone: () => Effect.succeed(null),
            onSome: (item) => decodeMeta(item)
          })
        )
      );

    const putMeta = (
      did: string,
      algorithm: string,
      meta: Record<string, unknown>,
      _ttlSeconds: number
    ) =>
      encodeMeta(meta).pipe(
        Effect.flatMap((value) => store.set(metaKey(did, algorithm), value)),
        Effect.asVoid
      );

    return FeedCache.of({ getFeed, putFeed, getMeta, putMeta });
  })).pipe(Layer.provide(KeyValueStore.layerMemory))
};
