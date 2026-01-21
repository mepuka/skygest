import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { AppConfig } from "./Config";

describe("AppConfig", () => {
  it("loads config from layer", async () => {
    const program = Effect.gen(function* () {
      const cfg = yield* AppConfig;
      return cfg.feedDid;
    });

    const result = await Effect.runPromise(
      program.pipe(
        Effect.provide(Layer.succeed(AppConfig, {
          feedDid: "did:plc:test",
          jetstreamEndpoint: "wss://example"
        }))
      )
    );

    expect(result).toBe("did:plc:test");
  });
});
