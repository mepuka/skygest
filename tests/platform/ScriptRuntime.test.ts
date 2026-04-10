import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Logger, References } from "effect";
import { withScriptMainFailureLogging } from "../../src/platform/ScriptRuntime";

describe("ScriptRuntime", () => {
  const captureLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const seen: Array<{
        readonly message: unknown;
        readonly annotations: Record<string, unknown>;
      }> = [];
      const captureLayer = Logger.layer([
        Logger.make((options) => {
          seen.push({
            message: options.message,
            annotations: options.fiber.getRef(References.CurrentLogAnnotations)
          });
        })
      ]);

      const exit = yield* Effect.exit(
        effect.pipe(
          Effect.provide(captureLayer),
          Effect.provideService(References.MinimumLogLevel, "All")
        )
      );

      return { exit, seen } as const;
    });

  it.effect("logs a structured failure event before surfacing the script error", () =>
    Effect.gen(function* () {
      const error = { _tag: "ExampleError", message: "boom" };
      const { exit, seen } = yield* captureLogs(
        withScriptMainFailureLogging(
          "EiaIngest",
          Effect.fail(error as never)
        )
      );

      expect(Exit.isFailure(exit)).toBe(true);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).toEqual(["script.failed"]);
      expect(seen[0]!.annotations.scriptName).toBe("EiaIngest");
      expect(seen[0]!.annotations.errorTag).toBe("ExampleError");
      expect(seen[0]!.annotations.message).toBe("boom");
    })
  );
});
