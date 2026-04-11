import { Duration, Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import {
  retryTransientHttpEffect,
  withMinIntervalHttpRateLimit
} from "../../dcat-harness";
import {
  getResponseStatus,
  isDecodeError
} from "../../../platform/HttpErrors";
import { stringifyUnknown } from "../../../platform/Json";
import { EMBER_OPENAPI_URL } from "./endpointCatalog";
import { EmberOpenApiDocument } from "./openApi";

export class EmberSpecFetchError extends Schema.TaggedErrorClass<EmberSpecFetchError>()(
  "EmberSpecFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class EmberSpecDecodeError extends Schema.TaggedErrorClass<EmberSpecDecodeError>()(
  "EmberSpecDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

export const fetchSpec = Effect.fn("Ember.fetchSpec")(function* (
  apiKey: Redacted.Redacted<string>,
  url: string = EMBER_OPENAPI_URL,
  minIntervalMs = 1000
) {
  const http = yield* withMinIntervalHttpRateLimit(
    yield* HttpClient.HttpClient,
    {
      key: "ember-openapi",
      minIntervalMs
    }
  );

  return yield* http
    .get(url, {
      urlParams: { api_key: Redacted.value(apiKey) }
    })
    .pipe(
      Effect.timeout(Duration.seconds(10)),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      (effect) => retryTransientHttpEffect(effect),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(EmberOpenApiDocument)),
      Effect.mapError((cause) =>
        isDecodeError(cause)
          ? new EmberSpecDecodeError({
              url,
              message: stringifyUnknown(cause)
            })
          : new EmberSpecFetchError(
              getResponseStatus(cause) === undefined
                ? {
                    url,
                    message: "Ember OpenAPI request failed"
                  }
                : {
                    url,
                    message: "Ember OpenAPI request failed",
                    status: getResponseStatus(cause)!
                  }
            )
      )
    );
});
