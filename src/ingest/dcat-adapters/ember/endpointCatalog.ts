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
  readonly datasetSeriesSlug: string;
  readonly distributionSlug: string;
  readonly catalogRecordSlug: string;
  readonly title: string;
  readonly summary?: string;
  readonly description?: string;
}

const trimPath = (path: string): string => path.replace(/^\/+|\/+$/gu, "");

export const emberFamilyTitle = (value: string): string =>
  value
    .split(/[-/]+/u)
    .filter((token) => token.length > 0)
    .map((token) => token[0]!.toUpperCase() + token.slice(1))
    .join(" ");

export const routeFromPath = (path: string): string | null => {
  const trimmed = trimPath(path);
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }

  const resolution = segments.at(-1);
  if (resolution !== "monthly" && resolution !== "yearly") {
    return null;
  }

  const prefixSegments =
    segments[0] === "v1" ? segments.slice(1, -1) : segments.slice(0, -1);
  if (prefixSegments.length === 0) {
    return null;
  }

  return `${prefixSegments.join("/")}/${resolution}`;
};

export const emberDatasetSlug = (route: string): string =>
  `ember-${route.replace(/[\/_]+/gu, "-")}`;

export const emberDatasetSeriesSlug = (family: string): string =>
  `ember-${family.replace(/[\/_]+/gu, "-")}-series`;

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
          datasetSeriesSlug: emberDatasetSeriesSlug(family!),
          distributionSlug: emberDistributionSlug(route),
          catalogRecordSlug: emberCatalogRecordSlug(route),
          title: `Ember ${emberFamilyTitle(family!)} ${emberFamilyTitle(resolution!)}`,
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
