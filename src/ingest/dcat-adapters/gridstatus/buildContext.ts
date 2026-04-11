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
  GRIDSTATUS_AGENT_NAME,
  GRIDSTATUS_AGENT_SLUG,
  GRIDSTATUS_CATALOG_SLUG,
  GRIDSTATUS_CATALOG_TITLE,
  GRIDSTATUS_DATA_SERVICE_CONFORMS_TO,
  GRIDSTATUS_DATA_SERVICE_SLUG,
  GRIDSTATUS_DATA_SERVICE_TITLE,
  GRIDSTATUS_DOCS_URL,
  GRIDSTATUS_ENDPOINT_URL,
  GRIDSTATUS_SITE_URL
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
    value: GRIDSTATUS_SITE_URL,
    relation: "exactMatch"
  }
];

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: GRIDSTATUS_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: GRIDSTATUS_ENDPOINT_URL,
    relation: "exactMatch"
  }
];

const resolveExistingAgent = (idx: CatalogIndex): Agent | null =>
  idx.allAgents.find((agent) => agent.name === GRIDSTATUS_AGENT_NAME) ??
  idx.allAgents.find((agent) => agent.homepage === GRIDSTATUS_SITE_URL) ??
  idx.allAgents.find((agent) => hasUrlAlias(agent.aliases, GRIDSTATUS_SITE_URL)) ??
  null;

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  idx.allCatalogs.find(
    (catalog) =>
      catalog.publisherAgentId === agent.id &&
      (catalog.title === GRIDSTATUS_CATALOG_TITLE ||
        catalog.homepage === GRIDSTATUS_SITE_URL ||
        hasUrlAlias(catalog.aliases, GRIDSTATUS_SITE_URL))
  ) ??
  idx.allCatalogs.find((catalog) => catalog.title === GRIDSTATUS_CATALOG_TITLE) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === GRIDSTATUS_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(GRIDSTATUS_ENDPOINT_URL) ||
        hasUrlAlias(dataService.aliases, GRIDSTATUS_ENDPOINT_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(GRIDSTATUS_ENDPOINT_URL)
  ) ??
  null;

const buildAgentCandidate = (nowIso: string, existing: Agent | null): Agent =>
  decodeAgent({
    _tag: "Agent" as const,
    id: existing?.id ?? mintAgentId(),
    kind: existing?.kind ?? ("organization" as const),
    name: GRIDSTATUS_AGENT_NAME,
    alternateNames: existing?.alternateNames,
    homepage: GRIDSTATUS_SITE_URL,
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
    title: GRIDSTATUS_CATALOG_TITLE,
    description:
      existing?.description ??
      "Catalog of GridStatus datasets spanning ISO/RTO operations across North America",
    publisherAgentId: agent.id,
    homepage: GRIDSTATUS_SITE_URL,
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
    title: GRIDSTATUS_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "Unified API for ISO/RTO operational datasets published by GridStatus",
    publisherAgentId: agent.id,
    endpointURLs: [GRIDSTATUS_ENDPOINT_URL],
    endpointDescription: existing?.endpointDescription ?? GRIDSTATUS_DOCS_URL,
    conformsTo: existing?.conformsTo ?? GRIDSTATUS_DATA_SERVICE_CONFORMS_TO,
    servesDatasetIds: existing?.servesDatasetIds ?? [],
    accessRights: existing?.accessRights ?? "public",
    license: existing?.license,
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
    agentSlug: GRIDSTATUS_AGENT_SLUG,
    catalogSlug: GRIDSTATUS_CATALOG_SLUG,
    dataServiceSlug: GRIDSTATUS_DATA_SERVICE_SLUG,
    agentMerged: existingAgent !== null,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent,
    catalog,
    dataService
  };
};
