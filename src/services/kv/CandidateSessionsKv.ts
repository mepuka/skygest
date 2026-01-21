import { Effect, Layer, Option, Schema } from "effect";
import * as KeyValueStore from "@effect/platform/KeyValueStore";
import { SystemError } from "@effect/platform/Error";
import { CloudflareEnv } from "../../platform/Env";
import { CandidateSessionsRepo } from "../CandidateSessionsRepo";

const key = (id: string) => `candidate:${id}`;

const kvError = (method: string, error: unknown) =>
  SystemError.make({
    reason: "Unknown",
    module: "KeyValueStore",
    method,
    description: String(error)
  });

const ItemsJson = Schema.parseJson(Schema.Array(Schema.String));

const decodeItems = (value: string) =>
  Schema.decodeUnknown(ItemsJson)(value).pipe(
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
  Schema.encode(ItemsJson)(value).pipe(
    Effect.mapError((error) =>
      SystemError.make({
        reason: "InvalidData",
        module: "KeyValueStore",
        method: "encode",
        description: String(error)
      })
    )
  );

export const CandidateSessionsKv = {
  layer: Layer.effect(CandidateSessionsRepo, Effect.gen(function* () {
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

    const put = (sessionId: string, items: ReadonlyArray<string>, ttlSeconds: number) =>
      encodeItems(items).pipe(
        Effect.flatMap((value) => putValue(key(sessionId), value, ttlSeconds)),
        Effect.asVoid
      );

    const get = (sessionId: string) =>
      getValue(key(sessionId)).pipe(
        Effect.flatMap((value) =>
          value === null
            ? Effect.succeed(null)
            : decodeItems(value)
        )
      );

    return CandidateSessionsRepo.of({ put, get });
  })),
  layerTest: Layer.effect(CandidateSessionsRepo, Effect.gen(function* () {
    const store = yield* KeyValueStore.KeyValueStore;

    const put = (sessionId: string, items: ReadonlyArray<string>, _ttlSeconds: number) =>
      encodeItems(items).pipe(
        Effect.flatMap((value) => store.set(key(sessionId), value)),
        Effect.asVoid
      );

    const get = (sessionId: string) =>
      store.get(key(sessionId)).pipe(
        Effect.flatMap((value) =>
          Option.match(value, {
            onNone: () => Effect.succeed(null),
            onSome: (item) => decodeItems(item)
          })
        )
      );

    return CandidateSessionsRepo.of({ put, get });
  })).pipe(Layer.provide(KeyValueStore.layerMemory))
};
