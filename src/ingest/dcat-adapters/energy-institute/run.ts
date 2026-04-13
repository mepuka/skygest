import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { AliasSchemeValues } from "../../../domain/data-layer";
import { EnergyInstituteIngestKeys } from "../../../platform/ConfigShapes";
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
  ENERGY_INSTITUTE_MANIFEST,
  isEnergyInstituteDatasetAlias,
  type EnergyInstituteDatasetManifestEntry
} from "./manifest";

export const ScriptConfig = Config.all(EnergyInstituteIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

const HARVEST_REPORT_DIR = "reports/harvest";
const INGEST_REPORT_FILE = "energy-institute-ingest-report.json";

const EnergyInstituteValidationFailure = Schema.Struct({
  kind: Schema.String,
  slug: Schema.String,
  message: Schema.String
});

const EnergyInstituteIngestReport = Schema.Struct({
  fetchedAt: Schema.String,
  manifestEntryCount: Schema.Number,
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
  validationFailures: Schema.optionalKey(
    Schema.Array(EnergyInstituteValidationFailure)
  )
});
type EnergyInstituteIngestReport = Schema.Schema.Type<
  typeof EnergyInstituteIngestReport
>;

const encodeReport = encodeJsonStringPrettyWith(EnergyInstituteIngestReport);

interface FetchedEnergyInstituteManifest {
  readonly entries: ReadonlyArray<EnergyInstituteDatasetManifestEntry>;
}

const buildReport = (input: {
  readonly fetchedAt: string;
  readonly manifestEntryCount: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly datasetSeriesCreated: ReadonlyArray<string>;
  readonly datasetSeriesMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly validationFailures?: ReadonlyArray<{
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }>;
}): EnergyInstituteIngestReport => ({
  fetchedAt: input.fetchedAt,
  manifestEntryCount: input.manifestEntryCount,
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
  ...(input.validationFailures === undefined ||
  input.validationFailures.length === 0
    ? {}
    : { validationFailures: [...input.validationFailures] })
});

const writeIngestReport = Effect.fn("EnergyInstitute.writeIngestReport")(
  function* (rootDir: string, report: EnergyInstituteIngestReport) {
    const path_ = yield* Path.Path;
    const reportsDir = path_.resolve(rootDir, HARVEST_REPORT_DIR);
    const reportPath = path_.resolve(reportsDir, INGEST_REPORT_FILE);
    yield* writeEntityFileWith(reportPath, `${encodeReport(report)}\n`);
  }
);

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
    FetchedEnergyInstituteManifest,
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
      manifestEntryCount: input.fetched.entries.length,
      nodeCount: input.candidates.length,
      edgeCount: 0,
      datasetsCreated,
      datasetsMerged,
      datasetSeriesCreated,
      datasetSeriesMerged,
      distributionCount,
      catalogRecordCount,
      validationFailures: input.failures
    })
  );
};

const onSuccess = (
  input: DcatSuccessInput<
    ScriptConfigShape,
    FetchedEnergyInstituteManifest,
    BuildContext
  >
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
        manifestEntryCount: input.fetched.entries.length,
        nodeCount: input.nodeCount,
        edgeCount: input.edgeCount,
        datasetsCreated: input.datasetsCreated,
        datasetsMerged: input.datasetsMerged,
        datasetSeriesCreated,
        datasetSeriesMerged,
        distributionCount: input.distributionCount,
        catalogRecordCount: input.catalogRecordCount
      })
    );
  });

export const runEnergyInstituteIngest = Effect.fn(
  "EnergyInstitute.runIngest"
)(function* (config: ScriptConfigShape) {
  const adapter: DcatAdapter<
    ScriptConfigShape,
    FetchedEnergyInstituteManifest,
    BuildContext,
    never,
    never,
    IngestFsError,
    FileSystem.FileSystem | Path.Path
  > = {
    name: "energy-institute",
    mergeAliasScheme: AliasSchemeValues.url,
    isMergeableDatasetAlias: isEnergyInstituteDatasetAlias,
    describeStart: (cfg) => ({ rootDir: cfg.rootDir }),
    fetch: () =>
      Effect.succeed({
        entries: ENERGY_INSTITUTE_MANIFEST
      }),
    describeFetch: ({ entries }) => ({
      manifestEntryCount: entries.length,
      distributionCount: entries.reduce(
        (count, entry) => count + entry.distributions.length,
        0
      )
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
