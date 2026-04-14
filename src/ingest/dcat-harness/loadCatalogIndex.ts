import { Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution,
  type AliasScheme,
  type ExternalIdentifier
} from "../../domain/data-layer";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../../platform/Json";
import { normalizeDistributionUrl } from "../../resolution/normalize";
import { IngestFsError, IngestHarnessError, IngestSchemaError } from "./errors";

const INDEX_LOAD_CONCURRENCY = 10;

export interface LoadedEntity<T> {
  readonly slug: string;
  readonly data: T;
}

export interface CatalogIndex {
  readonly datasetsByMergeKey: Map<string, Dataset>;
  readonly datasetFileSlugById: Map<Dataset["id"], string>;
  readonly datasetSeriesById: Map<DatasetSeries["id"], DatasetSeries>;
  readonly datasetSeriesFileSlugById: Map<DatasetSeries["id"], string>;
  // Downloads widen this key with URL/downloadURL when available so one
  // dataset can keep multiple distinct file resources without collisions.
  readonly distributionsByDatasetIdKind: Map<string, Distribution>;
  readonly distributionFileSlugById: Map<Distribution["id"], string>;
  readonly catalogRecordsByCatalogAndPrimaryTopic: Map<string, CatalogRecord>;
  readonly catalogRecordFileSlugById: Map<CatalogRecord["id"], string>;
  readonly agentsById: Map<Agent["id"], Agent>;
  readonly agentFileSlugById: Map<Agent["id"], string>;
  readonly agentsByName: Map<string, Agent>;
  readonly catalogsById: Map<Catalog["id"], Catalog>;
  readonly dataServicesById: Map<DataService["id"], DataService>;
  readonly allDatasets: ReadonlyArray<Dataset>;
  readonly allDatasetSeries: ReadonlyArray<DatasetSeries>;
  readonly allDistributions: ReadonlyArray<Distribution>;
  readonly allCatalogRecords: ReadonlyArray<CatalogRecord>;
  readonly allCatalogs: ReadonlyArray<Catalog>;
  readonly allDataServices: ReadonlyArray<DataService>;
  readonly allAgents: ReadonlyArray<Agent>;
}

export type DatasetSkipReason = "missingMergeAlias" | "unmergeableAlias";

export interface SkippedDataset {
  readonly slug: string;
  readonly datasetId: Dataset["id"];
  readonly reason: DatasetSkipReason;
  readonly mergeAliasValue: string | null;
}

export interface LoadCatalogIndexOptions<
  FsError = IngestFsError,
  SchemaError = IngestSchemaError
> {
  readonly rootDir: string;
  readonly mergeAliasScheme: AliasScheme;
  readonly isMergeableDatasetAlias?: (
    alias: ExternalIdentifier
  ) => boolean;
  readonly mapFsError?: (input: {
    readonly operation: string;
    readonly path: string;
    readonly message: string;
  }) => FsError;
  readonly mapSchemaError?: (input: {
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }) => SchemaError;
}

interface LoadedCatalogEntities {
  readonly datasets: ReadonlyArray<LoadedEntity<Dataset>>;
  readonly datasetSeries: ReadonlyArray<LoadedEntity<DatasetSeries>>;
  readonly distributions: ReadonlyArray<LoadedEntity<Distribution>>;
  readonly catalogRecords: ReadonlyArray<LoadedEntity<CatalogRecord>>;
  readonly dataServices: ReadonlyArray<LoadedEntity<DataService>>;
  readonly catalogs: ReadonlyArray<LoadedEntity<Catalog>>;
  readonly agents: ReadonlyArray<LoadedEntity<Agent>>;
}

type DistributionLookup = Pick<
  Distribution,
  "datasetId" | "kind" | "accessURL" | "downloadURL" | "format"
>;

const urlDisambiguatedDistributionKinds = new Set<
  Distribution["kind"]
>(["download", "landing-page"]);

export interface CatalogIndexLoadResult {
  readonly index: CatalogIndex;
  readonly skippedDatasets: ReadonlyArray<SkippedDataset>;
}

const decodeFileAs = <
  S extends Schema.Decoder<unknown>,
  SchemaError = IngestSchemaError
>(
  schema: S,
  kind: string,
  slug: string,
  mapSchemaError?: (input: {
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }) => SchemaError
) =>
  (text: string): Effect.Effect<S["Type"], SchemaError | IngestSchemaError> =>
    Effect.gen(function* () {
      const result = decodeJsonStringEitherWith(schema)(text);
      if (Result.isFailure(result)) {
        const message = formatSchemaParseError(result.failure);
        return yield* (
          mapSchemaError === undefined
            ? new IngestSchemaError({
                kind,
                slug,
                message
              })
            : Effect.fail(
                mapSchemaError({
                  kind,
                  slug,
                  message
                })
              )
        );
      }
      return result.success;
    });

const loadEntitiesFromDir = <
  S extends Schema.Decoder<unknown>,
  FsError = IngestFsError,
  SchemaError = IngestSchemaError
>(
  rootDir: string,
  subDir: string,
  schema: S,
  kind: string,
  options?: Pick<
    LoadCatalogIndexOptions<FsError, SchemaError>,
    "mapFsError" | "mapSchemaError"
  >
): Effect.Effect<
  ReadonlyArray<LoadedEntity<S["Type"]>>,
  FsError | SchemaError | IngestFsError | IngestSchemaError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const dir = path_.resolve(rootDir, "catalog", subDir);

    const files = yield* fs_.readDirectory(dir).pipe(
      Effect.mapError((cause) => {
        const error = {
          operation: "readDirectory",
          path: dir,
          message: stringifyUnknown(cause)
        };
        return options?.mapFsError === undefined
          ? new IngestFsError(error)
          : options.mapFsError(error);
      }),
      Effect.map((entries) => entries.filter((entry) => entry.endsWith(".json")))
    );

    return yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const slug = file.replace(/\.json$/u, "");
          const filePath = path_.resolve(dir, file);
          const text = yield* fs_.readFileString(filePath).pipe(
            Effect.mapError((cause) => {
              const error = {
                operation: "readFileString",
                path: filePath,
                message: stringifyUnknown(cause)
              };
              return options?.mapFsError === undefined
                ? new IngestFsError(error)
                : options.mapFsError(error);
            })
          );
          const data = yield* decodeFileAs(
            schema,
            kind,
            slug,
            options?.mapSchemaError
          )(text);
          return { slug, data } satisfies LoadedEntity<S["Type"]>;
        }),
      { concurrency: INDEX_LOAD_CONCURRENCY }
    );
  });

const isDatasetAliasMergeable = (
  alias: ExternalIdentifier,
  options: Pick<
    LoadCatalogIndexOptions,
    "mergeAliasScheme" | "isMergeableDatasetAlias"
  >
): boolean =>
  alias.scheme === options.mergeAliasScheme &&
  (options.isMergeableDatasetAlias?.(alias) ?? true);

const registerUnique = <T>(
  map: Map<string, T>,
  key: string,
  value: T,
  message: string
): Effect.Effect<void, IngestHarnessError> => {
  if (map.has(key)) {
    return Effect.fail(new IngestHarnessError({ message }));
  }

  map.set(key, value);
  return Effect.void;
};

const baseDistributionLookupKey = (
  distribution: Pick<Distribution, "datasetId" | "kind">
): string => `${distribution.datasetId}::${distribution.kind}`;

const normalizedDistributionFormat = (
  value: string | undefined
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? undefined : trimmed;
};

const distributionLookupDisambiguator = (
  distribution: DistributionLookup
): string | undefined => {
  if (!urlDisambiguatedDistributionKinds.has(distribution.kind)) {
    return undefined;
  }

  const rawUrl = distribution.accessURL ?? distribution.downloadURL;
  if (rawUrl !== undefined) {
    return `url:${normalizeDistributionUrl(rawUrl) ?? rawUrl.trim()}`;
  }

  const format = normalizedDistributionFormat(distribution.format ?? undefined);
  return format === undefined ? undefined : `format:${format}`;
};

export const distributionLookupKey = (
  distribution: DistributionLookup
): string => {
  const baseKey = baseDistributionLookupKey(distribution);
  const disambiguator = distributionLookupDisambiguator(distribution);
  return disambiguator === undefined ? baseKey : `${baseKey}::${disambiguator}`;
};

export const findDistributionInIndex = (
  index: Pick<CatalogIndex, "distributionsByDatasetIdKind" | "allDistributions">,
  distribution: DistributionLookup
): Distribution | null => {
  const exactKey = distributionLookupKey(distribution);
  const exactMatch = index.distributionsByDatasetIdKind.get(exactKey);
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const baseKey = baseDistributionLookupKey(distribution);
  if (exactKey !== baseKey) {
    const legacyMatch = index.distributionsByDatasetIdKind.get(baseKey);
    if (legacyMatch !== undefined) {
      return legacyMatch;
    }
  }

  const exactArrayMatch = index.allDistributions.find(
    (candidate) => distributionLookupKey(candidate) === exactKey
  );
  if (exactArrayMatch !== undefined) {
    return exactArrayMatch;
  }

  const sameKindCandidates = index.allDistributions.filter(
    (candidate) =>
      candidate.datasetId === distribution.datasetId &&
      candidate.kind === distribution.kind
  );
  return sameKindCandidates.length === 1 ? sameKindCandidates[0]! : null;
};

export const buildCatalogIndex = Effect.fn("DcatHarness.buildCatalogIndex")(
  function* (
    entities: LoadedCatalogEntities,
    options: Pick<
      LoadCatalogIndexOptions,
      "mergeAliasScheme" | "isMergeableDatasetAlias"
    >
  ) {
    const datasetsByMergeKey = new Map<string, Dataset>();
    const datasetFileSlugById = new Map<Dataset["id"], string>();
    const datasetSeriesById = new Map<DatasetSeries["id"], DatasetSeries>();
    const datasetSeriesFileSlugById = new Map<
      DatasetSeries["id"],
      string
    >();
    const distributionsByDatasetIdKind = new Map<string, Distribution>();
    const distributionFileSlugById = new Map<Distribution["id"], string>();
    const catalogRecordsByCatalogAndPrimaryTopic = new Map<
      string,
      CatalogRecord
    >();
    const catalogRecordFileSlugById = new Map<CatalogRecord["id"], string>();
    const agentsById = new Map<Agent["id"], Agent>();
    const agentFileSlugById = new Map<Agent["id"], string>();
    const agentsByName = new Map<string, Agent>();
    const catalogsById = new Map<Catalog["id"], Catalog>();
    const dataServicesById = new Map<DataService["id"], DataService>();
    const skippedDatasets: Array<SkippedDataset> = [];

    const allDatasets = entities.datasets.map(({ data }) => data);
    const allDatasetSeries = entities.datasetSeries.map(({ data }) => data);
    const allDistributions = entities.distributions.map(({ data }) => data);
    const allCatalogRecords = entities.catalogRecords.map(({ data }) => data);
    const allCatalogs = entities.catalogs.map(({ data }) => data);
    const allDataServices = entities.dataServices.map(({ data }) => data);
    const allAgents = entities.agents.map(({ data }) => data);

    for (const { slug, data: dataset } of entities.datasets) {
      datasetFileSlugById.set(dataset.id, slug);
      const mergeAlias =
        dataset.aliases.find(
          (alias) => alias.scheme === options.mergeAliasScheme
        )?.value ?? null;
      const mergeKey = dataset.aliases.find((alias) =>
        isDatasetAliasMergeable(alias, options)
      )?.value;

      if (mergeKey !== undefined) {
        yield* registerUnique(
          datasetsByMergeKey,
          mergeKey,
          dataset,
          `Duplicate dataset merge key ${mergeKey} detected for dataset ${dataset.id}`
        );
      } else {
        skippedDatasets.push({
          slug,
          datasetId: dataset.id,
          reason: mergeAlias === null ? "missingMergeAlias" : "unmergeableAlias",
          mergeAliasValue: mergeAlias
        });
      }
    }

    for (const { slug, data: datasetSeries } of entities.datasetSeries) {
      datasetSeriesFileSlugById.set(datasetSeries.id, slug);
      datasetSeriesById.set(datasetSeries.id, datasetSeries);
    }

    for (const { slug, data: distribution } of entities.distributions) {
      distributionFileSlugById.set(distribution.id, slug);
      const key = distributionLookupKey(distribution);
      yield* registerUnique(
        distributionsByDatasetIdKind,
        key,
        distribution,
        `Duplicate distribution key ${key} detected for distribution ${distribution.id}`
      );
    }

    for (const { slug, data: catalogRecord } of entities.catalogRecords) {
      catalogRecordFileSlugById.set(catalogRecord.id, slug);
      const key = `${catalogRecord.catalogId}::${catalogRecord.primaryTopicId}`;
      yield* registerUnique(
        catalogRecordsByCatalogAndPrimaryTopic,
        key,
        catalogRecord,
        `Duplicate catalog-record key ${key} detected for catalog record ${catalogRecord.id}`
      );
    }

    for (const { slug, data: agent } of entities.agents) {
      agentFileSlugById.set(agent.id, slug);
      agentsById.set(agent.id, agent);
      agentsByName.set(agent.name, agent);
    }

    for (const catalog of allCatalogs) {
      catalogsById.set(catalog.id, catalog);
    }

    for (const dataService of allDataServices) {
      dataServicesById.set(dataService.id, dataService);
    }

    return {
      index: {
        datasetsByMergeKey,
        datasetFileSlugById,
        datasetSeriesById,
        datasetSeriesFileSlugById,
        distributionsByDatasetIdKind,
        distributionFileSlugById,
        catalogRecordsByCatalogAndPrimaryTopic,
        catalogRecordFileSlugById,
        agentsById,
        agentFileSlugById,
        agentsByName,
        catalogsById,
        dataServicesById,
        allDatasets,
        allDatasetSeries,
        allDistributions,
        allCatalogRecords,
        allCatalogs,
        allDataServices,
        allAgents
      },
      skippedDatasets
    } satisfies CatalogIndexLoadResult;
  }
);

export const loadCatalogIndexWith = <FsError = IngestFsError, SchemaError = IngestSchemaError>(
  options: LoadCatalogIndexOptions<FsError, SchemaError>
): Effect.Effect<
  CatalogIndexLoadResult,
  FsError | SchemaError | IngestFsError | IngestSchemaError | IngestHarnessError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const [
      datasets,
      datasetSeries,
      distributions,
      catalogRecords,
      dataServices,
      catalogs,
      agents
    ] = yield* Effect.all(
      [
        loadEntitiesFromDir(
          options.rootDir,
          "datasets",
          Dataset,
          "Dataset",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "dataset-series",
          DatasetSeries,
          "DatasetSeries",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "distributions",
          Distribution,
          "Distribution",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "catalog-records",
          CatalogRecord,
          "CatalogRecord",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "data-services",
          DataService,
          "DataService",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "catalogs",
          Catalog,
          "Catalog",
          options
        ),
        loadEntitiesFromDir(
          options.rootDir,
          "agents",
          Agent,
          "Agent",
          options
        )
      ],
      { concurrency: "unbounded" }
    );

    return yield* buildCatalogIndex(
      {
        datasets,
        datasetSeries,
        distributions,
        catalogRecords,
        dataServices,
        catalogs,
        agents
      },
      options
    );
  });
