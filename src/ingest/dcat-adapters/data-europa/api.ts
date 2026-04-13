import { Duration, Effect, Schema, SchemaGetter } from "effect";
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT = Duration.seconds(30);
const PAGE_SIZE = 100;

const nullableString = Schema.NullOr(Schema.String);

/** CKAN wraps some URLs in square brackets — e.g. `[https://example.com]`. */
const stripBrackets = (s: string) => s.replace(/^\[|\]$/g, "").trim();
const CkanUrl = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform(stripBrackets),
    encode: SchemaGetter.transform((s: string) => s)
  })
);
const ckanUrl = Schema.NullOr(CkanUrl);

// ---------------------------------------------------------------------------
// API Response Schemas (lenient — all fields optional/nullable)
// ---------------------------------------------------------------------------

const CkanTranslationEntry = Schema.Struct({
  title: Schema.optionalKey(nullableString),
  notes: Schema.optionalKey(nullableString)
});

const CkanPublisher = Schema.Struct({
  name: Schema.optionalKey(nullableString),
  resource: Schema.optionalKey(nullableString)
});

const CkanOrganizationCountry = Schema.Struct({
  label: Schema.optionalKey(nullableString),
  id: Schema.optionalKey(nullableString)
});

const CkanOrganization = Schema.Struct({
  title: Schema.optionalKey(
    Schema.NullOr(
      Schema.Union([
        Schema.String,
        Schema.Struct({ en: Schema.optionalKey(nullableString) })
      ])
    )
  ),
  country: Schema.optionalKey(Schema.NullOr(CkanOrganizationCountry))
});

const CkanResource = Schema.Struct({
  id: Schema.String,
  access_url: Schema.optionalKey(ckanUrl),
  format: Schema.optionalKey(nullableString),
  size: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  created: Schema.optionalKey(nullableString),
  last_modified: Schema.optionalKey(nullableString)
});

const CkanTemporal = Schema.Struct({
  start_date: Schema.optionalKey(nullableString),
  end_date: Schema.optionalKey(nullableString)
});

const CkanGroup = Schema.Struct({
  id: Schema.optionalKey(nullableString)
});

const CkanLanguage = Schema.Struct({
  id: Schema.optionalKey(nullableString),
  label: Schema.optionalKey(nullableString)
});

/**
 * A single dataset entry from the data.europa.eu CKAN API.
 * All fields kept lenient so that individual row decode failures
 * are collected rather than aborting the whole page.
 */
export const DataEuropaDatasetInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(nullableString),
  type: Schema.optionalKey(nullableString),
  url: Schema.optionalKey(ckanUrl),
  metadata_created: Schema.optionalKey(nullableString),
  metadata_modified: Schema.optionalKey(nullableString),
  translation: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, CkanTranslationEntry))
  ),
  publisher: Schema.optionalKey(Schema.NullOr(CkanPublisher)),
  organization: Schema.optionalKey(Schema.NullOr(CkanOrganization)),
  resources: Schema.optionalKey(
    Schema.NullOr(Schema.Array(CkanResource))
  ),
  temporal: Schema.optionalKey(
    Schema.NullOr(Schema.Array(CkanTemporal))
  ),
  groups: Schema.optionalKey(
    Schema.NullOr(Schema.Array(CkanGroup))
  ),
  tags: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  license_id: Schema.optionalKey(nullableString),
  frequency: Schema.optionalKey(nullableString),
  in_series: Schema.optionalKey(Schema.Unknown),
  series_navigation: Schema.optionalKey(Schema.Unknown),
  language: Schema.optionalKey(
    Schema.NullOr(Schema.Array(CkanLanguage))
  )
});
export type DataEuropaDatasetInfo = Schema.Schema.Type<
  typeof DataEuropaDatasetInfo
>;

/**
 * Raw envelope for the CKAN package_search endpoint.
 * `results` is kept as `Array<Unknown>` so individual rows can be decoded
 * leniently — failures are collected rather than aborting the whole page.
 */
const RawCkanSearchResponse = Schema.Struct({
  result: Schema.Struct({
    count: Schema.Number,
    results: Schema.Array(Schema.Unknown)
  })
});

// ---------------------------------------------------------------------------
// Row-level failure tracking
// ---------------------------------------------------------------------------

export const DataEuropaCatalogRowFailure = Schema.Struct({
  page: Schema.Number,
  row: Schema.Number,
  datasetId: Schema.optionalKey(Schema.String),
  message: Schema.String
});
export type DataEuropaCatalogRowFailure = Schema.Schema.Type<
  typeof DataEuropaCatalogRowFailure
>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class DataEuropaCatalogFetchError extends Schema.TaggedErrorClass<DataEuropaCatalogFetchError>()(
  "DataEuropaCatalogFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class DataEuropaCatalogDecodeError extends Schema.TaggedErrorClass<DataEuropaCatalogDecodeError>()(
  "DataEuropaCatalogDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DataEuropaCatalogFetchResult {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly datasets: ReadonlyArray<DataEuropaDatasetInfo>;
  readonly rowFailures: ReadonlyArray<DataEuropaCatalogRowFailure>;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/u, "");

export const catalogUrl = (
  baseUrl: string,
  rows: number,
  start: number
): string =>
  `${normalizeBaseUrl(baseUrl)}/ckan/package_search?fq=groups:ENER&rows=${rows}&start=${start}&sort=metadata_modified+desc`;

// ---------------------------------------------------------------------------
// HTTP client wrapper
// ---------------------------------------------------------------------------

export const makeDataEuropaHttpClient = Effect.fn(
  "DataEuropa.makeHttpClient"
)(function* (minIntervalMs: number) {
  return yield* withMinIntervalHttpRateLimit(yield* HttpClient.HttpClient, {
    key: "data-europa-api",
    minIntervalMs
  });
});

// ---------------------------------------------------------------------------
// Fetch a single catalog page
// ---------------------------------------------------------------------------

const fetchCatalogPage = Effect.fn("DataEuropa.fetchCatalogPage")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string,
  start: number
) {
  const url = catalogUrl(baseUrl, PAGE_SIZE, start);

  return yield* client
    .get(url)
    .pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      retryTransientHttpEffect,
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(RawCkanSearchResponse)
      ),
      Effect.mapError((cause) =>
        isDecodeError(cause)
          ? new DataEuropaCatalogDecodeError({
              url,
              message: stringifyUnknown(cause)
            })
          : new DataEuropaCatalogFetchError(
              getResponseStatus(cause) === undefined
                ? {
                    url,
                    message: "data.europa.eu catalog request failed"
                  }
                : {
                    url,
                    message: "data.europa.eu catalog request failed",
                    status: getResponseStatus(cause)!
                  }
            )
      )
    );
});

// ---------------------------------------------------------------------------
// Lenient row decoder
// ---------------------------------------------------------------------------

const decodeCatalogRows = (
  page: number,
  rows: ReadonlyArray<unknown>
) =>
  Effect.partition(
    rows,
    (row, index) =>
      Schema.decodeUnknownEffect(DataEuropaDatasetInfo)(row).pipe(
        Effect.mapError((error): DataEuropaCatalogRowFailure => {
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
            ...(rawDatasetId === undefined
              ? {}
              : { datasetId: rawDatasetId }),
            message: formatSchemaParseError(error)
          };
        })
      ),
    { concurrency: "unbounded" }
  ).pipe(
    Effect.map(([failures, datasets]) => ({ failures, datasets }))
  );

// ---------------------------------------------------------------------------
// Paginated catalog fetch (capped at maxDatasets)
// ---------------------------------------------------------------------------

export const fetchCatalog = Effect.fn("DataEuropa.fetchCatalog")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string,
  maxDatasets: number
) {
  const datasets: Array<DataEuropaDatasetInfo> = [];
  const rowFailures: Array<DataEuropaCatalogRowFailure> = [];
  let start = 0;
  let pageCount = 0;
  let totalCount = 0;

  while (true) {
    pageCount += 1;
    const catalogPage = yield* fetchCatalogPage(client, baseUrl, start);
    totalCount = catalogPage.result.count;

    const decodedRows = yield* decodeCatalogRows(
      pageCount,
      catalogPage.result.results
    );
    datasets.push(...decodedRows.datasets);
    rowFailures.push(...decodedRows.failures);

    start += catalogPage.result.results.length;

    if (
      start >= totalCount ||
      datasets.length >= maxDatasets ||
      catalogPage.result.results.length === 0
    ) {
      break;
    }
  }

  // Trim to maxDatasets cap
  const capped = datasets.slice(0, maxDatasets);

  return {
    pageCount,
    totalCount,
    datasets: capped,
    rowFailures
  } satisfies DataEuropaCatalogFetchResult;
});
