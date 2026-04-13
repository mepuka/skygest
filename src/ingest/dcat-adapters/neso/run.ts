import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { NesoIngestKeys } from "../../../platform/ConfigShapes";
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
  type BuildContext,
  buildContextFromIndex
} from "./buildContext";
import { buildCandidateNodes } from "./buildCandidateNodes";
import {
  type NesoCatalogDecodeError,
  type NesoCatalogFetchError,
  type NesoCatalogFetchResult,
  type NesoCatalogRowFailure,
  NesoCatalogRowFailure as NesoCatalogRowFailureSchema,
  fetchCatalog,
  makeNesoHttpClient
} from "./api";

export const ScriptConfig = Config.all(NesoIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "neso-ingest-report.json";
const NESO_SITE_PREFIX = "https://www.neso.energy/data-portal/";

const NesoValidationFailure = Schema.Struct({
  kind: Schema.String,
  slug: Schema.String,
  message: Schema.String
});

const NesoIngestReport = Schema.Struct({
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
  datasetSeries: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
  rowFailures: Schema.optionalKey(
    Schema.Array(NesoCatalogRowFailureSchema)
  ),
  validationFailures: Schema.optionalKey(
    Schema.Array(NesoValidationFailure)
  )
});
type NesoIngestReport = Schema.Schema.Type<typeof NesoIngestReport>;

const encodeReport = encodeJsonStringPrettyWith(NesoIngestReport);

interface FetchedNesoCatalog {
  readonly pageCount: number;
  readonly totalCount: number;
  readonly datasets: ReadonlyArray<NesoCatalogFetchResult["datasets"][number]>;
  readonly rowFailures: ReadonlyArray<NesoCatalogRowFailure>;
}

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly pageCount: number;
  readonly totalAvailable: number;
  readonly datasetCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly datasetSeriesCreated: ReadonlyArray<string>;
  readonly datasetSeriesMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly rowFailures: ReadonlyArray<NesoCatalogRowFailure>;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): NesoIngestReport => ({
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
  datasetSeries: {
    created: [...input.datasetSeriesCreated],
    merged: [...input.datasetSeriesMerged]
  },
  distributions: { count: input.distributionCount },
  catalogRecords: { count: input.catalogRecordCount },
  ...(input.rowFailures.length === 0 ? {} : { rowFailures: [...input.rowFailures] }),
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : { validationFailures: [...input.validationFailures] })
});

const writeIngestReport = Effect.fn("Neso.writeIngestReport")(function* (
  rootDir: string,
  report: NesoIngestReport
) {
  const path_ = yield* Path.Path;
  const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
  const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
  yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
});

const logRowFailures = (failures: ReadonlyArray<NesoCatalogRowFailure>) =>
  failures.length === 0
    ? Effect.void
    : Logging.logWarning("neso row decode failures", {
        count: failures.length,
        sample: failures.slice(0, 20),
        omittedCount: Math.max(failures.length - 20, 0)
      });

const candidateNodeStats = (
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

const onValidationFailure = (
  input: DcatValidationFailureInput<
    ScriptConfigShape,
    FetchedNesoCatalog,
    BuildContext
  >
) => {
  const {
    datasetsCreated,
    datasetsMerged,
    datasetSeriesCreated,
    datasetSeriesMerged,
    distributionCount,
    catalogRecordCount
  } = candidateNodeStats(input.candidates);

  return writeIngestReport(
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
      datasetSeriesCreated,
      datasetSeriesMerged,
      distributionCount,
      catalogRecordCount,
      rowFailures: input.fetched.rowFailures,
      validationFailures: input.failures
    })
  );
};

const onSuccess = (
  input: DcatSuccessInput<ScriptConfigShape, FetchedNesoCatalog, BuildContext>
) =>
  Effect.gen(function* () {
    const {
      datasetSeriesCreated,
      datasetSeriesMerged
    } = candidateNodeStats(input.topoOrder);

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
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount,
        rowFailures: input.fetched.rowFailures
      })
    );
  });

const adapter: DcatAdapter<
  ScriptConfigShape,
  FetchedNesoCatalog,
  BuildContext,
  NesoCatalogFetchError | NesoCatalogDecodeError,
  never,
  IngestFsError,
  HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
> = {
  name: "neso",
  mergeAliasScheme: AliasSchemeValues.url,
  isMergeableDatasetAlias: (alias) =>
    alias.scheme === AliasSchemeValues.url &&
    alias.value.startsWith(NESO_SITE_PREFIX),
  describeStart: (config) => ({
    baseUrl: config.baseUrl,
    maxDatasets: config.maxDatasets,
    onlyDataset: Option.getOrElse(config.onlyDataset, () => "all"),
    minIntervalMs: config.minIntervalMs
  }),
  fetch: (config) =>
    Effect.gen(function* () {
      const client = yield* makeNesoHttpClient(config.minIntervalMs);
      const fetched = yield* fetchCatalog(client, config.baseUrl, {
        maxDatasets: config.maxDatasets,
        onlyDataset: config.onlyDataset
      });
      yield* logRowFailures(fetched.rowFailures);
      return fetched;
    }),
  describeFetch: (fetched) => ({
    pageCount: fetched.pageCount,
    totalAvailable: fetched.totalCount,
    datasetCount: fetched.datasets.length,
    rowFailureCount: fetched.rowFailures.length
  }),
  buildContextFromIndex: (idx, nowIso) =>
    Effect.succeed(buildContextFromIndex(idx, nowIso)),
  buildCandidateNodes: (fetched, idx, context) =>
    buildCandidateNodes(fetched.datasets, idx, context),
  onValidationFailure,
  onSuccess,
  describeCompletion: (input) => ({
    dryRun: input.dryRun,
    nodeCount: input.nodeCount,
    edgeCount: input.edgeCount,
    datasetCount: input.fetched.datasets.length,
    distributionCount: input.distributionCount,
    catalogRecordCount: input.catalogRecordCount
  })
};

export const runNesoIngest = Effect.fn("Neso.runIngest")(function* (
  config: ScriptConfigShape
) {
  yield* runDcatIngest(config, adapter);
});
