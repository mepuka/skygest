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
  ENERGY_CHARTS_AGENT_NAME,
  ENERGY_CHARTS_AGENT_SLUG,
  ENERGY_CHARTS_API_BASE_URL,
  ENERGY_CHARTS_CATALOG_SLUG,
  ENERGY_CHARTS_CATALOG_TITLE,
  ENERGY_CHARTS_DATA_SERVICE_SLUG,
  ENERGY_CHARTS_DATA_SERVICE_TITLE,
  ENERGY_CHARTS_OPENAPI_URL,
  ENERGY_CHARTS_SITE_URL,
  FRAUNHOFER_ISE_HOMEPAGE
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
    value: FRAUNHOFER_ISE_HOMEPAGE,
    relation: "exactMatch"
  }
];

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: ENERGY_CHARTS_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: ENERGY_CHARTS_API_BASE_URL,
    relation: "exactMatch"
  }
];

const resolveExistingAgent = (idx: CatalogIndex): Agent | null =>
  idx.allAgents.find((agent) => agent.name === ENERGY_CHARTS_AGENT_NAME) ??
  idx.allAgents.find((agent) => agent.homepage === FRAUNHOFER_ISE_HOMEPAGE) ??
  idx.allAgents.find((agent) =>
    hasUrlAlias(agent.aliases, FRAUNHOFER_ISE_HOMEPAGE)
  ) ??
  null;

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  idx.allCatalogs.find(
    (catalog) =>
      catalog.publisherAgentId === agent.id &&
      (catalog.title === ENERGY_CHARTS_CATALOG_TITLE ||
        catalog.homepage === ENERGY_CHARTS_SITE_URL ||
        hasUrlAlias(catalog.aliases, ENERGY_CHARTS_SITE_URL))
  ) ??
  idx.allCatalogs.find((catalog) => catalog.title === ENERGY_CHARTS_CATALOG_TITLE) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === ENERGY_CHARTS_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(ENERGY_CHARTS_API_BASE_URL) ||
        hasUrlAlias(dataService.aliases, ENERGY_CHARTS_API_BASE_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(ENERGY_CHARTS_API_BASE_URL)
  ) ??
  null;

const buildAgentCandidate = (nowIso: string, existing: Agent | null): Agent =>
  decodeAgent({
    _tag: "Agent" as const,
    id: existing?.id ?? mintAgentId(),
    kind: "organization" as const,
    name: ENERGY_CHARTS_AGENT_NAME,
    alternateNames: existing?.alternateNames ?? ["Fraunhofer ISE"],
    homepage: existing?.homepage ?? FRAUNHOFER_ISE_HOMEPAGE,
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
    title: ENERGY_CHARTS_CATALOG_TITLE,
    description:
      existing?.description ??
      "Catalog of Energy Charts endpoint families published by Fraunhofer ISE",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? ENERGY_CHARTS_SITE_URL,
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
    title: ENERGY_CHARTS_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "REST API serving Energy Charts time-series and market endpoints",
    publisherAgentId: agent.id,
    endpointURLs: existing?.endpointURLs ?? [ENERGY_CHARTS_API_BASE_URL],
    endpointDescription:
      existing?.endpointDescription ?? ENERGY_CHARTS_OPENAPI_URL,
    conformsTo: existing?.conformsTo ?? "OpenAPI 3",
    servesDatasetIds: existing?.servesDatasetIds ?? [],
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
  const catalog = buildCatalogCandidate(
    nowIso,
    agent,
    resolveExistingCatalog(idx, existingAgent ?? agent)
  );
  const dataService = buildDataServiceCandidate(
    nowIso,
    agent,
    resolveExistingDataService(idx, existingAgent ?? agent)
  );

  return {
    nowIso,
    agentSlug: ENERGY_CHARTS_AGENT_SLUG,
    catalogSlug: ENERGY_CHARTS_CATALOG_SLUG,
    dataServiceSlug: ENERGY_CHARTS_DATA_SERVICE_SLUG,
    agentMerged: existingAgent !== null,
    catalogMerged: resolveExistingCatalog(idx, existingAgent ?? agent) !== null,
    dataServiceMerged:
      resolveExistingDataService(idx, existingAgent ?? agent) !== null,
    agent,
    catalog,
    dataService
  };
};
