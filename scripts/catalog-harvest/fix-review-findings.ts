/**
 * Fix review findings from five-layer catalog review
 *
 * Addresses:
 *  #1 (must-fix): Remove DOE/EIA duplicate datasets (doe-seds, doe-recs)
 *  #2 (must-fix): Restore doe-oedi CatalogRecord
 *  #3 (must-fix): Wire 3 orphan DatasetSeries via inSeries
 *  #4 (should-fix): Backfill accessRights: "public" on ~30 datasets
 *  #5 (should-fix): Backfill accessRights: "restricted" on BNEF datasets
 *  #6 (should-fix): Fix NYISO agent (add homepage + url alias)
 *  #8 (should-fix): Normalize CatalogRecords (add firstSeen where missing)
 *
 * Usage: bun scripts/catalog-harvest/fix-review-findings.ts
 *
 * SKY-216: Review fixes
 */
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const CATALOG = join(ROOT, "catalog");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"),
);

function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: any): void {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

let fixes = 0;

// ---------------------------------------------------------------------------
// #1: Remove DOE/EIA duplicate datasets
// doe-seds duplicates eia-state-energy-data-system
// doe-recs duplicates eia-recs
// ---------------------------------------------------------------------------
console.log("=== #1: Removing DOE/EIA duplicates ===");

const DOE_DUPLICATES = ["doe-seds", "doe-recs"];

for (const slug of DOE_DUPLICATES) {
  // Remove dataset
  const dsPath = join(CATALOG, "datasets", `${slug}.json`);
  if (existsSync(dsPath)) {
    const ds = readJson(dsPath);
    // Remove associated distributions
    for (const distId of ds.distributionIds ?? []) {
      // Find distribution file by ID
      for (const f of readdirSync(join(CATALOG, "distributions")).filter((f) => f.endsWith(".json"))) {
        const dist = readJson(join(CATALOG, "distributions", f));
        if (dist.id === distId) {
          unlinkSync(join(CATALOG, "distributions", f));
          // Clean entity-ids
          const key = Object.entries(entityIds).find(([, v]) => v === distId)?.[0];
          if (key) delete entityIds[key];
          console.log(`  deleted distribution: ${f}`);
          fixes++;
        }
      }
    }
    // Remove catalog record
    const crPath = join(CATALOG, "catalog-records", `${slug}-cr.json`);
    if (existsSync(crPath)) {
      unlinkSync(crPath);
      const crKey = Object.entries(entityIds).find(([k]) => k === `CatalogRecord:${slug}-cr`)?.[0];
      if (crKey) delete entityIds[crKey];
      console.log(`  deleted catalog-record: ${slug}-cr.json`);
      fixes++;
    }
    unlinkSync(dsPath);
    const dsKey = `Dataset:${slug}`;
    delete entityIds[dsKey];
    console.log(`  deleted dataset: ${slug}.json`);
    fixes++;
  }
}

// ---------------------------------------------------------------------------
// #2: Restore doe-oedi CatalogRecord
// ---------------------------------------------------------------------------
console.log("\n=== #2: Restoring doe-oedi CatalogRecord ===");

const oediCrPath = join(CATALOG, "catalog-records", "doe-oedi-cr.json");
if (!existsSync(oediCrPath)) {
  const crId = mintId("catalog-record", "cr");
  entityIds["CatalogRecord:doe-oedi-cr"] = crId;

  writeJson(oediCrPath, {
    _tag: "CatalogRecord",
    id: crId,
    catalogId: entityIds["Catalog:doe"],
    primaryTopicType: "dataset",
    primaryTopicId: entityIds["Dataset:doe-oedi"],
    firstSeen: TS,
    isAuthoritative: true,
  });
  console.log("  created doe-oedi-cr.json");
  fixes++;
} else {
  console.log("  skip: already exists");
}

// ---------------------------------------------------------------------------
// #3: Wire 3 orphan DatasetSeries
// ---------------------------------------------------------------------------
console.log("\n=== #3: Wiring orphan DatasetSeries ===");

const SERIES_WIRING: Record<string, string[]> = {
  "DatasetSeries:gem-tracker-updates": [
    "gem-global-coal-plant-tracker",
    "gem-global-solar-power-tracker",
    "gem-global-wind-power-tracker",
  ],
  "DatasetSeries:gcp-global-carbon-budget": [
    "gcp-global-carbon-budget-dataset",
  ],
  "DatasetSeries:agora-energiewende-analysis": [
    "agora-agorameter",
  ],
};

for (const [seriesKey, datasetSlugs] of Object.entries(SERIES_WIRING)) {
  const seriesId = entityIds[seriesKey];
  if (!seriesId) {
    console.log(`  ERROR: ${seriesKey} not found in entity-ids`);
    continue;
  }

  for (const slug of datasetSlugs) {
    const dsPath = join(CATALOG, "datasets", `${slug}.json`);
    if (!existsSync(dsPath)) {
      console.log(`  skip: ${slug} not found`);
      continue;
    }

    const ds = readJson(dsPath);
    if (ds.inSeries) {
      console.log(`  skip: ${slug} already has inSeries`);
      continue;
    }

    ds.inSeries = seriesId;
    writeJson(dsPath, ds);
    console.log(`  wired: ${slug} -> ${seriesKey.replace("DatasetSeries:", "")}`);
    fixes++;
  }
}

// ---------------------------------------------------------------------------
// #4: Backfill accessRights: "public" on datasets missing it
// ---------------------------------------------------------------------------
console.log("\n=== #4: Backfilling accessRights ===");

// Known public datasets missing accessRights
const PUBLIC_DATASETS = [
  "aemo-nem-data", "agora-agorameter", "bnetza-smard",
  "cea-installed-capacity", "cea-monthly-generation",
  "climate-trace-inventory", "desnz-energy-statistics", "doe-oedi",
  "epa-egrid", "epa-ghg-inventory", "eurostat-energy-statistics",
  "gcp-global-carbon-budget-dataset",
  "gem-global-coal-plant-tracker", "gem-global-solar-power-tracker",
  "gem-global-wind-power-tracker", "gridstatus-us-grid",
  "iiasa-scenario-explorer", "imf-climate-data-dashboard",
  "imf-fossil-fuel-subsidies", "iso-ne-market-data",
  "meti-energy-statistics", "miso-market-data",
  "nerc-reliability-assessments", "nyiso-market-data",
  "owid-co2-data", "owid-energy-data",
  "ree-esios", "rte-eco2mix",
  "terna-transparency-report", "world-bank-energy-data",
  "lbnl-queue", "spp-generation",
  "cat-country-assessments", "ferc-infrastructure-update", "ferc-orders",
  "nrel-atb", "nrel-geothermal",
];

// Also backfill all EIA datasets as public
const eiaPublic: string[] = [];
for (const f of readdirSync(join(CATALOG, "datasets")).filter((f) => f.startsWith("eia-"))) {
  eiaPublic.push(f.replace(".json", ""));
}

// Also Ember, IEA, IRENA, CAISO, ERCOT, ENTSO-E, PJM
for (const prefix of ["ember-", "iea-", "irena-", "caiso-", "ercot-", "entsoe-", "pjm-", "unfccc-", "ipcc-"]) {
  for (const f of readdirSync(join(CATALOG, "datasets")).filter((f) => f.startsWith(prefix))) {
    const slug = f.replace(".json", "");
    if (!PUBLIC_DATASETS.includes(slug) && !eiaPublic.includes(slug)) {
      eiaPublic.push(slug);
    }
  }
}

const allPublic = [...new Set([...PUBLIC_DATASETS, ...eiaPublic])];

let publicCount = 0;
for (const slug of allPublic) {
  const dsPath = join(CATALOG, "datasets", `${slug}.json`);
  if (!existsSync(dsPath)) continue;

  const ds = readJson(dsPath);
  if (ds.accessRights) continue; // already set

  ds.accessRights = "public";
  writeJson(dsPath, ds);
  publicCount++;
}
console.log(`  Set accessRights: "public" on ${publicCount} datasets`);
fixes += publicCount;

// ---------------------------------------------------------------------------
// #5: BNEF datasets → restricted
// ---------------------------------------------------------------------------
console.log("\n=== #5: BNEF accessRights: restricted ===");

const BNEF_RESTRICTED = ["bnef-battery-price", "bnef-corporate-clean", "bnef-datacenter", "bnef-eti"];
let bnefCount = 0;

for (const slug of BNEF_RESTRICTED) {
  const dsPath = join(CATALOG, "datasets", `${slug}.json`);
  if (!existsSync(dsPath)) continue;

  const ds = readJson(dsPath);
  if (ds.accessRights === "restricted") continue;

  ds.accessRights = "restricted";
  writeJson(dsPath, ds);
  bnefCount++;
}
console.log(`  Set accessRights: "restricted" on ${bnefCount} BNEF datasets`);
fixes += bnefCount;

// ---------------------------------------------------------------------------
// #6: Fix NYISO agent
// ---------------------------------------------------------------------------
console.log("\n=== #6: Fixing NYISO agent ===");

const nyisoPath = join(CATALOG, "agents", "nyiso.json");
const nyiso = readJson(nyisoPath);

if (!nyiso.homepage) {
  nyiso.homepage = "https://www.nyiso.com/";
  const hasUrl = nyiso.aliases?.some((a: any) => a.scheme === "url");
  if (!hasUrl) {
    nyiso.aliases = nyiso.aliases ?? [];
    nyiso.aliases.push({
      scheme: "url",
      value: "https://www.nyiso.com/",
      relation: "exactMatch",
    });
  }
  writeJson(nyisoPath, nyiso);
  console.log("  Added homepage and url alias to NYISO");
  fixes++;
} else {
  console.log("  skip: already has homepage");
}

// ---------------------------------------------------------------------------
// #8: Normalize CatalogRecords — add firstSeen where missing
// ---------------------------------------------------------------------------
console.log("\n=== #8: Normalizing CatalogRecords ===");

let crNormalized = 0;
const crDir = join(CATALOG, "catalog-records");

for (const f of readdirSync(crDir).filter((f) => f.endsWith(".json"))) {
  const crPath = join(crDir, f);
  const cr = readJson(crPath);

  let changed = false;

  if (!cr.firstSeen) {
    cr.firstSeen = TS;
    changed = true;
  }

  if (cr.isAuthoritative === undefined) {
    cr.isAuthoritative = true;
    changed = true;
  }

  if (changed) {
    writeJson(crPath, cr);
    crNormalized++;
  }
}
console.log(`  Normalized ${crNormalized} CatalogRecords`);
fixes += crNormalized;

// ---------------------------------------------------------------------------
// Save entity IDs
// ---------------------------------------------------------------------------
writeJson(join(ROOT, ".entity-ids.json"), entityIds);

console.log(`\n=== Review Fixes Complete ===`);
console.log(`Total fixes applied: ${fixes}`);
