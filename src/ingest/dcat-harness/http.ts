import { Duration, Schedule } from "effect";
import { HttpClient } from "effect/unstable/http";

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
