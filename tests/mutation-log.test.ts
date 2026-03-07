import { Effect, HashMap, Layer, Logger, LogLevel, Option, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { AccessIdentity } from "../src/auth/AuthService";
import { withMutationAudit } from "../src/platform/MutationLog";

class TestMutationError extends Schema.TaggedError<TestMutationError>()(
  "TestMutationError",
  {
    message: Schema.String,
    status: Schema.Number
  }
) {}

const actor: AccessIdentity = {
  subject: null,
  email: null,
  issuer: "https://access.example.com",
  audience: ["skygest-mcp"],
  scopes: ["ops:refresh"],
  payload: {}
};

const getAnnotation = (
  options: Logger.Logger.Options<unknown>,
  key: string
) =>
  Option.getOrUndefined(HashMap.get(key)(options.annotations));

describe("mutation audit logging", () => {
  it.effect("includes failure details and preserves reserved actor annotations", () =>
    Effect.gen(function* () {
      const seen: Array<Logger.Logger.Options<unknown>> = [];
      const captureLayer = Layer.mergeAll(
        Logger.replace(Logger.defaultLogger, Logger.make((options) => {
          seen.push(options);
        })),
        Logger.minimumLogLevel(LogLevel.Info)
      );

      yield* Effect.exit(
        Effect.fail(
          TestMutationError.make({
            message: "boom",
            status: 503
          })
        ).pipe(
          withMutationAudit({
            label: "expert registry mutation",
            actor,
            action: "refresh_shards",
            annotations: {
              actorSubject: "should-not-win",
              shard: 3
            }
          }),
          Effect.provide(captureLayer)
        )
      );

      const entry = seen[0];
      expect(entry).toBeDefined();
      expect(getAnnotation(entry!, "action")).toBe("refresh_shards");
      expect(getAnnotation(entry!, "shard")).toBe(3);
      expect(getAnnotation(entry!, "actorSubject")).toBe("<missing>");
      expect(getAnnotation(entry!, "actorEmail")).toBe("<missing>");
      expect(getAnnotation(entry!, "errorTag")).toBe("TestMutationError");
      expect(getAnnotation(entry!, "errorMessage")).toBe("boom");
      expect(getAnnotation(entry!, "errorStatus")).toBe(503);
    })
  );
});
