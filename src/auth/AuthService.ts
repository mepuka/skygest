import { Context, Effect, Layer } from "effect";
import { decodeJwt } from "jose";

export class AuthService extends Context.Tag("@skygest/AuthService")<
  AuthService,
  {
    readonly decodeBearer: (header: string | null) => Effect.Effect<string | null>;
  }
>() {
  static layer = Layer.succeed(AuthService, {
    decodeBearer: (header) =>
      Effect.sync(() => {
        if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
        const token = header.slice("bearer ".length).trim();
        try {
          const payload = decodeJwt(token);
          return typeof payload.iss === "string" ? payload.iss : null;
        } catch {
          return null;
        }
      })
  });
}
