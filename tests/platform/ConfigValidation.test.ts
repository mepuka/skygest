import { describe, expect, it } from "@effect/vitest";
import { Effect, ConfigProvider, Result } from "effect";
import {
  validateKeys,
  ConfigValidationError
} from "../../src/platform/ConfigValidation";
import { OperatorKeys, EnrichmentKeys, WorkerDeployKeys } from "../../src/platform/ConfigShapes";
import { AppConfig } from "../../src/platform/Config";

describe("ConfigValidation", () => {
  it.effect("reports all missing keys at once — not fail-fast", () =>
    Effect.gen(function* () {
      const allKeys = { ...OperatorKeys, ...EnrichmentKeys };
      const result = yield* Effect.result(
        validateKeys(allKeys, ConfigProvider.fromUnknown({}))
      );
      expect(result._tag).toBe("Failure");
      if (Result.isFailure(result)) {
        const error = result.failure;
        expect(error).toBeInstanceOf(ConfigValidationError);
        if (error instanceof ConfigValidationError) {
          // Must report all three required keys, not just the first
          expect(error.failures.length).toBe(3);
          const names = error.failures.map((f) => f.key);
          expect(names).toContain("operatorSecret");
          expect(names).toContain("baseUrl");
          expect(names).toContain("googleApiKey");
        }
      }
    })
  );

  it.effect("succeeds when all required keys present", () =>
    Effect.gen(function* () {
      const result = yield* validateKeys(
        OperatorKeys,
        ConfigProvider.fromUnknown({
          SKYGEST_OPERATOR_SECRET: "test-secret",
          SKYGEST_STAGING_BASE_URL: "https://example.com"
        })
      );
      expect(result.baseUrl).toBeInstanceOf(URL);
    })
  );

  it.effect("defaults still resolve alongside failures", () =>
    Effect.gen(function* () {
      // visionModel has a default, googleApiKey does not
      const result = yield* Effect.result(
        validateKeys(EnrichmentKeys, ConfigProvider.fromUnknown({}))
      );
      expect(result._tag).toBe("Failure");
      if (Result.isFailure(result)) {
        const error = result.failure;
        if (error instanceof ConfigValidationError) {
          expect(error.failures.length).toBe(1);
          expect(error.failures[0]!.key).toBe("googleApiKey");
          expect(error.successes).toContain("visionModel");
        }
      }
    })
  );

  it.effect("AppConfig.validate catches missing OPERATOR_SECRET", () =>
    Effect.gen(function* () {
      // Only provide GOOGLE_API_KEY — OPERATOR_SECRET missing
      const provider = ConfigProvider.fromUnknown({
        GOOGLE_API_KEY: "test-key"
      });
      const result = yield* Effect.result(AppConfig.validate(provider));
      expect(result._tag).toBe("Failure");
      if (Result.isFailure(result)) {
        const error = result.failure;
        if (error instanceof ConfigValidationError) {
          const failedKeys = error.failures.map((f) => f.key);
          expect(failedKeys).toContain("operatorSecret");
        }
      }
    })
  );

  it.effect("AppConfig.validate succeeds with all required keys", () =>
    Effect.gen(function* () {
      const provider = ConfigProvider.fromUnknown({
        OPERATOR_SECRET: "real-secret",
        GOOGLE_API_KEY: "test-key"
      });
      const result = yield* AppConfig.validate(provider);
      expect(result.operatorSecret).toBeDefined();
      expect(result.googleApiKey).toBeDefined();
    })
  );

  it.effect("summary is human-readable", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        validateKeys(OperatorKeys, ConfigProvider.fromUnknown({}))
      );
      if (Result.isFailure(result)) {
        const error = result.failure;
        if (error instanceof ConfigValidationError) {
          expect(error.summary).toContain("operatorSecret");
          expect(error.summary).toContain("baseUrl");
          expect(error.summary).toContain("Failed");
        }
      }
    })
  );
});
