import { Effect, FileSystem, Path, Result, Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  Distribution,
  type AliasScheme,
  type ExternalIdentifier
} from "../../domain/data-layer";
import {
  decodeJsonStringEitherWith,
  formatSchemaParseError,
  stringifyUnknown
} from "../../platform/Json";

const INDEX_LOAD_CONCURRENCY = 10;

export interface LoadedEntity<T> {
  readonly slug: string;
  readonly data: T;
}

export interface CatalogIndex {
  readonly datasetsByMergeKey: Map<string, Dataset>;
  readonly datasetFileSlugById: Map<Dataset["id"], string>;
  readonly distributionsByDatasetIdKind: Map<string, Distribution>;
  readonly distributionFileSlugById: Map<Distribution["id"], string>;
  readonly catalogRecordsByCatalogAndPrimaryTopic: Map<string, CatalogRecord>;
  readonly catalogRecordFileSlugById: Map<CatalogRecord["id"], string>;
  readonly agentsById: Map<Agent["id"], Agent>;
  readonly agentsByName: Map<string, Agent>;
  readonly catalogsById: Map<Catalog["id"], Catalog>;
  readonly dataServicesById: Map<DataService["id"], DataService>;
  readonly allDatasets: ReadonlyArray<Dataset>;
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

export interface LoadCatalogIndexOptions<FsError, SchemaError> {
  readonly rootDir: string;
  readonly mergeAliasScheme: AliasScheme;
  readonly isMergeableDatasetAlias?: (
    alias: ExternalIdentifier
  ) => boolean;
  readonly mapFsError: (input: {
    readonly operation: string;
    readonly path: string;
    readonly message: string;
  }) => FsError;
  readonly mapSchemaError: (input: {
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }) => SchemaError;
}

interface LoadedCatalogEntities {
  readonly datasets: ReadonlyArray<LoadedEntity<Dataset>>;
  readonly distributions: ReadonlyArray<LoadedEntity<Distribution>>;
  readonly catalogRecords: ReadonlyArray<LoadedEntity<CatalogRecord>>;
  readonly dataServices: ReadonlyArray<LoadedEntity<DataService>>;
  readonly catalogs: ReadonlyArray<LoadedEntity<Catalog>>;
  readonly agents: ReadonlyArray<LoadedEntity<Agent>>;
}

export interface CatalogIndexLoadResult {
  readonly index: CatalogIndex;
  readonly skippedDatasets: ReadonlyArray<SkippedDataset>;
}

const decodeFileAsWith = <S extends Schema.Decoder<unknown>, E>(
  schema: S,
  kind: string,
  slug: string,
  mapSchemaError: (input: {
    readonly kind: string;
    readonly slug: string;
    readonly message: string;
  }) => E
) =>
  (text: string): Effect.Effect<S["Type"], E> =>
    Effect.gen(function* () {
      const result = decodeJsonStringEitherWith(schema)(text);
      if (Result.isFailure(result)) {
        return yield* Effect.fail(
          mapSchemaError({
            kind,
            slug,
            message: formatSchemaParseError(result.failure)
          })
        );
      }
      return result.success;
    });

const loadEntitiesFromDirWith = <
  S extends Schema.Decoder<unknown>,
  FsError,
  SchemaError
>(
  rootDir: string,
  subDir: string,
  schema: S,
  kind: string,
  options: Pick<
    LoadCatalogIndexOptions<FsError, SchemaError>,
    "mapFsError" | "mapSchemaError"
  >
): Effect.Effect<
  ReadonlyArray<LoadedEntity<S["Type"]>>,
  FsError | SchemaError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs_ = yield* FileSystem.FileSystem;
    const path_ = yield* Path.Path;
    const dir = path_.resolve(rootDir, "catalog", subDir);

    const files = yield* fs_.readDirectory(dir).pipe(
      Effect.mapError((cause) =>
        options.mapFsError({
          operation: "readDirectory",
          path: dir,
          message: stringifyUnknown(cause)
        })
      ),
      Effect.map((entries) => entries.filter((entry) => entry.endsWith(".json")))
    );

    return yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const slug = file.replace(/\.json$/u, "");
          const filePath = path_.resolve(dir, file);
          const text = yield* fs_.readFileString(filePath).pipe(
            Effect.mapError((cause) =>
              options.mapFsError({
                operation: "readFileString",
                path: filePath,
                message: stringifyUnknown(cause)
              })
            )
          );
          const data = yield* decodeFileAsWith(
            schema,
            kind,
            slug,
            options.mapSchemaError
          )(text);
          return { slug, data } satisfies LoadedEntity<S["Type"]>;
        }),
      { concurrency: INDEX_LOAD_CONCURRENCY }
    );
  });

const isDatasetAliasMergeable = (
  alias: ExternalIdentifier,
  options: Pick<
    LoadCatalogIndexOptions<never, never>,
    "mergeAliasScheme" | "isMergeableDatasetAlias"
  >
): boolean =>
  alias.scheme === options.mergeAliasScheme &&
  (options.isMergeableDatasetAlias?.(alias) ?? true);

export const buildCatalogIndex = (
  entities: LoadedCatalogEntities,
  options: Pick<
    LoadCatalogIndexOptions<never, never>,
    "mergeAliasScheme" | "isMergeableDatasetAlias"
  >
): CatalogIndexLoadResult => {
  const datasetsByMergeKey = new Map<string, Dataset>();
  const datasetFileSlugById = new Map<Dataset["id"], string>();
  const distributionsByDatasetIdKind = new Map<string, Distribution>();
  const distributionFileSlugById = new Map<Distribution["id"], string>();
  const catalogRecordsByCatalogAndPrimaryTopic = new Map<
    string,
    CatalogRecord
  >();
  const catalogRecordFileSlugById = new Map<CatalogRecord["id"], string>();
  const agentsById = new Map<Agent["id"], Agent>();
  const agentsByName = new Map<string, Agent>();
  const catalogsById = new Map<Catalog["id"], Catalog>();
  const dataServicesById = new Map<DataService["id"], DataService>();
  const skippedDatasets: Array<SkippedDataset> = [];

  const allDatasets = entities.datasets.map(({ data }) => data);
  const allDistributions = entities.distributions.map(({ data }) => data);
  const allCatalogRecords = entities.catalogRecords.map(({ data }) => data);
  const allCatalogs = entities.catalogs.map(({ data }) => data);
  const allDataServices = entities.dataServices.map(({ data }) => data);
  const allAgents = entities.agents.map(({ data }) => data);

  for (const { slug, data: dataset } of entities.datasets) {
    datasetFileSlugById.set(dataset.id, slug);
    const mergeAlias =
      dataset.aliases.find((alias) => alias.scheme === options.mergeAliasScheme)
        ?.value ?? null;
    const mergeKey = dataset.aliases.find((alias) =>
      isDatasetAliasMergeable(alias, options)
    )?.value;

    if (mergeKey !== undefined) {
      datasetsByMergeKey.set(mergeKey, dataset);
    } else {
      skippedDatasets.push({
        slug,
        datasetId: dataset.id,
        reason: mergeAlias === null ? "missingMergeAlias" : "unmergeableAlias",
        mergeAliasValue: mergeAlias
      });
    }
  }

  for (const { slug, data: distribution } of entities.distributions) {
    distributionFileSlugById.set(distribution.id, slug);
    distributionsByDatasetIdKind.set(
      `${distribution.datasetId}::${distribution.kind}`,
      distribution
    );
  }

  for (const { slug, data: catalogRecord } of entities.catalogRecords) {
    catalogRecordFileSlugById.set(catalogRecord.id, slug);
    catalogRecordsByCatalogAndPrimaryTopic.set(
      `${catalogRecord.catalogId}::${catalogRecord.primaryTopicId}`,
      catalogRecord
    );
  }

  for (const agent of allAgents) {
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
      distributionsByDatasetIdKind,
      distributionFileSlugById,
      catalogRecordsByCatalogAndPrimaryTopic,
      catalogRecordFileSlugById,
      agentsById,
      agentsByName,
      catalogsById,
      dataServicesById,
      allDatasets,
      allDistributions,
      allCatalogRecords,
      allCatalogs,
      allDataServices,
      allAgents
    },
    skippedDatasets
  };
};

export const loadCatalogIndexWith = <FsError, SchemaError>(
  options: LoadCatalogIndexOptions<FsError, SchemaError>
): Effect.Effect<
  CatalogIndexLoadResult,
  FsError | SchemaError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const [
      datasets,
      distributions,
      catalogRecords,
      dataServices,
      catalogs,
      agents
    ] = yield* Effect.all(
      [
        loadEntitiesFromDirWith(
          options.rootDir,
          "datasets",
          Dataset,
          "Dataset",
          options
        ),
        loadEntitiesFromDirWith(
          options.rootDir,
          "distributions",
          Distribution,
          "Distribution",
          options
        ),
        loadEntitiesFromDirWith(
          options.rootDir,
          "catalog-records",
          CatalogRecord,
          "CatalogRecord",
          options
        ),
        loadEntitiesFromDirWith(
          options.rootDir,
          "data-services",
          DataService,
          "DataService",
          options
        ),
        loadEntitiesFromDirWith(
          options.rootDir,
          "catalogs",
          Catalog,
          "Catalog",
          options
        ),
        loadEntitiesFromDirWith(
          options.rootDir,
          "agents",
          Agent,
          "Agent",
          options
        )
      ],
      { concurrency: "unbounded" }
    );

    return buildCatalogIndex(
      {
        datasets,
        distributions,
        catalogRecords,
        dataServices,
        catalogs,
        agents
      },
      options
    );
  });
