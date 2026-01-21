import { it, expect } from "bun:test";
import { Effect, HashMap, Logger, LogLevel, Option } from "effect";
import { Logging } from "./Logging";

it("adds log annotations from context", async () => {
  const seen: Array<Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });

  await Effect.runPromise(
    Effect.log("hello").pipe(
      Logging.withContext({ component: "test" }),
      Effect.provide(Logger.replace(Logger.defaultLogger, capture)),
      Effect.provide(Logger.minimumLogLevel(LogLevel.Info))
    )
  );

  const annotation = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(annotation).toBe("test");
});
