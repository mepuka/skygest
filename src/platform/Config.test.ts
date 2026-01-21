import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { AppConfig } from "./Config";
import { CloudflareEnv, type EnvBindings } from "./Env";

describe("AppConfig", () => {
  it("loads config from provider", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      ALG_FEED_DID: "did:plc:alg",
      FOLLOW_LIMIT: "5000",
      DB: {} as D1Database,
      FEED_CACHE: {} as KVNamespace,
      RAW_EVENTS: {} as Queue,
      FEED_GEN: {} as Queue,
      POSTPROCESS: {} as Queue,
      JETSTREAM_INGESTOR: {} as DurableObjectNamespace
    } satisfies EnvBindings;

    const program = AppConfig.pipe(
      Effect.provide(AppConfig.layer.pipe(Layer.provide(CloudflareEnv.layer(env))))
    );

    const result = await Effect.runPromise(program);

    expect(result).toMatchObject({
      feedDid: "did:plc:test",
      algFeedDid: "did:plc:alg",
      followLimit: 5000
    });
  });
});
