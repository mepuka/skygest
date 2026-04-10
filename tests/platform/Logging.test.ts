import { describe, expect, it } from "@effect/vitest";
import {
  Effect,
  Fiber,
  Logger,
  References
} from "effect";
import { TestClock } from "effect/testing";
import { Logging } from "../../src/platform/Logging";

describe("Logging", () => {
  const annotationValue = (
    options: { readonly annotations: Record<string, unknown> },
    key: string
  ) => options.annotations[key];

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

      const result = yield* effect.pipe(
        Effect.provide(captureLayer),
        Effect.provideService(References.MinimumLogLevel, "All")
      );
      return { result, seen } as const;
    });

  it.effect("adds log annotations from context", () =>
    Effect.gen(function* () {
      const { seen } = yield* captureLogs(
        Effect.logInfo("hello").pipe(Logging.withContext({ component: "test" }))
      );

      expect(seen.length).toBe(1);
      expect(seen[0]!.message).toEqual(["hello"]);
      expect(annotationValue(seen[0]!, "component")).toBe("test");
    })
  );

  it.effect("emits structured summary events", () =>
    Effect.gen(function* () {
      const { seen } = yield* captureLogs(
        Logging.logSummary("eia walk loaded", {
          routeCount: 12,
          fromCache: true
        })
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).toEqual(["eia walk loaded"]);
      expect(annotationValue(seen[0]!, "routeCount")).toBe(12);
      expect(annotationValue(seen[0]!, "fromCache")).toBe(true);
    })
  );

  it.effect("emits structured warning events", () =>
    Effect.gen(function* () {
      const { seen } = yield* captureLogs(
        Logging.logWarning("eia dataset skipped from route index", {
          slug: "eia-steo",
          reason: "missingApiRouteAlias"
        })
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).toEqual([
        "eia dataset skipped from route index"
      ]);
      expect(annotationValue(seen[0]!, "slug")).toBe("eia-steo");
      expect(annotationValue(seen[0]!, "reason")).toBe(
        "missingApiRouteAlias"
      );
    })
  );

  it.effect("emits structured failure events", () =>
    Effect.gen(function* () {
      const error = { _tag: "ExampleError", message: "broken" };
      const { seen } = yield* captureLogs(
        Logging.logFailure("eia ingest failed", error, { route: "steo" })
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).toEqual(["eia ingest failed"]);
      expect(annotationValue(seen[0]!, "errorTag")).toBe("ExampleError");
      expect(annotationValue(seen[0]!, "message")).toBe("broken");
      expect(annotationValue(seen[0]!, "route")).toBe("steo");
    })
  );

  it.effect("records timing metadata around an effect", () =>
    Effect.gen(function* () {
      const fiber = yield* captureLogs(
        Logging.withTiming("EiaIngest.testStep", "test step completed", {
          step: "test"
        })(Effect.sleep("5 seconds").pipe(Effect.as("ok")))
      ).pipe(Effect.forkChild);

      yield* TestClock.adjust("5 seconds");
      const { result, seen } = yield* Fiber.join(fiber);

      expect(result).toBe("ok");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.message).toEqual(["test step completed"]);
      expect(annotationValue(seen[0]!, "spanName")).toBe("EiaIngest.testStep");
      expect(annotationValue(seen[0]!, "durationMs")).toBe(5000);
    })
  );
});
