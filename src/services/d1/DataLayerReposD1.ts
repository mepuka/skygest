import { Layer } from "effect";
import { AgentsRepoD1 } from "./AgentsRepoD1";
import { CatalogRecordsRepoD1 } from "./CatalogRecordsRepoD1";
import { CatalogsRepoD1 } from "./CatalogsRepoD1";
import { DataServicesRepoD1 } from "./DataServicesRepoD1";
import { DatasetSeriesRepoD1 } from "./DatasetSeriesRepoD1";
import { DatasetsRepoD1 } from "./DatasetsRepoD1";
import { DistributionsRepoD1 } from "./DistributionsRepoD1";
import { SeriesRepoD1 } from "./SeriesRepoD1";
import { VariablesRepoD1 } from "./VariablesRepoD1";

export const DataLayerReposD1 = {
  layer: Layer.mergeAll(
    AgentsRepoD1.layer,
    CatalogsRepoD1.layer,
    CatalogRecordsRepoD1.layer,
    DatasetsRepoD1.layer,
    DistributionsRepoD1.layer,
    DataServicesRepoD1.layer,
    DatasetSeriesRepoD1.layer,
    VariablesRepoD1.layer,
    SeriesRepoD1.layer
  )
};
