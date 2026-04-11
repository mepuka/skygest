import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { withTransientHttpRetry } from "../../dcat-harness";
import { getResponseStatus, isDecodeError } from "../../../platform/HttpErrors";
import { stringifyUnknown } from "../../../platform/Json";
import { ENERGY_CHARTS_OPENAPI_URL } from "./endpointCatalog";
import { EnergyChartsOpenApiDocument } from "./openApi";

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
  const http = withTransientHttpRetry(yield* HttpClient.HttpClient);
  return yield* http.get(url).pipe(
    Effect.timeout(Duration.seconds(10)),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(EnergyChartsOpenApiDocument)),
    Effect.mapError((cause) =>
      isDecodeError(cause)
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
