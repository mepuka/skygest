import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it, vi } from "@effect/vitest";
import {
  AuthService,
  ForbiddenAccessJwtError,
  InvalidAccessJwtError,
  InvalidOperatorSecretError,
  MissingOperatorSecretError,
  MissingAccessJwtError
} from "../src/auth/AuthService";
import { AppConfig } from "../src/platform/Config";
import { encodeJsonString } from "../src/platform/Json";
import { testConfig } from "./support/runtime";

const issuer = "https://access.example.com";
const audience = "skygest-mcp";

const makeAuthLayer = (overrides: Parameters<typeof testConfig>[0] = {}) => {
  const config = testConfig({
    accessTeamDomain: issuer,
    accessAud: audience,
    ...overrides
  });

  return Layer.mergeAll(
    Layer.succeed(AppConfig, config),
    AuthService.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(AppConfig, config)
      )
    )
  );
};

const authLayer = makeAuthLayer();

describe("Cloudflare Access auth", () => {
  it.live("accepts a valid signed Access JWT", () =>
    Effect.gen(function* () {
      const { publicKey, privateKey } = yield* Effect.promise(() =>
        generateKeyPair("RS256")
      );
      const publicJwk = yield* Effect.promise(() => exportJWK(publicKey));
      publicJwk.kid = "test-key";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(encodeJsonString({ keys: [publicJwk] }), {
          headers: { "content-type": "application/json" }
        })
      );

      try {
        const token = yield* Effect.promise(() =>
          issueToken(publicJwk, privateKey, {
            scope: "experts:write ops:refresh"
          })
        );
        const auth = yield* AuthService;
        const identity = yield* auth.requireAccess(new Headers({
          "cf-access-jwt-assertion": token
        }));

        expect(identity.email).toBe("operator@example.com");
        expect(identity.subject).toBe("did:example:operator");
        expect(identity.scopes).toContain("experts:write");
      } finally {
        fetchSpy.mockRestore();
      }
    }).pipe(Effect.provide(authLayer))
  );

  it.live("rejects missing tokens, invalid signatures, and wrong audiences", () =>
    Effect.gen(function* () {
      const { publicKey, privateKey } = yield* Effect.promise(() =>
        generateKeyPair("RS256")
      );
      const publicJwk = yield* Effect.promise(() => exportJWK(publicKey));
      publicJwk.kid = "test-key";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(encodeJsonString({ keys: [publicJwk] }), {
          headers: { "content-type": "application/json" }
        })
      );

      try {
        const auth = yield* AuthService;
        const validToken = yield* Effect.promise(() => issueToken(publicJwk, privateKey));
        const wrongAudienceToken = yield* Effect.promise(() =>
          issueToken(publicJwk, privateKey, { aud: "wrong-audience" })
        );

        const missing = yield* Effect.exit(Effect.flip(auth.requireAccess(new Headers())));
        const invalid = yield* Effect.exit(Effect.flip(auth.requireAccess(new Headers({
          "cf-access-jwt-assertion": `${validToken}corrupted`
        }))));
        const forbidden = yield* Effect.exit(Effect.flip(auth.requireAccess(new Headers({
          "cf-access-jwt-assertion": wrongAudienceToken
        }))));

        expect(Exit.isSuccess(missing)).toBe(true);
        expect(Exit.isSuccess(invalid)).toBe(true);
        expect(Exit.isSuccess(forbidden)).toBe(true);

        if (Exit.isSuccess(missing)) {
          expect(missing.value).toBeInstanceOf(MissingAccessJwtError);
        }
        if (Exit.isSuccess(invalid)) {
          expect(invalid.value).toBeInstanceOf(InvalidAccessJwtError);
        }
        if (Exit.isSuccess(forbidden)) {
          expect(forbidden.value).toBeInstanceOf(ForbiddenAccessJwtError);
        }
      } finally {
        fetchSpy.mockRestore();
      }
    }).pipe(Effect.provide(authLayer))
  );

  it.live("enforces required scopes for admin operations", () =>
    Effect.gen(function* () {
      const { publicKey, privateKey } = yield* Effect.promise(() =>
        generateKeyPair("RS256")
      );
      const publicJwk = yield* Effect.promise(() => exportJWK(publicKey));
      publicJwk.kid = "test-key";

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(encodeJsonString({ keys: [publicJwk] }), {
          headers: { "content-type": "application/json" }
        })
      );

      try {
        const auth = yield* AuthService;
        const writeToken = yield* Effect.promise(() =>
          issueToken(publicJwk, privateKey, { scope: "experts:write" })
        );
        const refreshToken = yield* Effect.promise(() =>
          issueToken(publicJwk, privateKey, { scope: "ops:refresh" })
        );

        const writeIdentity = yield* auth.requireScopes(new Headers({
          "cf-access-jwt-assertion": writeToken
        }), ["experts:write"]);
        const refreshIdentity = yield* auth.requireScopes(new Headers({
          "cf-access-jwt-assertion": refreshToken
        }), ["ops:refresh"]);
        const missingScope = yield* Effect.exit(
          Effect.flip(
            auth.requireScopes(new Headers({
              "cf-access-jwt-assertion": refreshToken
            }), ["experts:write"])
          )
        );

        expect(writeIdentity.scopes).toContain("experts:write");
        expect(refreshIdentity.scopes).toContain("ops:refresh");
        expect(Exit.isSuccess(missingScope)).toBe(true);

        if (Exit.isSuccess(missingScope)) {
          expect(missingScope.value).toBeInstanceOf(ForbiddenAccessJwtError);
        }
      } finally {
        fetchSpy.mockRestore();
      }
    }).pipe(Effect.provide(authLayer))
  );

  it.live("accepts the staging shared-secret mode and rejects missing or wrong secrets", () =>
    Effect.gen(function* () {
      const auth = yield* AuthService;
      const identity = yield* auth.requireOperator(new Headers({
        "x-skygest-operator-secret": "stage-secret"
      }));
      const scopedIdentity = yield* auth.requireOperatorScopes(new Headers({
        "x-skygest-operator-secret": "stage-secret"
      }), ["experts:write", "ops:refresh"]);
      const missing = yield* Effect.exit(
        Effect.flip(auth.requireOperator(new Headers()))
      );
      const invalid = yield* Effect.exit(
        Effect.flip(auth.requireOperator(new Headers({
          "x-skygest-operator-secret": "wrong-secret"
        })))
      );

      expect(identity.subject).toBe("staging-shared-secret-operator");
      expect(scopedIdentity.scopes).toContain("experts:write");
      expect(Exit.isSuccess(missing)).toBe(true);
      expect(Exit.isSuccess(invalid)).toBe(true);

      if (Exit.isSuccess(missing)) {
        expect(missing.value).toBeInstanceOf(MissingOperatorSecretError);
      }

      if (Exit.isSuccess(invalid)) {
        expect(invalid.value).toBeInstanceOf(InvalidOperatorSecretError);
      }
    }).pipe(Effect.provide(makeAuthLayer({
      operatorAuthMode: "shared-secret",
      operatorSecret: "stage-secret"
    })))
  );
});

const issueToken = async (
  publicJwk: JWK,
  privateKey: CryptoKey,
  options?: {
    readonly aud?: string;
    readonly scope?: string;
  }
) =>
  {
    const kid = publicJwk.kid ?? "test-key";
    return new SignJWT({
      email: "operator@example.com",
      ...(options?.scope ? { scope: options.scope } : {})
    })
      .setProtectedHeader({
        alg: "RS256",
        kid,
        typ: "JWT"
      })
      .setIssuer(issuer)
      .setAudience(options?.aud ?? audience)
      .setSubject("did:example:operator")
      .setIssuedAt()
      .setExpirationTime("10 minutes")
      .sign(privateKey);
  };
