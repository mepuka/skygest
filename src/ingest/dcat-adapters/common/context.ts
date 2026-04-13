import { Schema } from "effect";
import {
  Agent,
  AliasSchemeValues,
  Catalog,
  DataService,
  WebUrl,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import type { CatalogIndex } from "../../dcat-harness";

const decodeWebUrl = Schema.decodeUnknownSync(WebUrl);

export const asWebUrl = (value: string): WebUrl => decodeWebUrl(value);

export const hasUrlAlias = (
  aliases: ReadonlyArray<ExternalIdentifier>,
  value: string
): boolean =>
  aliases.some(
    (alias) => alias.scheme === AliasSchemeValues.url && alias.value === value
  );

export const freshUrlAlias = (value: string): ExternalIdentifier => ({
  scheme: AliasSchemeValues.url,
  value: asWebUrl(value),
  relation: "exactMatch"
});

export const freshUrlAliases = (
  ...values: ReadonlyArray<string>
): ReadonlyArray<ExternalIdentifier> => values.map(freshUrlAlias);

export const resolveExistingAgentBySlug = (
  idx: CatalogIndex,
  slug: string
): Agent | null => {
  for (const agent of idx.allAgents) {
    if (idx.agentFileSlugById.get(agent.id) === slug) {
      return agent;
    }
  }

  return null;
};

const arrayify = <T>(value: T | ReadonlyArray<T>): ReadonlyArray<T> => {
  if (Array.isArray(value)) {
    return value;
  }

  return [value] as ReadonlyArray<T>;
};

export const resolveExistingCatalogByPublisher = (
  idx: CatalogIndex,
  agent: Agent,
  options: {
    readonly title: string;
    readonly homepages: WebUrl | ReadonlyArray<WebUrl>;
  }
): Catalog | null => {
  const homepages = arrayify(options.homepages);

  return (
    idx.allCatalogs.find(
      (catalog) =>
        catalog.publisherAgentId === agent.id &&
        (catalog.title === options.title ||
          homepages.some(
            (homepage) =>
              catalog.homepage === homepage ||
              hasUrlAlias(catalog.aliases, homepage)
          ))
    ) ??
    idx.allCatalogs.find((catalog) => catalog.title === options.title) ??
    null
  );
};

export const resolveExistingDataServiceByPublisher = (
  idx: CatalogIndex,
  agent: Agent,
  options: {
    readonly title: string;
    readonly endpointUrl: WebUrl;
  }
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === options.title ||
        dataService.endpointURLs.includes(options.endpointUrl) ||
        hasUrlAlias(dataService.aliases, options.endpointUrl))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(options.endpointUrl)
  ) ??
  null;

export interface DcatBuildContextCommon {
  readonly nowIso: string;
  readonly agentSlug: string;
  readonly catalogSlug: string;
  readonly agentMerged: boolean;
  readonly catalogMerged: boolean;
  readonly agent: Agent;
  readonly catalog: Catalog;
}

export interface DcatBuildContextWithDataService
  extends DcatBuildContextCommon {
  readonly dataServiceSlug: string;
  readonly dataServiceMerged: boolean;
  readonly dataService: DataService;
}
