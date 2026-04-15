import {
  Agent,
  Catalog,
  DataService,
  mintCatalogId,
  mintDataServiceId,
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import { type CatalogIndex, unionAliases } from "../../dcat-harness";
import {
  asWebUrl,
  freshUrlAliases,
  resolveExistingAgentBySlug,
  resolveExistingCatalogByPublisher,
  resolveExistingDataServiceByPublisher,
  type DcatBuildContextWithDataService
} from "../common/context";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTSOE_AGENT_FILE_SLUG = "entso-e";

const ENTSOE_CATALOG_SLUG = "entsoe-transparency";
const ENTSOE_CATALOG_TITLE = "ENTSO-E Transparency Platform";
const ENTSOE_SITE_URL = asWebUrl("https://transparency.entsoe.eu/");

const ENTSOE_DATA_SERVICE_SLUG = "entsoe-restful-api";
const ENTSOE_DATA_SERVICE_TITLE = "ENTSO-E Transparency Platform RESTful API";
const ENTSOE_ENDPOINT_URL = asWebUrl("https://web-api.tp.entsoe.eu/api");
const ENTSOE_ENDPOINT_DESCRIPTION = asWebUrl(
  "https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html"
);

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);
const decodeDataService = stripUndefinedAndDecodeWith(DataService);

// ---------------------------------------------------------------------------
// Alias helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Resolve existing entities
// ---------------------------------------------------------------------------

/**
 * The ENTSO-E agent is expected to already exist in the catalog index
 * (cold-started from `.generated/cold-start/catalog/agents/entso-e.json`).
 * We resolve it by its file slug rather than minting a new agent.
 */
const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  resolveExistingCatalogByPublisher(idx, agent, {
    title: ENTSOE_CATALOG_TITLE,
    homepages: ENTSOE_SITE_URL
  });

const resolveExistingDataService = (
  idx: CatalogIndex,
  agent: Agent
): DataService | null =>
  resolveExistingDataServiceByPublisher(idx, agent, {
    title: ENTSOE_DATA_SERVICE_TITLE,
    endpointUrl: ENTSOE_ENDPOINT_URL
  });

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
    aliases: unionAliases(existing?.aliases ?? [], freshUrlAliases(ENTSOE_SITE_URL)),
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
    aliases: unionAliases(
      existing?.aliases ?? [],
      freshUrlAliases(ENTSOE_ENDPOINT_URL)
    ),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type BuildContext = DcatBuildContextWithDataService;

export const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): BuildContext => {
  const existingAgent = resolveExistingAgentBySlug(idx, ENTSOE_AGENT_FILE_SLUG);
  if (existingAgent === null) {
    throw new Error(
      `ENTSO-E agent not found in catalog index (expected file slug "${ENTSOE_AGENT_FILE_SLUG}"). ` +
        "Ensure .generated/cold-start/catalog/agents/entso-e.json exists."
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
