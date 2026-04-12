import { Duration, Effect, Schema } from "effect";
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

const REQUEST_TIMEOUT = Duration.seconds(20);
const PAGE_LIMIT = 100;

const nullableString = Schema.NullOr(Schema.String);
const nullableNumber = Schema.NullOr(Schema.Number);

// ---------------------------------------------------------------------------
// API Response Schemas
// ---------------------------------------------------------------------------

/** Default metadata block present on every ODS dataset. */
const OdreDefaultMetas = Schema.Struct({
  title: Schema.optionalKey(nullableString),
  description: Schema.optionalKey(nullableString),
  keyword: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  theme: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  modified: Schema.optionalKey(nullableString),
  publisher: Schema.optionalKey(nullableString),
  language: Schema.optionalKey(nullableString),
  license: Schema.optionalKey(nullableString),
  records_count: Schema.optionalKey(nullableNumber)
});

/** DCAT metadata block (temporal coverage, creation date, creator). */
const OdreDcatMetas = Schema.Struct({
  temporal: Schema.optionalKey(nullableString),
  created: Schema.optionalKey(nullableString),
  creator: Schema.optionalKey(nullableString)
});

/** DCAT-AP metadata block (access rights). */
const OdreDcatApMetas = Schema.Struct({
  access_right: Schema.optionalKey(nullableString)
});

const OdreMetas = Schema.Struct({
  default: OdreDefaultMetas,
  dcat: Schema.optionalKey(Schema.NullOr(OdreDcatMetas)),
  dcat_ap: Schema.optionalKey(Schema.NullOr(OdreDcatApMetas))
});

/**
 * A single dataset entry from the OpenDataSoft v2.1 catalog.
 * Only the fields needed for DCAT mapping are modeled.
 */
export const OdreDatasetInfo = Schema.Struct({
  dataset_id: Schema.String,
  metas: OdreMetas
});
export type OdreDatasetInfo = Schema.Schema.Type<typeof OdreDatasetInfo>;

/**
 * Raw envelope for the catalog listing endpoint.
 * `results` is kept as `Array<Unknown>` so individual rows can be decoded
 * leniently — failures are collected rather than aborting the whole page.
 */
const RawOdreCatalogResponse = Schema.Struct({
  total_count: Schema.Number,
  results: Schema.Array(Schema.Unknown)
});

// ---------------------------------------------------------------------------
// Row-level failure tracking
// ---------------------------------------------------------------------------

export const OdreCatalogRowFailure = Schema.Struct({
  page: Schema.Number,
  row: Schema.Number,
  datasetId: Schema.optionalKey(Schema.String),
  message: Schema.String
});
export type OdreCatalogRowFailure = Schema.Schema.Type<
  typeof OdreCatalogRowFailure
>;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class OdreCatalogFetchError extends Schema.TaggedErrorClass<OdreCatalogFetchError>()(
  "OdreCatalogFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class OdreCatalogDecodeError extends Schema.TaggedErrorClass<OdreCatalogDecodeError>()(
  "OdreCatalogDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface OdreCatalogFetchResult {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly datasets: ReadonlyArray<OdreDatasetInfo>;
  readonly rowFailures: ReadonlyArray<OdreCatalogRowFailure>;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/u, "");

export const catalogUrl = (baseUrl: string, limit: number, offset: number): string =>
  `${normalizeBaseUrl(baseUrl)}/catalog/datasets?limit=${limit}&offset=${offset}`;

// ---------------------------------------------------------------------------
// HTTP client wrapper
// ---------------------------------------------------------------------------

export const makeOdreHttpClient = Effect.fn(
  "Odre.makeHttpClient"
)(function* (minIntervalMs: number) {
  return yield* withMinIntervalHttpRateLimit(yield* HttpClient.HttpClient, {
    key: "odre-api",
    minIntervalMs
  });
});

// ---------------------------------------------------------------------------
// Fetch a single catalog page
// ---------------------------------------------------------------------------

const fetchCatalogPage = Effect.fn("Odre.fetchCatalogPage")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string,
  offset: number
) {
  const url = catalogUrl(baseUrl, PAGE_LIMIT, offset);

  return yield* client
    .get(url)
    .pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      retryTransientHttpEffect,
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(RawOdreCatalogResponse)
      ),
      Effect.mapError((cause) =>
        isDecodeError(cause)
          ? new OdreCatalogDecodeError({
              url,
              message: stringifyUnknown(cause)
            })
          : new OdreCatalogFetchError(
              getResponseStatus(cause) === undefined
                ? {
                    url,
                    message: "ODRE catalog request failed"
                  }
                : {
                    url,
                    message: "ODRE catalog request failed",
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
): Effect.Effect<
  {
    readonly failures: ReadonlyArray<OdreCatalogRowFailure>;
    readonly datasets: ReadonlyArray<OdreDatasetInfo>;
  },
  never
> =>
  Effect.partition(
    rows,
    (row, index) =>
      Schema.decodeUnknownEffect(OdreDatasetInfo)(row).pipe(
        Effect.mapError((error): OdreCatalogRowFailure => {
          const rawDatasetId =
            typeof row === "object" &&
            row !== null &&
            "dataset_id" in row &&
            typeof row.dataset_id === "string"
              ? row.dataset_id
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
// Paginated catalog fetch
// ---------------------------------------------------------------------------

export const fetchCatalog = Effect.fn("Odre.fetchCatalog")(function* <
  E,
  R
>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string
) {
  const datasets: Array<OdreDatasetInfo> = [];
  const rowFailures: Array<OdreCatalogRowFailure> = [];
  let offset = 0;
  let pageCount = 0;
  let totalCount = 0;

  while (true) {
    pageCount += 1;
    const catalogPage = yield* fetchCatalogPage(client, baseUrl, offset);
    totalCount = catalogPage.total_count;

    const decodedRows = yield* decodeCatalogRows(
      pageCount,
      catalogPage.results
    );
    datasets.push(...decodedRows.datasets);
    rowFailures.push(...decodedRows.failures);

    offset += catalogPage.results.length;

    if (offset >= totalCount) {
      break;
    }
  }

  return {
    pageCount,
    totalCount,
    datasets,
    rowFailures
  } satisfies OdreCatalogFetchResult;
});
