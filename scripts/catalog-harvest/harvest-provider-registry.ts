/**
 * Two-phase merge of energy.json provider registry into the cold-start catalog.
 *
 * Report:
 *   bun scripts/catalog-harvest/harvest-provider-registry.ts report
 *
 * Apply:
 *   bun scripts/catalog-harvest/harvest-provider-registry.ts apply
 *
 * SKY-218: Provider registry -> cold-start catalog merge
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(process.cwd(), "references", "cold-start");
const AGENTS_DIR = join(ROOT, "catalog", "agents");
const CATALOGS_DIR = join(ROOT, "catalog", "catalogs");
const DATASETS_DIR = join(ROOT, "catalog", "datasets");
const DISTS_DIR = join(ROOT, "catalog", "distributions");
const RECORDS_DIR = join(ROOT, "catalog", "catalog-records");
const SERVICES_DIR = join(ROOT, "catalog", "data-services");
const REPORTS_DIR = join(ROOT, "reports");
const ENTITY_IDS_FILE = join(ROOT, ".entity-ids.json");
const PROPOSALS_FILE = join(REPORTS_DIR, "sky-218-merge-proposals.json");
const ENERGY_JSON = join(process.cwd(), "config", "source-registry", "energy.json");
const TS = "2026-04-08T00:00:00.000Z";

type JsonRecord = Record<string, any>;

interface Provider {
  providerId: string;
  providerLabel: string;
  aliases: string[];
  domains: string[];
  sourceFamilies: string[];
}

interface Alias {
  scheme: string;
  value: string;
  relation: string;
}

interface AgentEntity extends JsonRecord {
  _tag: "Agent";
  id: string;
  name: string;
  aliases?: Alias[];
  alternateNames?: string[];
  homepage?: string;
}

interface DatasetEntity extends JsonRecord {
  _tag: "Dataset";
  id: string;
  title: string;
  distributionIds?: string[];
  dataServiceIds?: string[];
}

interface DistributionEntity extends JsonRecord {
  _tag: "Distribution";
  id: string;
  datasetId: string;
  accessServiceId?: string;
}

interface DataServiceEntity extends JsonRecord {
  _tag: "DataService";
  id: string;
  servesDatasetIds?: string[];
}

type ProposalAction =
  | "enrich-agent"
  | "create-agent"
  | "create-catalog"
  | "create-data-service"
  | "wire-existing-dataset-service"
  | "create-dataset"
  | "skip-existing-dataset"
  | "reject-source-family";

interface Proposal {
  id: string;
  provider: string;
  action: ProposalAction;
  slug: string;
  confidence: "high" | "low";
  approved: boolean | null;
  detail: Record<string, unknown>;
}

interface ProposalsFile {
  ticket: string;
  generatedAt: string;
  proposals: Proposal[];
}

interface FamilyRule {
  action: "skip-existing-dataset" | "reject-source-family";
  confidence: "high" | "low";
  existingDatasetSlug?: string;
  reason: string;
}

interface DataServiceSpec {
  providerId: string;
  slug: string;
  title: string;
  description: string;
  endpointURLs: string[];
  endpointDescription?: string;
  conformsTo?: string;
  attachToNewDatasets: boolean;
  existingDatasetSlugs: string[];
}

const SLUG_MAP: Record<string, string> = {
  "iso-new-england": "iso-ne",
};

const FAMILY_RULES: Record<string, Record<string, FamilyRule>> = {
  eia: {
    "Short-Term Energy Outlook": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "eia-steo",
      reason: "Already represented by the existing short-term outlook dataset.",
    },
    "Natural Gas Monthly": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "eia-natural-gas",
      reason: "Already represented by the existing natural-gas dataset.",
    },
  },
  "entso-e": {
    "Transparency Platform": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "entsoe-transparency",
      reason: "Already represented by the existing Transparency Platform dataset.",
    },
    "European Resource Adequacy Assessment": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "entso-e-adequacy-assessment",
      reason: "Already represented by the existing adequacy assessment dataset.",
    },
    "Annual Report": {
      action: "reject-source-family",
      confidence: "low",
      reason: "Treat as a general publication rather than a dataset in this catalog pass.",
    },
  },
  ferc: {
    "Energy Primer": {
      action: "reject-source-family",
      confidence: "low",
      reason: "Treat as an educational document rather than a dataset in this catalog pass.",
    },
  },
  iea: {
    "World Energy Outlook": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "iea-weo-dataset",
      reason: "Already represented by the existing World Energy Outlook dataset.",
    },
    Electricity: {
      action: "skip-existing-dataset",
      confidence: "low",
      existingDatasetSlug: "iea-demand",
      reason: "Closest existing match is the electricity-demand dataset backed by the current IEA electricity report.",
    },
    Renewables: {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "iea-renewables",
      reason: "Already represented by the existing renewables dataset.",
    },
  },
  miso: {
    "Market Reports": {
      action: "skip-existing-dataset",
      confidence: "low",
      existingDatasetSlug: "miso-market-data",
      reason: "Broad market-data dataset already covers this family.",
    },
  },
  nrel: {
    "Annual Technology Baseline": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "nrel-atb",
      reason: "Already represented by the existing ATB dataset.",
    },
  },
  pjm: {
    "Load Forecast Report": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "pjm-load-forecast",
      reason: "Already represented by the existing load-forecast dataset.",
    },
    "Annual Markets Report": {
      action: "skip-existing-dataset",
      confidence: "high",
      existingDatasetSlug: "pjm-state-of-market",
      reason: "Already represented by the state-of-market dataset.",
    },
    "Annual Report": {
      action: "reject-source-family",
      confidence: "low",
      reason: "Treat as a general corporate report rather than a dataset in this catalog pass.",
    },
  },
};

const DATA_SERVICE_SPECS: Record<string, DataServiceSpec> = {
  caiso: {
    providerId: "caiso",
    slug: "caiso-oasis",
    title: "CAISO OASIS",
    description: "Open Access Same-time Information System for CAISO market data",
    endpointURLs: ["https://oasis.caiso.com/"],
    endpointDescription: "https://www.caiso.com/market/Pages/ReportsBulletins/Default.aspx",
    conformsTo: "CAISO OASIS",
    attachToNewDatasets: true,
    existingDatasetSlugs: [],
  },
  eia: {
    providerId: "eia",
    slug: "eia-api",
    title: "EIA Open Data API v2",
    description: "RESTful API providing access to EIA energy data",
    endpointURLs: ["https://api.eia.gov/v2/"],
    endpointDescription: "https://www.eia.gov/opendata/documentation.php",
    conformsTo: "EIA Open Data API v2",
    attachToNewDatasets: true,
    existingDatasetSlugs: ["eia-steo", "eia-natural-gas"],
  },
  "entso-e": {
    providerId: "entso-e",
    slug: "entsoe-transparency-api",
    title: "ENTSO-E Transparency Platform API",
    description: "Programmatic access point for ENTSO-E Transparency Platform data",
    endpointURLs: ["https://webportal.tp.entsoe.eu/"],
    endpointDescription: "https://transparency.entsoe.eu/",
    conformsTo: "ENTSO-E Transparency Platform",
    attachToNewDatasets: false,
    existingDatasetSlugs: ["entsoe-transparency"],
  },
};

const ACTION_ORDER: Record<ProposalAction, number> = {
  "create-agent": 1,
  "enrich-agent": 2,
  "create-catalog": 3,
  "create-data-service": 4,
  "wire-existing-dataset-service": 5,
  "create-dataset": 6,
  "skip-existing-dataset": 7,
  "reject-source-family": 8,
};

function coldStartSlug(providerId: string): string {
  return SLUG_MAP[providerId] ?? providerId;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

function normalizeDomain(value: string): string {
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function slugify(providerLabel: string, familyName: string): string {
  const prefix = providerLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const suffix = familyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${prefix}-${suffix}`;
}

function proposalId(provider: string, action: ProposalAction, slug: string): string {
  return `${provider}:${action}:${slug}`;
}

function listJsonSlugs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
    .map((name) => name.slice(0, -5))
    .sort();
}

function providerLookup(): Map<string, Provider> {
  const registry = readJson<{ providers: Provider[] }>(ENERGY_JSON);
  return new Map(registry.providers.map((provider) => [provider.providerId, provider]));
}

function allAgents(): Array<{ slug: string; entity: AgentEntity }> {
  return listJsonSlugs(AGENTS_DIR).map((slug) => ({
    slug,
    entity: readJson<AgentEntity>(join(AGENTS_DIR, `${slug}.json`)),
  }));
}

function collectAgentDomains(agent: AgentEntity): string[] {
  const domains = new Set<string>();
  if (agent.homepage) domains.add(normalizeDomain(agent.homepage));
  for (const alias of agent.aliases ?? []) {
    if (alias.scheme === "url") domains.add(normalizeDomain(alias.value));
  }
  return Array.from(domains);
}

function findPotentialAgentDuplicates(provider: Provider, targetSlug: string): Array<{ slug: string; reasons: string[] }> {
  const providerNames = new Set(uniqueCaseInsensitive([provider.providerLabel, ...provider.aliases]).map(normalizeName));
  const providerDomains = new Set(provider.domains.map(normalizeDomain));
  const candidates: Array<{ slug: string; reasons: string[] }> = [];

  for (const { slug, entity } of allAgents()) {
    if (slug === targetSlug) continue;

    const reasons: string[] = [];
    const existingNames = uniqueCaseInsensitive([entity.name, ...(entity.alternateNames ?? [])]).map(normalizeName);
    const existingDomains = collectAgentDomains(entity);

    for (const name of existingNames) {
      if (providerNames.has(name)) {
        reasons.push(`name overlap with "${entity.name}"`);
        break;
      }
    }

    for (const domain of existingDomains) {
      if (providerDomains.has(domain)) {
        reasons.push(`domain overlap with ${domain}`);
        break;
      }
    }

    if (reasons.length > 0) {
      candidates.push({ slug, reasons });
    }
  }

  return candidates;
}

function ensureEntityId(entityIds: Record<string, string>, key: string, path: string): string | undefined {
  if (!existsSync(path)) return entityIds[key];
  const raw = readJson<JsonRecord>(path);
  if (typeof raw.id === "string") {
    entityIds[key] = raw.id;
    return raw.id;
  }
  return entityIds[key];
}

function datasetNeedsServiceWiring(datasetSlug: string, dataServiceSlug: string, entityIds: Record<string, string>): boolean {
  const datasetPath = join(DATASETS_DIR, `${datasetSlug}.json`);
  if (!existsSync(datasetPath)) return false;

  const dataset = readJson<DatasetEntity>(datasetPath);
  const servicePath = join(SERVICES_DIR, `${dataServiceSlug}.json`);
  const serviceId =
    ensureEntityId(entityIds, `DataService:${dataServiceSlug}`, servicePath) ??
    (existsSync(servicePath) ? readJson<DataServiceEntity>(servicePath).id : undefined);

  if (!serviceId) return true;
  if (!(dataset.dataServiceIds ?? []).includes(serviceId)) return true;

  for (const distSlug of listJsonSlugs(DISTS_DIR)) {
    const distPath = join(DISTS_DIR, `${distSlug}.json`);
    const dist = readJson<DistributionEntity>(distPath);
    if (dist.datasetId === dataset.id && dist.accessServiceId === serviceId) {
      return false;
    }
  }

  return true;
}

function buildServiceProposal(providerId: string, spec: DataServiceSpec): Proposal | null {
  const servicePath = join(SERVICES_DIR, `${spec.slug}.json`);
  if (existsSync(servicePath)) return null;

  return {
    id: proposalId(providerId, "create-data-service", spec.slug),
    provider: providerId,
    action: "create-data-service",
    slug: spec.slug,
    confidence: "high",
    approved: null,
    detail: {
      publisherSlug: coldStartSlug(providerId),
      title: spec.title,
      description: spec.description,
      endpointURLs: spec.endpointURLs,
      endpointDescription: spec.endpointDescription ?? null,
      conformsTo: spec.conformsTo ?? null,
    },
  };
}

function runReport(): void {
  const providers = readJson<{ providers: Provider[] }>(ENERGY_JSON).providers;
  const entityIds = readJson<Record<string, string>>(ENTITY_IDS_FILE);
  const proposals: Proposal[] = [];

  for (const provider of providers) {
    const providerSlug = coldStartSlug(provider.providerId);
    const agentPath = join(AGENTS_DIR, `${providerSlug}.json`);

    if (existsSync(agentPath)) {
      const agent = readJson<AgentEntity>(agentPath);
      const existingAltNames = new Set(uniqueCaseInsensitive([agent.name, ...(agent.alternateNames ?? [])]).map(normalizeName));
      const existingDomains = new Set(collectAgentDomains(agent));
      const addAlternateNames = uniqueCaseInsensitive([provider.providerLabel, ...provider.aliases]).filter(
        (name) => !existingAltNames.has(normalizeName(name)),
      );
      const addUrlAliases = provider.domains.filter((domain) => !existingDomains.has(normalizeDomain(domain)));

      if (addAlternateNames.length > 0 || addUrlAliases.length > 0) {
        proposals.push({
          id: proposalId(provider.providerId, "enrich-agent", providerSlug),
          provider: provider.providerId,
          action: "enrich-agent",
          slug: providerSlug,
          confidence: "high",
          approved: null,
          detail: {
            addAlternateNames,
            addUrlAliases,
          },
        });
      }
    } else {
      const name = provider.aliases[0] ?? provider.providerLabel;
      const alternateNames = uniqueCaseInsensitive([provider.providerLabel, ...provider.aliases]).filter(
        (candidate) => normalizeName(candidate) !== normalizeName(name),
      );
      const duplicateCandidates = findPotentialAgentDuplicates(provider, providerSlug);

      proposals.push({
        id: proposalId(provider.providerId, "create-agent", providerSlug),
        provider: provider.providerId,
        action: "create-agent",
        slug: providerSlug,
        confidence: duplicateCandidates.length > 0 ? "low" : "high",
        approved: null,
        detail: {
          name,
          alternateNames,
          domains: provider.domains,
          duplicateCandidates,
        },
      });

      proposals.push({
        id: proposalId(provider.providerId, "create-catalog", providerSlug),
        provider: provider.providerId,
        action: "create-catalog",
        slug: providerSlug,
        confidence: duplicateCandidates.length > 0 ? "low" : "high",
        approved: null,
        detail: {
          title: `${name} Data Catalog`,
          homepage: `https://${provider.domains[0]}`,
        },
      });
    }

    const familyRules = FAMILY_RULES[provider.providerId] ?? {};
    const serviceSpec = DATA_SERVICE_SPECS[provider.providerId];

    for (const family of provider.sourceFamilies) {
      const rule = familyRules[family];
      if (rule?.action === "skip-existing-dataset") {
        proposals.push({
          id: proposalId(provider.providerId, "skip-existing-dataset", rule.existingDatasetSlug!),
          provider: provider.providerId,
          action: "skip-existing-dataset",
          slug: rule.existingDatasetSlug!,
          confidence: rule.confidence,
          approved: null,
          detail: {
            sourceFamily: family,
            existingDataset: rule.existingDatasetSlug!,
            reason: rule.reason,
          },
        });
        continue;
      }

      if (rule?.action === "reject-source-family") {
        proposals.push({
          id: proposalId(provider.providerId, "reject-source-family", slugify(provider.providerLabel, family)),
          provider: provider.providerId,
          action: "reject-source-family",
          slug: slugify(provider.providerLabel, family),
          confidence: rule.confidence,
          approved: null,
          detail: {
            sourceFamily: family,
            reason: rule.reason,
          },
        });
        continue;
      }

      const datasetSlug = slugify(provider.providerLabel, family);
      if (existsSync(join(DATASETS_DIR, `${datasetSlug}.json`))) {
        proposals.push({
          id: proposalId(provider.providerId, "skip-existing-dataset", datasetSlug),
          provider: provider.providerId,
          action: "skip-existing-dataset",
          slug: datasetSlug,
          confidence: "high",
          approved: null,
          detail: {
            sourceFamily: family,
            existingDataset: datasetSlug,
            reason: "Dataset file already exists on disk.",
          },
        });
        continue;
      }

      proposals.push({
        id: proposalId(provider.providerId, "create-dataset", datasetSlug),
        provider: provider.providerId,
        action: "create-dataset",
        slug: datasetSlug,
        confidence: "high",
        approved: null,
        detail: {
          providerSlug,
          sourceFamily: family,
          title: `${provider.providerLabel} ${family}`,
          primaryDomain: provider.domains[0],
          dataServiceSlug: serviceSpec?.attachToNewDatasets ? serviceSpec.slug : null,
        },
      });
    }
  }

  for (const [providerId, spec] of Object.entries(DATA_SERVICE_SPECS)) {
    const serviceProposal = buildServiceProposal(providerId, spec);
    if (serviceProposal) proposals.push(serviceProposal);

    for (const datasetSlug of spec.existingDatasetSlugs) {
      if (!datasetNeedsServiceWiring(datasetSlug, spec.slug, entityIds)) continue;

      const datasetPath = join(DATASETS_DIR, `${datasetSlug}.json`);
      if (!existsSync(datasetPath)) continue;
      const dataset = readJson<DatasetEntity>(datasetPath);

      proposals.push({
        id: proposalId(providerId, "wire-existing-dataset-service", datasetSlug),
        provider: providerId,
        action: "wire-existing-dataset-service",
        slug: datasetSlug,
        confidence: "high",
        approved: null,
        detail: {
          datasetTitle: dataset.title,
          dataServiceSlug: spec.slug,
        },
      });
    }
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const proposalsDoc: ProposalsFile = {
    ticket: "SKY-218",
    generatedAt: TS,
    proposals: proposals.sort((left, right) => left.id.localeCompare(right.id)),
  };
  writeJson(PROPOSALS_FILE, proposalsDoc);

  const counts = proposals.reduce<Record<string, number>>((acc, proposal) => {
    acc[proposal.action] = (acc[proposal.action] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\n=== SKY-218 Merge Proposals ===");
  console.log(`Enrich existing agents:        ${counts["enrich-agent"] ?? 0}`);
  console.log(`Create new agents:             ${counts["create-agent"] ?? 0}`);
  console.log(`Create new catalogs:           ${counts["create-catalog"] ?? 0}`);
  console.log(`Create new datasets:           ${counts["create-dataset"] ?? 0}`);
  console.log(`Create data services:          ${counts["create-data-service"] ?? 0}`);
  console.log(`Wire existing datasets:        ${counts["wire-existing-dataset-service"] ?? 0}`);
  console.log(`Skip existing dataset matches: ${counts["skip-existing-dataset"] ?? 0}`);
  console.log(`Reject source families:        ${counts["reject-source-family"] ?? 0}`);
  console.log(`\nAll proposals start with "approved": null and require review before apply.`);
  console.log(`Proposals written to: ${PROPOSALS_FILE}`);
}

function ensureDataService(
  entityIds: Record<string, string>,
  dataServiceSlug: string,
  providerId: string,
  stats: Record<string, number>,
): string | null {
  const spec = Object.values(DATA_SERVICE_SPECS).find((candidate) => candidate.slug === dataServiceSlug);
  if (!spec) return null;

  const servicePath = join(SERVICES_DIR, `${dataServiceSlug}.json`);
  if (existsSync(servicePath)) {
    return ensureEntityId(entityIds, `DataService:${dataServiceSlug}`, servicePath) ?? null;
  }

  const publisherSlug = coldStartSlug(providerId);
  const publisherAgentId = ensureEntityId(entityIds, `Agent:${publisherSlug}`, join(AGENTS_DIR, `${publisherSlug}.json`));
  if (!publisherAgentId) {
    console.warn(`  warn: DataService:${dataServiceSlug} missing publisher Agent:${publisherSlug}`);
    return null;
  }

  const serviceId = mintId("data-service", "svc");
  entityIds[`DataService:${dataServiceSlug}`] = serviceId;

  const service: JsonRecord = {
    _tag: "DataService",
    id: serviceId,
    title: spec.title,
    description: spec.description,
    publisherAgentId,
    endpointURLs: spec.endpointURLs,
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    servesDatasetIds: [],
  };

  if (spec.endpointDescription) service.endpointDescription = spec.endpointDescription;
  if (spec.conformsTo) service.conformsTo = spec.conformsTo;

  writeJson(servicePath, service);
  stats.dataServicesCreated++;
  console.log(`  created: DataService:${dataServiceSlug} -> ${serviceId}`);
  return serviceId;
}

function ensureCatalogRecord(
  entityIds: Record<string, string>,
  datasetSlug: string,
  datasetId: string,
  catalogId: string,
  stats: Record<string, number>,
): void {
  const recordSlug = `${datasetSlug}-cr`;
  const recordPath = join(RECORDS_DIR, `${recordSlug}.json`);
  const recordKey = `CatalogRecord:${recordSlug}`;

  if (existsSync(recordPath)) {
    ensureEntityId(entityIds, recordKey, recordPath);
    return;
  }

  const recordId = mintId("catalog-record", "cr");
  entityIds[recordKey] = recordId;
  writeJson(recordPath, {
    _tag: "CatalogRecord",
    id: recordId,
    catalogId,
    primaryTopicType: "dataset",
    primaryTopicId: datasetId,
  });
  stats.catalogRecordsCreated++;
}

function ensureWebDistribution(
  entityIds: Record<string, string>,
  datasetSlug: string,
  datasetId: string,
  sourceFamily: string,
  primaryDomain: string,
  stats: Record<string, number>,
): string {
  const distSlug = `${datasetSlug}-web`;
  const distPath = join(DISTS_DIR, `${distSlug}.json`);
  const distKey = `Distribution:${distSlug}`;

  if (existsSync(distPath)) {
    return ensureEntityId(entityIds, distKey, distPath)!;
  }

  const distId = mintId("distribution", "dist");
  entityIds[distKey] = distId;
  writeJson(distPath, {
    _tag: "Distribution",
    id: distId,
    datasetId,
    kind: "landing-page",
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    title: `${sourceFamily} web`,
    accessURL: `https://${primaryDomain}`,
  });
  stats.distributionsCreated++;
  return distId;
}

function ensureApiDistribution(
  entityIds: Record<string, string>,
  datasetSlug: string,
  datasetId: string,
  datasetTitle: string,
  dataServiceSlug: string,
  dataServiceId: string,
  stats: Record<string, number>,
): string {
  const spec = Object.values(DATA_SERVICE_SPECS).find((candidate) => candidate.slug === dataServiceSlug)!;
  const distSlug = `${datasetSlug}-api`;
  const distPath = join(DISTS_DIR, `${distSlug}.json`);
  const distKey = `Distribution:${distSlug}`;

  if (existsSync(distPath)) {
    const dist = readJson<DistributionEntity>(distPath);
    entityIds[distKey] = dist.id;

    let changed = false;
    if (dist.accessServiceId !== dataServiceId) {
      dist.accessServiceId = dataServiceId;
      changed = true;
    }
    if (dist.accessURL !== spec.endpointURLs[0]) {
      dist.accessURL = spec.endpointURLs[0];
      changed = true;
    }
    if (dist.title !== `${datasetTitle} via API`) {
      dist.title = `${datasetTitle} via API`;
      changed = true;
    }
    if (changed) {
      dist.updatedAt = TS;
      writeJson(distPath, dist);
      stats.distributionsUpdated++;
    }
    return dist.id;
  }

  const distId = mintId("distribution", "dist");
  entityIds[distKey] = distId;
  writeJson(distPath, {
    _tag: "Distribution",
    id: distId,
    datasetId,
    kind: "api-access",
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    title: `${datasetTitle} via API`,
    accessURL: spec.endpointURLs[0],
    accessServiceId: dataServiceId,
  });
  stats.distributionsCreated++;
  return distId;
}

function ensureDatasetServiceWiring(
  entityIds: Record<string, string>,
  datasetSlug: string,
  dataServiceSlug: string,
  providerId: string,
  stats: Record<string, number>,
): void {
  const datasetPath = join(DATASETS_DIR, `${datasetSlug}.json`);
  if (!existsSync(datasetPath)) {
    console.warn(`  warn: Dataset:${datasetSlug} missing for service wiring`);
    return;
  }

  const dataset = readJson<DatasetEntity>(datasetPath);
  const dataServiceId = ensureDataService(entityIds, dataServiceSlug, providerId, stats);
  if (!dataServiceId) return;

  const apiDistId = ensureApiDistribution(
    entityIds,
    datasetSlug,
    dataset.id,
    dataset.title,
    dataServiceSlug,
    dataServiceId,
    stats,
  );

  let datasetChanged = false;
  dataset.distributionIds = dataset.distributionIds ?? [];
  if (!dataset.distributionIds.includes(apiDistId)) {
    dataset.distributionIds.push(apiDistId);
    datasetChanged = true;
  }
  dataset.dataServiceIds = dataset.dataServiceIds ?? [];
  if (!dataset.dataServiceIds.includes(dataServiceId)) {
    dataset.dataServiceIds.push(dataServiceId);
    datasetChanged = true;
  }
  if (datasetChanged) {
    dataset.updatedAt = TS;
    writeJson(datasetPath, dataset);
    stats.datasetsUpdated++;
  }

  const servicePath = join(SERVICES_DIR, `${dataServiceSlug}.json`);
  const service = readJson<DataServiceEntity>(servicePath);
  service.servesDatasetIds = service.servesDatasetIds ?? [];
  if (!service.servesDatasetIds.includes(dataset.id)) {
    service.servesDatasetIds.push(dataset.id);
    service.updatedAt = TS;
    writeJson(servicePath, service);
    stats.dataServicesUpdated++;
  }
}

function runApply(): void {
  if (!existsSync(PROPOSALS_FILE)) {
    console.error("No proposals file found. Run report first.");
    process.exit(1);
  }

  const proposalsDoc = readJson<ProposalsFile>(PROPOSALS_FILE);
  const unreviewed = proposalsDoc.proposals.filter((proposal) => proposal.approved === null);
  if (unreviewed.length > 0) {
    console.error(`${unreviewed.length} proposals still have approved=null. Review the file before apply.`);
    process.exit(1);
  }

  const entityIds = readJson<Record<string, string>>(ENTITY_IDS_FILE);
  const approved = proposalsDoc.proposals
    .filter((proposal) => proposal.approved === true)
    .sort((left, right) => ACTION_ORDER[left.action] - ACTION_ORDER[right.action] || left.id.localeCompare(right.id));
  const rejected = proposalsDoc.proposals.filter((proposal) => proposal.approved === false);

  const stats: Record<string, number> = {
    agentsEnriched: 0,
    agentsCreated: 0,
    catalogsCreated: 0,
    datasetsCreated: 0,
    datasetsUpdated: 0,
    distributionsCreated: 0,
    distributionsUpdated: 0,
    catalogRecordsCreated: 0,
    dataServicesCreated: 0,
    dataServicesUpdated: 0,
  };

  for (const proposal of approved) {
    const detail = proposal.detail;

    switch (proposal.action) {
      case "enrich-agent": {
        const agentPath = join(AGENTS_DIR, `${proposal.slug}.json`);
        if (!existsSync(agentPath)) {
          console.warn(`  warn: Agent:${proposal.slug} missing for enrichment`);
          break;
        }

        const agent = readJson<AgentEntity>(agentPath);
        let changed = false;
        const altNames = uniqueCaseInsensitive([...(agent.alternateNames ?? []), ...(detail.addAlternateNames as string[] ?? [])]);
        if (JSON.stringify(altNames) !== JSON.stringify(agent.alternateNames ?? [])) {
          agent.alternateNames = altNames;
          changed = true;
        }

        const existingDomains = new Set(collectAgentDomains(agent));
        for (const domain of (detail.addUrlAliases as string[] ?? [])) {
          if (existingDomains.has(normalizeDomain(domain))) continue;
          agent.aliases = agent.aliases ?? [];
          agent.aliases.push({
            scheme: "url",
            value: `https://${domain.replace(/^https?:\/\//, "")}`,
            relation: "exactMatch",
          });
          existingDomains.add(normalizeDomain(domain));
          changed = true;
        }

        if (changed) {
          agent.updatedAt = TS;
          writeJson(agentPath, agent);
          stats.agentsEnriched++;
        }
        ensureEntityId(entityIds, `Agent:${proposal.slug}`, agentPath);
        break;
      }

      case "create-agent": {
        const agentPath = join(AGENTS_DIR, `${proposal.slug}.json`);
        if (existsSync(agentPath)) {
          ensureEntityId(entityIds, `Agent:${proposal.slug}`, agentPath);
          break;
        }

        const agentId = mintId("agent", "ag");
        entityIds[`Agent:${proposal.slug}`] = agentId;
        const domains = (detail.domains as string[]) ?? [];

        writeJson(agentPath, {
          _tag: "Agent",
          id: agentId,
          kind: "organization",
          name: detail.name,
          ...(Array.isArray(detail.alternateNames) && (detail.alternateNames as string[]).length > 0
            ? { alternateNames: detail.alternateNames }
            : {}),
          homepage: `https://${domains[0]}`,
          aliases: domains.map((domain) => ({
            scheme: "url",
            value: `https://${String(domain).replace(/^https?:\/\//, "")}`,
            relation: "exactMatch",
          })),
          createdAt: TS,
          updatedAt: TS,
        });
        stats.agentsCreated++;
        break;
      }

      case "create-catalog": {
        const catalogPath = join(CATALOGS_DIR, `${proposal.slug}.json`);
        if (existsSync(catalogPath)) {
          ensureEntityId(entityIds, `Catalog:${proposal.slug}`, catalogPath);
          break;
        }

        const publisherAgentId =
          ensureEntityId(entityIds, `Agent:${proposal.slug}`, join(AGENTS_DIR, `${proposal.slug}.json`)) ?? null;
        if (!publisherAgentId) {
          console.warn(`  warn: Catalog:${proposal.slug} missing Agent:${proposal.slug}`);
          break;
        }

        const catalogId = mintId("catalog", "cat");
        entityIds[`Catalog:${proposal.slug}`] = catalogId;
        writeJson(catalogPath, {
          _tag: "Catalog",
          id: catalogId,
          title: detail.title,
          publisherAgentId,
          homepage: detail.homepage,
          aliases: [],
          createdAt: TS,
          updatedAt: TS,
        });
        stats.catalogsCreated++;
        break;
      }

      case "create-data-service": {
        ensureDataService(entityIds, proposal.slug, proposal.provider, stats);
        break;
      }

      case "wire-existing-dataset-service": {
        ensureDatasetServiceWiring(entityIds, proposal.slug, detail.dataServiceSlug as string, proposal.provider, stats);
        break;
      }

      case "create-dataset": {
        const datasetPath = join(DATASETS_DIR, `${proposal.slug}.json`);
        const providerSlug = detail.providerSlug as string;
        const publisherAgentId =
          ensureEntityId(entityIds, `Agent:${providerSlug}`, join(AGENTS_DIR, `${providerSlug}.json`)) ?? null;
        const catalogId =
          ensureEntityId(entityIds, `Catalog:${providerSlug}`, join(CATALOGS_DIR, `${providerSlug}.json`)) ?? null;
        if (!publisherAgentId || !catalogId) {
          console.warn(`  warn: Dataset:${proposal.slug} missing Agent/Catalog for ${providerSlug}`);
          break;
        }

        let dataset: DatasetEntity;
        let datasetChanged = false;
        if (existsSync(datasetPath)) {
          dataset = readJson<DatasetEntity>(datasetPath);
          entityIds[`Dataset:${proposal.slug}`] = dataset.id;
        } else {
          const datasetId = mintId("dataset", "ds");
          entityIds[`Dataset:${proposal.slug}`] = datasetId;
          dataset = {
            _tag: "Dataset",
            id: datasetId,
            title: detail.title as string,
            publisherAgentId,
            aliases: [],
            createdAt: TS,
            updatedAt: TS,
            landingPage: `https://${detail.primaryDomain}`,
            keywords: String(detail.sourceFamily)
              .toLowerCase()
              .split(/\s+/)
              .filter((word) => word.length > 2),
            themes: ["energy"],
            distributionIds: [],
            accessRights: "public",
          };
          stats.datasetsCreated++;
          datasetChanged = true;
        }

        const webDistId = ensureWebDistribution(
          entityIds,
          proposal.slug,
          dataset.id,
          detail.sourceFamily as string,
          detail.primaryDomain as string,
          stats,
        );

        dataset.distributionIds = dataset.distributionIds ?? [];
        if (!dataset.distributionIds.includes(webDistId)) {
          dataset.distributionIds.push(webDistId);
          datasetChanged = true;
        }
        if (!dataset.publisherAgentId) {
          dataset.publisherAgentId = publisherAgentId;
          datasetChanged = true;
        }
        if (!dataset.landingPage) {
          dataset.landingPage = `https://${detail.primaryDomain}`;
          datasetChanged = true;
        }
        if (!dataset.accessRights) {
          dataset.accessRights = "public";
          datasetChanged = true;
        }

        if (datasetChanged) {
          dataset.updatedAt = TS;
          writeJson(datasetPath, dataset);
        }

        const dataServiceSlug = detail.dataServiceSlug as string | null;
        if (dataServiceSlug) {
          ensureDatasetServiceWiring(entityIds, proposal.slug, dataServiceSlug, proposal.provider, stats);
        }

        ensureCatalogRecord(entityIds, proposal.slug, dataset.id, catalogId, stats);
        break;
      }

      case "skip-existing-dataset":
      case "reject-source-family":
        break;
    }
  }

  writeJson(ENTITY_IDS_FILE, entityIds);

  console.log("\n=== SKY-218 Apply Results ===");
  console.log(`Agents enriched:        ${stats.agentsEnriched}`);
  console.log(`Agents created:         ${stats.agentsCreated}`);
  console.log(`Catalogs created:       ${stats.catalogsCreated}`);
  console.log(`Datasets created:       ${stats.datasetsCreated}`);
  console.log(`Datasets updated:       ${stats.datasetsUpdated}`);
  console.log(`Distributions created:  ${stats.distributionsCreated}`);
  console.log(`Distributions updated:  ${stats.distributionsUpdated}`);
  console.log(`CatalogRecords created: ${stats.catalogRecordsCreated}`);
  console.log(`DataServices created:   ${stats.dataServicesCreated}`);
  console.log(`DataServices updated:   ${stats.dataServicesUpdated}`);
  console.log(`Proposals rejected:     ${rejected.length}`);
}

const mode = process.argv[2];
if (mode === "report") {
  runReport();
} else if (mode === "apply") {
  runApply();
} else {
  console.error("Usage: bun scripts/catalog-harvest/harvest-provider-registry.ts <report|apply>");
  process.exit(1);
}
