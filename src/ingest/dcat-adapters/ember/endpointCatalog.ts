import { AliasSchemeValues } from "../../../domain/data-layer";
import type { EmberOpenApiDocument } from "./openApi";

export const EMBER_AGENT_SLUG = "ember";
export const EMBER_CATALOG_SLUG = "ember";
export const EMBER_DATA_SERVICE_SLUG = "ember-energy-api";
export const EMBER_DATASET_ALIAS_SCHEME = AliasSchemeValues.emberRoute;
export const EMBER_OPENAPI_URL =
  "https://api.ember-energy.org/v1/openapi.json";
export const EMBER_API_BASE_URL = "https://api.ember-energy.org/v1/";
export const EMBER_SITE_URL = "https://ember-energy.org/";
export const EMBER_LEGACY_SITE_URL = "https://ember-climate.org/";
export const EMBER_LEGACY_CATALOG_URL = "https://ember-climate.org";
export const EMBER_LICENSE = "CC-BY-4.0";
export const EMBER_AGENT_NAME = "Ember";
export const EMBER_CATALOG_TITLE = "Ember Data Catalog";
export const EMBER_DATA_SERVICE_TITLE = "Ember Energy API";

export interface EndpointFamily {
  readonly path: string;
  readonly family: string;
  readonly resolution: "monthly" | "yearly";
  readonly route: string;
  readonly datasetSlug: string;
  readonly distributionSlug: string;
  readonly catalogRecordSlug: string;
  readonly title: string;
  readonly summary?: string;
  readonly description?: string;
}

const trimPath = (path: string): string => path.replace(/^\/+|\/+$/gu, "");

const emberPathPattern =
  /^(?:v1\/)?([a-z-]+)\/(monthly|yearly)$/u;

const titleCase = (value: string): string =>
  value
    .split(/[-/]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token[0]!.toUpperCase() + token.slice(1))
    .join(" ");

export const routeFromPath = (path: string): string | null => {
  const match = trimPath(path).match(emberPathPattern);
  if (match === null) {
    return null;
  }

  const [, family, resolution] = match;
  return `${family!}/${resolution!}`;
};

export const emberDatasetSlug = (route: string): string =>
  `ember-${route.replace(/[\/_]+/gu, "-")}`;

export const emberDistributionSlug = (route: string): string =>
  `${emberDatasetSlug(route)}-api`;

export const emberCatalogRecordSlug = (route: string): string =>
  `${emberDatasetSlug(route)}-cr`;

export const listEndpointFamilies = (
  document: EmberOpenApiDocument
): ReadonlyArray<EndpointFamily> =>
  Object.entries(document.paths)
    .flatMap(([path, pathItem]) => {
      const route = routeFromPath(path);
      if (route === null || pathItem.get === undefined) {
        return [];
      }

      const [family, resolution] = route.split("/");
      const getOperation = pathItem.get;
      return [
        {
          path,
          family: family!,
          resolution: resolution as EndpointFamily["resolution"],
          route,
          datasetSlug: emberDatasetSlug(route),
          distributionSlug: emberDistributionSlug(route),
          catalogRecordSlug: emberCatalogRecordSlug(route),
          title: `Ember ${titleCase(family!)} ${titleCase(resolution!)}`,
          ...(getOperation.summary === undefined
            ? {}
            : { summary: getOperation.summary }),
          ...(getOperation.description === undefined
            ? {}
            : { description: getOperation.description })
        }
      ];
    })
    .sort((left, right) => left.route.localeCompare(right.route));
