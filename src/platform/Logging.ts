import { Effect, Layer, Logger } from "effect";

export const Logging = {
  layer: Logger.layer([Logger.consoleJson]),
  withContext:
    (annotations: Record<string, string | number | boolean>) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.annotateLogs(annotations))
};
