/**
 * Harvest EIA datasets from the bulk download manifest.
 *
 * Creates Dataset, Distribution, and CatalogRecord entities for EIA
 * dataset categories not yet in the catalog. Each manifest entry produces:
 *   - 1 Dataset
 *   - 2 Distributions (bulk download ZIP + API access)
 *   - 1 CatalogRecord (linking to the EIA catalog)
 *
 * The API-access Distributions link to the existing EIA DataService.
 * AEO vintages are skipped (already covered by eia-aeo-dataset + DatasetSeries).
 *
 * Source: references/cold-start/reports/harvest/eia-manifest-raw.json
 *
 * Output:
 *   references/cold-start/catalog/datasets/eia-*.json
 *   references/cold-start/catalog/distributions/eia-*-bulk.json
 *   references/cold-start/catalog/distributions/eia-*-api.json
 *   references/cold-start/catalog/catalog-records/eia-*-cr.json
 *   references/cold-start/.entity-ids.json (updated)
 *
 * Usage: bun scripts/catalog-harvest/harvest-eia-datasets.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const DATASETS_DIR = join(ROOT, "catalog", "datasets");
const DISTS_DIR = join(ROOT, "catalog", "distributions");
const RECORDS_DIR = join(ROOT, "catalog", "catalog-records");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "reports", "harvest", "eia-manifest-raw.json"), "utf-8"));

// EIA Agent and Catalog IDs (must exist)
const eiaAgentId = entityIds["Agent:eia"];
const eiaCatalogId = entityIds["Catalog:eia"];
if (!eiaAgentId || !eiaCatalogId) {
  console.error("EIA Agent or Catalog ID not found in .entity-ids.json");
  process.exit(1);
}

// Existing EIA DataService ID
const eiaDataServiceId = entityIds["DataService:eia-api"]
  ?? Object.entries(entityIds).find(([k]) => k.startsWith("DataService:eia"))?.[1];

// ---------------------------------------------------------------------------
// Map manifest categories to dataset slugs
// ---------------------------------------------------------------------------
interface ManifestMapping {
  manifestKey: string;
  slug: string;
  title: string;
  description?: string;
  keywords?: string[];
  themes?: string[];
  landingPage?: string;
}

// Skip AEO vintages (already handled), ELEC (already eia-electricity-data),
// PET (already eia-petroleum), INTL (already eia-international),
// STEO (already eia-steo), EMISS (partially eia-state-co2)
const EXISTING_MAPPINGS: Record<string, string> = {
  ELEC: "eia-electricity-data",
  PET: "eia-petroleum",
  INTL: "eia-international",
  STEO: "eia-steo",
};

const NEW_DATASETS: ManifestMapping[] = [
  {
    manifestKey: "COAL",
    slug: "eia-coal",
    title: "EIA Coal Data",
    description: "National, state, and mine-level coal production statistics, including imports, exports, receipts, and quality data.",
    keywords: ["coal", "production", "mining", "imports", "exports"],
    themes: ["coal", "fossil fuels"],
    landingPage: "https://www.eia.gov/coal/data.php",
  },
  {
    manifestKey: "EBA",
    slug: "eia-electric-system-operating-data",
    title: "EIA U.S. Electric System Operating Data",
    description: "Hourly electric system operating data including demand, generation by source, and interchange between balancing authorities.",
    keywords: ["electricity", "grid", "demand", "generation", "balancing authority", "hourly"],
    themes: ["electricity", "grid operations"],
    landingPage: "https://www.eia.gov/electricity/gridmonitor/",
  },
  {
    manifestKey: "EMISS",
    slug: "eia-emissions",
    title: "EIA Emissions Data",
    description: "Energy-related carbon dioxide emissions by fuel, sector, and state.",
    keywords: ["emissions", "CO2", "carbon dioxide", "greenhouse gas"],
    themes: ["emissions"],
    landingPage: "https://www.eia.gov/environment/emissions/",
  },
  {
    manifestKey: "IEO",
    slug: "eia-international-energy-outlook",
    title: "EIA International Energy Outlook",
    description: "Long-term projections of international energy production, consumption, and carbon dioxide emissions.",
    keywords: ["international", "outlook", "forecast", "projections"],
    themes: ["international", "forecast"],
    landingPage: "https://www.eia.gov/outlooks/ieo/",
  },
  {
    manifestKey: "NG",
    slug: "eia-natural-gas",
    title: "EIA Natural Gas Data",
    description: "U.S. natural gas production, imports, exploration, pipelines, exports, prices, consumption, and reserves.",
    keywords: ["natural gas", "production", "prices", "pipelines", "storage"],
    themes: ["natural gas"],
    landingPage: "https://www.eia.gov/naturalgas/data.php",
  },
  {
    manifestKey: "NUC_STATUS",
    slug: "eia-nuclear-outages",
    title: "EIA Nuclear Outages",
    description: "Daily status of U.S. nuclear power plant capacity and outages.",
    keywords: ["nuclear", "outages", "capacity", "power plants"],
    themes: ["nuclear"],
    landingPage: "https://www.eia.gov/nuclear/outages/",
  },
  {
    manifestKey: "PET_IMPORTS",
    slug: "eia-petroleum-imports",
    title: "EIA Petroleum Imports",
    description: "National, PADD, state, city, port, and refinery petroleum imports data for various grades of crude oil and countries of origin.",
    keywords: ["petroleum", "imports", "crude oil", "refinery"],
    themes: ["petroleum", "trade"],
    landingPage: "https://www.eia.gov/petroleum/imports/browser/",
  },
  {
    manifestKey: "SEDS",
    slug: "eia-state-energy-data-system",
    title: "EIA State Energy Data System (SEDS)",
    description: "Comprehensive state-level energy production and consumption estimates using survey data and statistical models.",
    keywords: ["state", "energy", "production", "consumption", "SEDS"],
    themes: ["state energy", "comprehensive"],
    landingPage: "https://www.eia.gov/state/seds/",
  },
  {
    manifestKey: "TOTAL",
    slug: "eia-total-energy",
    title: "EIA Total Energy",
    description: "U.S. total energy production, prices, carbon dioxide emissions, and consumption by sector and source.",
    keywords: ["total energy", "production", "consumption", "prices", "emissions"],
    themes: ["total energy"],
    landingPage: "https://www.eia.gov/totalenergy/",
  },
];

// ---------------------------------------------------------------------------
// Create entities
// ---------------------------------------------------------------------------
mkdirSync(DISTS_DIR, { recursive: true });
mkdirSync(RECORDS_DIR, { recursive: true });

let datasetsCreated = 0;
let distsCreated = 0;
let recordsCreated = 0;

for (const mapping of NEW_DATASETS) {
  const entry = manifest.dataset?.[mapping.manifestKey];
  if (!entry) {
    console.warn(`  ${mapping.manifestKey}: not found in manifest, skipping`);
    continue;
  }

  // Skip if already exists
  if (existsSync(join(DATASETS_DIR, `${mapping.slug}.json`))) {
    console.log(`  ${mapping.slug}: already exists, skipping`);
    continue;
  }

  // Mint IDs
  const datasetId = `https://id.skygest.io/dataset/ds_${ulid()}`;
  const bulkDistId = `https://id.skygest.io/distribution/dist_${ulid()}`;
  const apiDistId = `https://id.skygest.io/distribution/dist_${ulid()}`;

  entityIds[`Dataset:${mapping.slug}`] = datasetId;
  entityIds[`Distribution:${mapping.slug}-bulk`] = bulkDistId;
  entityIds[`Distribution:${mapping.slug}-api`] = apiDistId;

  // Build Distribution entities
  const bulkDist = {
    _tag: "Distribution",
    id: bulkDistId,
    datasetId,
    kind: "download",
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    title: `${mapping.title} (bulk download)`,
    accessURL: entry.accessURL,
    format: "application/zip",
    mediaType: "application/zip",
  };

  const apiDist: Record<string, any> = {
    _tag: "Distribution",
    id: apiDistId,
    datasetId,
    kind: "api-access",
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    title: `${mapping.title} via API`,
    accessURL: `https://api.eia.gov/v2/${mapping.manifestKey.toLowerCase()}/`,
  };
  if (eiaDataServiceId) {
    apiDist.accessServiceId = eiaDataServiceId;
  }

  // Build Dataset entity
  const dataset: Record<string, any> = {
    _tag: "Dataset",
    id: datasetId,
    title: mapping.title,
    publisherAgentId: eiaAgentId,
    aliases: [
      { scheme: "eia-route", value: mapping.manifestKey, relation: "exactMatch" },
    ],
    createdAt: TS,
    updatedAt: TS,
    distributionIds: [bulkDistId, apiDistId],
  };

  if (mapping.description) dataset.description = mapping.description;
  if (mapping.landingPage) dataset.landingPage = mapping.landingPage;
  if (mapping.keywords) dataset.keywords = mapping.keywords;
  if (mapping.themes) dataset.themes = mapping.themes;
  if (eiaDataServiceId) dataset.dataServiceIds = [eiaDataServiceId];

  // Build CatalogRecord
  const crId = `https://id.skygest.io/catalog-record/cr_${ulid()}`;
  entityIds[`CatalogRecord:${mapping.slug}-cr`] = crId;

  const catalogRecord = {
    _tag: "CatalogRecord",
    id: crId,
    catalogId: eiaCatalogId,
    primaryTopicType: "dataset" as const,
    primaryTopicId: datasetId,
  };

  // Write files
  writeFileSync(join(DATASETS_DIR, `${mapping.slug}.json`), JSON.stringify(dataset, null, 2) + "\n");
  writeFileSync(join(DISTS_DIR, `${mapping.slug}-bulk.json`), JSON.stringify(bulkDist, null, 2) + "\n");
  writeFileSync(join(DISTS_DIR, `${mapping.slug}-api.json`), JSON.stringify(apiDist, null, 2) + "\n");
  writeFileSync(join(RECORDS_DIR, `${mapping.slug}-cr.json`), JSON.stringify(catalogRecord, null, 2) + "\n");

  console.log(`  ${mapping.slug}: dataset + 2 distributions + catalog record`);
  datasetsCreated++;
  distsCreated += 2;
  recordsCreated++;
}

// Also update the existing EIA DataService to serve the new datasets
if (eiaDataServiceId) {
  const dsPath = join(ROOT, "catalog", "data-services", "eia-api.json");
  if (existsSync(dsPath)) {
    const ds = JSON.parse(readFileSync(dsPath, "utf-8"));
    const newDatasetIds = NEW_DATASETS
      .map((m) => entityIds[`Dataset:${m.slug}`])
      .filter(Boolean);

    const existingIds = new Set(ds.servesDatasetIds ?? []);
    let added = 0;
    for (const id of newDatasetIds) {
      if (!existingIds.has(id)) {
        ds.servesDatasetIds.push(id);
        added++;
      }
    }

    if (added > 0) {
      writeFileSync(dsPath, JSON.stringify(ds, null, 2) + "\n");
      console.log(`\n  Updated EIA DataService: added ${added} dataset references`);
    }
  }
}

// Save entity IDs
writeFileSync(
  join(ROOT, ".entity-ids.json"),
  JSON.stringify(entityIds, null, 2) + "\n",
);

console.log(`\n=== EIA Dataset Harvest Results ===`);
console.log(`Datasets created: ${datasetsCreated}`);
console.log(`Distributions created: ${distsCreated}`);
console.log(`CatalogRecords created: ${recordsCreated}`);
