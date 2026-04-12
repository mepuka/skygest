import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { DataEuropaIngestKeys } from "../../../platform/ConfigShapes";
import { Logging } from "../../../platform/Logging";
import { encodeJsonStringPrettyWith } from "../../../platform/Json";
import {
  type DcatAdapter,
  type DcatSuccessInput,
  type DcatValidationFailureInput,
  IngestFsError,
  runDcatIngest,
  writeEntityFileWith
} from "../../dcat-harness";
import {
  type DataEuropaCatalogFetchResult,
  type DataEuropaCatalogRowFailure,
  type DataEuropaDatasetInfo,
  DataEuropaCatalogDecodeError,
  DataEuropaCatalogFetchError,
  DataEuropaCatalogRowFailure as DataEuropaCatalogRowFailureSchema,
  fetchCatalog,
  makeDataEuropaHttpClient
} from "./api";
import { type BuildContext, buildContextFromIndex } from "./buildContext";
import { buildCandidateNodes } from "./buildCandidateNodes";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ScriptConfig = Config.all(DataEuropaIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// Report schema
// ---------------------------------------------------------------------------

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "data-europa-ingest-report.json";

const DataEuropaValidationFailure = Schema.Struct({
  kind: Schema.String,
  slug: Schema.String,
  message: Schema.String
});

const DataEuropaIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  pageCount: Schema.Number,
  totalAvailable: Schema.Number,
  datasetCount: Schema.Number,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  datasets: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
  rowFailures: Schema.optionalKey(
    Schema.Array(DataEuropaCatalogRowFailureSchema)
  ),
  validationFailures: Schema.optionalKey(
    Schema.Array(DataEuropaValidationFailure)
  )
});
type DataEuropaIngestReport = Schema.Schema.Type<typeof DataEuropaIngestReport>;

const encodeReport = encodeJsonStringPrettyWith(DataEuropaIngestReport);

// ---------------------------------------------------------------------------
// Fetched payload
// ---------------------------------------------------------------------------

interface FetchedDataEuropaCatalog {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly datasets: ReadonlyArray<DataEuropaDatasetInfo>;
  readonly rowFailures: ReadonlyArray<DataEuropaCatalogRowFailure>;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly pageCount: number;
  readonly totalAvailable: number;
  readonly datasetCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly rowFailures: ReadonlyArray<DataEuropaCatalogRowFailure>;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): DataEuropaIngestReport => ({
  fetchedAt: input.fetchedAt,
  pageCount: input.pageCount,
  totalAvailable: input.totalAvailable,
  datasetCount: input.datasetCount,
  nodeCount: input.nodeCount,
  edgeCount: input.edgeCount,
  datasets: {
    created: [...input.datasetsCreated],
    merged: [...input.datasetsMerged]
  },
  distributions: { count: input.distributionCount },
  catalogRecords: { count: input.catalogRecordCount },
  ...(input.rowFailures.length === 0
    ? {}
    : { rowFailures: [...input.rowFailures] }),
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : { validationFailures: [...input.validationFailures] })
});

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

const writeIngestReport = Effect.fn("DataEuropa.writeIngestReport")(
  function* (rootDir: string, report: DataEuropaIngestReport) {
    const path_ = yield* Path.Path;
    const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
    const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
    yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
  }
);

// ---------------------------------------------------------------------------
// Row failure logging
// ---------------------------------------------------------------------------

const logRowFailures = (
  failures: ReadonlyArray<DataEuropaCatalogRowFailure>
) =>
  failures.length === 0
    ? Effect.void
    : Logging.logWarning("data-europa row decode failures", {
        count: failures.length,
        sample: failures.slice(0, 20),
        omittedCount: Math.max(failures.length - 20, 0)
      });

// ---------------------------------------------------------------------------
// Candidate stats helper
// ---------------------------------------------------------------------------

const candidateDatasetStats = (
  candidates: ReadonlyArray<{
    readonly _tag: string;
    readonly slug: string;
    readonly merged: boolean;
  }>
) => {
  const datasetNodes = candidates.filter(
    (
      candidate
    ): candidate is {
      readonly _tag: "dataset";
      readonly slug: string;
      readonly merged: boolean;
    } => candidate._tag === "dataset"
  );

  return {
    datasetsCreated: datasetNodes
      .filter((candidate) => !candidate.merged)
      .map((candidate) => candidate.slug),
    datasetsMerged: datasetNodes
      .filter((candidate) => candidate.merged)
      .map((candidate) => candidate.slug),
    distributionCount: candidates.filter(
      (candidate) => candidate._tag === "distribution"
    ).length,
    catalogRecordCount: candidates.filter(
      (candidate) => candidate._tag === "catalog-record"
    ).length
  };
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const onValidationFailure = (
  input: DcatValidationFailureInput<
    ScriptConfigShape,
    FetchedDataEuropaCatalog,
    BuildContext
  >
) =>
  Effect.gen(function* () {
    const {
      datasetsCreated,
      datasetsMerged,
      distributionCount,
      catalogRecordCount
    } = candidateDatasetStats(input.candidates);
    yield* logRowFailures(input.fetched.rowFailures);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        totalAvailable: input.fetched.totalCount,
        datasetCount: input.fetched.datasets.length,
        nodeCount: input.candidates.length,
        edgeCount: 0,
        datasetsCreated,
        datasetsMerged,
        distributionCount,
        catalogRecordCount,
        rowFailures: input.fetched.rowFailures,
        validationFailures: input.failures
      })
    );
  });

const onSuccess = (
  input: DcatSuccessInput<
    ScriptConfigShape,
    FetchedDataEuropaCatalog,
    BuildContext
  >
) =>
  Effect.gen(function* () {
    yield* logRowFailures(input.fetched.rowFailures);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        totalAvailable: input.fetched.totalCount,
        datasetCount: input.fetched.datasets.length,
        nodeCount: input.nodeCount,
        edgeCount: input.edgeCount,
        datasetsCreated: input.datasetsCreated,
        datasetsMerged: input.datasetsMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount,
        rowFailures: input.fetched.rowFailures
      })
    );
  });

// ---------------------------------------------------------------------------
// Adapter + runner
// ---------------------------------------------------------------------------

export const runDataEuropaIngest = Effect.fn("DataEuropa.runIngest")(
  function* (config: ScriptConfigShape) {
    const adapter: DcatAdapter<
      ScriptConfigShape,
      FetchedDataEuropaCatalog,
      BuildContext,
      DataEuropaCatalogFetchError | DataEuropaCatalogDecodeError,
      never,
      IngestFsError,
      HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
    > = {
      name: "data-europa",
      mergeAliasScheme: AliasSchemeValues.europaDatasetId,
      describeStart: (cfg) => ({
        baseUrl: cfg.baseUrl,
        maxDatasets: cfg.maxDatasets
      }),
      fetch: (cfg) =>
        Effect.gen(function* () {
          const http = yield* makeDataEuropaHttpClient(cfg.minIntervalMs);
          const result: DataEuropaCatalogFetchResult = yield* fetchCatalog(
            http,
            cfg.baseUrl,
            cfg.maxDatasets
          );

          return {
            pageCount: result.pageCount,
            totalCount: result.totalCount,
            datasets: result.datasets,
            rowFailures: result.rowFailures
          };
        }),
      describeFetch: ({ datasets, pageCount, totalCount, rowFailures }) => ({
        pageCount,
        totalAvailable: totalCount,
        datasetCount: datasets.length,
        rowFailureCount: rowFailures.length
      }),
      buildContextFromIndex: (idx, nowIso) =>
        Effect.succeed(buildContextFromIndex(idx, nowIso)),
      buildCandidateNodes: ({ datasets }, idx, context) =>
        buildCandidateNodes(datasets, idx, context),
      onValidationFailure,
      onSuccess,
      describeCompletion: ({ fetched }) => ({
        datasetCount: fetched.datasets.length,
        totalAvailable: fetched.totalCount,
        pageCount: fetched.pageCount,
        rowFailureCount: fetched.rowFailures.length
      })
    };

    return yield* runDcatIngest(config, adapter);
  }
);
