import { Context, Effect, Layer, Schema } from "effect";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { AppConfig } from "../platform/Config";

const ACCESS_HEADER = "cf-access-jwt-assertion";
const OPERATOR_SECRET_HEADER = "x-skygest-operator-secret";

const normalizeTeamDomain = (value: string) =>
  value.startsWith("http://") || value.startsWith("https://")
    ? value.replace(/\/+$/, "")
    : `https://${value.replace(/\/+$/, "")}`;

export class MissingAccessJwtError extends Schema.TaggedError<MissingAccessJwtError>()(
  "MissingAccessJwtError",
  {}
) {}

export class InvalidAccessJwtError extends Schema.TaggedError<InvalidAccessJwtError>()(
  "InvalidAccessJwtError",
  {
    message: Schema.String
  }
) {}

export class MissingOperatorSecretError extends Schema.TaggedError<MissingOperatorSecretError>()(
  "MissingOperatorSecretError",
  {}
) {}

export class InvalidOperatorSecretError extends Schema.TaggedError<InvalidOperatorSecretError>()(
  "InvalidOperatorSecretError",
  {}
) {}

export class ForbiddenAccessJwtError extends Schema.TaggedError<ForbiddenAccessJwtError>()(
  "ForbiddenAccessJwtError",
  {
    reason: Schema.String
  }
) {}

export class InvalidAuthConfigError extends Schema.TaggedError<InvalidAuthConfigError>()(
  "InvalidAuthConfigError",
  {
    missing: Schema.String
  }
) {}

export type AccessIdentity = {
  readonly subject: string | null;
  readonly email: string | null;
  readonly issuer: string;
  readonly audience: ReadonlyArray<string>;
  readonly scopes: ReadonlyArray<string>;
  readonly payload: JWTPayload;
};

const toAudience = (payload: JWTPayload): ReadonlyArray<string> => {
  if (Array.isArray(payload.aud)) {
    return payload.aud.filter((value): value is string => typeof value === "string");
  }
  return typeof payload.aud === "string" ? [payload.aud] : [];
};

const toScopes = (payload: JWTPayload): ReadonlyArray<string> => {
  const collect = (value: unknown): ReadonlyArray<string> => {
    if (typeof value === "string") {
      return value
        .split(/\s+/u)
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
    }

    if (Array.isArray(value)) {
      return value.filter((scope): scope is string => typeof scope === "string");
    }

    return [];
  };

  return Array.from(
    new Set([
      ...collect(payload.scope),
      ...collect(payload.scopes),
      ...collect(payload.permissions)
    ])
  );
};

const operatorScopes: ReadonlyArray<string> = [
  "experts:write",
  "ops:refresh"
];

export class AuthService extends Context.Tag("@skygest/AuthService")<
  AuthService,
  {
    readonly requireAccess: (
      headers: Headers
    ) => Effect.Effect<
      AccessIdentity,
      MissingAccessJwtError | InvalidAccessJwtError | ForbiddenAccessJwtError | InvalidAuthConfigError
    >;
    readonly requireScopes: (
      headers: Headers,
      requiredScopes: ReadonlyArray<string>
    ) => Effect.Effect<
      AccessIdentity,
      MissingAccessJwtError | InvalidAccessJwtError | ForbiddenAccessJwtError | InvalidAuthConfigError
    >;
    readonly requireOperator: (
      headers: Headers
    ) => Effect.Effect<
      AccessIdentity,
      | MissingAccessJwtError
      | InvalidAccessJwtError
      | ForbiddenAccessJwtError
      | MissingOperatorSecretError
      | InvalidOperatorSecretError
      | InvalidAuthConfigError
    >;
    readonly requireOperatorScopes: (
      headers: Headers,
      requiredScopes: ReadonlyArray<string>
    ) => Effect.Effect<
      AccessIdentity,
      | MissingAccessJwtError
      | InvalidAccessJwtError
      | ForbiddenAccessJwtError
      | MissingOperatorSecretError
      | InvalidOperatorSecretError
      | InvalidAuthConfigError
    >;
  }
>() {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const issuer = normalizeTeamDomain(config.accessTeamDomain);
      const jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));

      const requireAccess = Effect.fn("AuthService.requireAccess")(function* (headers: Headers) {
        if (config.accessTeamDomain.length === 0) {
          return yield* InvalidAuthConfigError.make({ missing: "ACCESS_TEAM_DOMAIN" });
        }

        if (config.accessAud.length === 0) {
          return yield* InvalidAuthConfigError.make({ missing: "ACCESS_AUD" });
        }

        const token = headers.get(ACCESS_HEADER);
        if (token === null || token.trim().length === 0) {
          return yield* MissingAccessJwtError.make({});
        }

        const { payload } = yield* Effect.tryPromise({
          try: () => jwtVerify(token, jwks),
          catch: (error) =>
            InvalidAccessJwtError.make({
              message: error instanceof Error ? error.message : String(error)
            })
        });

        const audience = toAudience(payload);
        if (payload.iss !== issuer) {
          return yield* ForbiddenAccessJwtError.make({ reason: "invalid issuer" });
        }

        if (!audience.includes(config.accessAud)) {
          return yield* ForbiddenAccessJwtError.make({ reason: "invalid audience" });
        }

        return {
          subject: typeof payload.sub === "string" ? payload.sub : null,
          email: typeof payload.email === "string" ? payload.email : null,
          issuer,
          audience,
          scopes: toScopes(payload),
          payload
        } satisfies AccessIdentity;
      });

      const requireScopes = Effect.fn("AuthService.requireScopes")(function* (
        headers: Headers,
        requiredScopes: ReadonlyArray<string>
      ) {
        const identity = yield* requireAccess(headers);
        const missing = requiredScopes.filter((scope) => !identity.scopes.includes(scope));

        if (missing.length > 0) {
          return yield* ForbiddenAccessJwtError.make({
            reason: `missing scopes: ${missing.join(", ")}`
          });
        }

        return identity;
      });

      const requireSharedSecret = Effect.fn("AuthService.requireSharedSecret")(function* (
        headers: Headers
      ) {
        if (config.operatorSecret.length === 0) {
          return yield* InvalidAuthConfigError.make({ missing: "OPERATOR_SECRET" });
        }

        const operatorSecret = headers.get(OPERATOR_SECRET_HEADER);
        if (operatorSecret === null || operatorSecret.trim().length === 0) {
          return yield* MissingOperatorSecretError.make({});
        }

        if (operatorSecret !== config.operatorSecret) {
          return yield* InvalidOperatorSecretError.make({});
        }

        return {
          subject: "staging-shared-secret-operator",
          email: "staging-operator@skygest.local",
          issuer: "shared-secret",
          audience: [],
          scopes: [...operatorScopes],
          payload: {
            sub: "staging-shared-secret-operator",
            email: "staging-operator@skygest.local",
            iss: "shared-secret",
            aud: []
          }
        } satisfies AccessIdentity;
      });

      const requireOperator = Effect.fn("AuthService.requireOperator")(function* (headers: Headers) {
        return yield* (
          config.operatorAuthMode === "shared-secret"
            ? requireSharedSecret(headers)
            : requireAccess(headers)
        );
      });

      const requireOperatorScopes = Effect.fn("AuthService.requireOperatorScopes")(function* (
        headers: Headers,
        requiredScopes: ReadonlyArray<string>
      ) {
        const identity = yield* requireOperator(headers);
        const missing = requiredScopes.filter((scope) => !identity.scopes.includes(scope));

        if (missing.length > 0) {
          return yield* ForbiddenAccessJwtError.make({
            reason: `missing scopes: ${missing.join(", ")}`
          });
        }

        return identity;
      });

      return AuthService.of({
        requireAccess,
        requireScopes,
        requireOperator,
        requireOperatorScopes
      });
    })
  );
}
