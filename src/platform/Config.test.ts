import { describe, it, expect } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import { AppConfig } from "./Config";
import { CloudflareEnv, type EnvBindings } from "./Env";

describe("AppConfig", () => {
  it("loads config from provider", async () => {
    const env = {
      DB: {} as D1Database,
      PUBLIC_BSKY_API: "https://example.public.api",
      DEFAULT_DOMAIN: "grid",
      MCP_LIMIT_DEFAULT: "15",
      MCP_LIMIT_MAX: "75",
      OPERATOR_SECRET: "top-secret",
      ENABLE_STAGING_OPS: "true",
      EDITORIAL_DEFAULT_EXPIRY_HOURS: "48",
      CURATION_MIN_SIGNAL_SCORE: "55"
    } satisfies EnvBindings;

    const program = AppConfig.pipe(
      Effect.provide(AppConfig.layer.pipe(Layer.provide(CloudflareEnv.layer(env))))
    );

    const result = await Effect.runPromise(program);

    expect(result).toMatchObject({
      publicApi: "https://example.public.api",
      defaultDomain: "grid",
      mcpLimitDefault: 15,
      mcpLimitMax: 75,
      enableStagingOps: true,
      editorialDefaultExpiryHours: 48,
      curationMinSignalScore: 55
    });
    expect(Redacted.value(result.operatorSecret)).toBe("top-secret");
  });
});
