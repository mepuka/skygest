import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { HttpClient } from "effect/unstable/http";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { EmberIngestKeys } from "../../../platform/ConfigShapes";
import { encodeJsonStringPrettyWith } from "../../../platform/Json";
import { writeEntityFileWith } from "../../dcat-harness";
import {
  type DcatAdapter,
  type DcatSuccessInput,
  type DcatValidationFailureInput,
  IngestFsError,
  runDcatIngest
} from "../../dcat-harness";
import { buildCandidateNodes } from "./buildCandidateNodes";
import {
  type BuildContext,
  buildContextFromIndex
} from "./buildContext";
import {
  type EndpointFamily,
  listEndpointFamilies
} from "./endpointCatalog";
import { EmberSpecDecodeError, EmberSpecFetchError, fetchSpec } from "./fetchSpec";
import type { EmberOpenApiDocument } from "./openApi";

export const ScriptConfig = Config.all(EmberIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "ember-ingest-report.json";

const EmberIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  endpointFamilyCount: Schema.Number,
  nodeCount: Schema.Number,
  edgeCount: Schema.Number,
  datasets: Schema.Struct({
    created: Schema.Array(Schema.String),
    merged: Schema.Array(Schema.String)
  }),
  distributions: Schema.Struct({ count: Schema.Number }),
  catalogRecords: Schema.Struct({ count: Schema.Number }),
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
type EmberIngestReport = Schema.Schema.Type<typeof EmberIngestReport>;

const encodeReport = encodeJsonStringPrettyWith(EmberIngestReport);

interface FetchedEmberSpec {
  readonly spec: EmberOpenApiDocument;
  readonly families: ReadonlyArray<EndpointFamily>;
}

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly endpointFamilyCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): EmberIngestReport => ({
  fetchedAt: input.fetchedAt,
  endpointFamilyCount: input.endpointFamilyCount,
  nodeCount: input.nodeCount,
  edgeCount: input.edgeCount,
  datasets: {
    created: [...input.datasetsCreated],
    merged: [...input.datasetsMerged]
  },
  distributions: { count: input.distributionCount },
  catalogRecords: { count: input.catalogRecordCount },
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : { validationFailures: [...input.validationFailures] })
});

const writeIngestReport = Effect.fn("Ember.writeIngestReport")(function* (
  rootDir: string,
  report: EmberIngestReport
) {
  const path_ = yield* Path.Path;
  const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
  const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
  yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
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

const onValidationFailure = (
  input: DcatValidationFailureInput<
    ScriptConfigShape,
    FetchedEmberSpec,
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
      endpointFamilyCount: input.fetched.families.length,
      nodeCount: input.candidates.length,
      edgeCount: 0,
      datasetsCreated,
      datasetsMerged,
      distributionCount,
      catalogRecordCount,
      validationFailures: input.failures
    })
  );
};

const onSuccess = (
  input: DcatSuccessInput<ScriptConfigShape, FetchedEmberSpec, BuildContext>
) =>
  writeIngestReport(
    input.config.rootDir,
    buildReport({
      fetchedAt: input.nowIso,
      endpointFamilyCount: input.fetched.families.length,
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      datasetsCreated: input.datasetsCreated,
      datasetsMerged: input.datasetsMerged,
      distributionCount: input.distributionCount,
      catalogRecordCount: input.catalogRecordCount
    })
  );

export const runEmberIngest = Effect.fn("Ember.runIngest")(function* (
  config: ScriptConfigShape
) {
  const adapter: DcatAdapter<
    ScriptConfigShape,
    FetchedEmberSpec,
    BuildContext,
    EmberSpecFetchError | EmberSpecDecodeError,
    never,
    IngestFsError,
    HttpClient.HttpClient | FileSystem.FileSystem | Path.Path
  > = {
    name: "ember",
    mergeAliasScheme: AliasSchemeValues.emberRoute,
    describeStart: (cfg) => ({ openApiUrl: cfg.openApiUrl }),
    fetch: (cfg) =>
      fetchSpec(cfg.apiKey, cfg.openApiUrl).pipe(
        Effect.map((spec) => ({
          spec,
          families: listEndpointFamilies(spec)
        }))
      ),
    describeFetch: ({ spec, families }) => ({
      pathCount: Object.keys(spec.paths).length,
      endpointFamilyCount: families.length
    }),
    buildContextFromIndex: (idx, nowIso) =>
      Effect.succeed(buildContextFromIndex(idx, nowIso)),
    buildCandidateNodes: ({ families }, idx, context) =>
      buildCandidateNodes(families, idx, context),
    onValidationFailure,
    onSuccess,
    describeCompletion: ({ fetched }) => ({
      endpointFamilyCount: fetched.families.length
    })
  };

  return yield* runDcatIngest(config, adapter);
});
