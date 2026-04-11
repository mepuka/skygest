import { Clock, DateTime, Effect, FileSystem, Graph, Path } from "effect";
import type { AliasScheme, ExternalIdentifier } from "../../domain/data-layer";
import { Logging } from "../../platform/Logging";
import { stringifyUnknown } from "../../platform/Json";
import {
  assertEntityIdMatchesWith,
  encodeNodeData,
  writeEntityFileWith
} from "./entityFiles";
import { IngestFsError, IngestHarnessError, IngestLedgerError, IngestSchemaError } from "./errors";
import type { IngestGraph } from "./IngestGraph";
import type { IngestNode } from "./IngestNode";
import { buildIngestGraph } from "./buildGraph";
import { ledgerKeyForNode, loadLedgerWith, saveLedgerWith } from "./ledger";
import { type CatalogIndex, loadCatalogIndexWith } from "./loadCatalogIndex";
import { validateCandidates } from "./validate";

type DcatRunError<FetchError, ContextError, HookError> =
  | FetchError
  | ContextError
  | HookError
  | IngestFsError
  | IngestLedgerError
  | IngestSchemaError
  | IngestHarnessError;

type DcatLogAnnotationValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: DcatLogAnnotationValue }
  | ReadonlyArray<DcatLogAnnotationValue>;
type DcatLogAnnotations = Record<string, DcatLogAnnotationValue>;

export interface DcatAdapterConfigShape {
  readonly rootDir: string;
  readonly dryRun: boolean;
}

export interface DcatValidationFailureInput<Config, Fetched, Context> {
  readonly config: Config;
  readonly fetched: Fetched;
  readonly index: CatalogIndex;
  readonly context: Context;
  readonly nowIso: string;
  readonly candidates: ReadonlyArray<IngestNode>;
  readonly failures: ReadonlyArray<IngestSchemaError>;
}

export interface DcatSuccessInput<Config, Fetched, Context> {
  readonly config: Config;
  readonly fetched: Fetched;
  readonly index: CatalogIndex;
  readonly context: Context;
  readonly nowIso: string;
  readonly graph: IngestGraph;
  readonly topoOrder: ReadonlyArray<IngestNode>;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly datasetsCreated: ReadonlyArray<string>;
  readonly datasetsMerged: ReadonlyArray<string>;
  readonly distributionCount: number;
  readonly catalogRecordCount: number;
  readonly dryRun: boolean;
}

export interface DcatAdapter<
  Config extends DcatAdapterConfigShape,
  Fetched,
  Context,
  FetchError = never,
  ContextError = never,
  HookError = never,
  R = never
> {
  readonly name: string;
  readonly mergeAliasScheme: AliasScheme;
  readonly isMergeableDatasetAlias?: (
    alias: ExternalIdentifier
  ) => boolean;
  readonly describeStart: (config: Config) => DcatLogAnnotations;
  readonly fetch: (config: Config) => Effect.Effect<Fetched, FetchError, R>;
  readonly describeFetch: (fetched: Fetched) => DcatLogAnnotations;
  readonly buildContextFromIndex: (
    idx: CatalogIndex,
    nowIso: string
  ) => Effect.Effect<Context, ContextError, R>;
  readonly buildCandidateNodes: (
    fetched: Fetched,
    idx: CatalogIndex,
    context: Context
  ) => ReadonlyArray<IngestNode>;
  readonly onValidationFailure?: (
    input: DcatValidationFailureInput<Config, Fetched, Context>
  ) => Effect.Effect<void, HookError, R>;
  readonly onSuccess?: (
    input: DcatSuccessInput<Config, Fetched, Context>
  ) => Effect.Effect<void, HookError, R>;
  readonly describeCompletion?: (
    input: DcatSuccessInput<Config, Fetched, Context>
  ) => DcatLogAnnotations;
}

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

const writeNode = (
  path_: Path.Path,
  rootDir: string,
  node: IngestNode
): Effect.Effect<
  void,
  IngestFsError | IngestLedgerError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const filePath = yield* assertEntityIdMatchesWith(path_, rootDir, node);
    yield* writeEntityFileWith(filePath, `${encodeNodeData(node)}\n`);
  });

const nodeWriteOutcome = (node: IngestNode): "created" | "merged" =>
  node.merged ? "merged" : "created";

const topoStats = (topoOrder: ReadonlyArray<IngestNode>) => {
  const datasetNodes = topoOrder.filter(
    (node): node is Extract<IngestNode, { _tag: "dataset" }> =>
      node._tag === "dataset"
  );

  return {
    datasetsCreated: datasetNodes
      .filter((node) => !node.merged)
      .map((node) => node.slug),
    datasetsMerged: datasetNodes
      .filter((node) => node.merged)
      .map((node) => node.slug),
    distributionCount: topoOrder.filter((node) => node._tag === "distribution")
      .length,
    catalogRecordCount: topoOrder.filter(
      (node) => node._tag === "catalog-record"
    ).length
  };
};

export const runDcatIngest = Effect.fn("DcatHarness.runDcatIngest")(
  function* <
    Config extends DcatAdapterConfigShape,
    Fetched,
    Context,
    FetchError,
    ContextError,
    HookError,
    R
  >(config: Config, adapter: DcatAdapter<
    Config,
    Fetched,
    Context,
    FetchError,
    ContextError,
    HookError,
    R
  >) {
    const startedAt = yield* Clock.currentTimeMillis;
    const path_ = yield* Path.Path;
    const nowIso = DateTime.formatIso(yield* DateTime.now);

    yield* Logging.logSummary(`${adapter.name} ingest started`, {
      rootDir: config.rootDir,
      dryRun: config.dryRun,
      ...adapter.describeStart(config)
    });

    const fetched = yield* adapter.fetch(config);
    yield* Logging.logSummary(
      `${adapter.name} fetch completed`,
      adapter.describeFetch(fetched)
    );

    const { index, skippedDatasets } = yield* loadCatalogIndexWith(
      adapter.isMergeableDatasetAlias === undefined
        ? {
            rootDir: config.rootDir,
            mergeAliasScheme: adapter.mergeAliasScheme
          }
        : {
            rootDir: config.rootDir,
            mergeAliasScheme: adapter.mergeAliasScheme,
            isMergeableDatasetAlias: adapter.isMergeableDatasetAlias
          }
    );

    yield* Logging.logSummary(
      `${adapter.name} catalog index loaded`,
      catalogIndexCounts(index)
    );

    if (skippedDatasets.length > 0) {
      yield* Logging.logSummary(`${adapter.name} skipped datasets`, {
        count: skippedDatasets.length
      });
    }

    const context = yield* adapter.buildContextFromIndex(index, nowIso);
    const candidates = adapter.buildCandidateNodes(fetched, index, context);
    yield* Logging.logSummary(`${adapter.name} candidate nodes built`, {
      total: candidates.length,
      byKind: candidateCountsByKind(candidates)
    });

    const { failures, successes } = yield* validateCandidates(candidates);
    if (failures.length > 0) {
      yield* Effect.forEach(
        failures,
        (error) =>
          Logging.logFailure(`${adapter.name} validation failure`, error, {
            kind: error.kind,
            slug: error.slug
          }),
        { discard: true }
      );

      if (adapter.onValidationFailure !== undefined) {
        yield* adapter.onValidationFailure({
          config,
          fetched,
          index,
          context,
          nowIso,
          candidates,
          failures
        });
      }
    }

    yield* Logging.logSummary(`${adapter.name} validation summary`, {
      valid: successes.length,
      failed: failures.length,
      total: candidates.length
    });

    const [firstFailure] = failures;
    if (firstFailure !== undefined) {
      return yield* firstFailure;
    }

    const graph = yield* Effect.try({
      try: () => buildIngestGraph(successes),
      catch: (error) =>
        error instanceof IngestHarnessError
          ? error
          : new IngestHarnessError({
              message: stringifyUnknown(error)
            })
    });
    const nodeCount = Graph.nodeCount(graph);
    const edgeCount = Graph.edgeCount(graph);
    const acyclic = Graph.isAcyclic(graph);

    yield* Logging.logSummary(`${adapter.name} graph built`, {
      nodeCount,
      edgeCount,
      acyclic
    });

    if (!acyclic) {
      return yield* new IngestHarnessError({
        message:
          "IngestGraph contains a cycle — programmer error in buildIngestGraph"
      });
    }

    const topoOrder = Array.from(Graph.values(Graph.topo(graph)));
    const {
      datasetsCreated,
      datasetsMerged,
      distributionCount,
      catalogRecordCount
    } = topoStats(topoOrder);

    if (config.dryRun) {
      const completedAt = yield* Clock.currentTimeMillis;
      const successInput = {
        config,
        fetched,
        index,
        context,
        nowIso,
        graph,
        topoOrder,
        nodeCount,
        edgeCount,
        datasetsCreated,
        datasetsMerged,
        distributionCount,
        catalogRecordCount,
        dryRun: true
      } satisfies DcatSuccessInput<Config, Fetched, Context>;
      yield* Logging.logSummary(`${adapter.name} ingest completed`, {
        nodeCount,
        edgeCount,
        datasetsCreated: datasetsCreated.length,
        datasetsMerged: datasetsMerged.length,
        distributionCount,
        catalogRecordCount,
        durationMs: completedAt - startedAt,
        dryRun: true,
        ...(adapter.describeCompletion?.(successInput) ?? {})
      });

      return;
    }

    yield* Effect.forEach(
      topoOrder,
      (node) =>
        writeNode(path_, config.rootDir, node).pipe(
          Effect.tap(() =>
            Logging.logSummary(`${adapter.name} node written`, {
              kind: node._tag,
              slug: node.slug,
              outcome: nodeWriteOutcome(node)
            })
          )
        ),
      { concurrency: 1 }
    );

    const loadedLedger = yield* loadLedgerWith(config.rootDir);
    const ledger: Record<string, string> = { ...loadedLedger };
    yield* Effect.sync(() => {
      for (const node of topoOrder) {
        ledger[ledgerKeyForNode(node)] = node.data.id;
      }
    });
    yield* saveLedgerWith(config.rootDir, ledger, writeEntityFileWith);
    yield* Logging.logSummary(`${adapter.name} ledger updated`, {
      entries: Object.keys(ledger).length
    });

    const successInput = {
      config,
      fetched,
      index,
      context,
      nowIso,
      graph,
      topoOrder,
      nodeCount,
      edgeCount,
      datasetsCreated,
      datasetsMerged,
      distributionCount,
      catalogRecordCount,
      dryRun: false
    } satisfies DcatSuccessInput<Config, Fetched, Context>;

    if (adapter.onSuccess !== undefined) {
      yield* adapter.onSuccess(successInput);
    }

    const completedAt = yield* Clock.currentTimeMillis;
    yield* Logging.logSummary(`${adapter.name} ingest completed`, {
      nodeCount,
      edgeCount,
      datasetsCreated: datasetsCreated.length,
      datasetsMerged: datasetsMerged.length,
      distributionCount,
      catalogRecordCount,
      durationMs: completedAt - startedAt,
      dryRun: false,
      ...(adapter.describeCompletion?.(successInput) ?? {})
    });
  }
) as <
  Config extends DcatAdapterConfigShape,
  Fetched,
  Context,
  FetchError,
  ContextError,
  HookError,
  R
>(
  config: Config,
  adapter: DcatAdapter<
    Config,
    Fetched,
    Context,
    FetchError,
    ContextError,
    HookError,
    R
  >
) => Effect.Effect<
  void,
  DcatRunError<FetchError, ContextError, HookError>,
  R | FileSystem.FileSystem | Path.Path
>;
 
