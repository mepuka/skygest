/**
 * Create Catalog entities for new publishers that don't have them yet.
 *
 * Each publisher Agent gets one Catalog entity, following the existing pattern
 * (e.g., "U.S. Energy Information Administration Data Catalog").
 *
 * Reads .entity-ids.json for Agent IDs. Skips agents that already have
 * a catalog file. Updates .entity-ids.json with new Catalog entries.
 *
 * Output:
 *   references/cold-start/catalog/catalogs/*.json  (new only)
 *   references/cold-start/.entity-ids.json         (updated)
 *
 * Usage: bun scripts/catalog-harvest/harvest-catalogs.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const CATALOGS_DIR = join(ROOT, "catalog", "catalogs");
const AGENTS_DIR = join(ROOT, "catalog", "agents");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"));

// Load all agent slugs from the agents directory
const glob = new Bun.Glob("*.json");
const agentSlugs: string[] = [];
for (const path of glob.scanSync({ cwd: AGENTS_DIR })) {
  agentSlugs.push(path.replace(".json", ""));
}

let created = 0;
let skipped = 0;

for (const slug of agentSlugs.sort()) {
  // Skip if catalog already exists
  if (existsSync(join(CATALOGS_DIR, `${slug}.json`))) {
    skipped++;
    continue;
  }

  const agentIdKey = `Agent:${slug}`;
  const agentId = entityIds[agentIdKey];
  if (!agentId) {
    console.warn(`  ${slug}: no Agent ID found, skipping`);
    continue;
  }

  // Read agent to get name and homepage
  const agent = JSON.parse(readFileSync(join(AGENTS_DIR, `${slug}.json`), "utf-8"));

  const catalogId = `https://id.skygest.io/catalog/cat_${ulid()}`;
  entityIds[`Catalog:${slug}`] = catalogId;

  const catalog = {
    _tag: "Catalog",
    id: catalogId,
    title: `${agent.name} Data Catalog`,
    publisherAgentId: agentId,
    ...(agent.homepage ? { homepage: agent.homepage } : {}),
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
  };

  writeFileSync(
    join(CATALOGS_DIR, `${slug}.json`),
    JSON.stringify(catalog, null, 2) + "\n",
  );

  console.log(`  created: ${slug} -> ${catalogId}`);
  created++;
}

// Save updated entity IDs
writeFileSync(
  join(ROOT, ".entity-ids.json"),
  JSON.stringify(entityIds, null, 2) + "\n",
);

console.log(`\n=== Catalog Harvest Results ===`);
console.log(`Created: ${created}`);
console.log(`Skipped (already exist): ${skipped}`);
