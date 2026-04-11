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

  // Regression tests for SKY-283 Part A: the previous implementation
  // short-circuited on `a.length !== b.length`, leaking the configured
  // secret's length through response timing. The hash-first fix routes
  // both inputs through SHA-256 before `timingSafeEqual`, ensuring
  // comparison work is independent of the caller-controlled input length.
  describe("timing-safe comparison (SKY-283 Part A)", () => {
    const expected = "stage-secret-with-a-reasonable-length";

    it.live("rejects an invalid token of the SAME length", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const wrong = "x".repeat(expected.length);
        expect(wrong.length).toBe(expected.length);

        const result = yield* Effect.exit(
          Effect.flip(auth.requireOperator(new Headers({
            authorization: `Bearer ${wrong}`
          })))
        );

        expect(Exit.isSuccess(result)).toBe(true);
        if (Exit.isSuccess(result)) {
          expect(result.value).toBeInstanceOf(InvalidOperatorSecretError);
        }
      }).pipe(Effect.provide(makeAuthLayer({
        operatorSecret: Redacted.make(expected)
      })))
    );

    it.live("rejects an invalid token of a DIFFERENT length", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const wrong = "short";
        expect(wrong.length).not.toBe(expected.length);

        const result = yield* Effect.exit(
          Effect.flip(auth.requireOperator(new Headers({
            authorization: `Bearer ${wrong}`
          })))
        );

        expect(Exit.isSuccess(result)).toBe(true);
        if (Exit.isSuccess(result)) {
          expect(result.value).toBeInstanceOf(InvalidOperatorSecretError);
        }
      }).pipe(Effect.provide(makeAuthLayer({
        operatorSecret: Redacted.make(expected)
      })))
    );

    it.live("rejects an invalid token MUCH longer than the expected secret", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const wrong = "z".repeat(expected.length * 50);

        const result = yield* Effect.exit(
          Effect.flip(auth.requireOperator(new Headers({
            authorization: `Bearer ${wrong}`
          })))
        );

        expect(Exit.isSuccess(result)).toBe(true);
        if (Exit.isSuccess(result)) {
          expect(result.value).toBeInstanceOf(InvalidOperatorSecretError);
        }
      }).pipe(Effect.provide(makeAuthLayer({
        operatorSecret: Redacted.make(expected)
      })))
    );

    it.live("rejects an empty bearer token without throwing", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;

        // `Bearer ` alone (no token) fails the regex and looks like a
        // missing header, so instead submit a whitespace-only token that
        // matches the regex but decodes to an empty payload after trim.
        const result = yield* Effect.exit(
          Effect.flip(auth.requireOperator(new Headers({
            authorization: "Bearer  "
          })))
        );

        expect(Exit.isSuccess(result)).toBe(true);
        if (Exit.isSuccess(result)) {
          // An all-whitespace header does not match `\S+` so it falls
          // into the missing-secret path. Both the missing and invalid
          // errors are acceptable — the key property is that we do not
          // throw.
          expect(
            result.value instanceof MissingOperatorSecretError ||
              result.value instanceof InvalidOperatorSecretError
          ).toBe(true);
        }
      }).pipe(Effect.provide(makeAuthLayer({
        operatorSecret: Redacted.make(expected)
      })))
    );

    // Coarse timing assertion: if the implementation short-circuited on
    // length mismatch, different-length rejections would be drastically
    // faster than same-length rejections. This test only asserts the two
    // means are within an order of magnitude of each other, which is
    // loose enough to avoid flakes on a shared CI runner but still
    // catches a regression to the previous early-return behaviour.
    it.live("uses comparable time for same-length and different-length mismatches", () =>
      Effect.gen(function* () {
        const auth = yield* AuthService;
        const iterations = 100;

        const sameLength = "x".repeat(expected.length);
        const diffLength = "y";

        const measure = (token: string) =>
          Effect.gen(function* () {
            const start = performance.now();
            yield* Effect.exit(
              Effect.flip(auth.requireOperator(new Headers({
                authorization: `Bearer ${token}`
              })))
            );
            return performance.now() - start;
          });

        // Warm-up: first calls can be disproportionately slow while the
        // WebCrypto path is initialised.
        for (let i = 0; i < 10; i++) {
          yield* measure(sameLength);
          yield* measure(diffLength);
        }

        let totalSame = 0;
        let totalDiff = 0;
        for (let i = 0; i < iterations; i++) {
          totalSame += yield* measure(sameLength);
          totalDiff += yield* measure(diffLength);
        }

        const meanSame = totalSame / iterations;
        const meanDiff = totalDiff / iterations;

        // Guard against division-by-zero on very fast machines.
        const safeSame = Math.max(meanSame, 1e-6);
        const safeDiff = Math.max(meanDiff, 1e-6);

        expect(safeSame / safeDiff).toBeLessThan(10);
        expect(safeDiff / safeSame).toBeLessThan(10);
      }).pipe(Effect.provide(makeAuthLayer({
        operatorSecret: Redacted.make(expected)
      })))
    );
  });
});
