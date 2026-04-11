import { Effect, Layer, Result } from "effect";
import { DataLayerRegistryLoadError } from "../domain/errors";
import {
  formatDataLayerRegistryDiagnostic,
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup
} from "../resolution/dataLayerRegistry";
import { AgentsRepo } from "../services/AgentsRepo";
import { CatalogRecordsRepo } from "../services/CatalogRecordsRepo";
import { CatalogsRepo } from "../services/CatalogsRepo";
import { DataLayerRegistry } from "../services/DataLayerRegistry";
import { DataServicesRepo } from "../services/DataServicesRepo";
import { DatasetSeriesRepo } from "../services/DatasetSeriesRepo";
import { DatasetsRepo } from "../services/DatasetsRepo";
import { DistributionsRepo } from "../services/DistributionsRepo";
import { SeriesRepo } from "../services/SeriesRepo";
import { VariablesRepo } from "../services/VariablesRepo";

export const d1DataLayerRegistryRoot = "d1://data-layer-registry";

export const loadD1DataLayerSeed = () =>
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
      { concurrency: "unbounded" }
    );
  });

export const loadD1DataLayerRegistry = (
  root = d1DataLayerRegistryRoot
) =>
  Effect.gen(function* () {
    const seed = yield* loadD1DataLayerSeed();

    const prepared = prepareDataLayerRegistry(seed, { root });
    if (Result.isFailure(prepared)) {
      return yield* new DataLayerRegistryLoadError({
        root,
        diagnostic: prepared.failure,
        message: formatDataLayerRegistryDiagnostic(prepared.failure)
      });
    }

    return prepared.success;
  });

export const d1DataLayerRegistryLayer = (
  root = d1DataLayerRegistryRoot
) =>
  Layer.effect(
    DataLayerRegistry,
    Effect.gen(function* () {
      const prepared = yield* loadD1DataLayerRegistry(root);
      return DataLayerRegistry.of({
        prepared,
        lookup: toDataLayerRegistryLookup(prepared)
      });
    })
  );
