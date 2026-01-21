import { it, expect } from "bun:test";
import { Effect } from "effect";
import { FeedCache } from "../FeedCache";
import { FeedCacheKv } from "./FeedCacheKv";

it("stores and loads a feed", async () => {
  const program = Effect.gen(function* () {
    const cache = yield* FeedCache;
    yield* cache.putFeed("did:plc:1", "default", ["at://1"], 60);
    const got = yield* cache.getFeed("did:plc:1", "default");
    return got?.length ?? 0;
  });

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(FeedCacheKv.layerTest))
  );
  expect(result).toBe(1);
});
