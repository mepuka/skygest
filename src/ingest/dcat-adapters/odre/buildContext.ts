import {
  Agent,
  AliasSchemeValues,
  Catalog,
  DataService,
  mintCatalogId,
  mintDataServiceId,
  type ExternalIdentifier
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import { type CatalogIndex, unionAliases } from "../../dcat-harness";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RTE_AGENT_FILE_SLUG = "rte";

const ODRE_CATALOG_SLUG = "odre";
const ODRE_CATALOG_TITLE = "ODRÉ Open Data Catalog";
const ODRE_SITE_URL = "https://odre.opendatasoft.com/";

const ODRE_DATA_SERVICE_SLUG = "odre-api";
const ODRE_DATA_SERVICE_TITLE = "ODRÉ OpenDataSoft API";
const ODRE_ENDPOINT_URL =
  "https://odre.opendatasoft.com/api/explore/v2.1/";
const ODRE_DATA_SERVICE_CONFORMS_TO = "OpenDataSoft Explore API v2.1";

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

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

const freshCatalogAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: ODRE_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: ODRE_ENDPOINT_URL,
    relation: "exactMatch"
  }
];

// ---------------------------------------------------------------------------
// Resolve existing entities
// ---------------------------------------------------------------------------

/**
 * The RTE agent is expected to already exist in the catalog index
 * (cold-started from `references/cold-start/catalog/agents/rte.json`).
 * We resolve it by its file slug rather than minting a new agent.
 */
const resolveExistingRteAgent = (idx: CatalogIndex): Agent | null => {
  for (const agent of idx.allAgents) {
    if (idx.agentFileSlugById.get(agent.id) === RTE_AGENT_FILE_SLUG) {
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
      (catalog.title === ODRE_CATALOG_TITLE ||
        catalog.homepage === ODRE_SITE_URL ||
        hasUrlAlias(catalog.aliases, ODRE_SITE_URL))
  ) ??
  idx.allCatalogs.find(
    (catalog) => catalog.title === ODRE_CATALOG_TITLE
  ) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === ODRE_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(ODRE_ENDPOINT_URL) ||
        hasUrlAlias(dataService.aliases, ODRE_ENDPOINT_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(ODRE_ENDPOINT_URL)
  ) ??
  null;

// ---------------------------------------------------------------------------
// Build candidates
// ---------------------------------------------------------------------------

const buildCatalogCandidate = (
  nowIso: string,
  agent: Agent,
  existing: Catalog | null
): Catalog =>
  decodeCatalog({
    _tag: "Catalog" as const,
    id: existing?.id ?? mintCatalogId(),
    title: ODRE_CATALOG_TITLE,
    description:
      existing?.description ??
      "Open Data Réseaux Énergies — open datasets on French energy networks published by RTE, GRTgaz, Teréga, and others",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? ODRE_SITE_URL,
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
    title: ODRE_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "OpenDataSoft Explore API v2.1 serving ODRÉ energy dataset records",
    publisherAgentId: agent.id,
    endpointURLs: [ODRE_ENDPOINT_URL],
    endpointDescription: existing?.endpointDescription,
    conformsTo: existing?.conformsTo ?? ODRE_DATA_SERVICE_CONFORMS_TO,
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
  const existingAgent = resolveExistingRteAgent(idx);
  if (existingAgent === null) {
    throw new Error(
      `RTE agent not found in catalog index (expected file slug "${RTE_AGENT_FILE_SLUG}"). ` +
        "Ensure references/cold-start/catalog/agents/rte.json exists."
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
    agentSlug: RTE_AGENT_FILE_SLUG,
    catalogSlug: ODRE_CATALOG_SLUG,
    dataServiceSlug: ODRE_DATA_SERVICE_SLUG,
    agentMerged: true,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent: existingAgent,
    catalog,
    dataService
  };
};
