import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { OdreIngestKeys } from "../../../platform/ConfigShapes";
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
  type OdreCatalogFetchResult,
  type OdreCatalogRowFailure,
  type OdreDatasetInfo,
  OdreCatalogDecodeError,
  OdreCatalogFetchError,
  OdreCatalogRowFailure as OdreCatalogRowFailureSchema,
  fetchCatalog,
  makeOdreHttpClient
} from "./api";
import { type BuildContext, buildContextFromIndex } from "./buildContext";
import { buildCandidateNodes } from "./buildCandidateNodes";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ScriptConfig = Config.all(OdreIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// Report schema
// ---------------------------------------------------------------------------

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "odre-ingest-report.json";

const OdreValidationFailure = Schema.Struct({
  kind: Schema.String,
  slug: Schema.String,
  message: Schema.String
});

const OdreIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  pageCount: Schema.Number,
  datasetCount: Schema.Number,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  datasets: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  datasetSeries: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
  rowFailures: Schema.optionalKey(Schema.Array(OdreCatalogRowFailureSchema)),
  validationFailures: Schema.optionalKey(
    Schema.Array(OdreValidationFailure)
  )
});
type OdreIngestReport = Schema.Schema.Type<typeof OdreIngestReport>;

const encodeReport = encodeJsonStringPrettyWith(OdreIngestReport);

// ---------------------------------------------------------------------------
// Fetched payload
// ---------------------------------------------------------------------------

interface FetchedOdreCatalog {
  readonly pageCount: number;
  readonly datasets: ReadonlyArray<OdreDatasetInfo>;
  readonly rowFailures: ReadonlyArray<OdreCatalogRowFailure>;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly pageCount: number;
  readonly datasetCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly datasetSeriesCreated: ReadonlyArray<string>;
  readonly datasetSeriesMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly rowFailures: ReadonlyArray<OdreCatalogRowFailure>;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): OdreIngestReport => ({
  fetchedAt: input.fetchedAt,
  pageCount: input.pageCount,
  datasetCount: input.datasetCount,
  nodeCount: input.nodeCount,
  edgeCount: input.edgeCount,
  datasets: {
    created: [...input.datasetsCreated],
    merged: [...input.datasetsMerged]
  },
  datasetSeries: {
    created: [...input.datasetSeriesCreated],
    merged: [...input.datasetSeriesMerged]
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

const writeIngestReport = Effect.fn("Odre.writeIngestReport")(function* (
  rootDir: string,
  report: OdreIngestReport
) {
  const path_ = yield* Path.Path;
  const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
  const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
  yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
});

// ---------------------------------------------------------------------------
// Row failure logging
// ---------------------------------------------------------------------------

const logRowFailures = (
  failures: ReadonlyArray<OdreCatalogRowFailure>
) =>
  failures.length === 0
    ? Effect.void
    : Logging.logWarning("odre row decode failures", {
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
  const datasetSeriesNodes = candidates.filter(
    (
      candidate
    ): candidate is {
      readonly _tag: "dataset-series";
      readonly slug: string;
      readonly merged: boolean;
    } => candidate._tag === "dataset-series"
  );

  return {
    datasetsCreated: datasetNodes
      .filter((candidate) => !candidate.merged)
      .map((candidate) => candidate.slug),
    datasetsMerged: datasetNodes
      .filter((candidate) => candidate.merged)
      .map((candidate) => candidate.slug),
    datasetSeriesCreated: datasetSeriesNodes
      .filter((candidate) => !candidate.merged)
      .map((candidate) => candidate.slug),
    datasetSeriesMerged: datasetSeriesNodes
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
    FetchedOdreCatalog,
    BuildContext
  >
) =>
  Effect.gen(function* () {
    const {
      datasetsCreated,
      datasetsMerged,
      datasetSeriesCreated,
      datasetSeriesMerged,
      distributionCount,
      catalogRecordCount
    } = candidateDatasetStats(input.candidates);
    yield* logRowFailures(input.fetched.rowFailures);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        datasetCount: input.fetched.datasets.length,
        nodeCount: input.candidates.length,
        edgeCount: 0,
        datasetsCreated,
        datasetsMerged,
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount,
        catalogRecordCount,
        rowFailures: input.fetched.rowFailures,
        validationFailures: input.failures
      })
    );
  });

const onSuccess = (
  input: DcatSuccessInput<ScriptConfigShape, FetchedOdreCatalog, BuildContext>
) =>
  Effect.gen(function* () {
    const {
      datasetSeriesCreated,
      datasetSeriesMerged
    } = candidateDatasetStats(input.topoOrder);
    yield* logRowFailures(input.fetched.rowFailures);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        datasetCount: input.fetched.datasets.length,
        nodeCount: input.nodeCount,
        edgeCount: input.edgeCount,
        datasetsCreated: input.datasetsCreated,
        datasetsMerged: input.datasetsMerged,
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount,
        rowFailures: input.fetched.rowFailures
      })
    );
  });

// ---------------------------------------------------------------------------
// Adapter + runner
// ---------------------------------------------------------------------------

export const runOdreIngest = Effect.fn("Odre.runIngest")(function* (
  config: ScriptConfigShape
) {
  const adapter: DcatAdapter<
    ScriptConfigShape,
    FetchedOdreCatalog,
    BuildContext,
    OdreCatalogFetchError | OdreCatalogDecodeError,
    never,
    IngestFsError,
    HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
  > = {
    name: "odre",
    mergeAliasScheme: AliasSchemeValues.odreDatasetId,
    describeStart: (cfg) => ({ baseUrl: cfg.baseUrl }),
    fetch: (cfg) =>
      Effect.gen(function* () {
        const http = yield* makeOdreHttpClient(cfg.minIntervalMs);
        const result: OdreCatalogFetchResult = yield* fetchCatalog(
          http,
          cfg.baseUrl
        );

        return {
          pageCount: result.pageCount,
          datasets: result.datasets,
          rowFailures: result.rowFailures
        };
      }),
    describeFetch: ({ datasets, pageCount, rowFailures }) => ({
      pageCount,
      datasetCount: datasets.length,
      rowFailureCount: rowFailures.length
    }),
    buildContextFromIndex: (idx, nowIso) =>
      Effect.sync(() => buildContextFromIndex(idx, nowIso)),
    buildCandidateNodes: ({ datasets }, idx, context) =>
      buildCandidateNodes(datasets, idx, context),
    onValidationFailure,
    onSuccess,
    describeCompletion: ({ fetched }) => ({
      datasetCount: fetched.datasets.length,
      pageCount: fetched.pageCount,
      rowFailureCount: fetched.rowFailures.length
    })
  };

  return yield* runDcatIngest(config, adapter);
});
