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

const ENTSOE_AGENT_FILE_SLUG = "entso-e";

const ENTSOE_CATALOG_SLUG = "entsoe-transparency";
const ENTSOE_CATALOG_TITLE = "ENTSO-E Transparency Platform";
const ENTSOE_SITE_URL = "https://transparency.entsoe.eu/";

const ENTSOE_DATA_SERVICE_SLUG = "entsoe-restful-api";
const ENTSOE_DATA_SERVICE_TITLE = "ENTSO-E Transparency Platform RESTful API";
const ENTSOE_ENDPOINT_URL = "https://web-api.tp.entsoe.eu/api";
const ENTSOE_ENDPOINT_DESCRIPTION =
  "https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html";

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
    value: ENTSOE_SITE_URL,
    relation: "exactMatch"
  }
];

const freshDataServiceAliases: ReadonlyArray<ExternalIdentifier> = [
  {
    scheme: AliasSchemeValues.url,
    value: ENTSOE_ENDPOINT_URL,
    relation: "exactMatch"
  }
];

// ---------------------------------------------------------------------------
// Resolve existing entities
// ---------------------------------------------------------------------------

/**
 * The ENTSO-E agent is expected to already exist in the catalog index
 * (cold-started from `references/cold-start/catalog/agents/entso-e.json`).
 * We resolve it by its file slug rather than minting a new agent.
 */
const resolveExistingEntsoeAgent = (idx: CatalogIndex): Agent | null => {
  for (const agent of idx.allAgents) {
    if (idx.agentFileSlugById.get(agent.id) === ENTSOE_AGENT_FILE_SLUG) {
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
      (catalog.title === ENTSOE_CATALOG_TITLE ||
        catalog.homepage === ENTSOE_SITE_URL ||
        hasUrlAlias(catalog.aliases, ENTSOE_SITE_URL))
  ) ??
  idx.allCatalogs.find(
    (catalog) => catalog.title === ENTSOE_CATALOG_TITLE
  ) ??
  null;

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  idx.allDataServices.find(
    (dataService) =>
      dataService.publisherAgentId === agent.id &&
      (dataService.title === ENTSOE_DATA_SERVICE_TITLE ||
        dataService.endpointURLs.includes(ENTSOE_ENDPOINT_URL) ||
        hasUrlAlias(dataService.aliases, ENTSOE_ENDPOINT_URL))
  ) ??
  idx.allDataServices.find((dataService) =>
    dataService.endpointURLs.includes(ENTSOE_ENDPOINT_URL)
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
    title: ENTSOE_CATALOG_TITLE,
    description:
      existing?.description ??
      "ENTSO-E Transparency Platform — pan-European electricity market and grid data mandated by EU Regulation 543/2013",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? ENTSOE_SITE_URL,
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
    title: ENTSOE_DATA_SERVICE_TITLE,
    description:
      existing?.description ??
      "RESTful XML API serving ENTSO-E Transparency Platform datasets (load, generation, transmission, balancing, outages)",
    publisherAgentId: agent.id,
    endpointURLs: [ENTSOE_ENDPOINT_URL],
    endpointDescription:
      existing?.endpointDescription ?? ENTSOE_ENDPOINT_DESCRIPTION,
    conformsTo: existing?.conformsTo ?? "EU Regulation 543/2013",
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
  const existingAgent = resolveExistingEntsoeAgent(idx);
  if (existingAgent === null) {
    throw new Error(
      `ENTSO-E agent not found in catalog index (expected file slug "${ENTSOE_AGENT_FILE_SLUG}"). ` +
        "Ensure references/cold-start/catalog/agents/entso-e.json exists."
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
    agentSlug: ENTSOE_AGENT_FILE_SLUG,
    catalogSlug: ENTSOE_CATALOG_SLUG,
    dataServiceSlug: ENTSOE_DATA_SERVICE_SLUG,
    agentMerged: true,
    catalogMerged: existingCatalog !== null,
    dataServiceMerged: existingDataService !== null,
    agent: existingAgent,
    catalog,
    dataService
  };
};
