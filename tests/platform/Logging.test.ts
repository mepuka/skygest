import { describe, expect, it } from "@effect/vitest";
import { Effect, Logger, References } from "effect";
import { Logging } from "../../src/platform/Logging";

describe("Logging", () => {
  it.effect("adds log annotations from context", () =>
    Effect.gen(function* () {
      const seen: Array<Readonly<Record<string, unknown>>> = [];
      const captureLayer = Logger.layer([
        Logger.make((options) => {
          seen.push(options.fiber.getRef(References.CurrentLogAnnotations));
        })
      ]);

      yield* Effect.logInfo("hello").pipe(
        Logging.withContext({ component: "test" }),
        Effect.provide(captureLayer)
      );

      expect(seen.length).toBe(1);
      expect(seen[0]!.component).toBe("test");
    })
  );
});
