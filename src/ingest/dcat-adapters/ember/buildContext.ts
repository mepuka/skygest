import {
  Agent,
  AliasSchemeValues,
  Catalog,
  DataService,
  mintAgentId,
  mintCatalogId,
  mintDataServiceId,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import { type CatalogIndex, unionAliases } from "../../dcat-harness";
import {
  EMBER_AGENT_NAME,
  EMBER_AGENT_SLUG,
  EMBER_API_BASE_URL,
  EMBER_CATALOG_SLUG,
  EMBER_CATALOG_TITLE,
  EMBER_DATA_SERVICE_SLUG,
  EMBER_DATA_SERVICE_TITLE,
  EMBER_LEGACY_CATALOG_URL,
  EMBER_LEGACY_SITE_URL,
  EMBER_LICENSE,
  EMBER_OPENAPI_URL,
  EMBER_SITE_URL
} from "./endpointCatalog";

const decodeAgent = stripUndefinedAndDecodeWith(Agent);
const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

const hasUrlAlias = (
  aliases: ReadonlyArray<ExternalIdentifier>,
  value: string
): boolean =>
  aliases.some(
    (alias) => alias.scheme === AliasSchemeValues.url && alias.value === value
  );

const freshAgentAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: EMBER_SITE_URL,
    relation: "exactMatch"
  }
];

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: EMBER_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: EMBER_API_BASE_URL,
    relation: "exactMatch"
  }
];

const resolveExistingAgent = (idx: CatalogIndex): Agent | null =>
  idx.allAgents.find((agent) => agent.name === EMBER_AGENT_NAME) ??
  idx.allAgents.find((agent) => agent.homepage === EMBER_SITE_URL) ??
  idx.allAgents.find((agent) => agent.homepage === EMBER_LEGACY_SITE_URL) ??
  idx.allAgents.find((agent) => hasUrlAlias(agent.aliases, EMBER_SITE_URL)) ??
  idx.allAgents.find((agent) =>
    hasUrlAlias(agent.aliases, EMBER_LEGACY_SITE_URL)
  ) ??
  null;

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  idx.allCatalogs.find(
    (catalog) =>
      catalog.publisherAgentId === agent.id &&
      (catalog.title === EMBER_CATALOG_TITLE ||
        catalog.homepage === EMBER_SITE_URL ||
        catalog.homepage === EMBER_LEGACY_CATALOG_URL ||
        hasUrlAlias(catalog.aliases, EMBER_SITE_URL) ||
        hasUrlAlias(catalog.aliases, EMBER_LEGACY_SITE_URL))
  ) ??
  idx.allCatalogs.find((catalog) => catalog.title === EMBER_CATALOG_TITLE) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === EMBER_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(EMBER_API_BASE_URL) ||
        hasUrlAlias(dataService.aliases, EMBER_API_BASE_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(EMBER_API_BASE_URL)
  ) ??
  null;

const buildAgentCandidate = (nowIso: string, existing: Agent | null): Agent =>
  decodeAgent({
    _tag: "Agent" as const,
    id: existing?.id ?? mintAgentId(),
    kind: existing?.kind ?? ("organization" as const),
    name: EMBER_AGENT_NAME,
    alternateNames: existing?.alternateNames ?? ["Ember Climate"],
    homepage: EMBER_SITE_URL,
    aliases: unionAliases(existing?.aliases ?? [], freshAgentAliases),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

const buildCatalogCandidate = (
  nowIso: string,
  agent: Agent,
  existing: Catalog | null
): Catalog =>
  decodeCatalog({
    _tag: "Catalog" as const,
    id: existing?.id ?? mintCatalogId(),
    title: EMBER_CATALOG_TITLE,
    description:
      existing?.description ??
      "Catalog of Ember analytical datasets and API-backed electricity indicators",
    publisherAgentId: agent.id,
    homepage: EMBER_SITE_URL,
    aliases: unionAliases(existing?.aliases ?? [], freshCatalogAliases),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

const buildDataServiceCandidate = (
  nowIso: string,
  agent: Agent,
  existing: DataService | null
): DataService =>
  decodeDataService({
    _tag: "DataService" as const,
    id: existing?.id ?? mintDataServiceId(),
    title: EMBER_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "REST API serving Ember electricity, demand, capacity, emissions, and carbon-intensity datasets",
    publisherAgentId: agent.id,
    endpointURLs: existing?.endpointURLs ?? [EMBER_API_BASE_URL],
    endpointDescription: existing?.endpointDescription ?? EMBER_OPENAPI_URL,
    conformsTo: existing?.conformsTo ?? "OpenAPI 3",
    servesDatasetIds: existing?.servesDatasetIds ?? [],
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license ?? EMBER_LICENSE,
    aliases: unionAliases(existing?.aliases ?? [], freshDataServiceAliases),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

export interface BuildContext {
  readonly nowIso: string;
  readonly agentSlug: string;
  readonly catalogSlug: string;
  readonly dataServiceSlug: string;
  readonly agentMerged: boolean;
  readonly catalogMerged: boolean;
  readonly dataServiceMerged: boolean;
  readonly agent: Agent;
  readonly catalog: Catalog;
  readonly dataService: DataService;
}

export const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): BuildContext => {
  const existingAgent = resolveExistingAgent(idx);
  const agent = buildAgentCandidate(nowIso, existingAgent);
  const existingCatalog = resolveExistingCatalog(idx, existingAgent ?? agent);
  const catalog = buildCatalogCandidate(nowIso, agent, existingCatalog);
  const existingDataService = resolveExistingDataService(
    idx,
    existingAgent ?? agent
  );
  const dataService = buildDataServiceCandidate(
    nowIso,
    agent,
    existingDataService
  );

  return {
    nowIso,
    agentSlug: EMBER_AGENT_SLUG,
    catalogSlug: EMBER_CATALOG_SLUG,
    dataServiceSlug: EMBER_DATA_SERVICE_SLUG,
    agentMerged: existingAgent !== null,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent,
    catalog,
    dataService
  };
};
