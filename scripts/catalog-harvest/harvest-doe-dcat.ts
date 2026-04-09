/**
 * Curated DOE DCAT harvest — high-value data products only
 *
 * Rather than ingesting the full DOE data.json (483 entries, mostly office
 * webpages and year-specific vintage archives), we curate the ~20 most
 * important DOE data products that energy experts actually reference.
 *
 * These are selected from the DOE data.json probe results plus known
 * DOE national lab programs.
 *
 * Usage: bun scripts/catalog-harvest/harvest-doe-dcat.ts
 *
 * SKY-216: Phase 1 — Catalog deepening
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "..", "references", "cold-start");
const DATASETS_DIR = join(ROOT, "catalog", "datasets");
const DISTS_DIR = join(ROOT, "catalog", "distributions");
const RECORDS_DIR = join(ROOT, "catalog", "catalog-records");
const SERIES_DIR = join(ROOT, "catalog", "dataset-series");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(
  readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"),
);

function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

function agentId(slug: string): string {
  const id = entityIds[`Agent:${slug}`];
  if (!id) throw new Error(`Agent:${slug} not found in entity-ids`);
  return id;
}

function catalogId(slug: string): string {
  const id = entityIds[`Catalog:${slug}`];
  if (!id) throw new Error(`Catalog:${slug} not found in entity-ids`);
  return id;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DistDef {
  slug: string;
  title: string;
  kind: "download" | "api-access" | "landing-page" | "interactive-web-app" | "documentation" | "other";
  accessURL: string;
  downloadURL?: string;
  format?: string;
  mediaType?: string;
}

interface DatasetDef {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  landingPage?: string;
  keywords: string[];
  themes: string[];
  distributions: DistDef[];
  accessRights?: "public" | "restricted";
  license?: string;
  temporal?: string;
}

// ---------------------------------------------------------------------------
// Curated DOE data products
// ---------------------------------------------------------------------------
const DOE_DATASETS: DatasetDef[] = [
  // --- NETL ---
  {
    publisherSlug: "doe",
    slug: "doe-netl-ccs-database",
    title: "NETL Carbon Capture and Storage Database",
    description: "Comprehensive database of active and planned carbon capture, utilization, and storage (CCUS) projects worldwide, maintained by the National Energy Technology Laboratory.",
    landingPage: "https://netl.doe.gov/carbon-management/carbon-storage/worldwide-ccs-database",
    keywords: ["CCS", "CCUS", "carbon capture", "storage", "NETL", "projects"],
    themes: ["carbon capture", "infrastructure"],
    accessRights: "public",
    license: "https://creativecommons.org/licenses/by/4.0",
    distributions: [
      { slug: "doe-netl-ccs-web", title: "NETL CCS Database", kind: "interactive-web-app", accessURL: "https://netl.doe.gov/carbon-management/carbon-storage/worldwide-ccs-database" },
      { slug: "doe-netl-ccs-download", title: "CCS Project Data Export", kind: "download", accessURL: "https://netl.doe.gov/carbon-management/carbon-storage/worldwide-ccs-database", format: "Excel" },
    ],
  },

  // --- NREL wind/solar resource data ---
  {
    publisherSlug: "doe",
    slug: "doe-nsrdb",
    title: "National Solar Radiation Database (NSRDB)",
    description: "Serially complete, 30-minute solar irradiance and meteorological data for the US and growing international coverage. Primary resource for solar energy site assessment.",
    landingPage: "https://nsrdb.nrel.gov/",
    keywords: ["solar radiation", "irradiance", "GHI", "DNI", "NREL", "meteorological"],
    themes: ["solar", "resource assessment"],
    accessRights: "public",
    distributions: [
      { slug: "doe-nsrdb-web", title: "NSRDB Data Viewer", kind: "interactive-web-app", accessURL: "https://nsrdb.nrel.gov/data-viewer" },
      { slug: "doe-nsrdb-api", title: "NSRDB API", kind: "api-access", accessURL: "https://developer.nrel.gov/api/nsrdb/" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-wind-toolkit",
    title: "Wind Integration National Dataset (WIND) Toolkit",
    description: "7-year, 5-minute resolution wind resource dataset covering the continental US at 2km resolution. Produced by NREL for wind integration studies.",
    landingPage: "https://www.nrel.gov/grid/wind-toolkit.html",
    keywords: ["wind resource", "wind speed", "NREL", "integration", "mesoscale"],
    themes: ["wind", "resource assessment"],
    accessRights: "public",
    distributions: [
      { slug: "doe-wind-toolkit-web", title: "WIND Toolkit Data Access", kind: "landing-page", accessURL: "https://www.nrel.gov/grid/wind-toolkit.html" },
      { slug: "doe-wind-toolkit-hsds", title: "WIND Toolkit HSDS Access", kind: "api-access", accessURL: "https://developer.nrel.gov/api/wind-toolkit/" },
    ],
  },

  // --- DOE core energy data ---
  {
    publisherSlug: "doe",
    slug: "doe-electric-power-annual",
    title: "DOE/EIA Electric Power Annual",
    description: "Comprehensive annual data on US electric power industry: generation by fuel type, capacity, consumption, emissions, prices, and utility financials.",
    landingPage: "https://www.eia.gov/electricity/annual/",
    keywords: ["electric power", "generation", "capacity", "annual", "utility"],
    themes: ["electricity", "statistics"],
    accessRights: "public",
    distributions: [
      { slug: "doe-epa-web", title: "Electric Power Annual Interactive Tables", kind: "interactive-web-app", accessURL: "https://www.eia.gov/electricity/annual/" },
      { slug: "doe-epa-download", title: "Electric Power Annual Data Tables", kind: "download", accessURL: "https://www.eia.gov/electricity/annual/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-seds",
    title: "State Energy Data System (SEDS)",
    description: "State-level annual energy production, consumption, prices, and expenditures by source and sector from 1960 to present.",
    landingPage: "https://www.eia.gov/state/seds/",
    keywords: ["state energy", "consumption", "production", "prices", "SEDS"],
    themes: ["energy", "statistics", "state-level"],
    accessRights: "public",
    distributions: [
      { slug: "doe-seds-web", title: "SEDS Data Browser", kind: "interactive-web-app", accessURL: "https://www.eia.gov/state/seds/" },
      { slug: "doe-seds-api", title: "SEDS via EIA API", kind: "api-access", accessURL: "https://api.eia.gov/v2/seds/" },
      { slug: "doe-seds-download", title: "SEDS Complete Data Download", kind: "download", accessURL: "https://www.eia.gov/state/seds/seds-data-complete.php", format: "CSV" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-cbecs",
    title: "Commercial Buildings Energy Consumption Survey (CBECS)",
    description: "National survey of commercial building characteristics and energy usage patterns, conducted approximately every 4 years.",
    landingPage: "https://www.eia.gov/consumption/commercial/",
    keywords: ["commercial buildings", "energy consumption", "survey", "CBECS", "building stock"],
    themes: ["buildings", "energy consumption"],
    accessRights: "public",
    distributions: [
      { slug: "doe-cbecs-web", title: "CBECS Survey Data", kind: "interactive-web-app", accessURL: "https://www.eia.gov/consumption/commercial/" },
      { slug: "doe-cbecs-download", title: "CBECS Microdata", kind: "download", accessURL: "https://www.eia.gov/consumption/commercial/data/", format: "CSV" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-recs",
    title: "Residential Energy Consumption Survey (RECS)",
    description: "National survey of residential energy characteristics and consumption patterns including heating, cooling, and appliance usage.",
    landingPage: "https://www.eia.gov/consumption/residential/",
    keywords: ["residential", "energy consumption", "survey", "RECS", "households"],
    themes: ["buildings", "energy consumption"],
    accessRights: "public",
    distributions: [
      { slug: "doe-recs-web", title: "RECS Survey Data", kind: "interactive-web-app", accessURL: "https://www.eia.gov/consumption/residential/" },
      { slug: "doe-recs-download", title: "RECS Microdata", kind: "download", accessURL: "https://www.eia.gov/consumption/residential/data/", format: "CSV" },
    ],
  },

  // --- DOE lab programs ---
  {
    publisherSlug: "doe",
    slug: "doe-alternative-fuel-stations",
    title: "Alternative Fuels Station Locator",
    description: "Location and characteristics of alternative fuel stations in the US: EV charging, hydrogen, CNG, LPG, biodiesel, and E85.",
    landingPage: "https://afdc.energy.gov/stations",
    keywords: ["alternative fuel", "EV charging", "hydrogen", "CNG", "stations"],
    themes: ["transportation", "alternative fuels"],
    accessRights: "public",
    distributions: [
      { slug: "doe-afdc-web", title: "Station Locator Map", kind: "interactive-web-app", accessURL: "https://afdc.energy.gov/stations" },
      { slug: "doe-afdc-api", title: "AFDC API", kind: "api-access", accessURL: "https://developer.nrel.gov/api/alt-fuel-stations/" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-energy-mapping-system",
    title: "US Energy Mapping System",
    description: "Interactive GIS platform showing US energy infrastructure: power plants, pipelines, refineries, transmission lines, and energy resources.",
    landingPage: "https://www.eia.gov/state/maps.php",
    keywords: ["GIS", "mapping", "infrastructure", "power plants", "pipelines"],
    themes: ["infrastructure", "geospatial"],
    accessRights: "public",
    distributions: [
      { slug: "doe-ems-web", title: "Energy Mapping System", kind: "interactive-web-app", accessURL: "https://www.eia.gov/state/maps.php" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-locus",
    title: "DOE LOCUS (Loans and Grants)",
    description: "Database of DOE loans, loan guarantees, and grants for clean energy projects under the Loan Programs Office (LPO).",
    landingPage: "https://www.energy.gov/lpo/portfolio-projects",
    keywords: ["loans", "grants", "LPO", "clean energy", "financing"],
    themes: ["financing", "clean energy"],
    accessRights: "public",
    distributions: [
      { slug: "doe-locus-web", title: "LPO Portfolio Projects", kind: "interactive-web-app", accessURL: "https://www.energy.gov/lpo/portfolio-projects" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-liquids-pipelines",
    title: "DOE Liquids Pipeline Projects Database",
    description: "Database tracking proposed and active oil and petroleum liquids pipeline projects in the US, including capacity, status, and routing.",
    landingPage: "https://www.eia.gov/naturalgas/pipelines/EIA-PipelineProjects.php",
    keywords: ["pipelines", "oil", "petroleum", "infrastructure", "projects"],
    themes: ["oil and gas", "infrastructure"],
    accessRights: "public",
    distributions: [
      { slug: "doe-pipelines-web", title: "Pipeline Projects Map", kind: "interactive-web-app", accessURL: "https://www.eia.gov/naturalgas/pipelines/EIA-PipelineProjects.php" },
    ],
  },

  // --- NREL specialized ---
  {
    publisherSlug: "doe",
    slug: "doe-pumped-storage-data",
    title: "Pumped Storage Hydropower Resource Assessment",
    description: "National assessment of closed-loop pumped storage hydropower potential, including site identification, capacity estimates, and cost data.",
    landingPage: "https://www.nrel.gov/water/pumped-storage-hydropower.html",
    keywords: ["pumped storage", "hydropower", "energy storage", "NREL", "resource assessment"],
    themes: ["storage", "hydropower"],
    accessRights: "public",
    distributions: [
      { slug: "doe-psh-web", title: "Pumped Storage Data", kind: "landing-page", accessURL: "https://www.nrel.gov/water/pumped-storage-hydropower.html" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-biomethane-resources",
    title: "US Biomethane Resources by County",
    description: "County-level assessment of biomethane production potential from landfill gas, animal manure, wastewater treatment, and agricultural residues.",
    landingPage: "https://data.openei.org/",
    keywords: ["biomethane", "biogas", "landfill", "renewable natural gas", "county-level"],
    themes: ["bioenergy", "resource assessment"],
    accessRights: "public",
    distributions: [
      { slug: "doe-biomethane-download", title: "Biomethane Resources Dataset", kind: "download", accessURL: "https://data.openei.org/", format: "CSV" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-geothermal-favorability",
    title: "Enhanced Geothermal Systems Favorability Map",
    description: "National assessment of deep enhanced geothermal system (EGS) resource potential based on thermal gradient, rock type, and depth data.",
    landingPage: "https://www.nrel.gov/gis/geothermal.html",
    keywords: ["geothermal", "EGS", "resource assessment", "thermal gradient", "NREL"],
    themes: ["geothermal", "resource assessment"],
    accessRights: "public",
    distributions: [
      { slug: "doe-geothermal-web", title: "Geothermal Resource Maps", kind: "interactive-web-app", accessURL: "https://www.nrel.gov/gis/geothermal.html" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-wave-energy-resource",
    title: "Marine and Hydrokinetic Wave Energy Resource Atlas",
    description: "High-resolution hindcast data for US wave energy resources including wave power density, significant height, and energy period.",
    landingPage: "https://www.nrel.gov/water/wave-energy.html",
    keywords: ["wave energy", "marine", "hydrokinetic", "resource assessment", "ocean"],
    themes: ["marine energy", "resource assessment"],
    accessRights: "public",
    distributions: [
      { slug: "doe-wave-web", title: "Wave Energy Resource Data", kind: "landing-page", accessURL: "https://www.nrel.gov/water/wave-energy.html" },
    ],
  },

  // --- DOE Pages / OSTI ---
  {
    publisherSlug: "doe",
    slug: "doe-osti-pages",
    title: "DOE PAGES (Public Access Gateway for Energy & Science)",
    description: "Full-text access to DOE-funded scholarly publications. Over 1 million peer-reviewed journal articles and accepted manuscripts.",
    landingPage: "https://www.osti.gov/pages/",
    keywords: ["publications", "open access", "research", "OSTI", "scholarly"],
    themes: ["research", "publications"],
    accessRights: "public",
    distributions: [
      { slug: "doe-osti-web", title: "DOE PAGES Search", kind: "interactive-web-app", accessURL: "https://www.osti.gov/pages/" },
      { slug: "doe-osti-api", title: "OSTI API", kind: "api-access", accessURL: "https://www.osti.gov/api/" },
    ],
  },

  // --- Tight oil & shale gas ---
  {
    publisherSlug: "doe",
    slug: "doe-tight-oil-production",
    title: "Tight Oil Production Estimates by Play",
    description: "Monthly estimates of tight oil production from major US shale plays: Permian, Bakken, Eagle Ford, Niobrara, and others.",
    landingPage: "https://www.eia.gov/petroleum/drilling/",
    keywords: ["tight oil", "shale", "Permian", "Bakken", "production estimates"],
    themes: ["oil and gas", "upstream"],
    accessRights: "public",
    distributions: [
      { slug: "doe-tight-oil-web", title: "Drilling Productivity Report", kind: "interactive-web-app", accessURL: "https://www.eia.gov/petroleum/drilling/" },
      { slug: "doe-tight-oil-download", title: "Tight Oil Data Download", kind: "download", accessURL: "https://www.eia.gov/petroleum/drilling/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-shale-gas-production",
    title: "Dry Shale Gas Production Estimates by Play",
    description: "Monthly estimates of dry shale gas production from major US plays: Marcellus, Haynesville, Permian, Utica, and others.",
    landingPage: "https://www.eia.gov/naturalgas/drilling/",
    keywords: ["shale gas", "Marcellus", "Haynesville", "production estimates", "dry gas"],
    themes: ["oil and gas", "upstream"],
    accessRights: "public",
    distributions: [
      { slug: "doe-shale-gas-web", title: "Natural Gas Drilling Productivity", kind: "interactive-web-app", accessURL: "https://www.eia.gov/naturalgas/drilling/" },
      { slug: "doe-shale-gas-download", title: "Shale Gas Data Download", kind: "download", accessURL: "https://www.eia.gov/naturalgas/drilling/", format: "Excel" },
    ],
  },

  // --- ARPA-E ---
  {
    publisherSlug: "doe",
    slug: "doe-arpa-e-projects",
    title: "ARPA-E Funded Projects Database",
    description: "Database of all ARPA-E funded projects: advanced energy technologies including grid storage, power electronics, carbon capture, and fusion.",
    landingPage: "https://arpa-e.energy.gov/technologies/projects",
    keywords: ["ARPA-E", "advanced energy", "research", "projects", "innovation"],
    themes: ["research", "innovation"],
    accessRights: "public",
    distributions: [
      { slug: "doe-arpa-e-web", title: "ARPA-E Projects Explorer", kind: "interactive-web-app", accessURL: "https://arpa-e.energy.gov/technologies/projects" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Write entities
// ---------------------------------------------------------------------------
mkdirSync(DATASETS_DIR, { recursive: true });
mkdirSync(DISTS_DIR, { recursive: true });
mkdirSync(RECORDS_DIR, { recursive: true });

let dsCount = 0, distCount = 0, crCount = 0;
const doeAgentId = agentId("doe");
const doeCatalogId = catalogId("doe");

for (const ds of DOE_DATASETS) {
  if (existsSync(join(DATASETS_DIR, `${ds.slug}.json`))) {
    console.log(`  skip: ${ds.slug} (exists)`);
    continue;
  }

  const datasetId = mintId("dataset", "ds");
  entityIds[`Dataset:${ds.slug}`] = datasetId;

  // Create distributions
  const distIds: string[] = [];

  for (const dist of ds.distributions) {
    const distId = mintId("distribution", "dist");
    entityIds[`Distribution:${dist.slug}`] = distId;
    distIds.push(distId);

    const distEntity: Record<string, any> = {
      _tag: "Distribution",
      id: distId,
      datasetId,
      kind: dist.kind,
      aliases: [],
      createdAt: TS,
      updatedAt: TS,
      title: dist.title,
      accessURL: dist.accessURL,
    };
    if (dist.downloadURL) distEntity.downloadURL = dist.downloadURL;
    if (dist.format) distEntity.format = dist.format;
    if (dist.mediaType) distEntity.mediaType = dist.mediaType;

    writeFileSync(
      join(DISTS_DIR, `${dist.slug}.json`),
      JSON.stringify(distEntity, null, 2) + "\n",
    );
    distCount++;
  }

  // Create dataset
  const datasetEntity: Record<string, any> = {
    _tag: "Dataset",
    id: datasetId,
    title: ds.title,
    publisherAgentId: doeAgentId,
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
    description: ds.description,
    distributionIds: distIds,
    keywords: ds.keywords,
    themes: ds.themes,
  };
  if (ds.landingPage) datasetEntity.landingPage = ds.landingPage;
  if (ds.accessRights) datasetEntity.accessRights = ds.accessRights;
  if (ds.license) datasetEntity.license = ds.license;
  if (ds.temporal) datasetEntity.temporal = ds.temporal;

  writeFileSync(
    join(DATASETS_DIR, `${ds.slug}.json`),
    JSON.stringify(datasetEntity, null, 2) + "\n",
  );
  dsCount++;

  // Create catalog record
  const crId = mintId("catalog-record", "cr");
  entityIds[`CatalogRecord:${ds.slug}-cr`] = crId;

  const crEntity: Record<string, any> = {
    _tag: "CatalogRecord",
    id: crId,
    catalogId: doeCatalogId,
    primaryTopicType: "dataset",
    primaryTopicId: datasetId,
    isAuthoritative: true,
  };

  writeFileSync(
    join(RECORDS_DIR, `${ds.slug}-cr.json`),
    JSON.stringify(crEntity, null, 2) + "\n",
  );
  crCount++;

  console.log(`  ${ds.slug}: dataset + ${ds.distributions.length} dist + CR`);
}

// Save entity IDs
writeFileSync(
  join(ROOT, ".entity-ids.json"),
  JSON.stringify(entityIds, null, 2) + "\n",
);

console.log(`\n=== DOE Curated Harvest Results ===`);
console.log(`Datasets: ${dsCount}`);
console.log(`Distributions: ${distCount}`);
console.log(`CatalogRecords: ${crCount}`);
