import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse
} from "effect/unstable/http";
import { retryTransientHttpEffect } from "../src/ingest/dcat-harness";

const makeStatusError = (status: number) => {
  const request = HttpClientRequest.get("https://example.com/data");
  const response = HttpClientResponse.fromWeb(
    request,
    new Response(`status ${status}`, { status })
  );

  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response
    })
  });
};

describe("retryTransientHttpEffect", () => {
  it("retries transient status-code errors", async () => {
    let attempts = 0;
    const value = await Effect.runPromise(
      retryTransientHttpEffect(
        Effect.gen(function* () {
          attempts += 1;
          if (attempts === 1) {
            return yield* makeStatusError(503);
          }

          return "ok";
        })
      )
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("does not retry non-transient status-code errors", async () => {
    let attempts = 0;
    const error = await Effect.runPromise(
      retryTransientHttpEffect(
        Effect.gen(function* () {
          attempts += 1;
          return yield* makeStatusError(401);
        })
      ).pipe(Effect.flip)
    );

    expect(error._tag).toBe("HttpClientError");
    expect(error.response?.status).toBe(401);
    expect(attempts).toBe(1);
  });
});
