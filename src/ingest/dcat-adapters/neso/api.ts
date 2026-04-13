import { Duration, Effect, Option, Schema } from "effect";
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

const REQUEST_TIMEOUT = Duration.seconds(30);
const PAGE_SIZE = 100;

const nullableString = Schema.NullOr(Schema.String);

const NesoTag = Schema.Struct({
  name: Schema.optionalKey(nullableString),
  display_name: Schema.optionalKey(nullableString)
});

const NesoExtra = Schema.Struct({
  key: Schema.optionalKey(nullableString),
  value: Schema.optionalKey(nullableString)
});

const NesoOrganization = Schema.Struct({
  id: Schema.optionalKey(nullableString),
  name: Schema.optionalKey(nullableString),
  title: Schema.optionalKey(nullableString),
  description: Schema.optionalKey(nullableString)
});

const NesoResource = Schema.Struct({
  id: Schema.String,
  name: Schema.optionalKey(nullableString),
  description: Schema.optionalKey(nullableString),
  format: Schema.optionalKey(nullableString),
  mimetype: Schema.optionalKey(nullableString),
  state: Schema.optionalKey(nullableString),
  url: Schema.optionalKey(nullableString),
  created: Schema.optionalKey(nullableString),
  last_modified: Schema.optionalKey(nullableString),
  metadata_modified: Schema.optionalKey(nullableString),
  size: Schema.optionalKey(Schema.Unknown),
  datastore_active: Schema.optionalKey(Schema.Unknown),
  position: Schema.optionalKey(Schema.Unknown)
});

export const NesoPackageInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  title: Schema.optionalKey(nullableString),
  notes: Schema.optionalKey(nullableString),
  type: Schema.optionalKey(nullableString),
  state: Schema.optionalKey(nullableString),
  metadata_created: Schema.optionalKey(nullableString),
  metadata_modified: Schema.optionalKey(nullableString),
  license_title: Schema.optionalKey(nullableString),
  license_url: Schema.optionalKey(nullableString),
  tags: Schema.optionalKey(Schema.NullOr(Schema.Array(NesoTag))),
  extras: Schema.optionalKey(Schema.NullOr(Schema.Array(NesoExtra))),
  organization: Schema.optionalKey(Schema.NullOr(NesoOrganization)),
  resources: Schema.optionalKey(Schema.NullOr(Schema.Array(NesoResource)))
});
export type NesoPackageInfo = Schema.Schema.Type<typeof NesoPackageInfo>;

const RawNesoSearchResponse = Schema.Struct({
  result: Schema.Struct({
    count: Schema.Number,
    results: Schema.Array(Schema.Unknown)
  })
});

export const NesoCatalogRowFailure = Schema.Struct({
  page: Schema.Number,
  row: Schema.Number,
  datasetId: Schema.optionalKey(Schema.String),
  message: Schema.String
});
export type NesoCatalogRowFailure = Schema.Schema.Type<
  typeof NesoCatalogRowFailure
>;

export class NesoCatalogFetchError extends Schema.TaggedErrorClass<NesoCatalogFetchError>()(
  "NesoCatalogFetchError",
  {
    url: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number)
  }
) {}

export class NesoCatalogDecodeError extends Schema.TaggedErrorClass<NesoCatalogDecodeError>()(
  "NesoCatalogDecodeError",
  {
    url: Schema.String,
    message: Schema.String
  }
) {}

export interface NesoCatalogFetchResult {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly datasets: ReadonlyArray<NesoPackageInfo>;
  readonly rowFailures: ReadonlyArray<NesoCatalogRowFailure>;
}

const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.replace(/\/+$/u, "");

export const catalogUrl = (
  baseUrl: string,
  rows: number,
  start: number
): string => {
  const params = new URLSearchParams({
    fq: "state:active",
    rows: String(rows),
    start: String(start),
    sort: "metadata_modified desc"
  });

  return `${normalizeBaseUrl(baseUrl)}/package_search?${params.toString()}`;
};

export const makeNesoHttpClient = Effect.fn("Neso.makeHttpClient")(function* (
  minIntervalMs: number
) {
  return yield* withMinIntervalHttpRateLimit(yield* HttpClient.HttpClient, {
    key: "neso-ckan-api",
    minIntervalMs
  });
});

const fetchCatalogPage = Effect.fn("Neso.fetchCatalogPage")(function* <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string,
  start: number
) {
  const url = catalogUrl(baseUrl, PAGE_SIZE, start);

  return yield* client.get(url).pipe(
    Effect.timeout(REQUEST_TIMEOUT),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    retryTransientHttpEffect,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RawNesoSearchResponse)),
    Effect.mapError((cause) =>
      isDecodeError(cause)
        ? new NesoCatalogDecodeError({
            url,
            message: stringifyUnknown(cause)
          })
        : new NesoCatalogFetchError(
            getResponseStatus(cause) === undefined
              ? {
                  url,
                  message: "NESO catalog request failed"
                }
              : {
                  url,
                  message: "NESO catalog request failed",
                  status: getResponseStatus(cause)!
                }
          )
    )
  );
});

const decodeCatalogRows = (page: number, rows: ReadonlyArray<unknown>) =>
  Effect.partition(
    rows,
    (row, index) =>
      Schema.decodeUnknownEffect(NesoPackageInfo)(row).pipe(
        Effect.mapError((error): NesoCatalogRowFailure => {
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
  ).pipe(Effect.map(([failures, datasets]) => ({ failures, datasets })));

const isActiveDataset = (dataset: NesoPackageInfo): boolean => {
  const state = dataset.state?.trim().toLowerCase();
  return state === undefined || state.length === 0 || state === "active";
};

const matchesOnlyDataset = (
  dataset: NesoPackageInfo,
  onlyDataset: Option.Option<string>
): boolean =>
  Option.match(onlyDataset, {
    onNone: () => true,
    onSome: (value) => dataset.name === value
  });

export const fetchCatalog = Effect.fn("Neso.fetchCatalog")(function* <E, R>(
  client: HttpClient.HttpClient.With<E, R>,
  baseUrl: string,
  options: {
    readonly maxDatasets: number;
    readonly onlyDataset: Option.Option<string>;
  }
) {
  const datasets: Array<NesoPackageInfo> = [];
  const rowFailures: Array<NesoCatalogRowFailure> = [];
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
    datasets.push(
      ...decodedRows.datasets.filter(
        (dataset) =>
          isActiveDataset(dataset) &&
          matchesOnlyDataset(dataset, options.onlyDataset)
      )
    );
    rowFailures.push(...decodedRows.failures);

    start += catalogPage.result.results.length;
    if (
      start >= totalCount ||
      datasets.length >= options.maxDatasets ||
      catalogPage.result.results.length === 0
    ) {
      break;
    }
  }

  return {
    pageCount,
    totalCount,
    datasets: datasets.slice(0, options.maxDatasets),
    rowFailures
  } satisfies NesoCatalogFetchResult;
});
