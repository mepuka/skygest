import {
  Agent,
  AliasSchemeValues,
  Catalog,
  mintCatalogId,
  type ExternalIdentifier
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

const decodeCatalog = stripUndefinedAndDecodeWith(Catalog);

const hasUrlAlias = (
  aliases: ReadonlyArray<ExternalIdentifier>,
  value: string
): boolean =>
  aliases.some(
    (alias) => alias.scheme === AliasSchemeValues.url && alias.value === value
  );

const resolveExistingEnergyInstituteAgent = (
  idx: CatalogIndex
): Agent | null => {
  for (const agent of idx.allAgents) {
    if (idx.agentFileSlugById.get(agent.id) === ENERGY_INSTITUTE_AGENT_FILE_SLUG) {
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
      (catalog.title === ENERGY_INSTITUTE_CATALOG_TITLE ||
        catalog.homepage === ENERGY_INSTITUTE_SITE_URL ||
        catalog.homepage === ENERGY_INSTITUTE_REVIEW_HOME_URL ||
        hasUrlAlias(catalog.aliases, ENERGY_INSTITUTE_SITE_URL) ||
        hasUrlAlias(catalog.aliases, ENERGY_INSTITUTE_REVIEW_HOME_URL))
  ) ??
  idx.allCatalogs.find(
    (catalog) => catalog.title === ENERGY_INSTITUTE_CATALOG_TITLE
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

export interface BuildContext {
  readonly nowIso: string;
  readonly agentSlug: string;
  readonly catalogSlug: string;
  readonly agentMerged: boolean;
  readonly catalogMerged: boolean;
  readonly agent: Agent;
  readonly catalog: Catalog;
}

export const buildContextFromIndex = (
  idx: CatalogIndex,
  nowIso: string
): BuildContext => {
  const existingAgent = resolveExistingEnergyInstituteAgent(idx);
  if (existingAgent === null) {
    throw new Error(
      `Energy Institute agent not found in catalog index (expected file slug "${ENERGY_INSTITUTE_AGENT_FILE_SLUG}"). ` +
        "Ensure references/cold-start/catalog/agents/energy-institute.json exists."
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
