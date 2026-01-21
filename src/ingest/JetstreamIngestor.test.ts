import { it, expect } from "bun:test";
import { Effect, HashMap, Layer, Logger, LogLevel, Option } from "effect";
import { annotateIngestorLogs } from "./JetstreamIngestor";

it("annotates ingestor logs", async () => {
  const seen: Array<Logger.Logger.Options<unknown>> = [];
  const capture = Logger.make((options) => {
    seen.push(options);
  });
  const logLayer = Layer.mergeAll(
    Logger.replace(Logger.defaultLogger, capture),
    Logger.minimumLogLevel(LogLevel.Info)
  );

  await Effect.runPromise(
    Effect.log("ingest-start").pipe(
      annotateIngestorLogs,
      Effect.provide(logLayer)
    )
  );

  const component = Option.getOrUndefined(
    HashMap.get("component")(seen[0]!.annotations)
  );
  expect(component).toBe("ingest");
});
