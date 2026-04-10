import { Clock, Effect, Layer, Logger } from "effect";
import { stringifyUnknown } from "./Json";

type LogAnnotationValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: LogAnnotationValue }
  | ReadonlyArray<LogAnnotationValue>;
type LogAnnotations = Record<string, LogAnnotationValue>;

const errorTag = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof (error as { readonly _tag: unknown })._tag === "string"
    ? (error as { readonly _tag: string })._tag
    : "unknown";

const errorMessage = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof (error as { readonly message: unknown }).message === "string"
    ? (error as { readonly message: string }).message
    : stringifyUnknown(error);

export const Logging = {
  layer: Logger.layer([Logger.consoleJson]),
  withContext:
    (annotations: LogAnnotations) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.annotateLogs(annotations)),
  logSummary: (event: string, annotations: LogAnnotations = {}) =>
    Effect.logInfo(event).pipe(Effect.annotateLogs(annotations)),
  logFailure: (
    event: string,
    error: unknown,
    annotations: LogAnnotations = {}
  ) =>
    Effect.logError(event).pipe(
      Effect.annotateLogs({
        ...annotations,
        errorTag: errorTag(error),
        message: errorMessage(error)
      })
    ),
  withTiming:
    (
      spanName: string,
      event = "operation completed",
      annotations: LogAnnotations = {}
    ) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const startedAt = yield* Clock.currentTimeMillis;
        const result = yield* effect;
        const completedAt = yield* Clock.currentTimeMillis;
        yield* Logging.logSummary(event, {
          ...annotations,
          spanName,
          durationMs: completedAt - startedAt
        });
        return result;
      }).pipe(Effect.withSpan(spanName))
};
