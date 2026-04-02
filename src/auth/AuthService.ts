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

const timingSafeEqual = (a: string, b: string): Effect.Effect<boolean> => {
  if (a.length !== b.length) {
    return Effect.succeed(false);
  }

  return Effect.sync(() => {
    const encoder = new TextEncoder();
    const bufA = encoder.encode(a);
    const bufB = encoder.encode(b);

    // Cloudflare Workers runtime provides crypto.subtle.timingSafeEqual
    const subtle = crypto.subtle as SubtleCrypto & {
      readonly timingSafeEqual?: (a: ArrayBuffer, b: ArrayBuffer) => boolean;
    };

    if (typeof subtle.timingSafeEqual === "function") {
      return subtle.timingSafeEqual(bufA.buffer, bufB.buffer);
    }

    // Fallback for non-Workers runtimes (test / Node / Bun):
    // constant-time comparison via bitwise OR accumulator
    let mismatch = 0;
    for (let i = 0; i < bufA.length; i++) {
      mismatch |= bufA[i]! ^ bufB[i]!;
    }
    return mismatch === 0;
  });
};

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
        const configuredSecret = Redacted.value(config.operatorSecret);

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
