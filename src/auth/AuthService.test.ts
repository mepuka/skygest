import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { AuthService } from "./AuthService";

const token = "eyJhbGciOiJub25lIn0." +
  "eyJpc3MiOiJkaWQ6cGxjOnRlc3QifQ." +
  "";

describe("AuthService", () => {
  it("decodes bearer token iss", async () => {
    const program = Effect.gen(function* () {
      const auth = yield* AuthService;
      return yield* auth.decodeBearer(`Bearer ${token}`);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(AuthService.layer))
    );
    expect(result).toBe("did:plc:test");
  });
});
