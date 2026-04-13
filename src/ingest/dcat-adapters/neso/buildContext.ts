import {
  Agent,
  AliasSchemeValues,
  Catalog,
  DataService,
  type ExternalIdentifier,
  mintCatalogId,
  mintDataServiceId
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import { type CatalogIndex, unionAliases } from "../../dcat-harness";

const NESO_AGENT_FILE_SLUG = "neso";

const NESO_CATALOG_SLUG = "neso-data-portal";
const NESO_CATALOG_TITLE = "NESO Data Portal";
const NESO_SITE_URL = "https://www.neso.energy/data-portal/";

const NESO_DATA_SERVICE_SLUG = "neso-ckan-api";
const NESO_DATA_SERVICE_TITLE = "NESO CKAN API";
const NESO_ENDPOINT_URL = "https://api.neso.energy/api/3/action";
const NESO_ENDPOINT_DESCRIPTION =
  "https://www.neso.energy/data-portal/api-guidance";
const NESO_DATA_SERVICE_CONFORMS_TO = "CKAN Action API";

const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

const hasUrlAlias = (
  aliases: ReadonlyArray<ExternalIdentifier>,
  value: string
): boolean =>
  aliases.some(
    (alias) => alias.scheme === AliasSchemeValues.url && alias.value === value
  );

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: NESO_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: NESO_ENDPOINT_URL,
    relation: "exactMatch"
  }
];

const resolveExistingNesoAgent = (idx: CatalogIndex): Agent | null => {
  for (const agent of idx.allAgents) {
    if (idx.agentFileSlugById.get(agent.id) === NESO_AGENT_FILE_SLUG) {
      return agent;
    }
  }

  return null;
};

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  idx.allCatalogs.find(
    (catalog) =>
      catalog.publisherAgentId === agent.id &&
      (catalog.title === NESO_CATALOG_TITLE ||
        catalog.homepage === NESO_SITE_URL ||
        hasUrlAlias(catalog.aliases, NESO_SITE_URL))
  ) ??
  idx.allCatalogs.find((catalog) => catalog.title === NESO_CATALOG_TITLE) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === NESO_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(NESO_ENDPOINT_URL) ||
        hasUrlAlias(dataService.aliases, NESO_ENDPOINT_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(NESO_ENDPOINT_URL)
  ) ??
  null;

const buildCatalogCandidate = (
  nowIso: string,
  agent: Agent,
  existing: Catalog | null
): Catalog =>
  decodeCatalog({
    _tag: "Catalog" as const,
    id: existing?.id ?? mintCatalogId(),
    title: NESO_CATALOG_TITLE,
    description:
      existing?.description ??
      "NESO Data Portal — operational electricity system, market, and planning datasets published by the National Energy System Operator.",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? NESO_SITE_URL,
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
    title: NESO_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "CKAN Action API serving dataset metadata and datastore-backed resources from the NESO Data Portal.",
    publisherAgentId: agent.id,
    endpointURLs: [NESO_ENDPOINT_URL],
    endpointDescription:
      existing?.endpointDescription ?? NESO_ENDPOINT_DESCRIPTION,
    conformsTo: existing?.conformsTo ?? NESO_DATA_SERVICE_CONFORMS_TO,
    servesDatasetIds: existing?.servesDatasetIds ?? [],
    accessRights: existing?.accessRights ?? "public",
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
  const existingAgent = resolveExistingNesoAgent(idx);
  if (existingAgent === null) {
    throw new Error(
      `NESO agent not found in catalog index (expected file slug "${NESO_AGENT_FILE_SLUG}"). ` +
        "Ensure references/cold-start/catalog/agents/neso.json exists."
    );
  }

  const existingCatalog = resolveExistingCatalog(idx, existingAgent);
  const catalog = buildCatalogCandidate(nowIso, existingAgent, existingCatalog);
  const existingDataService = resolveExistingDataService(idx, existingAgent);
  const dataService = buildDataServiceCandidate(
    nowIso,
    existingAgent,
    existingDataService
  );

  return {
    nowIso,
    agentSlug: NESO_AGENT_FILE_SLUG,
    catalogSlug: NESO_CATALOG_SLUG,
    dataServiceSlug: NESO_DATA_SERVICE_SLUG,
    agentMerged: true,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent: existingAgent,
    catalog,
    dataService
  };
};
