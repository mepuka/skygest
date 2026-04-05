import { describe, expect, it } from "@effect/vitest";
import { Effect, ConfigProvider } from "effect";
import {
  OperatorKeys,
  WorkerKeys,
  EnrichmentKeys
} from "../../src/platform/ConfigShapes";

describe("ConfigShapes", () => {
  describe("OperatorKeys", () => {
    it.effect("operatorSecret resolves from env", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: "test-secret-123"
        });
        const result = yield* OperatorKeys.operatorSecret.parse(provider);
        expect(result).toBeDefined();
      })
    );

    it.effect("operatorSecret fails when missing", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* Effect.result(
          OperatorKeys.operatorSecret.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("operatorSecret fails when empty string", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: ""
        });
        const result = yield* Effect.result(
          OperatorKeys.operatorSecret.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("baseUrl validates URL format", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_STAGING_BASE_URL: "not-a-url"
        });
        const result = yield* Effect.result(
          OperatorKeys.baseUrl.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("baseUrl resolves valid URL", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({
          SKYGEST_STAGING_BASE_URL: "https://example.com/mcp"
        });
        const result = yield* OperatorKeys.baseUrl.parse(provider);
        expect(result).toBeInstanceOf(URL);
        expect(result.href).toContain("example.com");
      })
    );
  });

  describe("WorkerKeys", () => {
    it.effect("publicApi defaults to public Bluesky API", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* WorkerKeys.publicApi.parse(provider);
        expect(result).toBe("https://public.api.bsky.app");
      })
    );

    it.effect("mcpLimitDefault defaults to 20", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* WorkerKeys.mcpLimitDefault.parse(provider);
        expect(result).toBe(20);
      })
    );
  });

  describe("EnrichmentKeys", () => {
    it.effect("googleApiKey fails when missing", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* Effect.result(
          EnrichmentKeys.googleApiKey.parse(provider)
        );
        expect(result._tag).toBe("Failure");
      })
    );

    it.effect("visionModel defaults to gemini-2.5-flash", () =>
      Effect.gen(function* () {
        const provider = ConfigProvider.fromUnknown({});
        const result = yield* EnrichmentKeys.visionModel.parse(provider);
        expect(result).toBe("gemini-2.5-flash");
      })
    );
  });
});
