import { Duration, Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { withTransientHttpRetry } from "../../dcat-harness";
import {
  getResponseStatus,
  isDecodeError
} from "../../../platform/HttpErrors";
import { stringifyUnknown } from "../../../platform/Json";

const nullableString = Schema.NullOr(Schema.String);
const nullableNumber = Schema.NullOr(Schema.Number);
const nullableBoolean = Schema.NullOr(Schema.Boolean);

export const GridStatusColumn = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  is_date: Schema.Boolean,
  is_numeric: Schema.Boolean,
  is_datetime: Schema.Boolean
});
export type GridStatusColumn = Schema.Schema.Type<typeof GridStatusColumn>;

export const GridStatusDatasetInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optionalKey(nullableString),
  earliest_available_time_utc: Schema.optionalKey(nullableString),
  latest_available_time_utc: Schema.optionalKey(nullableString),
  source: Schema.optionalKey(nullableString),
  last_checked_time_utc: Schema.optionalKey(nullableString),
  primary_key_columns: Schema.Array(Schema.String),
  publish_time_column: Schema.optionalKey(nullableString),
  time_index_column: Schema.optionalKey(nullableString),
  subseries_index_column: Schema.optionalKey(nullableString),
  all_columns: Schema.Array(GridStatusColumn),
  number_of_rows_approximate: Schema.optionalKey(nullableNumber),
  table_type: Schema.optionalKey(nullableString),
  is_in_snowflake: Schema.optionalKey(nullableBoolean),
  data_frequency: Schema.optionalKey(nullableString),
  source_url: Schema.optionalKey(nullableString),
  publication_frequency: Schema.optionalKey(nullableString),
  is_published: Schema.optionalKey(nullableBoolean),
  created_at_utc: Schema.optionalKey(nullableString),
  status: Schema.optionalKey(nullableString)
});
export type GridStatusDatasetInfo = Schema.Schema.Type<
  typeof GridStatusDatasetInfo
>;

export const GridStatusDatasetCatalogResponse = Schema.Struct({
  data: Schema.Array(GridStatusDatasetInfo),
  meta: Schema.optionalKey(
    Schema.Struct({
      page: Schema.optionalKey(Schema.Number),
      limit: Schema.optionalKey(nullableNumber),
      page_size: Schema.optionalKey(nullableNumber),
      hasNextPage: Schema.optionalKey(nullableBoolean),
      cursor: Schema.optionalKey(nullableString)
    })
  )
});
export type GridStatusDatasetCatalogResponse = Schema.Schema.Type<
  typeof GridStatusDatasetCatalogResponse
>;

export class GridStatusCatalogFetchError extends Schema.TaggedErrorClass<GridStatusCatalogFetchError>()(
  "GridStatusCatalogFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class GridStatusCatalogDecodeError extends Schema.TaggedErrorClass<GridStatusCatalogDecodeError>()(
  "GridStatusCatalogDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/u, "");

export const datasetCatalogUrl = (baseUrl: string): string =>
  `${normalizeBaseUrl(baseUrl)}/datasets`;

export const fetchCatalog = Effect.fn("GridStatus.fetchCatalog")(function* (
  apiKey: Redacted.Redacted<string>,
  baseUrl: string
) {
  const url = datasetCatalogUrl(baseUrl);
  const http = withTransientHttpRetry(yield* HttpClient.HttpClient);

  return yield* http
    .get(url, {
      headers: {
        "x-api-key": Redacted.value(apiKey)
      }
    })
    .pipe(
      Effect.timeout(Duration.seconds(20)),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(GridStatusDatasetCatalogResponse)
      ),
      Effect.mapError((cause) =>
        isDecodeError(cause)
          ? new GridStatusCatalogDecodeError({
              url,
              message: stringifyUnknown(cause)
            })
          : new GridStatusCatalogFetchError(
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
