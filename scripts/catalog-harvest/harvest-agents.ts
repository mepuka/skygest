/**
 * Harvest Agent entities from verified probe data.
 *
 * Reads ROR and Wikidata probe reports, combines with existing catalog data,
 * and produces corrected existing + new Agent JSON files. Preserves existing
 * Agent IDs to avoid breaking FK references from Datasets, Catalogs, etc.
 *
 * Actions:
 *   1. Fix existing agents: correct Wikidata QIDs, update/add ROR IDs
 *   2. Create new agents: mint IDs, populate from Wikidata + ROR probe data
 *   3. Update .entity-ids.json with new Agent entries
 *
 * Output:
 *   references/cold-start/catalog/agents/*.json    (corrected + new)
 *   references/cold-start/.entity-ids.json         (updated)
 *   references/cold-start/reports/harvest/agent-harvest-summary.json
 *
 * Usage: bun scripts/catalog-harvest/harvest-agents.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const AGENTS_DIR = join(ROOT, "catalog", "agents");
const REPORTS_DIR = join(ROOT, "reports", "harvest");
const TS = "2026-04-08T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Load probe reports
// ---------------------------------------------------------------------------
const rorReport = JSON.parse(readFileSync(join(REPORTS_DIR, "ror-probe.json"), "utf-8"));
const wdReport = JSON.parse(readFileSync(join(REPORTS_DIR, "wikidata-probe.json"), "utf-8"));
const entityIds: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"));

// Index probe results by slug
const rorBySlug = new Map<string, any>();
for (const r of rorReport.verified ?? []) {
  rorBySlug.set(r.slug, r);
}

const wdBySlug = new Map<string, any>();
for (const r of wdReport.results ?? []) {
  if (r.found) wdBySlug.set(r.slug, r);
}

// ---------------------------------------------------------------------------
// Agent definitions — verified data from probes
// ---------------------------------------------------------------------------
interface AgentSpec {
  slug: string;
  name: string;
  alternateNames?: string[];
  kind: "organization" | "person" | "consortium" | "program" | "other";
  homepage?: string;
  rorId?: string;        // from ROR probe (verified exact match)
  wikidataQid?: string;  // from Wikidata probe (verified QID)
}

// Merge probe data into agent specs
function normalizeRorId(rorId?: string): string | undefined {
  if (!rorId) return undefined;
  return rorId.startsWith("https://ror.org/") ? rorId : `https://ror.org/${rorId}`;
}

function buildAgentSpec(slug: string, name: string, alternateNames: string[]): AgentSpec {
  const ror = rorBySlug.get(slug);
  const wd = wdBySlug.get(slug);
  const resolvedRorId = ror?.rorId ?? wd?.rorId;

  return {
    slug,
    name,
    alternateNames: alternateNames.length > 0 ? alternateNames : undefined,
    kind: "organization",
    homepage: wd?.website ?? ror?.website ?? undefined,
    rorId: normalizeRorId(resolvedRorId),
    wikidataQid: wd?.qid ?? undefined,
  };
}

// Build the full agent list
const AGENTS: AgentSpec[] = [
  // Original catalog agents.
  buildAgentSpec("eia", "U.S. Energy Information Administration", ["EIA"]),
  buildAgentSpec("iea", "International Energy Agency", ["IEA"]),
  buildAgentSpec("ember", "Ember", ["Ember Climate"]),
  buildAgentSpec("bnef", "BloombergNEF", ["BNEF", "Bloomberg New Energy Finance"]),
  buildAgentSpec("ferc", "Federal Energy Regulatory Commission", ["FERC"]),
  buildAgentSpec("ercot", "Electric Reliability Council of Texas", ["ERCOT"]),
  buildAgentSpec("caiso", "California Independent System Operator", ["CAISO", "California ISO"]),
  buildAgentSpec("pjm", "PJM Interconnection", ["PJM"]),
  buildAgentSpec("nrel", "National Renewable Energy Laboratory", ["NREL"]),
  buildAgentSpec("irena", "International Renewable Energy Agency", ["IRENA"]),
  buildAgentSpec("entso-e", "European Network of Transmission System Operators for Electricity", ["ENTSO-E"]),
  buildAgentSpec("unfccc", "United Nations Framework Convention on Climate Change", ["UNFCCC"]),
  buildAgentSpec("cat", "Climate Action Tracker", ["CAT"]),
  buildAgentSpec("lbnl", "Lawrence Berkeley National Laboratory", ["LBNL", "Berkeley Lab"]),
  buildAgentSpec("spp", "Southwest Power Pool", ["SPP"]),

  // Additional harvested agents. Existing files win over this historical grouping.
  buildAgentSpec("miso", "Midcontinent Independent System Operator", ["MISO"]),
  buildAgentSpec("nyiso", "New York Independent System Operator", ["NYISO"]),
  buildAgentSpec("iso-ne", "ISO New England", ["ISO-NE"]),
  buildAgentSpec("nerc", "North American Electric Reliability Corporation", ["NERC"]),
  buildAgentSpec("aemo", "Australian Energy Market Operator", ["AEMO"]),
  buildAgentSpec("rte", "RTE", ["Réseau de Transport d'Électricité"]),
  buildAgentSpec("terna", "Terna S.p.A.", ["Terna"]),
  buildAgentSpec("epa", "United States Environmental Protection Agency", ["EPA", "US EPA"]),
  buildAgentSpec("eurostat", "Eurostat", []),
  buildAgentSpec("bnetza", "Bundesnetzagentur", ["BNetzA", "Federal Network Agency"]),
  buildAgentSpec("ree", "Red Eléctrica de España", ["REE", "Redeia"]),
  buildAgentSpec("meti", "Ministry of Economy, Trade and Industry", ["METI"]),
  buildAgentSpec("doe", "United States Department of Energy", ["DOE", "US DOE"]),
  buildAgentSpec("beis", "Department for Energy Security and Net Zero", ["DESNZ"]),
  buildAgentSpec("cea", "Central Electricity Authority of India", ["CEA"]),
  buildAgentSpec("world-bank", "World Bank", ["IBRD"]),
  buildAgentSpec("imf", "International Monetary Fund", ["IMF"]),
  buildAgentSpec("iiasa", "International Institute for Applied Systems Analysis", ["IIASA"]),
  buildAgentSpec("agora", "Agora Energiewende", ["Agora"]),
  buildAgentSpec("climate-trace", "Climate TRACE", []),
  buildAgentSpec("gcp", "Global Carbon Project", ["GCP"]),
  buildAgentSpec("gem", "Global Energy Monitor", ["GEM"]),
  buildAgentSpec("owid", "Our World in Data", ["OWID"]),
  buildAgentSpec("gridstatus", "GridStatus", []),
];

// ---------------------------------------------------------------------------
// Build Agent JSON entities
// ---------------------------------------------------------------------------
interface AgentEntity {
  _tag: "Agent";
  id: string;
  kind: string;
  name: string;
  aliases: Array<{ scheme: string; value: string; relation: string; uri?: string }>;
  createdAt: string;
  updatedAt: string;
  alternateNames?: string[];
  homepage?: string;
}

function buildAliases(spec: AgentSpec, existing?: AgentEntity): AgentEntity["aliases"] {
  const aliases: AgentEntity["aliases"] = (existing?.aliases ?? []).filter(
    (alias) => !["ror", "wikidata", "url"].includes(alias.scheme),
  );
  const homepage = spec.homepage ?? existing?.homepage;

  if (spec.rorId) {
    aliases.push({ scheme: "ror", value: spec.rorId, relation: "exactMatch" });
  }
  if (spec.wikidataQid) {
    aliases.push({ scheme: "wikidata", value: spec.wikidataQid, relation: "exactMatch" });
  }
  if (homepage) {
    aliases.push({ scheme: "url", value: homepage, relation: "exactMatch" });
  }

  return aliases;
}

const summary = {
  corrected: [] as Array<{ slug: string; changes: string[] }>,
  created: [] as Array<{ slug: string; id: string }>,
  unchanged: [] as string[],
};

for (const spec of AGENTS) {
  const existingIdKey = `Agent:${spec.slug}`;
  const existingPath = join(AGENTS_DIR, `${spec.slug}.json`);
  const existing = existsSync(existingPath)
    ? JSON.parse(readFileSync(existingPath, "utf-8")) as AgentEntity
    : undefined;
  const persistedId = existing?.id ?? entityIds[existingIdKey];
  const isExisting = persistedId !== undefined;
  const agentId = persistedId ?? `https://id.skygest.io/agent/ag_${ulid()}`;
  entityIds[existingIdKey] = agentId;

  const homepage = spec.homepage ?? existing?.homepage;
  const aliases = buildAliases(spec, existing);

  const baseEntity: AgentEntity = {
    _tag: "Agent",
    id: agentId,
    kind: spec.kind,
    name: spec.name,
    aliases,
    createdAt: existing?.createdAt ?? TS,
    updatedAt: TS,
    ...(spec.alternateNames && spec.alternateNames.length > 0 ? { alternateNames: spec.alternateNames } : {}),
    ...(homepage ? { homepage } : {}),
  };

  const changes: string[] = [];
  if (existing) {
    if (existing.kind !== baseEntity.kind) changes.push("kind");
    if (existing.name !== baseEntity.name) changes.push("name");
    if (JSON.stringify(existing.aliases ?? []) !== JSON.stringify(aliases)) changes.push("aliases");
    if (existing.homepage !== baseEntity.homepage) changes.push("homepage");
    if (JSON.stringify(existing.alternateNames) !== JSON.stringify(baseEntity.alternateNames)) changes.push("alternateNames");
  }

  let entityToWrite = baseEntity;
  if (existing && changes.length === 0) {
    entityToWrite = existing;
    summary.unchanged.push(spec.slug);
  } else if (isExisting) {
    if (!existing) changes.push("new file");
    summary.corrected.push({ slug: spec.slug, changes });
  } else {
    summary.created.push({ slug: spec.slug, id: agentId });
  }

  if (!existing || JSON.stringify(existing) !== JSON.stringify(entityToWrite)) {
    writeFileSync(existingPath, JSON.stringify(entityToWrite, null, 2) + "\n");
  }
}

// Update entity-ids.json
writeFileSync(
  join(ROOT, ".entity-ids.json"),
  JSON.stringify(entityIds, null, 2) + "\n",
);

// Write summary report
const report = {
  _meta: {
    script: "harvest-agents.ts",
    executedAt: TS,
    ticket: "SKY-216",
  },
  summary: {
    totalAgents: AGENTS.length,
    corrected: summary.corrected.length,
    created: summary.created.length,
    unchanged: summary.unchanged.length,
  },
  corrected: summary.corrected,
  created: summary.created,
  unchanged: summary.unchanged,
};

writeFileSync(
  join(REPORTS_DIR, "agent-harvest-summary.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------
console.log("=== Agent Harvest Results ===");
console.log(`Total: ${AGENTS.length} agents`);
console.log(`Corrected: ${summary.corrected.length}`);
console.log(`Created: ${summary.created.length}`);
console.log(`Unchanged: ${summary.unchanged.length}`);

if (summary.corrected.length > 0) {
  console.log("\nCorrected existing agents:");
  for (const c of summary.corrected) {
    console.log(`  ${c.slug}: ${c.changes.join(", ")}`);
  }
}

if (summary.created.length > 0) {
  console.log("\nNew agents created:");
  for (const c of summary.created) {
    console.log(`  ${c.slug}: ${c.id}`);
  }
}

console.log("\nDone. Run `bun run test` to validate all entities.");
