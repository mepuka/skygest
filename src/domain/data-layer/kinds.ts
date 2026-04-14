import { Schema } from "effect";
import {
  Agent,
  Catalog,
  CatalogRecord,
  DataService,
  Dataset,
  DatasetSeries,
  Distribution
} from "./catalog";
import {
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  SeriesId,
  VariableId,
  mintAgentId,
  mintCatalogId,
  mintCatalogRecordId,
  mintDataServiceId,
  mintDatasetId,
  mintDatasetSeriesId,
  mintDistributionId,
  mintSeriesId,
  mintVariableId
} from "./ids";
import {
  Series,
  Variable
} from "./variable";

export const DataLayerKindMembers = [
  "agents",
  "catalogs",
  "catalog-records",
  "datasets",
  "distributions",
  "data-services",
  "dataset-series",
  "variables",
  "series"
] as const;

export const DataLayerKind = Schema.Literals([
  ...DataLayerKindMembers
]);
export type DataLayerKind = Schema.Schema.Type<typeof DataLayerKind>;

export const DataLayerEntityTagMembers = [
  "Agent",
  "Catalog",
  "CatalogRecord",
  "Dataset",
  "Distribution",
  "DataService",
  "DatasetSeries",
  "Variable",
  "Series"
] as const;

export const DataLayerEntityTag = Schema.Literals([
  ...DataLayerEntityTagMembers
]);
export type DataLayerEntityTag = Schema.Schema.Type<typeof DataLayerEntityTag>;

export type DataLayerSeedKey =
  | "agents"
  | "catalogs"
  | "catalogRecords"
  | "datasets"
  | "distributions"
  | "dataServices"
  | "datasetSeries"
  | "variables"
  | "series";

type AnySchema = Schema.Decoder<any, never>;

export type DataLayerEntityKindSpec = {
  readonly tag: DataLayerEntityTag;
  readonly apiKind: DataLayerKind;
  readonly seedKey: DataLayerSeedKey;
  readonly directory: string;
  readonly schema: AnySchema;
  readonly idSchema: AnySchema;
  readonly mintId: () => string;
};

export const dataLayerEntityKindSpecs = [
  {
    tag: "Agent",
    apiKind: "agents",
    seedKey: "agents",
    directory: "catalog/agents",
    schema: Agent,
    idSchema: AgentId,
    mintId: mintAgentId
  },
  {
    tag: "Catalog",
    apiKind: "catalogs",
    seedKey: "catalogs",
    directory: "catalog/catalogs",
    schema: Catalog,
    idSchema: CatalogId,
    mintId: mintCatalogId
  },
  {
    tag: "CatalogRecord",
    apiKind: "catalog-records",
    seedKey: "catalogRecords",
    directory: "catalog/catalog-records",
    schema: CatalogRecord,
    idSchema: CatalogRecordId,
    mintId: mintCatalogRecordId
  },
  {
    tag: "Dataset",
    apiKind: "datasets",
    seedKey: "datasets",
    directory: "catalog/datasets",
    schema: Dataset,
    idSchema: DatasetId,
    mintId: mintDatasetId
  },
  {
    tag: "Distribution",
    apiKind: "distributions",
    seedKey: "distributions",
    directory: "catalog/distributions",
    schema: Distribution,
    idSchema: DistributionId,
    mintId: mintDistributionId
  },
  {
    tag: "DataService",
    apiKind: "data-services",
    seedKey: "dataServices",
    directory: "catalog/data-services",
    schema: DataService,
    idSchema: DataServiceId,
    mintId: mintDataServiceId
  },
  {
    tag: "DatasetSeries",
    apiKind: "dataset-series",
    seedKey: "datasetSeries",
    directory: "catalog/dataset-series",
    schema: DatasetSeries,
    idSchema: DatasetSeriesId,
    mintId: mintDatasetSeriesId
  },
  {
    tag: "Variable",
    apiKind: "variables",
    seedKey: "variables",
    directory: "variables",
    schema: Variable,
    idSchema: VariableId,
    mintId: mintVariableId
  },
  {
    tag: "Series",
    apiKind: "series",
    seedKey: "series",
    directory: "series",
    schema: Series,
    idSchema: SeriesId,
    mintId: mintSeriesId
  }
] as const satisfies ReadonlyArray<DataLayerEntityKindSpec>;

export const dataLayerEntityKindSpecByApiKind = Object.fromEntries(
  dataLayerEntityKindSpecs.map((spec) => [spec.apiKind, spec])
) as unknown as Record<DataLayerKind, DataLayerEntityKindSpec>;

export const dataLayerEntityKindSpecByTag = Object.fromEntries(
  dataLayerEntityKindSpecs.map((spec) => [spec.tag, spec])
) as unknown as Record<DataLayerEntityTag, DataLayerEntityKindSpec>;
