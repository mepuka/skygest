import {
  Agent,
  Catalog,
  mintCatalogId,
} from "../../../domain/data-layer";
import { stripUndefinedAndDecodeWith } from "../../../platform/Json";
import { type CatalogIndex, unionAliases } from "../../dcat-harness";
import {
  ENERGY_INSTITUTE_AGENT_FILE_SLUG,
  ENERGY_INSTITUTE_CATALOG_SLUG,
  ENERGY_INSTITUTE_CATALOG_TITLE,
  ENERGY_INSTITUTE_REVIEW_HOME_URL,
  ENERGY_INSTITUTE_SITE_URL,
  energyInstituteCatalogAliases
} from "./manifest";
import {
  resolveExistingAgentBySlug,
  resolveExistingCatalogByPublisher,
  type DcatBuildContextCommon
} from "../common/context";

const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);

const resolveExistingCatalog = (
  idx: CatalogIndex,
  agent: Agent
): Catalog | null =>
  resolveExistingCatalogByPublisher(idx, agent, {
    title: ENERGY_INSTITUTE_CATALOG_TITLE,
    homepages: [ENERGY_INSTITUTE_SITE_URL, ENERGY_INSTITUTE_REVIEW_HOME_URL]
  });

const buildCatalogCandidate = (
  nowIso: string,
  agent: Agent,
  existing: Catalog | null
): Catalog =>
  decodeCatalog({
    _tag: "Catalog" as const,
    id: existing?.id ?? mintCatalogId(),
    title: existing?.title ?? ENERGY_INSTITUTE_CATALOG_TITLE,
    description:
      existing?.description ??
      "Energy Institute publications and data resources, including the Statistical Review of World Energy and Country Transition Tracker.",
    publisherAgentId: agent.id,
    homepage: existing?.homepage ?? ENERGY_INSTITUTE_SITE_URL,
    aliases: unionAliases(
      existing?.aliases ?? [],
      energyInstituteCatalogAliases()
    ),
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso
  });

export type BuildContext = DcatBuildContextCommon;

export const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): BuildContext => {
  const existingAgent = resolveExistingAgentBySlug(
    idx,
    ENERGY_INSTITUTE_AGENT_FILE_SLUG
  );
  if (existingAgent === null) {
    throw new Error(
      `Energy Institute agent not found in catalog index (expected file slug "${ENERGY_INSTITUTE_AGENT_FILE_SLUG}"). ` +
        "Ensure .generated/cold-start/catalog/agents/energy-institute.json exists."
    );
  }

  const existingCatalog = resolveExistingCatalog(idx, existingAgent);
  const catalog = buildCatalogCandidate(nowIso, existingAgent, existingCatalog);

  return {
    nowIso,
    agentSlug: ENERGY_INSTITUTE_AGENT_FILE_SLUG,
    catalogSlug: ENERGY_INSTITUTE_CATALOG_SLUG,
    agentMerged: true,
    catalogMerged: existingCatalog !== null,
    agent: existingAgent,
    catalog
  };
};
