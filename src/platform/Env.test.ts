import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { CloudflareEnv } from "./Env";

describe("CloudflareEnv", () => {
  it("provides bindings", async () => {
    const env = {
      FEED_DID: "did:plc:test",
      JETSTREAM_ENDPOINT: "wss://example",
      DB: {} as D1Database,
      RAW_EVENTS: {} as Queue,
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
