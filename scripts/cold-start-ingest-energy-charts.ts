import { Clock, Config, DateTime, Effect, FileSystem, Graph, Path, Schema } from "effect";
import {
  AliasSchemeValues,
  type DataService,
  type Dataset,
  type Distribution
} from "../src/domain/data-layer";
import {
  buildIngestGraph,
  loadCatalogIndexWith,
  loadLedgerWith,
  saveLedgerWith,
  validateCandidatesWith,
  validateNodeWith,
  writeEntityFileWith,
  assertNodeOwnsWriteTargetWith,
  ledgerKeyForNode,
  encodeNodeData,
  unionAliases,
  type CatalogIndex,
  type EntityIdLedger,
  type IngestNode
} from "../src/ingest/dcat-harness";
import {
  buildCandidateNodes,
  buildContextFromIndex,
  fetchSpec,
  listEndpointFamilies
} from "../src/ingest/dcat-adapters/energy-charts";
import { formatSchemaParseError } from "../src/platform/Json";
import { EnergyChartsIngestKeys } from "../src/platform/ConfigShapes";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export {
  buildCandidateNodes,
  buildContextFromIndex,
  fetchSpec,
  listEndpointFamilies,
  unionAliases
};

export class EnergyChartsIngestSchemaError extends Schema.TaggedErrorClass<EnergyChartsIngestSchemaError>()(
  "EnergyChartsIngestSchemaError",
  {
    kind: Schema.String,
    slug: Schema.String,
    message: Schema.String
  }
) {}

export class EnergyChartsIngestFsError extends Schema.TaggedErrorClass<EnergyChartsIngestFsError>()(
  "EnergyChartsIngestFsError",
  {
    operation: Schema.String,
    path: Schema.String,
    message: Schema.String
  }
) {}

export class EnergyChartsIngestLedgerError extends Schema.TaggedErrorClass<EnergyChartsIngestLedgerError>()(
  "EnergyChartsIngestLedgerError",
  { message: Schema.String }
) {}

export const ScriptConfig = Config.all(EnergyChartsIngestKeys);
export type ScriptConfigShape = Config.Success<typeof ScriptConfig>;

const catalogIndexCounts = (idx: CatalogIndex) => ({
  agentCount: idx.allAgents.length,
  catalogCount: idx.allCatalogs.length,
  dataServiceCount: idx.allDataServices.length,
  datasetCount: idx.allDatasets.length,
  distributionCount: idx.allDistributions.length,
  catalogRecordCount: idx.allCatalogRecords.length
});

const candidateCountsByKind = (candidates: ReadonlyArray<IngestNode>) => {
  const byKind = {
    agent: 0,
    catalog: 0,
    dataService: 0,
    dataset: 0,
    distribution: 0,
    catalogRecord: 0
  };

  for (const candidate of candidates) {
    switch (candidate._tag) {
      case "agent":
        byKind.agent += 1;
        break;
      case "catalog":
        byKind.catalog += 1;
        break;
      case "data-service":
        byKind.dataService += 1;
        break;
      case "dataset":
        byKind.dataset += 1;
        break;
      case "distribution":
        byKind.distribution += 1;
        break;
      case "catalog-record":
        byKind.catalogRecord += 1;
        break;
    }
  }

  return byKind;
};

const nodeWriteOutcome = (node: IngestNode): "created" | "merged" => {
  switch (node._tag) {
    case "dataset":
      return node.merged ? "merged" : "created";
    case "catalog-record":
      return node.data.firstSeen === node.data.lastSeen ? "created" : "merged";
    case "distribution":
      return node.data.createdAt === node.data.updatedAt ? "created" : "merged";
    default:
      return node.data.createdAt === node.data.updatedAt ? "created" : "merged";
  }
};

export const validateNode = Effect.fn("EnergyChartsIngest.validateNode")(
  function* (node: IngestNode) {
    const mapErr = (candidate: IngestNode, error: Schema.SchemaError) =>
      new EnergyChartsIngestSchemaError({
        kind: candidate._tag,
        slug: candidate.slug,
        message: formatSchemaParseError(error)
      });
    return yield* validateNodeWith(node, mapErr);
  }
);

export const validateCandidates = Effect.fn(
  "EnergyChartsIngest.validateCandidates"
)(function* (candidates: ReadonlyArray<IngestNode>) {
  return yield* validateCandidatesWith(candidates, validateNode);
});

export const writeEntityFile = Effect.fn("EnergyChartsIngest.writeEntityFile")(
  function* (filePath: string, content: string) {
    yield* writeEntityFileWith(filePath, content, (input) =>
      new EnergyChartsIngestFsError(input)
    );
  }
);

export const loadCatalogIndex = Effect.fn(
  "EnergyChartsIngest.loadCatalogIndex"
)(function* (rootDir: string) {
  const { index, skippedDatasets } = yield* loadCatalogIndexWith({
    rootDir,
    mergeAliasScheme: AliasSchemeValues.energyChartsEndpoint,
    mapFsError: ({ operation, path, message }) =>
      new EnergyChartsIngestFsError({ operation, path, message }),
    mapSchemaError: ({ kind, slug, message }) =>
      new EnergyChartsIngestSchemaError({ kind, slug, message })
  });

  yield* Effect.forEach(
    skippedDatasets.filter((dataset) => dataset.slug.startsWith("energy-charts-")),
    (dataset) =>
      Logging.logWarning("energy charts dataset skipped from endpoint index", {
        slug: dataset.slug,
        datasetId: dataset.datasetId,
        reason: dataset.reason,
        ...(dataset.mergeAliasValue === null
          ? {}
          : { endpointKey: dataset.mergeAliasValue })
      }),
    { discard: true }
  );

  return index;
});

export const loadLedger = Effect.fn("EnergyChartsIngest.loadLedger")(
  function* (rootDir: string) {
    return yield* loadLedgerWith(
      rootDir,
      (message) => new EnergyChartsIngestLedgerError({ message })
    );
  }
);

export const saveLedger = Effect.fn("EnergyChartsIngest.saveLedger")(
  function* (rootDir: string, ledger: EntityIdLedger) {
    yield* saveLedgerWith(rootDir, ledger, writeEntityFile);
  }
);

export const assertNodeOwnsWriteTarget = Effect.fn(
  "EnergyChartsIngest.assertNodeOwnsWriteTarget"
)(
  function* (path_: Path.Path, rootDir: string, node: IngestNode) {
    return yield* assertNodeOwnsWriteTargetWith(
      path_,
      rootDir,
      node,
      (message) => new EnergyChartsIngestLedgerError({ message })
    );
  }
);

const writeNode = (
  path_: Path.Path,
  rootDir: string,
  node: IngestNode
): Effect.Effect<
  void,
  EnergyChartsIngestFsError | EnergyChartsIngestLedgerError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const filePath = yield* assertNodeOwnsWriteTarget(path_, rootDir, node);
    yield* writeEntityFile(filePath, `${encodeNodeData(node)}\n`);
  });

export const runEnergyChartsIngest = Effect.fn(
  "EnergyChartsIngest.run"
)(function* (config: ScriptConfigShape) {
  const startedAt = yield* Clock.currentTimeMillis;
  const path_ = yield* Path.Path;
  const nowIso = DateTime.formatIso(yield* DateTime.now);

  yield* Logging.logSummary("energy charts ingest started", {
    rootDir: config.rootDir,
    dryRun: config.dryRun,
    openApiUrl: config.openApiUrl
  });

  const spec = yield* fetchSpec(config.openApiUrl);
  const families = listEndpointFamilies(spec);
  yield* Logging.logSummary("energy charts spec fetched", {
    pathCount: Object.keys(spec.paths).length,
    endpointFamilyCount: families.length
  });

  const idx = yield* loadCatalogIndex(config.rootDir);
  yield* Logging.logSummary(
    "energy charts catalog index loaded",
    catalogIndexCounts(idx)
  );

  const ctx = buildContextFromIndex(idx, nowIso);
  const candidates = buildCandidateNodes(families, idx, ctx);
  yield* Logging.logSummary("energy charts candidate nodes built", {
    total: candidates.length,
    byKind: candidateCountsByKind(candidates)
  });

  const { failures, successes } = yield* validateCandidates(candidates);
  yield* Logging.logSummary("energy charts validation summary", {
    valid: successes.length,
    failed: failures.length,
    total: candidates.length
  });
  const [firstFailure] = failures;
  if (firstFailure !== undefined) {
    yield* Effect.forEach(
      failures,
      (error) =>
        Logging.logFailure("energy charts validation failure", error, {
          kind: error.kind,
          slug: error.slug
        }),
      { discard: true }
    );
    return yield* firstFailure;
  }

  const graph = buildIngestGraph(successes);
  const nodeCount = Graph.nodeCount(graph);
  const edgeCount = Graph.edgeCount(graph);
  const acyclic = Graph.isAcyclic(graph);
  yield* Logging.logSummary("energy charts graph built", {
    nodeCount,
    edgeCount,
    acyclic
  });
  if (!acyclic) {
    return yield* new EnergyChartsIngestLedgerError({
      message:
        "IngestGraph contains a cycle — programmer error in buildIngestGraph"
    });
  }

  const topoOrder = Array.from(Graph.values(Graph.topo(graph)));
  const datasetNodes = topoOrder.filter(
    (node): node is Extract<IngestNode, { _tag: "dataset" }> =>
      node._tag === "dataset"
  );
  const distributionCount = topoOrder.filter(
    (node) => node._tag === "distribution"
  ).length;
  const catalogRecordCount = topoOrder.filter(
    (node) => node._tag === "catalog-record"
  ).length;
  const datasetsCreated = datasetNodes.filter((node) => !node.merged);
  const datasetsMerged = datasetNodes.filter((node) => node.merged);

  if (config.dryRun) {
    const completedAt = yield* Clock.currentTimeMillis;
    yield* Logging.logSummary("energy charts ingest completed", {
      endpointFamilyCount: families.length,
      nodeCount,
      edgeCount,
      datasetsCreated: datasetsCreated.length,
      datasetsMerged: datasetsMerged.length,
      distributionCount,
      catalogRecordCount,
      durationMs: completedAt - startedAt,
      dryRun: true
    });
    return;
  }

  yield* Effect.forEach(
    topoOrder,
    (node) =>
      writeNode(path_, config.rootDir, node).pipe(
        Effect.tap(() =>
          Logging.logSummary("energy charts node written", {
            kind: node._tag,
            slug: node.slug,
            outcome: nodeWriteOutcome(node)
          })
        )
      ),
    { concurrency: 1 }
  );

  const loadedLedger = yield* loadLedger(config.rootDir);
  const ledger: Record<string, string> = { ...loadedLedger };
  yield* Effect.sync(() => {
    for (const node of topoOrder) {
      ledger[ledgerKeyForNode(node)] = node.data.id;
    }
  });
  yield* saveLedger(config.rootDir, ledger);
  yield* Logging.logSummary("energy charts ledger updated", {
    entries: Object.keys(ledger).length
  });

  const completedAt = yield* Clock.currentTimeMillis;
  yield* Logging.logSummary("energy charts ingest completed", {
    endpointFamilyCount: families.length,
    nodeCount,
    edgeCount,
    datasetsCreated: datasetsCreated.length,
    datasetsMerged: datasetsMerged.length,
    distributionCount,
    catalogRecordCount,
    durationMs: completedAt - startedAt,
    dryRun: false
  });
});

const main = Effect.fn("EnergyChartsIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runEnergyChartsIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) =>
    Logging.logFailure("energy charts ingest failed", error)
  )
);

if (import.meta.main) {
  runScriptMain(
    "EnergyChartsIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
