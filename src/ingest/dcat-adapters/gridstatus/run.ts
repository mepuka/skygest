import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { GridStatusIngestKeys } from "../../../platform/ConfigShapes";
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
  type GridStatusDatasetInfo,
  type GridStatusDatasetCatalogResponse,
  GridStatusCatalogDecodeError,
  GridStatusCatalogFetchError,
  fetchCatalog
} from "./api";
import {
  type BuildContext,
  buildContextFromIndex
} from "./buildContext";
import { buildCandidateNodes } from "./buildCandidateNodes";

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

const GridStatusIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  datasetCount: Schema.Number,
  sourceCount: Schema.Number,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  datasets: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
  removedPlaceholders: Schema.Array(Schema.String),
  validationFailures: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        slug: Schema.String,
        message: Schema.String
      })
    )
  )
});
type GridStatusIngestReport = Schema.Schema.Type<
  typeof GridStatusIngestReport
>;

const encodeReport = encodeJsonStringPrettyWith(GridStatusIngestReport);

interface FetchedGridStatusCatalog {
  readonly response: GridStatusDatasetCatalogResponse;
  readonly datasets: ReadonlyArray<GridStatusDatasetInfo>;
  readonly sourceLabels: ReadonlyArray<string>;
  readonly baseUrl: string;
}

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly datasetCount: number;
  readonly sourceCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly removedPlaceholders: ReadonlyArray<string>;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): GridStatusIngestReport => ({
  fetchedAt: input.fetchedAt,
  datasetCount: input.datasetCount,
  sourceCount: input.sourceCount,
  nodeCount: input.nodeCount,
  edgeCount: input.edgeCount,
  datasets: {
    created: [...input.datasetsCreated],
    merged: [...input.datasetsMerged]
  },
  distributions: { count: input.distributionCount },
  catalogRecords: { count: input.catalogRecordCount },
  removedPlaceholders: [...input.removedPlaceholders],
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
          Effect.mapError((cause) =>
            ingestFsError("exists", filePath, cause)
          )
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

const onValidationFailure = (
  input: DcatValidationFailureInput<
    ScriptConfigShape,
    FetchedGridStatusCatalog,
    BuildContext
  >
) => {
  const {
    datasetsCreated,
    datasetsMerged,
    distributionCount,
    catalogRecordCount
  } = candidateDatasetStats(input.candidates);

  return writeIngestReport(
    input.config.rootDir,
    buildReport({
      fetchedAt: input.nowIso,
      datasetCount: input.fetched.datasets.length,
      sourceCount: input.fetched.sourceLabels.length,
      nodeCount: input.candidates.length,
      edgeCount: 0,
      datasetsCreated,
      datasetsMerged,
      distributionCount,
      catalogRecordCount,
      removedPlaceholders: [],
      validationFailures: input.failures
    })
  );
};

const onSuccess = (
  input: DcatSuccessInput<ScriptConfigShape, FetchedGridStatusCatalog, BuildContext>
) =>
  Effect.gen(function* () {
    const removedPlaceholders = yield* removePlaceholderFiles(input.config.rootDir);
    yield* writeIngestReport(
      input.config.rootDir,
      buildReport({
        fetchedAt: input.nowIso,
        datasetCount: input.fetched.datasets.length,
        sourceCount: input.fetched.sourceLabels.length,
        nodeCount: input.nodeCount,
        edgeCount: input.edgeCount,
        datasetsCreated: input.datasetsCreated,
        datasetsMerged: input.datasetsMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount,
        removedPlaceholders
      })
    );
  });

export const runGridStatusIngest = Effect.fn("GridStatus.runIngest")(function* (
  config: ScriptConfigShape
) {
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
      fetchCatalog(cfg.apiKey, cfg.baseUrl).pipe(
        Effect.map((response) => {
          const sourceLabels = Array.from(
            new Set(
              response.data
                .map((dataset) => dataset.source)
                .filter((source): source is string => source !== undefined)
            )
          ).sort();

          return {
            response,
            datasets: response.data,
            sourceLabels,
            baseUrl: cfg.baseUrl
          };
        })
      ),
    describeFetch: ({ datasets, response, sourceLabels }) => ({
      datasetCount: datasets.length,
      sourceCount: sourceLabels.length,
      meta: response.meta ?? null
    }),
    buildContextFromIndex: (idx, nowIso) =>
      Effect.succeed(buildContextFromIndex(idx, nowIso)),
    buildCandidateNodes: ({ datasets, baseUrl }, idx, context) =>
      buildCandidateNodes(datasets, idx, context, baseUrl),
    onValidationFailure,
    onSuccess,
    describeCompletion: ({ fetched }) => ({
      datasetCount: fetched.datasets.length,
      sourceCount: fetched.sourceLabels.length
    })
  };

  return yield* runDcatIngest(config, adapter);
});
