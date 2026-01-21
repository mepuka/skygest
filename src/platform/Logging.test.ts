import { it, expect } from "bun:test";
import { Effect, HashMap, Layer, Logger, LogLevel, Option } from "effect";
import { Logging } from "./Logging";

it("adds log annotations from context", async () => {
  const seen: Array<Logger.Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });
  const logLayer = Layer.mergeAll(
    Logger.replace(Logger.defaultLogger, capture),
    Logger.minimumLogLevel(LogLevel.Info)
  );

  await Effect.runPromise(
    Effect.log("hello").pipe(
      Logging.withContext({ component: "test" }),
      Effect.provide(logLayer)
    )
  );

  const annotation = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(annotation).toBe("test");
});
