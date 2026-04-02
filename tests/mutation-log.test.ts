import { Effect, Layer, Logger, References, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { AccessIdentity } from "../src/auth/AuthService";
import { withMutationAudit } from "../src/platform/MutationLog";

class TestMutationError extends Schema.TaggedErrorClass<TestMutationError>()(
  "TestMutationError",
  {
    message: Schema.String,
    status: Schema.Number
  }
) {}

const actor: AccessIdentity = {
  subject: null,
  email: null,
  scopes: ["ops:refresh"]
};

describe("mutation audit logging", () => {
  it.effect("includes failure details and preserves reserved actor annotations", () =>
    Effect.gen(function* () {
      const seen: Array<Record<string, unknown>> = [];
      const captureLayer = Logger.layer([
        Logger.make((options) => {
          const annotations = options.fiber.getRef(References.CurrentLogAnnotations);
          seen.push(annotations);
        })
      ]);

      yield* Effect.exit(
        Effect.fail(
          new TestMutationError({
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
      expect(entry!.action).toBe("refresh_shards");
      expect(entry!.shard).toBe(3);
      expect(entry!.actorSubject).toBe("<missing>");
      expect(entry!.actorEmail).toBe("<missing>");
      expect(entry!.errorTag).toBe("TestMutationError");
      expect(entry!.errorMessage).toBe("boom");
      expect(entry!.errorStatus).toBe(503);
    })
  );
});
