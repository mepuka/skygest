import { Effect, Layer, Logger, LogLevel } from "effect";

export const Logging = {
  layer: Layer.mergeAll(
    Logger.json,
    Logger.minimumLogLevel(LogLevel.Info)
  ),
  withContext:
    (annotations: Record<string, string | number | boolean>) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.annotateLogs(annotations))
};
