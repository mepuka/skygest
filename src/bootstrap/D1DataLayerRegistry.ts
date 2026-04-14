import { Effect } from "effect";
import { AgentsRepo } from "../services/AgentsRepo";
import { CatalogRecordsRepo } from "../services/CatalogRecordsRepo";
import { CatalogsRepo } from "../services/CatalogsRepo";
import { DataServicesRepo } from "../services/DataServicesRepo";
import { DatasetSeriesRepo } from "../services/DatasetSeriesRepo";
import { DatasetsRepo } from "../services/DatasetsRepo";
import { DistributionsRepo } from "../services/DistributionsRepo";
import { SeriesRepo } from "../services/SeriesRepo";
import {
  loadPreparedDataLayerRegistry,
  DataLayerRegistry
} from "../services/DataLayerRegistry";
import { VariablesRepo } from "../services/VariablesRepo";

export const d1DataLayerRegistryRoot = "d1://data-layer-registry";
export const dataLayerRegistrySourceTables = [
  "agents",
  "catalogs",
  "catalog_records",
  "datasets",
  "distributions",
  "data_services",
  "dataset_series",
  "variables",
  "series"
] as const;
export const dataLayerRegistrySourceTableArgs =
  dataLayerRegistrySourceTables.flatMap((name) => ["--table", name]);
const dataLayerRegistryReadConcurrency = 1;

export const loadRepoDataLayerSeed = () =>
  Effect.gen(function* () {
    const agents = yield* AgentsRepo;
    const catalogs = yield* CatalogsRepo;
    const catalogRecords = yield* CatalogRecordsRepo;
    const datasets = yield* DatasetsRepo;
    const distributions = yield* DistributionsRepo;
    const dataServices = yield* DataServicesRepo;
    const datasetSeries = yield* DatasetSeriesRepo;
    const variables = yield* VariablesRepo;
    const series = yield* SeriesRepo;

    return yield* Effect.all(
      {
        agents: agents.listAll(),
        catalogs: catalogs.listAll(),
        catalogRecords: catalogRecords.listAll(),
        datasets: datasets.listAll(),
        distributions: distributions.listAll(),
        dataServices: dataServices.listAll(),
        datasetSeries: datasetSeries.listAll(),
        variables: variables.listAll(),
        series: series.listAll()
      },
      { concurrency: dataLayerRegistryReadConcurrency }
    );
  });

export const loadD1DataLayerSeed = loadRepoDataLayerSeed;

export const loadD1DataLayerRegistry = (
  root = d1DataLayerRegistryRoot
) =>
  loadPreparedDataLayerRegistry(
    loadRepoDataLayerSeed().pipe(
      Effect.map((seed) => ({
        seed,
        root
      }))
    )
  );

export const d1DataLayerRegistryLayer = (
  root = d1DataLayerRegistryRoot
) =>
  DataLayerRegistry.layerFromEffect(loadD1DataLayerRegistry(root));
