import { describe, it, expect } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import { CloudflareEnv, type EnvBindings } from "./Env";

describe("CloudflareEnv", () => {
  it("fails when required bindings are missing", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      DB: {} as D1Database,
      RAW_EVENTS: {} as Queue,
      FEED_GEN: {} as Queue,
      POSTPROCESS: {} as Queue,
      JETSTREAM_INGESTOR: {} as DurableObjectNamespace
    } satisfies Partial<EnvBindings>;

    const exit = await Effect.runPromiseExit(
      CloudflareEnv.pipe(
        Effect.provide(CloudflareEnv.layer(env as EnvBindings))
      )
    );

    const failure = Exit.match(exit, {
      onFailure: (cause) => Cause.failureOption(cause),
      onSuccess: () => Option.none()
    });

    expect(Option.isSome(failure)).toBe(true);
    expect(Option.getOrUndefined(failure)).toMatchObject({
      _tag: "EnvError",
      missing: "FEED_CACHE"
    });
  });

  it("provides bindings", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      DB: {} as D1Database,
      FEED_CACHE: {} as KVNamespace,
      RAW_EVENTS: {} as Queue,
      FEED_GEN: {} as Queue,
      POSTPROCESS: {} as Queue,
      JETSTREAM_ENDPOINT: "wss://example",
      JETSTREAM_INGESTOR: {} as DurableObjectNamespace
    };

    const program = Effect.gen(function* () {
      const bindings = yield* CloudflareEnv;
      return bindings.FEED_DID;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(CloudflareEnv.layer(env)))
    );

    expect(result).toBe("did:plc:test");
  });
});
