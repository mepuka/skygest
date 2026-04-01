import { Effect, Exit, Layer, Redacted } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  AuthService,
  InvalidOperatorSecretError,
  MissingOperatorSecretError
} from "../src/auth/AuthService";
import { AppConfig } from "../src/platform/Config";
import { testConfig } from "./support/runtime";

const makeAuthLayer = (overrides: Parameters<typeof testConfig>[0] = {}) => {
  const config = testConfig(overrides);

  return Layer.mergeAll(
    Layer.succeed(AppConfig, config),
    AuthService.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(AppConfig, config)
      )
    )
  );
};

describe("Bearer token auth", () => {
  it.live("accepts a valid bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const identity = yield* auth.requireOperator(new Headers({
        authorization: "Bearer stage-secret"
      }));

      expect(identity.subject).toBe("operator");
      expect(identity.scopes).toContain("mcp:read");
      expect(identity.scopes).toContain("experts:read");
      expect(identity.scopes).toContain("experts:write");
      expect(identity.scopes).toContain("curation:write");
      expect(identity.scopes).toContain("ops:read");
      expect(identity.scopes).toContain("ops:refresh");
      expect(identity.scopes).toContain("editorial:read");
      expect(identity.scopes).toContain("editorial:write");
    }).pipe(Effect.provide(makeAuthLayer({
      operatorSecret: Redacted.make("stage-secret")
    })))
  );

  it.live("rejects missing Authorization header", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const result = yield* Effect.exit(
        Effect.flip(auth.requireOperator(new Headers()))
      );

      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value).toBeInstanceOf(MissingOperatorSecretError);
      }
    }).pipe(Effect.provide(makeAuthLayer({
      operatorSecret: Redacted.make("stage-secret")
    })))
  );

  it.live("rejects invalid bearer token", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const result = yield* Effect.exit(
        Effect.flip(auth.requireOperator(new Headers({
          authorization: "Bearer wrong-secret"
        })))
      );

      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value).toBeInstanceOf(InvalidOperatorSecretError);
      }
    }).pipe(Effect.provide(makeAuthLayer({
      operatorSecret: Redacted.make("stage-secret")
    })))
  );

  it.live("rejects non-Bearer Authorization header", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const result = yield* Effect.exit(
        Effect.flip(auth.requireOperator(new Headers({
          authorization: "Basic dXNlcjpwYXNz"
        })))
      );

      expect(Exit.isSuccess(result)).toBe(true);
      if (Exit.isSuccess(result)) {
        expect(result.value).toBeInstanceOf(MissingOperatorSecretError);
      }
    }).pipe(Effect.provide(makeAuthLayer({
      operatorSecret: Redacted.make("stage-secret")
    })))
  );
});
