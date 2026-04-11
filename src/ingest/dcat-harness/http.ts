import { Cause, Duration, Effect, Schedule } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientResponse
} from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";

export interface TransientRetryOptions {
  readonly times?: number;
}

export const transientRetrySchedule = Schedule.exponential(
  Duration.millis(500)
).pipe(Schedule.jittered);

export const withTransientHttpRetry = <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  options?: TransientRetryOptions
): HttpClient.HttpClient.With<E, R> =>
  client.pipe(
    HttpClient.retryTransient({
      retryOn: "errors-and-responses",
      schedule: transientRetrySchedule,
      times: options?.times ?? 4
    })
  );

const isTransientResponse = (
  response: HttpClientResponse.HttpClientResponse
): boolean =>
  response.status === 408 ||
  response.status === 429 ||
  response.status === 500 ||
  response.status === 502 ||
  response.status === 503 ||
  response.status === 504;

export const isTransientHttpError = (error: unknown): boolean =>
  Cause.isTimeoutError(error) ||
  (HttpClientError.isHttpClientError(error) &&
    (error.reason._tag === "TransportError" ||
      (error.reason._tag === "StatusCodeError" &&
        isTransientResponse(error.reason.response))));

export const retryTransientHttpEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: TransientRetryOptions
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.retry({
      schedule: transientRetrySchedule,
      times: options?.times ?? 4,
      while: isTransientHttpError
    })
  );

export const withMinIntervalHttpRateLimit = Effect.fn(
  "DcatHarness.withMinIntervalHttpRateLimit"
)(function* <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  options: {
    readonly key: string;
    readonly minIntervalMs: number;
  }
) {
  if (options.minIntervalMs <= 0) {
    return client as HttpClient.HttpClient.With<
      E | RateLimiter.RateLimiterError,
      R
    >;
  }

  const limiter = yield* RateLimiter.make.pipe(
    Effect.provide(RateLimiter.layerStoreMemory)
  );

  return client.pipe(
    HttpClient.withRateLimiter({
      limiter,
      key: options.key,
      limit: 1,
      window: Duration.millis(options.minIntervalMs)
    })
  );
});
