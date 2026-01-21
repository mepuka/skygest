import { it, expect } from "bun:test";
import { Effect, HashMap, Logger, LogLevel, Option } from "effect";
import { annotateIngestorLogs } from "./JetstreamIngestor";

it("annotates ingestor logs", async () => {
  const seen: Array<Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });

  await Effect.runPromise(
    Effect.log("ingest-start").pipe(
      annotateIngestorLogs,
      Effect.provide(Logger.replace(Logger.defaultLogger, capture)),
      Effect.provide(Logger.minimumLogLevel(LogLevel.Info))
    )
  );

  const component = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(component).toBe("ingest");
});
