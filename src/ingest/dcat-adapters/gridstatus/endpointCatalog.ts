import { AliasSchemeValues } from "../../../domain/data-layer";

export const GRIDSTATUS_AGENT_SLUG = "gridstatus";
export const GRIDSTATUS_CATALOG_SLUG = "gridstatus";
export const GRIDSTATUS_DATA_SERVICE_SLUG = "gridstatus-api";
export const GRIDSTATUS_DATASET_ALIAS_SCHEME =
  AliasSchemeValues.gridstatusDatasetId;
export const GRIDSTATUS_BASE_URL = "https://api.gridstatus.io/v1";
export const GRIDSTATUS_ENDPOINT_URL = "https://api.gridstatus.io/v1/";
export const GRIDSTATUS_DOCS_URL = "https://docs.gridstatus.io/developers";
export const GRIDSTATUS_SITE_URL = "https://www.gridstatus.io/";
export const GRIDSTATUS_DATASET_PAGE_BASE =
  "https://www.gridstatus.io/datasets/";
export const GRIDSTATUS_AGENT_NAME = "GridStatus";
export const GRIDSTATUS_CATALOG_TITLE = "GridStatus Data Catalog";
export const GRIDSTATUS_DATA_SERVICE_TITLE = "GridStatus API";
export const GRIDSTATUS_DATA_SERVICE_CONFORMS_TO = "GridStatus REST API";

export const gridstatusDatasetSlug = (datasetId: string): string =>
  `gridstatus-${datasetId.replace(/[_/]+/gu, "-")}`;

export const gridstatusApiDistributionSlug = (datasetId: string): string =>
  `${gridstatusDatasetSlug(datasetId)}-api`;

export const gridstatusCsvDistributionSlug = (datasetId: string): string =>
  `${gridstatusDatasetSlug(datasetId)}-csv`;

export const gridstatusCatalogRecordSlug = (datasetId: string): string =>
  `${gridstatusDatasetSlug(datasetId)}-cr`;

export const gridstatusDatasetLandingPage = (datasetId: string): string =>
  `${GRIDSTATUS_DATASET_PAGE_BASE}${datasetId}`;

export const gridstatusDatasetQueryUrl = (baseUrl: string, datasetId: string): string =>
  `${baseUrl.replace(/\/+$/u, "")}/datasets/${datasetId}/query`;
