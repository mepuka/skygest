import { ServiceMap, Effect, Layer, Redacted, Schema } from "effect";
import { AppConfig } from "../platform/Config";

const AUTHORIZATION_HEADER = "authorization";

export class MissingOperatorSecretError extends Schema.TaggedErrorClass<MissingOperatorSecretError>()(
  "MissingOperatorSecretError",
  {}
) {}

export class InvalidOperatorSecretError extends Schema.TaggedErrorClass<InvalidOperatorSecretError>()(
  "InvalidOperatorSecretError",
  {}
) {}

export class MissingOperatorScopeError extends Schema.TaggedErrorClass<MissingOperatorScopeError>()(
  "MissingOperatorScopeError",
  {
    missingScopes: Schema.Array(Schema.String)
  }
) {}

export type AccessIdentity = {
  readonly subject: string | null;
  readonly email: string | null;
  readonly scopes: ReadonlyArray<string>;
};

const operatorScopes: ReadonlyArray<string> = [
  "mcp:read",
  "experts:read",
  "experts:write",
  "curation:write",
  "ops:read",
  "ops:refresh",
  "editorial:read",
  "editorial:write"
];

const extractBearerToken = (header: string): string | null => {
  const match = /^Bearer\s+(\S+)$/iu.exec(header);
  return match === null ? null : match[1]!;
};

/**
 * Constant-time bearer-token comparison.
 *
 * Both inputs are SHA-256 hashed before comparison so that:
 *   1. Both sides of `timingSafeEqual` always have the same length
 *      (32 bytes), meaning the expected token's length is never leaked
 *      through an early-return path.
 *   2. Comparison runs in time proportional to the fixed hash size,
 *      not to the caller-controlled input length.
 *
 * This is the standard Workers-recommended pattern for constant-time
 * string equality and is resistant to the timing-oracle attack where an
 * attacker probes the expected secret's length by measuring response
 * time against bearer tokens of varying length.
 */
const timingSafeEqual = (a: string, b: string): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);

    const [hashA, hashB] = yield* Effect.promise(() =>
      Promise.all([
        crypto.subtle.digest("SHA-256", bufA),
        crypto.subtle.digest("SHA-256", bufB)
      ])
    );

    const viewA = new Uint8Array(hashA);
    const viewB = new Uint8Array(hashB);

    // Cloudflare Workers runtime provides crypto.subtle.timingSafeEqual.
    const subtle = crypto.subtle as SubtleCrypto & {
      readonly timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
    };

    if (typeof subtle.timingSafeEqual === "function") {
      return subtle.timingSafeEqual(viewA, viewB);
    }

    // Fallback for non-Workers runtimes (test / Node / Bun):
    // constant-time comparison via bitwise OR accumulator over the
    // fixed-length SHA-256 outputs.
    let mismatch = 0;
    for (let i = 0; i < viewA.length; i++) {
      mismatch |= viewA[i]! ^ viewB[i]!;
    }
    return mismatch === 0;
  });

export class AuthService extends ServiceMap.Service<
  AuthService,
  {
    readonly requireOperator: (
      headers: Headers
    ) => Effect.Effect<
      AccessIdentity,
      MissingOperatorSecretError | InvalidOperatorSecretError
    >;
  }
>()("@skygest/AuthService") {
  static readonly layer = Layer.effect(
    AuthService,
    Effect.gen(function* () {
      const config = yield* AppConfig;

      const requireOperator = Effect.fn("AuthService.requireOperator")(function* (
        headers: Headers
      ) {
        const configuredSecret: string = Redacted.value(config.operatorSecret) as string;

        const authHeader = headers.get(AUTHORIZATION_HEADER);
        const token = authHeader !== null ? extractBearerToken(authHeader) : null;

        if (token === null) {
          return yield* new MissingOperatorSecretError();
        }

        const isValid = yield* timingSafeEqual(token, configuredSecret);

        if (!isValid) {
          return yield* new InvalidOperatorSecretError();
        }

        return {
          subject: "operator",
          email: null,
          scopes: [...operatorScopes]
        } satisfies AccessIdentity;
      });

      return {
        requireOperator
      };
    })
  );
}
