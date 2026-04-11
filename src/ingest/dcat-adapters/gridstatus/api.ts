import { Duration, Effect, Redacted, Schema } from "effect";
import {
  HttpClient,
  HttpClientResponse
} from "effect/unstable/http";
import {
  retryTransientHttpEffect,
  withMinIntervalHttpRateLimit
} from "../../dcat-harness";
import {
  getResponseStatus,
  isDecodeError
} from "../../../platform/HttpErrors";
import {
  formatSchemaParseError,
  stringifyUnknown
} from "../../../platform/Json";

const REQUEST_TIMEOUT = Duration.seconds(20);
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

const GridStatusDatasetCatalogMeta = Schema.Struct({
  page: Schema.optionalKey(Schema.Number),
  limit: Schema.optionalKey(nullableNumber),
  page_size: Schema.optionalKey(nullableNumber),
  hasNextPage: Schema.optionalKey(nullableBoolean),
  cursor: Schema.optionalKey(nullableString)
});

const RawGridStatusDatasetCatalogResponse = Schema.Struct({
  data: Schema.Array(Schema.Unknown),
  meta: Schema.optionalKey(GridStatusDatasetCatalogMeta)
});

export const GridStatusCatalogRowFailure = Schema.Struct({
  page: Schema.Number,
  row: Schema.Number,
  datasetId: Schema.optionalKey(Schema.String),
  message: Schema.String
});
export type GridStatusCatalogRowFailure = Schema.Schema.Type<
  typeof GridStatusCatalogRowFailure
>;

const GridStatusApiUsageLimits = Schema.Struct({
  api_rows_returned_limit: Schema.optionalKey(nullableNumber),
  api_requests_limit: Schema.optionalKey(nullableNumber),
  api_rows_per_response_limit: Schema.optionalKey(nullableNumber),
  per_second_api_rate_limit: Schema.optionalKey(nullableNumber),
  per_minute_api_rate_limit: Schema.optionalKey(nullableNumber),
  per_hour_api_rate_limit: Schema.optionalKey(nullableNumber)
});

const GridStatusApiUsageCurrentPeriod = Schema.Struct({
  total_requests: Schema.optionalKey(nullableNumber),
  total_api_rows_returned: Schema.optionalKey(nullableNumber)
});

export const GridStatusApiUsageResponse = Schema.Struct({
  plan_name: Schema.optionalKey(nullableString),
  limits: Schema.optionalKey(GridStatusApiUsageLimits),
  current_usage_period_start: Schema.optionalKey(nullableString),
  current_usage_period_end: Schema.optionalKey(nullableString),
  current_period_usage: Schema.optionalKey(GridStatusApiUsageCurrentPeriod)
});
export type GridStatusApiUsageResponse = Schema.Schema.Type<
  typeof GridStatusApiUsageResponse
>;

export interface GridStatusCatalogFetchResult {
  readonly pageCount: number;
  readonly datasets: ReadonlyArray<GridStatusDatasetInfo>;
  readonly meta: Schema.Schema.Type<typeof GridStatusDatasetCatalogMeta> | undefined;
  readonly rowFailures: ReadonlyArray<GridStatusCatalogRowFailure>;
}

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

export class GridStatusApiUsageFetchError extends Schema.TaggedErrorClass<GridStatusApiUsageFetchError>()(
  "GridStatusApiUsageFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class GridStatusApiUsageDecodeError extends Schema.TaggedErrorClass<GridStatusApiUsageDecodeError>()(
  "GridStatusApiUsageDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/u, "");

export const datasetCatalogUrl = (baseUrl: string): string =>
  `${normalizeBaseUrl(baseUrl)}/datasets`;

export const apiUsageUrl = (baseUrl: string): string =>
  `${normalizeBaseUrl(baseUrl)}/api_usage`;

const safeFetchMessage = (label: string): string => `${label} request failed`;

export const makeGridStatusHttpClient = Effect.fn(
  "GridStatus.makeHttpClient"
)(function* (minIntervalMs: number) {
  return yield* withMinIntervalHttpRateLimit(yield* HttpClient.HttpClient, {
    key: "gridstatus-api",
    minIntervalMs
  });
});

const fetchCatalogPage = Effect.fn("GridStatus.fetchCatalogPage")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  apiKey: Redacted.Redacted<string>,
  baseUrl: string,
  cursor: string | undefined
) {
  const url = datasetCatalogUrl(baseUrl);

  return yield* client
    .get(url, {
      headers: {
        "x-api-key": Redacted.value(apiKey)
      },
      ...(cursor === undefined ? {} : { urlParams: { cursor } })
    })
    .pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      retryTransientHttpEffect,
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(RawGridStatusDatasetCatalogResponse)
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
                    message: safeFetchMessage("GridStatus dataset catalog")
                  }
                : {
                    url,
                    message: safeFetchMessage("GridStatus dataset catalog"),
                    status: getResponseStatus(cause)!
                  }
            )
      )
    );
});

const decodeCatalogRows = (
  page: number,
  rows: ReadonlyArray<unknown>
): Effect.Effect<
  {
    readonly failures: ReadonlyArray<GridStatusCatalogRowFailure>;
    readonly datasets: ReadonlyArray<GridStatusDatasetInfo>;
  },
  never
> =>
  Effect.partition(
    rows,
    (row, index) =>
      Schema.decodeUnknownEffect(GridStatusDatasetInfo)(row).pipe(
        Effect.mapError((error): GridStatusCatalogRowFailure => {
          const rawDatasetId =
            typeof row === "object" &&
            row !== null &&
            "id" in row &&
            typeof row.id === "string"
              ? row.id
              : undefined;

          return {
            page,
            row: index + 1,
            ...(rawDatasetId === undefined ? {} : { datasetId: rawDatasetId }),
            message: formatSchemaParseError(error)
          };
        })
      ),
    { concurrency: "unbounded" }
  ).pipe(
    Effect.map(([failures, datasets]) => ({ failures, datasets }))
  );

export const fetchCatalog = Effect.fn("GridStatus.fetchCatalog")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  apiKey: Redacted.Redacted<string>,
  baseUrl: string
) {
  const datasets: Array<GridStatusDatasetInfo> = [];
  const rowFailures: Array<GridStatusCatalogRowFailure> = [];
  let cursor: string | undefined = undefined;
  let pageCount = 0;
  let lastMeta: Schema.Schema.Type<typeof GridStatusDatasetCatalogMeta> | undefined =
    undefined;

  while (true) {
    pageCount += 1;
    const catalogPage: Schema.Schema.Type<
      typeof RawGridStatusDatasetCatalogResponse
    > = yield* fetchCatalogPage(client, apiKey, baseUrl, cursor);
    const decodedRows = yield* decodeCatalogRows(pageCount, catalogPage.data);
    datasets.push(...decodedRows.datasets);
    rowFailures.push(...decodedRows.failures);
    lastMeta = catalogPage.meta;

    if (catalogPage.meta?.hasNextPage !== true) {
      break;
    }

    const nextCursor: string | null | undefined = catalogPage.meta.cursor;
    if (
      nextCursor === null ||
      nextCursor === undefined ||
      nextCursor.trim().length === 0
    ) {
      return yield* new GridStatusCatalogDecodeError({
        url: datasetCatalogUrl(baseUrl),
        message:
          "GridStatus dataset catalog returned hasNextPage=true without a usable cursor"
      });
    }

    cursor = nextCursor;
  }

  return {
    pageCount,
    datasets,
    meta: lastMeta,
    rowFailures
  } satisfies GridStatusCatalogFetchResult;
});

export const fetchApiUsage = Effect.fn("GridStatus.fetchApiUsage")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  apiKey: Redacted.Redacted<string>,
  baseUrl: string
) {
  const url = apiUsageUrl(baseUrl);

  return yield* client
    .get(url, {
      headers: {
        "x-api-key": Redacted.value(apiKey)
      }
    })
    .pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      retryTransientHttpEffect,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(GridStatusApiUsageResponse)),
      Effect.mapError((cause) =>
        isDecodeError(cause)
          ? new GridStatusApiUsageDecodeError({
              url,
              message: stringifyUnknown(cause)
            })
          : new GridStatusApiUsageFetchError(
              getResponseStatus(cause) === undefined
                ? {
                    url,
                    message: safeFetchMessage("GridStatus API usage")
                  }
                : {
                    url,
                    message: safeFetchMessage("GridStatus API usage"),
                    status: getResponseStatus(cause)!
                  }
            )
      )
    );
});
