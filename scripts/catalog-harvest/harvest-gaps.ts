/**
 * Fill remaining catalog gaps identified in the SKY-216 audit:
 *
 * 1. Fix BNEF and GridStatus — add URL aliases (not in ROR/Wikidata)
 * 2. Add missing publishers: Wood Mackenzie, Rystad, S&P Global, IPCC
 * 3. Add datasets for publishers with 0: CEA, IMF, METI
 * 4. Add datasets for the new paywalled/report publishers
 *
 * Rationale: even paywalled publishers need catalog entries for matching.
 * When an expert cites "BloombergNEF LCOE data", we need an entity to
 * link to — the catalog is for matching, not connecting.
 *
 * Usage: bun scripts/catalog-harvest/harvest-gaps.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const AGENTS_DIR = join(ROOT, "catalog", "agents");
const CATALOGS_DIR = join(ROOT, "catalog", "catalogs");
const DATASETS_DIR = join(ROOT, "catalog", "datasets");
const DISTS_DIR = join(ROOT, "catalog", "distributions");
const RECORDS_DIR = join(ROOT, "catalog", "catalog-records");
const SERIES_DIR = join(ROOT, "catalog", "dataset-series");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"));

function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

function writeEntity(dir: string, filename: string, entity: Record<string, any>) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${filename}.json`), JSON.stringify(entity, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// 1. Fix BNEF and GridStatus aliases
// ---------------------------------------------------------------------------
console.log("=== Fixing BNEF and GridStatus aliases ===");

for (const slug of ["bnef", "gridstatus"]) {
  const path = join(AGENTS_DIR, `${slug}.json`);
  const agent = JSON.parse(readFileSync(path, "utf-8"));
  if (agent.aliases.length === 0 && agent.homepage) {
    agent.aliases.push({ scheme: "url", value: agent.homepage, relation: "exactMatch" });
    agent.updatedAt = "2026-04-08T00:00:00.000Z";
    writeFileSync(path, JSON.stringify(agent, null, 2) + "\n");
    console.log(`  ${slug}: added URL alias (${agent.homepage})`);
  } else if (agent.aliases.length === 0) {
    // GridStatus has no homepage from Wikidata — add manually
    const homepage = slug === "gridstatus" ? "https://www.gridstatus.io" : "https://about.bnef.com";
    agent.homepage = homepage;
    agent.aliases.push({ scheme: "url", value: homepage, relation: "exactMatch" });
    agent.updatedAt = "2026-04-08T00:00:00.000Z";
    writeFileSync(path, JSON.stringify(agent, null, 2) + "\n");
    console.log(`  ${slug}: added homepage + URL alias (${homepage})`);
  }
}

// ---------------------------------------------------------------------------
// 2. Add missing publishers: Wood Mackenzie, Rystad, S&P Global, IPCC
// ---------------------------------------------------------------------------
console.log("\n=== Adding missing publishers ===");

interface NewPublisher {
  slug: string;
  name: string;
  alternateNames: string[];
  homepage: string;
  wikidataQid?: string;
  accessRights: "public" | "restricted";
}

const NEW_PUBLISHERS: NewPublisher[] = [
  {
    slug: "wood-mackenzie",
    name: "Wood Mackenzie",
    alternateNames: ["WoodMac"],
    homepage: "https://www.woodmac.com",
    wikidataQid: "Q8030088",
    accessRights: "restricted",
  },
  {
    slug: "rystad",
    name: "Rystad Energy",
    alternateNames: ["Rystad"],
    homepage: "https://www.rystadenergy.com",
    wikidataQid: "Q7385447",
    accessRights: "restricted",
  },
  {
    slug: "sp-global",
    name: "S&P Global Commodity Insights",
    alternateNames: ["S&P Global Platts", "Platts"],
    homepage: "https://www.spglobal.com/commodityinsights/",
    wikidataQid: "Q7387876",
    accessRights: "restricted",
  },
  {
    slug: "ipcc",
    name: "Intergovernmental Panel on Climate Change",
    alternateNames: ["IPCC"],
    homepage: "https://www.ipcc.ch",
    wikidataQid: "Q171183",
    accessRights: "public",
  },
];

for (const pub of NEW_PUBLISHERS) {
  if (existsSync(join(AGENTS_DIR, `${pub.slug}.json`))) {
    console.log(`  skip: ${pub.slug} (exists)`);
    continue;
  }

  const agentId = mintId("agent", "ag");
  entityIds[`Agent:${pub.slug}`] = agentId;

  const aliases: Array<{ scheme: string; value: string; relation: string }> = [];
  if (pub.wikidataQid) aliases.push({ scheme: "wikidata", value: pub.wikidataQid, relation: "exactMatch" });
  aliases.push({ scheme: "url", value: pub.homepage, relation: "exactMatch" });

  writeEntity(AGENTS_DIR, pub.slug, {
    _tag: "Agent", id: agentId, kind: "organization",
    name: pub.name, alternateNames: pub.alternateNames,
    homepage: pub.homepage, aliases,
    createdAt: TS, updatedAt: TS,
  });

  // Catalog
  const catId = mintId("catalog", "cat");
  entityIds[`Catalog:${pub.slug}`] = catId;
  writeEntity(CATALOGS_DIR, pub.slug, {
    _tag: "Catalog", id: catId,
    title: `${pub.name} Data Catalog`,
    publisherAgentId: agentId,
    homepage: pub.homepage,
    aliases: [], createdAt: TS, updatedAt: TS,
  });

  console.log(`  created: ${pub.slug} (agent + catalog)`);
}

// ---------------------------------------------------------------------------
// 3. Add datasets for all publishers that need them
// ---------------------------------------------------------------------------
console.log("\n=== Adding datasets for gap publishers ===");

interface GapDataset {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  landingPage?: string;
  keywords: string[];
  themes: string[];
  accessRights?: "public" | "restricted" | "nonPublic" | "unknown";
  license?: string;
  distributions: Array<{
    slug: string;
    title: string;
    kind: "download" | "api-access" | "landing-page" | "interactive-web-app" | "documentation" | "other";
    accessURL: string;
    format?: string;
  }>;
}

const GAP_DATASETS: GapDataset[] = [
  // CEA
  {
    publisherSlug: "cea",
    slug: "cea-monthly-generation",
    title: "CEA Monthly Generation Report",
    description: "Monthly report on all-India electricity generation by fuel type and state, published by the Central Electricity Authority.",
    landingPage: "https://cea.nic.in/monthly-generation-report/",
    keywords: ["India", "generation", "monthly", "fuel mix", "state-level"],
    themes: ["electricity", "India"],
    distributions: [
      { slug: "cea-generation-web", title: "CEA Generation Reports", kind: "landing-page", accessURL: "https://cea.nic.in/monthly-generation-report/" },
    ],
  },
  {
    publisherSlug: "cea",
    slug: "cea-installed-capacity",
    title: "CEA All India Installed Capacity",
    description: "Monthly report on installed electricity generation capacity in India by fuel type, sector, and state.",
    landingPage: "https://cea.nic.in/installed-capacity-report/",
    keywords: ["India", "capacity", "installed", "fuel type"],
    themes: ["electricity", "India"],
    distributions: [
      { slug: "cea-capacity-web", title: "CEA Capacity Reports", kind: "landing-page", accessURL: "https://cea.nic.in/installed-capacity-report/" },
    ],
  },
  // IMF
  {
    publisherSlug: "imf",
    slug: "imf-fossil-fuel-subsidies",
    title: "IMF Fossil Fuel Subsidies Database",
    description: "Country-level estimates of fossil fuel subsidies including explicit subsidies and implicit subsidies (undercharging for environmental costs).",
    landingPage: "https://www.imf.org/en/Topics/climate-change/energy-subsidies",
    keywords: ["subsidies", "fossil fuels", "IMF", "country-level", "environmental costs"],
    themes: ["subsidies", "fossil fuels", "policy"],
    distributions: [
      { slug: "imf-subsidies-web", title: "IMF Fossil Fuel Subsidies Portal", kind: "interactive-web-app", accessURL: "https://www.imf.org/en/Topics/climate-change/energy-subsidies" },
    ],
  },
  {
    publisherSlug: "imf",
    slug: "imf-climate-data-dashboard",
    title: "IMF Climate Change Dashboard",
    description: "Climate-related economic indicators including carbon pricing, energy transition metrics, and climate finance data.",
    landingPage: "https://climatedata.imf.org/",
    keywords: ["climate", "economic indicators", "carbon pricing", "finance"],
    themes: ["climate", "economics"],
    distributions: [
      { slug: "imf-climate-dashboard", title: "IMF Climate Data Dashboard", kind: "interactive-web-app", accessURL: "https://climatedata.imf.org/" },
    ],
  },
  // METI
  {
    publisherSlug: "meti",
    slug: "meti-energy-statistics",
    title: "METI Energy Supply and Demand Statistics",
    description: "Japan's comprehensive energy supply and demand statistics including production, imports, consumption by sector.",
    landingPage: "https://www.enecho.meti.go.jp/en/statistics/",
    keywords: ["Japan", "energy supply", "demand", "statistics"],
    themes: ["energy", "Japan"],
    distributions: [
      { slug: "meti-stats-web", title: "METI Energy Statistics Portal", kind: "landing-page", accessURL: "https://www.enecho.meti.go.jp/en/statistics/" },
    ],
  },
  // Wood Mackenzie (restricted)
  {
    publisherSlug: "wood-mackenzie",
    slug: "woodmac-lens-power",
    title: "Wood Mackenzie Lens Power & Renewables",
    description: "Global power market analytics including capacity forecasts, generation projections, and technology cost curves.",
    landingPage: "https://www.woodmac.com/lens/power-renewables/",
    keywords: ["power markets", "forecasts", "renewables", "cost curves"],
    themes: ["electricity", "forecasts"],
    accessRights: "restricted",
    distributions: [
      { slug: "woodmac-lens-web", title: "WoodMac Lens Platform", kind: "interactive-web-app", accessURL: "https://www.woodmac.com/lens/power-renewables/" },
    ],
  },
  // Rystad (restricted)
  {
    publisherSlug: "rystad",
    slug: "rystad-energy-cube",
    title: "Rystad Energy UCube / PCube",
    description: "Global upstream and power market analytics platform with asset-level data on oil, gas, and power.",
    landingPage: "https://www.rystadenergy.com/energy-themes/renewables",
    keywords: ["upstream", "power", "asset-level", "oil", "gas", "renewables"],
    themes: ["oil and gas", "power markets"],
    accessRights: "restricted",
    distributions: [
      { slug: "rystad-cube-web", title: "Rystad Energy Platform", kind: "interactive-web-app", accessURL: "https://www.rystadenergy.com/energy-themes/renewables" },
    ],
  },
  // S&P Global (restricted)
  {
    publisherSlug: "sp-global",
    slug: "sp-global-power-assessments",
    title: "S&P Global Commodity Insights Power Assessments",
    description: "Real-time and forward power price assessments, capacity analytics, and energy transition metrics across global markets.",
    landingPage: "https://www.spglobal.com/commodityinsights/en/ci/products/electric-power.html",
    keywords: ["power prices", "assessments", "capacity", "energy transition"],
    themes: ["electricity", "market data", "prices"],
    accessRights: "restricted",
    distributions: [
      { slug: "sp-global-power-web", title: "S&P Global Power Portal", kind: "interactive-web-app", accessURL: "https://www.spglobal.com/commodityinsights/en/ci/products/electric-power.html" },
    ],
  },
  // IPCC
  {
    publisherSlug: "ipcc",
    slug: "ipcc-ar6",
    title: "IPCC Sixth Assessment Report (AR6)",
    description: "Comprehensive assessment of climate change science, impacts, and mitigation pathways. Includes Working Group reports and Synthesis Report.",
    landingPage: "https://www.ipcc.ch/assessment-report/ar6/",
    keywords: ["IPCC", "climate change", "assessment", "mitigation", "scenarios"],
    themes: ["climate", "scenarios"],
    distributions: [
      { slug: "ipcc-ar6-web", title: "IPCC AR6 Reports", kind: "landing-page", accessURL: "https://www.ipcc.ch/assessment-report/ar6/" },
      { slug: "ipcc-ar6-data", title: "IPCC AR6 Data Distribution", kind: "download", accessURL: "https://data.ece.iiasa.ac.at/ar6/" },
    ],
  },
  {
    publisherSlug: "ipcc",
    slug: "ipcc-emission-factor-database",
    title: "IPCC Emission Factor Database (EFDB)",
    description: "Database of greenhouse gas emission factors and other parameters for national GHG inventory estimation.",
    landingPage: "https://www.ipcc-nggip.iges.or.jp/EFDB/main.php",
    keywords: ["emission factors", "GHG inventory", "methodology"],
    themes: ["emissions", "methodology"],
    distributions: [
      { slug: "ipcc-efdb-web", title: "EFDB Web Interface", kind: "interactive-web-app", accessURL: "https://www.ipcc-nggip.iges.or.jp/EFDB/main.php" },
    ],
  },
];

let dsCount = 0, distCount = 0, crCount = 0;

for (const ds of GAP_DATASETS) {
  if (existsSync(join(DATASETS_DIR, `${ds.slug}.json`))) {
    console.log(`  skip: ${ds.slug} (exists)`);
    continue;
  }

  const pubAgentId = entityIds[`Agent:${ds.publisherSlug}`];
  const pubCatalogId = entityIds[`Catalog:${ds.publisherSlug}`];
  if (!pubAgentId || !pubCatalogId) {
    console.error(`  ERROR: ${ds.publisherSlug} agent or catalog not found`);
    continue;
  }

  const datasetId = mintId("dataset", "ds");
  entityIds[`Dataset:${ds.slug}`] = datasetId;

  const distIds: string[] = [];
  for (const dist of ds.distributions) {
    const distId = mintId("distribution", "dist");
    entityIds[`Distribution:${dist.slug}`] = distId;
    distIds.push(distId);

    const distEntity: Record<string, any> = {
      _tag: "Distribution", id: distId, datasetId, kind: dist.kind,
      aliases: [], createdAt: TS, updatedAt: TS,
      title: dist.title, accessURL: dist.accessURL,
    };
    if (dist.format) distEntity.format = dist.format;

    writeEntity(DISTS_DIR, dist.slug, distEntity);
    distCount++;
  }

  const datasetEntity: Record<string, any> = {
    _tag: "Dataset", id: datasetId, title: ds.title,
    publisherAgentId: pubAgentId,
    aliases: [], createdAt: TS, updatedAt: TS,
    description: ds.description,
    distributionIds: distIds,
    keywords: ds.keywords, themes: ds.themes,
  };
  if (ds.landingPage) datasetEntity.landingPage = ds.landingPage;
  if (ds.accessRights) datasetEntity.accessRights = ds.accessRights;
  if (ds.license) datasetEntity.license = ds.license;

  writeEntity(DATASETS_DIR, ds.slug, datasetEntity);
  dsCount++;

  const crId = mintId("catalog-record", "cr");
  entityIds[`CatalogRecord:${ds.slug}-cr`] = crId;
  writeEntity(RECORDS_DIR, `${ds.slug}-cr`, {
    _tag: "CatalogRecord", id: crId,
    catalogId: pubCatalogId,
    primaryTopicType: "dataset", primaryTopicId: datasetId,
  });
  crCount++;

  console.log(`  ${ds.slug}: dataset + ${ds.distributions.length} dist + CR`);
}

// Save entity IDs
writeFileSync(join(ROOT, ".entity-ids.json"), JSON.stringify(entityIds, null, 2) + "\n");

console.log(`\n=== Gap Fill Results ===`);
console.log(`New publishers: ${NEW_PUBLISHERS.length}`);
console.log(`Datasets: ${dsCount}`);
console.log(`Distributions: ${distCount}`);
console.log(`CatalogRecords: ${crCount}`);
