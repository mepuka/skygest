import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { GridStatusIngestKeys } from "../../../platform/ConfigShapes";
import { Logging } from "../../../platform/Logging";
import {
  encodeJsonStringPrettyWith,
  stringifyUnknown
} from "../../../platform/Json";
import {
  type DcatAdapter,
  type DcatSuccessInput,
  type DcatValidationFailureInput,
  IngestFsError,
  runDcatIngest,
  writeEntityFileWith
} from "../../dcat-harness";
import {
  type GridStatusApiUsageResponse,
  type GridStatusCatalogRowFailure,
  type GridStatusDatasetInfo,
  GridStatusApiUsageDecodeError,
  GridStatusApiUsageFetchError,
  GridStatusCatalogDecodeError,
  GridStatusCatalogFetchError,
  fetchApiUsage,
  fetchCatalog,
  makeGridStatusHttpClient,
  GridStatusCatalogRowFailure as GridStatusCatalogRowFailureSchema
} from "./api";
import { type BuildContext, buildContextFromIndex } from "./buildContext";
import {
  buildCandidateNodes,
  type GridStatusProvenanceWarning,
  GridStatusProvenanceWarning as GridStatusProvenanceWarningSchema
} from "./buildCandidateNodes";

export const ScriptConfig = Config.all(GridStatusIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "gridstatus-ingest-report.json";
const PLACEHOLDER_FILES = [
  ["datasets", "gridstatus-us-grid.json"],
  ["catalog-records", "gridstatus-us-grid-cr.json"],
  ["distributions", "gridstatus-api-access.json"],
  ["distributions", "gridstatus-python.json"],
  ["distributions", "gridstatus-web.json"]
] as const;

const GridStatusRateLimitBudget = Schema.Struct({
  planName: Schema.NullOr(Schema.String),
  currentUsagePeriodStart: Schema.NullOr(Schema.String),
  currentUsagePeriodEnd: Schema.NullOr(Schema.String),
  totalRequestsUsed: Schema.NullOr(Schema.Number),
  totalRequestsLimit: Schema.NullOr(Schema.Number),
  totalRequestsRemaining: Schema.NullOr(Schema.Number),
  totalRowsUsed: Schema.NullOr(Schema.Number),
  totalRowsLimit: Schema.NullOr(Schema.Number),
  totalRowsRemaining: Schema.NullOr(Schema.Number),
  perSecondRateLimit: Schema.NullOr(Schema.Number),
  perMinuteRateLimit: Schema.NullOr(Schema.Number),
  perHourRateLimit: Schema.NullOr(Schema.Number)
});
type GridStatusRateLimitBudget = Schema.Schema.Type<
  typeof GridStatusRateLimitBudget
>;

const GridStatusValidationFailure = Schema.Struct({
  kind: Schema.String,
  slug: Schema.String,
  message: Schema.String
});

const GridStatusIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  pageCount: Schema.Number,
  datasetCount: Schema.Number,
  sourceCount: Schema.Number,
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
  removedPlaceholders: Schema.Array(Schema.String),
  rateLimitBudget: Schema.optionalKey(GridStatusRateLimitBudget),
  rowFailures: Schema.optionalKey(Schema.Array(GridStatusCatalogRowFailureSchema)),
  provenanceWarnings: Schema.optionalKey(
    Schema.Array(GridStatusProvenanceWarningSchema)
  ),
  validationFailures: Schema.optionalKey(
    Schema.Array(GridStatusValidationFailure)
  )
});
type GridStatusIngestReport = Schema.Schema.Type<
  typeof GridStatusIngestReport
>;

const encodeReport = encodeJsonStringPrettyWith(GridStatusIngestReport);

interface FetchedGridStatusCatalog {
  readonly pageCount: number;
  readonly datasets: ReadonlyArray<GridStatusDatasetInfo>;
  readonly sourceLabels: ReadonlyArray<string>;
  readonly baseUrl: string;
  readonly meta: Record<string, unknown> | null;
  readonly rowFailures: ReadonlyArray<GridStatusCatalogRowFailure>;
  readonly rateLimitBudget: GridStatusRateLimitBudget | null;
}

const budgetSnapshotFromUsage = (
  usage: GridStatusApiUsageResponse
): GridStatusRateLimitBudget => {
  const totalRequestsLimit = usage.limits?.api_requests_limit ?? null;
  const totalRequestsUsed = usage.current_period_usage?.total_requests ?? null;
  const totalRowsLimit = usage.limits?.api_rows_returned_limit ?? null;
  const totalRowsUsed =
    usage.current_period_usage?.total_api_rows_returned ?? null;

  return {
    planName: usage.plan_name ?? null,
    currentUsagePeriodStart: usage.current_usage_period_start ?? null,
    currentUsagePeriodEnd: usage.current_usage_period_end ?? null,
    totalRequestsUsed,
    totalRequestsLimit,
    totalRequestsRemaining:
      totalRequestsLimit === null || totalRequestsUsed === null
        ? null
        : Math.max(totalRequestsLimit - totalRequestsUsed, 0),
    totalRowsUsed,
    totalRowsLimit,
    totalRowsRemaining:
      totalRowsLimit === null || totalRowsUsed === null
        ? null
        : Math.max(totalRowsLimit - totalRowsUsed, 0),
    perSecondRateLimit: usage.limits?.per_second_api_rate_limit ?? null,
    perMinuteRateLimit: usage.limits?.per_minute_api_rate_limit ?? null,
    perHourRateLimit: usage.limits?.per_hour_api_rate_limit ?? null
  };
};

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly pageCount: number;
  readonly datasetCount: number;
  readonly sourceCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly datasetSeriesCreated: ReadonlyArray<string>;
  readonly datasetSeriesMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly removedPlaceholders: ReadonlyArray<string>;
  readonly rateLimitBudget: GridStatusRateLimitBudget | null;
  readonly rowFailures: ReadonlyArray<GridStatusCatalogRowFailure>;
  readonly provenanceWarnings: ReadonlyArray<GridStatusProvenanceWarning>;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): GridStatusIngestReport => ({
  fetchedAt: input.fetchedAt,
  pageCount: input.pageCount,
  datasetCount: input.datasetCount,
  sourceCount: input.sourceCount,
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
  removedPlaceholders: [...input.removedPlaceholders],
  ...(input.rateLimitBudget === null
    ? {}
    : { rateLimitBudget: input.rateLimitBudget }),
  ...(input.rowFailures.length === 0
    ? {}
    : { rowFailures: [...input.rowFailures] }),
  ...(input.provenanceWarnings.length === 0
    ? {}
    : { provenanceWarnings: [...input.provenanceWarnings] }),
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : { validationFailures: [...input.validationFailures] })
});

const writeIngestReport = Effect.fn("GridStatus.writeIngestReport")(function* (
  rootDir: string,
  report: GridStatusIngestReport
) {
  const path_ = yield* Path.Path;
  const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
  const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
  yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
});

const ingestFsError = (
  operation: string,
  path: string,
  cause: unknown
): IngestFsError =>
  new IngestFsError({
    operation,
    path,
    message: stringifyUnknown(cause)
  });

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

const removePlaceholderFiles = Effect.fn("GridStatus.removePlaceholderFiles")(
  function* (rootDir: string) {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const removed: Array<string> = [];

    for (const [subDir, fileName] of PLACEHOLDER_FILES) {
      const filePath = path_.resolve(rootDir, "catalog", subDir, fileName);
      const exists = yield* fs_
        .exists(filePath)
        .pipe(
          Effect.mapError((cause) => ingestFsError("exists", filePath, cause))
        );
      if (!exists) {
        continue;
      }

      yield* fs_.remove(filePath, { force: true }).pipe(
        Effect.mapError((cause) => ingestFsError("remove", filePath, cause))
      );
      removed.push(`${subDir}/${fileName}`);
    }

    return removed;
  }
);

const logRowFailures = (
  failures: ReadonlyArray<GridStatusCatalogRowFailure>
) =>
  failures.length === 0
    ? Effect.void
    : Logging.logWarning("gridstatus row decode failures", {
        count: failures.length,
        sample: failures.slice(0, 20),
        omittedCount: Math.max(failures.length - 20, 0)
      });

const logProvenanceWarnings = (
  warnings: ReadonlyArray<GridStatusProvenanceWarning>
) =>
  warnings.length === 0
    ? Effect.void
    : Logging.logWarning("gridstatus provenance gaps", {
        count: warnings.length,
        sample: warnings.slice(0, 20),
        omittedCount: Math.max(warnings.length - 20, 0)
      });

const onValidationFailure = (
  input: DcatValidationFailureInput<
    ScriptConfigShape,
    FetchedGridStatusCatalog,
    BuildContext
  >,
  provenanceWarnings: ReadonlyArray<GridStatusProvenanceWarning>
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
    const removedPlaceholders = yield* removePlaceholderFiles(
      input.config.rootDir
    );
    yield* logRowFailures(input.fetched.rowFailures);
    yield* logProvenanceWarnings(provenanceWarnings);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        datasetCount: input.fetched.datasets.length,
        sourceCount: input.fetched.sourceLabels.length,
        nodeCount: input.candidates.length,
        edgeCount: 0,
        datasetsCreated,
        datasetsMerged,
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount,
        catalogRecordCount,
        removedPlaceholders,
        rateLimitBudget: input.fetched.rateLimitBudget,
        rowFailures: input.fetched.rowFailures,
        provenanceWarnings,
        validationFailures: input.failures
      })
    );
  });

const onSuccess = (
  input: DcatSuccessInput<ScriptConfigShape, FetchedGridStatusCatalog, BuildContext>,
  provenanceWarnings: ReadonlyArray<GridStatusProvenanceWarning>
) =>
  Effect.gen(function* () {
    const {
      datasetSeriesCreated,
      datasetSeriesMerged
    } = candidateDatasetStats(input.topoOrder);
    const removedPlaceholders = yield* removePlaceholderFiles(
      input.config.rootDir
    );
    yield* logRowFailures(input.fetched.rowFailures);
    yield* logProvenanceWarnings(provenanceWarnings);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        pageCount: input.fetched.pageCount,
        datasetCount: input.fetched.datasets.length,
        sourceCount: input.fetched.sourceLabels.length,
        nodeCount: input.nodeCount,
        edgeCount: input.edgeCount,
        datasetsCreated: input.datasetsCreated,
        datasetsMerged: input.datasetsMerged,
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount,
        removedPlaceholders,
        rateLimitBudget: input.fetched.rateLimitBudget,
        rowFailures: input.fetched.rowFailures,
        provenanceWarnings
      })
    );
  });

export const runGridStatusIngest = Effect.fn("GridStatus.runIngest")(function* (
  config: ScriptConfigShape
) {
  let provenanceWarnings: ReadonlyArray<GridStatusProvenanceWarning> = [];

  const adapter: DcatAdapter<
    ScriptConfigShape,
    FetchedGridStatusCatalog,
    BuildContext,
    GridStatusCatalogFetchError | GridStatusCatalogDecodeError,
    never,
    IngestFsError,
    HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
  > = {
    name: "gridstatus",
    mergeAliasScheme: AliasSchemeValues.gridstatusDatasetId,
    describeStart: (cfg) => ({ baseUrl: cfg.baseUrl }),
    fetch: (cfg) =>
      Effect.gen(function* () {
        const http = yield* makeGridStatusHttpClient(cfg.minIntervalMs);
        const rateLimitBudget = yield* fetchApiUsage(
          http,
          cfg.apiKey,
          cfg.baseUrl
        ).pipe(
          Effect.map(budgetSnapshotFromUsage),
          Effect.tap((budget) =>
            Logging.logSummary("gridstatus rate limit budget", budget)
          ),
          Effect.catchTags({
            GridStatusApiUsageFetchError: (error) =>
              Logging.logWarning("gridstatus rate limit budget unavailable", {
                errorTag: error._tag,
                message: error.message,
                status: error.status ?? null
              }).pipe(Effect.as(null)),
            GridStatusApiUsageDecodeError: (error) =>
              Logging.logWarning("gridstatus rate limit budget unavailable", {
                errorTag: error._tag,
                message: error.message,
                status: null
              }).pipe(Effect.as(null))
          })
        );
        const response = yield* fetchCatalog(http, cfg.apiKey, cfg.baseUrl);
        const sourceLabels = Array.from(
          new Set(
            response.datasets
              .map((dataset) => dataset.source)
              .filter(
                (source): source is string =>
                  source !== undefined && source !== null
              )
          )
        ).sort();

        return {
          pageCount: response.pageCount,
          datasets: response.datasets,
          sourceLabels,
          baseUrl: cfg.baseUrl,
          meta: response.meta ?? null,
          rowFailures: response.rowFailures,
          rateLimitBudget
        };
      }),
    describeFetch: ({
      datasets,
      meta,
      pageCount,
      rowFailures,
      rateLimitBudget,
      sourceLabels
    }) => ({
      pageCount,
      datasetCount: datasets.length,
      sourceCount: sourceLabels.length,
      rowFailureCount: rowFailures.length,
      meta: meta === null ? null : stringifyUnknown(meta),
      rateLimitBudget
    }),
    buildContextFromIndex: (idx, nowIso) =>
      Effect.succeed(buildContextFromIndex(idx, nowIso)),
    buildCandidateNodes: ({ datasets, baseUrl }, idx, context) => {
      const result = buildCandidateNodes(datasets, idx, context, baseUrl);
      provenanceWarnings = result.provenanceWarnings;
      return result.candidates;
    },
    onValidationFailure: (input) => onValidationFailure(input, provenanceWarnings),
    onSuccess: (input) => onSuccess(input, provenanceWarnings),
    describeCompletion: ({ fetched }) => ({
      datasetCount: fetched.datasets.length,
      sourceCount: fetched.sourceLabels.length,
      pageCount: fetched.pageCount,
      rowFailureCount: fetched.rowFailures.length,
      provenanceWarningCount: provenanceWarnings.length
    })
  };

  return yield* runDcatIngest(config, adapter);
});
