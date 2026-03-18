import { describe, it, expect } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import { CloudflareEnv, type EnvBindings } from "./Env";

describe("CloudflareEnv", () => {
  it("fails when required bindings are missing", async () => {
    const env = {
      PUBLIC_BSKY_API: "https://public.api.bsky.app"
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
      missing: "DB"
    });
  });

  it("provides bindings", async () => {
    const env = {
      DB: {} as D1Database,
      PUBLIC_BSKY_API: "https://public.api.bsky.app"
    };

    const program = Effect.gen(function* () {
      const bindings = yield* CloudflareEnv;
      return bindings.PUBLIC_BSKY_API;
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(CloudflareEnv.layer(env)))
    );

    expect(result).toBe("https://public.api.bsky.app");
  });
});
