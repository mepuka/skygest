import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { EntsoeIngestKeys } from "../../../platform/ConfigShapes";
import { encodeJsonStringPrettyWith } from "../../../platform/Json";
import {
  type DcatAdapter,
  type DcatSuccessInput,
  type DcatValidationFailureInput,
  IngestFsError,
  runDcatIngest,
  writeEntityFileWith
} from "../../dcat-harness";
import { buildCandidateNodes } from "./buildCandidateNodes";
import {
  type BuildContext,
  buildContextFromIndex
} from "./buildContext";
import {
  type EntsoeManifestEntry,
  ENTSOE_MANIFEST
} from "./manifest";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const ScriptConfig = Config.all(EntsoeIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

// ---------------------------------------------------------------------------
// Report schema
// ---------------------------------------------------------------------------

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "entsoe-ingest-report.json";

const EntsoeIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  manifestEntryCount: Schema.Number,
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
type EntsoeIngestReport = Schema.Schema.Type<typeof EntsoeIngestReport>;

const encodeReport = encodeJsonStringPrettyWith(EntsoeIngestReport);

// ---------------------------------------------------------------------------
// Fetched payload (static manifest — no HTTP needed)
// ---------------------------------------------------------------------------

interface FetchedEntsoeManifest {
  readonly entries: ReadonlyArray<EntsoeManifestEntry>;
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly manifestEntryCount: number;
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
}): EntsoeIngestReport => ({
  fetchedAt: input.fetchedAt,
  manifestEntryCount: input.manifestEntryCount,
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

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

const writeIngestReport = Effect.fn("Entsoe.writeIngestReport")(function* (
  rootDir: string,
  report: EntsoeIngestReport
) {
  const path_ = yield* Path.Path;
  const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
  const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
  yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
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
    FetchedEntsoeManifest,
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
      manifestEntryCount: input.fetched.entries.length,
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
  input: DcatSuccessInput<
    ScriptConfigShape,
    FetchedEntsoeManifest,
    BuildContext
  >
) =>
  writeIngestReport(
    input.config.rootDir,
    buildReport({
      fetchedAt: input.nowIso,
      manifestEntryCount: input.fetched.entries.length,
      nodeCount: input.nodeCount,
      edgeCount: input.edgeCount,
      datasetsCreated: input.datasetsCreated,
      datasetsMerged: input.datasetsMerged,
      distributionCount: input.distributionCount,
      catalogRecordCount: input.catalogRecordCount
    })
  );

// ---------------------------------------------------------------------------
// Adapter + runner
// ---------------------------------------------------------------------------

export const runEntsoeIngest = Effect.fn("Entsoe.runIngest")(function* (
  config: ScriptConfigShape
) {
  const adapter: DcatAdapter<
    ScriptConfigShape,
    FetchedEntsoeManifest,
    BuildContext,
    never,
    never,
    IngestFsError,
    FileSystem.FileSystem | Path.Path
  > = {
    name: "entsoe",
    mergeAliasScheme: AliasSchemeValues.entsoeDocumentType,
    describeStart: (cfg) => ({ rootDir: cfg.rootDir }),
    fetch: () =>
      Effect.succeed({
        entries: ENTSOE_MANIFEST
      }),
    describeFetch: ({ entries }) => ({
      manifestEntryCount: entries.length
    }),
    buildContextFromIndex: (idx, nowIso) =>
      Effect.sync(() => buildContextFromIndex(idx, nowIso)),
    buildCandidateNodes: ({ entries }, idx, context) =>
      buildCandidateNodes(entries, idx, context),
    onValidationFailure,
    onSuccess,
    describeCompletion: ({ fetched }) => ({
      manifestEntryCount: fetched.entries.length
    })
  };

  return yield* runDcatIngest(config, adapter);
});
