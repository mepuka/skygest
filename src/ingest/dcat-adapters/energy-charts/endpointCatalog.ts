import { AliasSchemeValues } from "../../../domain/data-layer";
import type { EnergyChartsOpenApiDocument } from "./openApi";

export const ENERGY_CHARTS_AGENT_SLUG = "fraunhofer-ise";
export const ENERGY_CHARTS_CATALOG_SLUG = "energy-charts";
export const ENERGY_CHARTS_DATA_SERVICE_SLUG = "energy-charts-api";
export const ENERGY_CHARTS_DATASET_ALIAS_SCHEME =
  AliasSchemeValues.energyChartsEndpoint;
export const ENERGY_CHARTS_OPENAPI_URL =
  "https://api.energy-charts.info/openapi.json";
export const ENERGY_CHARTS_API_BASE_URL = "https://api.energy-charts.info/";
export const ENERGY_CHARTS_SITE_URL = "https://www.energy-charts.info/";
export const FRAUNHOFER_ISE_HOMEPAGE = "https://www.ise.fraunhofer.de/";
export const ENERGY_CHARTS_LICENSE_URL =
  "https://creativecommons.org/licenses/by/4.0/";
export const ENERGY_CHARTS_AGENT_NAME =
  "Fraunhofer Institute for Solar Energy Systems ISE";
export const ENERGY_CHARTS_CATALOG_TITLE = "Energy Charts API Catalog";
export const ENERGY_CHARTS_DATA_SERVICE_TITLE = "Energy Charts API";

export interface EndpointFamily {
  readonly path: string;
  readonly endpointKey: string;
  readonly datasetSlug: string;
  readonly distributionSlug: string;
  readonly catalogRecordSlug: string;
  readonly title: string;
  readonly summary?: string;
  readonly description?: string;
}

const trimPath = (path: string): string => path.replace(/^\/+|\/+$/gu, "");

const humanizeEndpointKey = (endpointKey: string): string =>
  endpointKey
    .split(/[\/_-]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token[0]!.toUpperCase() + token.slice(1))
    .join(" ");

export const endpointKeyFromPath = (path: string): string => trimPath(path);

export const energyChartsDatasetSlug = (endpointKey: string): string =>
  `energy-charts-${endpointKey.replace(/[\/_]+/gu, "-")}`;

export const energyChartsDistributionSlug = (endpointKey: string): string =>
  `${energyChartsDatasetSlug(endpointKey)}-api`;

export const energyChartsCatalogRecordSlug = (endpointKey: string): string =>
  `${energyChartsDatasetSlug(endpointKey)}-cr`;

export const listEndpointFamilies = (
  document: EnergyChartsOpenApiDocument
): ReadonlyArray<EndpointFamily> =>
  Object.entries(document.paths)
    .filter(([path, pathItem]) => trimPath(path).length > 0 && pathItem.get !== undefined)
    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
    .map(([path, pathItem]) => {
      const endpointKey = endpointKeyFromPath(path);
      const getOperation = pathItem.get!;
      return {
        path,
        endpointKey,
        datasetSlug: energyChartsDatasetSlug(endpointKey),
        distributionSlug: energyChartsDistributionSlug(endpointKey),
        catalogRecordSlug: energyChartsCatalogRecordSlug(endpointKey),
        title: `Energy Charts ${humanizeEndpointKey(endpointKey)}`,
        ...(getOperation.summary === undefined
          ? {}
          : { summary: getOperation.summary }),
        ...(getOperation.description === undefined
          ? {}
          : { description: getOperation.description })
      };
    });
