import { Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { stringifyUnknown } from "../../../platform/Json";
import { ENERGY_CHARTS_OPENAPI_URL } from "./endpointCatalog";

export const EnergyChartsOpenApiOperation = Schema.Struct({
  summary: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  operationId: Schema.optionalKey(Schema.String)
});
export type EnergyChartsOpenApiOperation = Schema.Schema.Type<
  typeof EnergyChartsOpenApiOperation
>;

export const EnergyChartsOpenApiPathItem = Schema.Struct({
  get: Schema.optionalKey(EnergyChartsOpenApiOperation)
});
export type EnergyChartsOpenApiPathItem = Schema.Schema.Type<
  typeof EnergyChartsOpenApiPathItem
>;

export const EnergyChartsOpenApiDocument = Schema.Struct({
  paths: Schema.Record(Schema.String, EnergyChartsOpenApiPathItem)
});
export type EnergyChartsOpenApiDocument = Schema.Schema.Type<
  typeof EnergyChartsOpenApiDocument
>;

const getResponseStatus = (cause: unknown): number | undefined => {
  if (typeof cause !== "object" || cause === null) return undefined;
  const maybe = cause as { readonly response?: { readonly status?: unknown } };
  if (
    maybe.response !== undefined &&
    typeof maybe.response.status === "number"
  ) {
    return maybe.response.status;
  }
  return undefined;
};

const isParseError = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const tag = (cause as { readonly _tag?: unknown })._tag;
  return tag === "ParseError" || tag === "SchemaError";
};

export class EnergyChartsSpecFetchError extends Schema.TaggedErrorClass<EnergyChartsSpecFetchError>()(
  "EnergyChartsSpecFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class EnergyChartsSpecDecodeError extends Schema.TaggedErrorClass<EnergyChartsSpecDecodeError>()(
  "EnergyChartsSpecDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

export const fetchSpec = Effect.fn("EnergyCharts.fetchSpec")(function* (
  url: string = ENERGY_CHARTS_OPENAPI_URL
) {
  const http = yield* HttpClient.HttpClient;
  return yield* http.get(url).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(EnergyChartsOpenApiDocument)),
    Effect.mapError((cause) =>
      isParseError(cause)
        ? new EnergyChartsSpecDecodeError({
            url,
            message: stringifyUnknown(cause)
          })
        : new EnergyChartsSpecFetchError(
            getResponseStatus(cause) === undefined
              ? {
                  url,
                  message: stringifyUnknown(cause)
                }
              : {
                  url,
                  message: stringifyUnknown(cause),
                  status: getResponseStatus(cause)!
                }
          )
    )
  );
});
