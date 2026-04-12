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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_EUROPA_AGENT_NAME = "data.europa.eu";
const DATA_EUROPA_AGENT_SLUG = "data-europa";
const DATA_EUROPA_SITE_URL = "https://data.europa.eu/";

const DATA_EUROPA_CATALOG_SLUG = "data-europa-energy";
const DATA_EUROPA_CATALOG_TITLE = "data.europa.eu Energy Datasets";

const DATA_EUROPA_DATA_SERVICE_SLUG = "data-europa-ckan-api";
const DATA_EUROPA_DATA_SERVICE_TITLE = "data.europa.eu CKAN Search API";
const DATA_EUROPA_ENDPOINT_URL =
  "https://data.europa.eu/api/hub/search/ckan/";
const DATA_EUROPA_DATA_SERVICE_CONFORMS_TO = "CKAN Action API";

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeAgent = stripUndefinedAndDecodeWith(Agent);
const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

// ---------------------------------------------------------------------------
// Alias helpers
// ---------------------------------------------------------------------------

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
    value: DATA_EUROPA_SITE_URL,
    relation: "exactMatch"
  }
];

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: DATA_EUROPA_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: DATA_EUROPA_ENDPOINT_URL,
    relation: "exactMatch"
  }
];

// ---------------------------------------------------------------------------
// Resolve existing entities
// ---------------------------------------------------------------------------

const resolveExistingAgent = (idx: CatalogIndex): Agent | null =>
  idx.allAgents.find((agent) => agent.name === DATA_EUROPA_AGENT_NAME) ??
  idx.allAgents.find((agent) => agent.homepage === DATA_EUROPA_SITE_URL) ??
  idx.allAgents.find((agent) =>
    hasUrlAlias(agent.aliases, DATA_EUROPA_SITE_URL)
  ) ??
  null;

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  idx.allCatalogs.find(
    (catalog) =>
      catalog.publisherAgentId === agent.id &&
      (catalog.title === DATA_EUROPA_CATALOG_TITLE ||
        catalog.homepage === DATA_EUROPA_SITE_URL ||
        hasUrlAlias(catalog.aliases, DATA_EUROPA_SITE_URL))
  ) ??
  idx.allCatalogs.find(
    (catalog) => catalog.title === DATA_EUROPA_CATALOG_TITLE
  ) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === DATA_EUROPA_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(DATA_EUROPA_ENDPOINT_URL) ||
        hasUrlAlias(dataService.aliases, DATA_EUROPA_ENDPOINT_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(DATA_EUROPA_ENDPOINT_URL)
  ) ??
  null;

// ---------------------------------------------------------------------------
// Build candidates
// ---------------------------------------------------------------------------

const buildAgentCandidate = (nowIso: string, existing: Agent | null): Agent =>
  decodeAgent({
    _tag: "Agent" as const,
    id: existing?.id ?? mintAgentId(),
    kind: existing?.kind ?? ("organization" as const),
    name: DATA_EUROPA_AGENT_NAME,
    alternateNames: existing?.alternateNames,
    homepage: DATA_EUROPA_SITE_URL,
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
    title: DATA_EUROPA_CATALOG_TITLE,
    description:
      existing?.description ??
      "EU federated open data portal — energy datasets harvested from national catalogs across Europe",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? DATA_EUROPA_SITE_URL,
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
    title: DATA_EUROPA_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "CKAN Action API serving federated dataset metadata from data.europa.eu",
    publisherAgentId: agent.id,
    endpointURLs: [DATA_EUROPA_ENDPOINT_URL],
    endpointDescription:
      existing?.endpointDescription,
    conformsTo: existing?.conformsTo ?? DATA_EUROPA_DATA_SERVICE_CONFORMS_TO,
    servesDatasetIds: existing?.servesDatasetIds ?? [],
    accessRights: existing?.accessRights ?? "public",
    aliases: unionAliases(existing?.aliases ?? [], freshDataServiceAliases),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
    agentSlug: DATA_EUROPA_AGENT_SLUG,
    catalogSlug: DATA_EUROPA_CATALOG_SLUG,
    dataServiceSlug: DATA_EUROPA_DATA_SERVICE_SLUG,
    agentMerged: existingAgent !== null,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent,
    catalog,
    dataService
  };
};
