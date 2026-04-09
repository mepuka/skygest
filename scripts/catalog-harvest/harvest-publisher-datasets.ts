/**
 * Hand-curated Dataset + Distribution + CatalogRecord entities for
 * non-EIA publishers added in the SKY-216 backfill.
 *
 * Each publisher's key public data products are defined here. Focus is
 * on datasets that energy experts cite in posts — the matching targets
 * for the resolver lanes.
 *
 * Usage: bun scripts/catalog-harvest/harvest-publisher-datasets.ts
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
const SERVICES_DIR = join(ROOT, "catalog", "data-services");
const SERIES_DIR = join(ROOT, "catalog", "dataset-series");
const TS = "2026-04-08T00:00:00.000Z";

const entityIds: Record<string, string> = JSON.parse(readFileSync(join(ROOT, ".entity-ids.json"), "utf-8"));

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
// Helpers
// ---------------------------------------------------------------------------
function mintId(kind: string, prefix: string): string {
  return `https://id.skygest.io/${kind}/${prefix}_${ulid()}`;
}

interface DistDef {
  slug: string;
  title: string;
  kind: "download" | "api-access" | "landing-page" | "interactive-web-app" | "documentation" | "other";
  accessURL: string;
  downloadURL?: string;
  format?: string;
  mediaType?: string;
  dataServiceSlug?: string; // links to a DataService
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
  dataServiceSlug?: string;
  aliases?: Array<{ scheme: string; value: string; relation: string }>;
}

interface DataServiceDef {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  endpointURLs: string[];
  endpointDescription?: string;
  conformsTo?: string;
}

interface DatasetSeriesDef {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  cadence: "annual" | "quarterly" | "monthly" | "weekly" | "daily" | "irregular";
}

// ---------------------------------------------------------------------------
// Publisher dataset definitions
// ---------------------------------------------------------------------------

const DATA_SERVICES: DataServiceDef[] = [
  {
    publisherSlug: "gridstatus",
    slug: "gridstatus-api",
    title: "GridStatus API",
    description: "Unified API for US ISO/RTO grid data",
    endpointURLs: ["https://api.gridstatus.io/v1/"],
    endpointDescription: "https://docs.gridstatus.io/",
    conformsTo: "GridStatus REST API",
  },
  {
    publisherSlug: "owid",
    slug: "owid-github",
    title: "Our World in Data GitHub",
    description: "Open datasets published via GitHub repositories",
    endpointURLs: ["https://github.com/owid/"],
    conformsTo: "GitHub CSV repositories",
  },
];

const DATASET_SERIES: DatasetSeriesDef[] = [
  { publisherSlug: "agora", slug: "agora-energiewende-analysis", title: "Agora Energiewende Annual Analysis", description: "Annual analysis of German energy transition progress", cadence: "annual" },
  { publisherSlug: "gcp", slug: "gcp-global-carbon-budget", title: "Global Carbon Budget", description: "Annual assessment of global CO2 sources and sinks", cadence: "annual" },
  { publisherSlug: "gem", slug: "gem-tracker-updates", title: "Global Energy Monitor Tracker Updates", description: "Semi-annual updates to fossil fuel and clean energy infrastructure trackers", cadence: "irregular" },
];

const DATASETS: DatasetDef[] = [
  // ===== Grid operators / ISOs =====
  {
    publisherSlug: "miso",
    slug: "miso-market-data",
    title: "MISO Market and Operations Data",
    description: "Real-time and historical market data including LMPs, generation mix, load, and interchange for the MISO footprint.",
    landingPage: "https://www.misoenergy.org/markets-and-operations/",
    keywords: ["LMP", "generation", "load", "interchange", "real-time"],
    themes: ["electricity", "grid operations", "market data"],
    distributions: [
      { slug: "miso-market-web", title: "MISO Market Dashboard", kind: "interactive-web-app", accessURL: "https://www.misoenergy.org/markets-and-operations/real-time-displays/" },
      { slug: "miso-market-reports", title: "MISO Market Reports", kind: "download", accessURL: "https://www.misoenergy.org/markets-and-operations/market-reports/", format: "CSV/Excel" },
    ],
  },
  {
    publisherSlug: "nyiso",
    slug: "nyiso-market-data",
    title: "NYISO Market and Operations Data",
    description: "New York ISO real-time and day-ahead market data including LMPs, load, and generation.",
    landingPage: "https://www.nyiso.com/energy-market-operational-data",
    keywords: ["LMP", "generation", "load", "New York"],
    themes: ["electricity", "grid operations", "market data"],
    distributions: [
      { slug: "nyiso-dashboard", title: "NYISO Dashboard", kind: "interactive-web-app", accessURL: "https://www.nyiso.com/real-time-dashboard" },
      { slug: "nyiso-reports", title: "NYISO Custom Reports", kind: "download", accessURL: "https://www.nyiso.com/custom-report", format: "CSV" },
    ],
  },
  {
    publisherSlug: "iso-ne",
    slug: "iso-ne-market-data",
    title: "ISO New England Market and Operations Data",
    description: "ISO-NE real-time and historical data including LMPs, load, generation, and fuel mix.",
    landingPage: "https://www.iso-ne.com/isoexpress/",
    keywords: ["LMP", "generation", "load", "fuel mix", "New England"],
    themes: ["electricity", "grid operations", "market data"],
    distributions: [
      { slug: "iso-ne-express", title: "ISO Express Dashboard", kind: "interactive-web-app", accessURL: "https://www.iso-ne.com/isoexpress/" },
      { slug: "iso-ne-webservices", title: "ISO-NE Web Services", kind: "api-access", accessURL: "https://webservices.iso-ne.com/" },
    ],
  },
  {
    publisherSlug: "aemo",
    slug: "aemo-nem-data",
    title: "AEMO National Electricity Market Data",
    description: "Australian NEM dispatch, pricing, generation, and demand data.",
    landingPage: "https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem",
    keywords: ["NEM", "dispatch", "generation", "demand", "Australia"],
    themes: ["electricity", "grid operations"],
    distributions: [
      { slug: "aemo-nem-dashboard", title: "AEMO NEM Dashboard", kind: "interactive-web-app", accessURL: "https://aemo.com.au/aemo/apps/visualisations/elec-nem-current.html" },
      { slug: "aemo-nem-reports", title: "AEMO Data Downloads", kind: "download", accessURL: "https://nemweb.com.au/", format: "CSV" },
    ],
  },
  {
    publisherSlug: "rte",
    slug: "rte-eco2mix",
    title: "RTE éCO2mix",
    description: "French electricity generation mix, consumption, exchanges, and CO2 emissions in real-time.",
    landingPage: "https://www.rte-france.com/eco2mix",
    keywords: ["generation mix", "consumption", "CO2", "France", "real-time"],
    themes: ["electricity", "emissions", "grid operations"],
    distributions: [
      { slug: "rte-eco2mix-web", title: "éCO2mix Dashboard", kind: "interactive-web-app", accessURL: "https://www.rte-france.com/eco2mix/les-donnees-en-energie" },
      { slug: "rte-eco2mix-download", title: "éCO2mix Data Downloads", kind: "download", accessURL: "https://www.rte-france.com/eco2mix/telecharger-les-indicateurs", format: "CSV/Excel" },
    ],
  },
  {
    publisherSlug: "terna",
    slug: "terna-transparency-report",
    title: "Terna Transparency Report",
    description: "Italian electricity system data including generation, demand, exchanges, and installed capacity.",
    landingPage: "https://www.terna.it/en/electric-system/transparency-report",
    keywords: ["generation", "demand", "capacity", "Italy", "transparency"],
    themes: ["electricity", "grid operations"],
    distributions: [
      { slug: "terna-transparency-web", title: "Terna Transparency Dashboard", kind: "interactive-web-app", accessURL: "https://www.terna.it/en/electric-system/transparency-report" },
      { slug: "terna-downloads", title: "Terna Statistical Data", kind: "download", accessURL: "https://www.terna.it/en/electric-system/statistical-data-forecast/statistical-publications", format: "Excel" },
    ],
  },
  {
    publisherSlug: "ree",
    slug: "ree-esios",
    title: "REE e·sios / ESIOS",
    description: "Spanish electricity system indicators including generation, demand, prices, and exchanges.",
    landingPage: "https://www.esios.ree.es/en",
    keywords: ["generation", "demand", "prices", "Spain", "indicators"],
    themes: ["electricity", "grid operations", "market data"],
    distributions: [
      { slug: "ree-esios-web", title: "ESIOS Dashboard", kind: "interactive-web-app", accessURL: "https://www.esios.ree.es/en" },
      { slug: "ree-esios-api", title: "ESIOS API", kind: "api-access", accessURL: "https://api.esios.ree.es/" },
    ],
  },
  {
    publisherSlug: "nerc",
    slug: "nerc-reliability-assessments",
    title: "NERC Reliability Assessments",
    description: "Long-term and seasonal reliability assessments of the North American bulk power system.",
    landingPage: "https://www.nerc.com/pa/RAPA/ra/Pages/default.aspx",
    keywords: ["reliability", "assessment", "bulk power system", "capacity"],
    themes: ["electricity", "reliability"],
    distributions: [
      { slug: "nerc-assessments-web", title: "NERC Assessment Reports", kind: "landing-page", accessURL: "https://www.nerc.com/pa/RAPA/ra/Pages/default.aspx" },
    ],
  },

  // ===== Research / NGOs =====
  {
    publisherSlug: "owid",
    slug: "owid-energy-data",
    title: "Our World in Data — Energy",
    description: "Global energy dataset covering consumption, production, mix, and per-capita metrics for 200+ countries. Sources: Energy Institute, EIA, Ember.",
    landingPage: "https://ourworldindata.org/energy",
    keywords: ["energy", "global", "consumption", "production", "per capita"],
    themes: ["energy", "global"],
    distributions: [
      { slug: "owid-energy-github", title: "OWID Energy Data (GitHub)", kind: "download", accessURL: "https://github.com/owid/energy-data", downloadURL: "https://raw.githubusercontent.com/owid/energy-data/master/owid-energy-data.csv", format: "CSV", dataServiceSlug: "owid-github" },
      { slug: "owid-energy-web", title: "OWID Energy Explorer", kind: "interactive-web-app", accessURL: "https://ourworldindata.org/explorers/energy" },
    ],
  },
  {
    publisherSlug: "owid",
    slug: "owid-co2-data",
    title: "Our World in Data — CO2 and Greenhouse Gas Emissions",
    description: "Global CO2 and GHG emissions dataset covering emissions by fuel, sector, and country. Sources: Global Carbon Project, CAIT.",
    landingPage: "https://ourworldindata.org/co2-and-greenhouse-gas-emissions",
    keywords: ["CO2", "emissions", "greenhouse gas", "global", "per capita"],
    themes: ["emissions", "global"],
    distributions: [
      { slug: "owid-co2-github", title: "OWID CO2 Data (GitHub)", kind: "download", accessURL: "https://github.com/owid/co2-data", downloadURL: "https://raw.githubusercontent.com/owid/co2-data/master/owid-co2-data.csv", format: "CSV", dataServiceSlug: "owid-github" },
    ],
  },
  {
    publisherSlug: "climate-trace",
    slug: "climate-trace-inventory",
    title: "Climate TRACE Global Emissions Inventory",
    description: "Independent, facility-level global greenhouse gas emissions inventory using satellite and remote sensing data.",
    landingPage: "https://climatetrace.org/inventory",
    keywords: ["emissions", "facility-level", "satellite", "inventory", "global"],
    themes: ["emissions", "satellite"],
    distributions: [
      { slug: "climate-trace-explorer", title: "Climate TRACE Explorer", kind: "interactive-web-app", accessURL: "https://climatetrace.org/explore" },
      { slug: "climate-trace-download", title: "Climate TRACE Data Download", kind: "download", accessURL: "https://climatetrace.org/downloads", format: "CSV" },
    ],
  },
  {
    publisherSlug: "gcp",
    slug: "gcp-global-carbon-budget-dataset",
    title: "Global Carbon Budget",
    description: "Annual dataset quantifying global CO2 emissions from fossil fuels, land-use change, and the ocean and land carbon sinks.",
    landingPage: "https://www.globalcarbonproject.org/carbonbudget/",
    keywords: ["carbon budget", "CO2", "emissions", "fossil fuels", "land use", "carbon sinks"],
    themes: ["emissions", "carbon cycle"],
    distributions: [
      { slug: "gcp-budget-download", title: "Global Carbon Budget Data", kind: "download", accessURL: "https://www.globalcarbonproject.org/carbonbudget/archive.htm", format: "Excel" },
    ],
  },
  {
    publisherSlug: "gem",
    slug: "gem-global-coal-plant-tracker",
    title: "Global Coal Plant Tracker",
    description: "Comprehensive database of every known coal-fired generating unit worldwide, with capacity, status, and ownership.",
    landingPage: "https://globalenergymonitor.org/projects/global-coal-plant-tracker/",
    keywords: ["coal", "power plants", "capacity", "tracker", "global"],
    themes: ["coal", "infrastructure"],
    distributions: [
      { slug: "gem-coal-download", title: "Global Coal Plant Tracker Download", kind: "download", accessURL: "https://globalenergymonitor.org/projects/global-coal-plant-tracker/download-data/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "gem",
    slug: "gem-global-solar-power-tracker",
    title: "Global Solar Power Tracker",
    description: "Database of utility-scale solar power projects worldwide with capacity, status, and location.",
    landingPage: "https://globalenergymonitor.org/projects/global-solar-power-tracker/",
    keywords: ["solar", "power plants", "capacity", "tracker", "global"],
    themes: ["solar", "infrastructure"],
    distributions: [
      { slug: "gem-solar-download", title: "Global Solar Power Tracker Download", kind: "download", accessURL: "https://globalenergymonitor.org/projects/global-solar-power-tracker/download-data/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "gem",
    slug: "gem-global-wind-power-tracker",
    title: "Global Wind Power Tracker",
    description: "Database of utility-scale wind power projects worldwide with capacity, status, and location.",
    landingPage: "https://globalenergymonitor.org/projects/global-wind-power-tracker/",
    keywords: ["wind", "power plants", "capacity", "tracker", "global"],
    themes: ["wind", "infrastructure"],
    distributions: [
      { slug: "gem-wind-download", title: "Global Wind Power Tracker Download", kind: "download", accessURL: "https://globalenergymonitor.org/projects/global-wind-power-tracker/download-data/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "agora",
    slug: "agora-agorameter",
    title: "Agorameter",
    description: "Real-time and historical German electricity generation, consumption, and prices dashboard.",
    landingPage: "https://www.agora-energiewende.de/en/publications/agorameter/",
    keywords: ["Germany", "electricity", "generation", "prices", "real-time"],
    themes: ["electricity", "grid operations"],
    distributions: [
      { slug: "agora-agorameter-web", title: "Agorameter Dashboard", kind: "interactive-web-app", accessURL: "https://www.agora-energiewende.de/daten-tools/agorameter/" },
    ],
  },
  {
    publisherSlug: "gridstatus",
    slug: "gridstatus-us-grid",
    title: "GridStatus US Grid Data",
    description: "Unified access to real-time and historical data from US ISOs/RTOs: CAISO, ERCOT, MISO, PJM, NYISO, ISO-NE, SPP.",
    landingPage: "https://www.gridstatus.io/",
    keywords: ["grid", "ISO", "RTO", "LMP", "generation", "demand", "real-time"],
    themes: ["electricity", "grid operations"],
    distributions: [
      { slug: "gridstatus-web", title: "GridStatus Dashboard", kind: "interactive-web-app", accessURL: "https://www.gridstatus.io/" },
      { slug: "gridstatus-api-access", title: "GridStatus API", kind: "api-access", accessURL: "https://api.gridstatus.io/v1/", dataServiceSlug: "gridstatus-api" },
      { slug: "gridstatus-python", title: "GridStatus Python Package", kind: "other", accessURL: "https://github.com/gridstatus/gridstatus" },
    ],
  },

  // ===== Government agencies =====
  {
    publisherSlug: "epa",
    slug: "epa-egrid",
    title: "EPA eGRID",
    description: "Emissions & Generation Resource Integrated Database: comprehensive source of data on environmental characteristics of electric power in the US.",
    landingPage: "https://www.epa.gov/egrid",
    keywords: ["emissions", "generation", "power plants", "eGRID", "environmental"],
    themes: ["emissions", "electricity"],
    distributions: [
      { slug: "epa-egrid-download", title: "eGRID Data Download", kind: "download", accessURL: "https://www.epa.gov/egrid/download-data", format: "Excel" },
    ],
  },
  {
    publisherSlug: "epa",
    slug: "epa-ghg-inventory",
    title: "EPA Greenhouse Gas Inventory",
    description: "Annual US greenhouse gas emissions and sinks inventory, reported to UNFCCC.",
    landingPage: "https://www.epa.gov/ghgemissions/inventory-us-greenhouse-gas-emissions-and-sinks",
    keywords: ["greenhouse gas", "inventory", "emissions", "sinks", "annual"],
    themes: ["emissions"],
    distributions: [
      { slug: "epa-ghg-web", title: "GHG Inventory Reports", kind: "landing-page", accessURL: "https://www.epa.gov/ghgemissions/inventory-us-greenhouse-gas-emissions-and-sinks" },
    ],
  },
  {
    publisherSlug: "eurostat",
    slug: "eurostat-energy-statistics",
    title: "Eurostat Energy Statistics",
    description: "Comprehensive European energy statistics including supply, transformation, consumption by fuel and sector.",
    landingPage: "https://ec.europa.eu/eurostat/web/energy/overview",
    keywords: ["energy", "Europe", "supply", "consumption", "EU"],
    themes: ["energy", "European"],
    distributions: [
      { slug: "eurostat-energy-web", title: "Eurostat Energy Data Browser", kind: "interactive-web-app", accessURL: "https://ec.europa.eu/eurostat/databrowser/explore/all/envir?lang=en&subtheme=nrg&display=list" },
      { slug: "eurostat-energy-api", title: "Eurostat API", kind: "api-access", accessURL: "https://ec.europa.eu/eurostat/api/dissemination/" },
    ],
  },
  {
    publisherSlug: "bnetza",
    slug: "bnetza-smard",
    title: "SMARD Strommarktdaten",
    description: "German electricity market data platform: generation, consumption, market prices, and cross-border flows.",
    landingPage: "https://www.smard.de/en",
    keywords: ["Germany", "electricity", "market", "generation", "prices"],
    themes: ["electricity", "market data"],
    distributions: [
      { slug: "bnetza-smard-web", title: "SMARD Dashboard", kind: "interactive-web-app", accessURL: "https://www.smard.de/en" },
      { slug: "bnetza-smard-download", title: "SMARD Data Downloads", kind: "download", accessURL: "https://www.smard.de/en/downloadcenter", format: "CSV" },
    ],
  },
  {
    publisherSlug: "doe",
    slug: "doe-oedi",
    title: "Open Energy Data Initiative (OEDI)",
    description: "DOE's centralized repository for energy research data including solar, wind, geothermal, and grid datasets.",
    landingPage: "https://data.openei.org/",
    keywords: ["open data", "energy research", "solar", "wind", "geothermal"],
    themes: ["energy research", "open data"],
    distributions: [
      { slug: "doe-oedi-catalog", title: "OEDI Data Catalog", kind: "interactive-web-app", accessURL: "https://data.openei.org/" },
    ],
  },
  {
    publisherSlug: "beis",
    slug: "desnz-energy-statistics",
    title: "UK Energy Statistics (DUKES & Energy Trends)",
    description: "Digest of UK Energy Statistics and quarterly Energy Trends: comprehensive UK energy production, consumption, and prices.",
    landingPage: "https://www.gov.uk/government/collections/digest-of-uk-energy-statistics-dukes",
    keywords: ["UK", "energy", "DUKES", "production", "consumption", "prices"],
    themes: ["energy", "UK"],
    distributions: [
      { slug: "desnz-dukes-download", title: "DUKES Downloads", kind: "download", accessURL: "https://www.gov.uk/government/collections/digest-of-uk-energy-statistics-dukes", format: "Excel/ODS" },
    ],
  },

  // ===== International orgs =====
  {
    publisherSlug: "world-bank",
    slug: "world-bank-energy-data",
    title: "World Bank Energy & Mining Data",
    description: "World Development Indicators related to energy: access, consumption, production, renewable share, and emissions.",
    landingPage: "https://data.worldbank.org/topic/energy-and-mining",
    keywords: ["energy access", "consumption", "renewable share", "development", "global"],
    themes: ["energy", "development"],
    distributions: [
      { slug: "world-bank-energy-web", title: "World Bank Data Portal", kind: "interactive-web-app", accessURL: "https://data.worldbank.org/topic/energy-and-mining" },
      { slug: "world-bank-energy-api", title: "World Bank API", kind: "api-access", accessURL: "https://api.worldbank.org/v2/" },
    ],
  },
  {
    publisherSlug: "iiasa",
    slug: "iiasa-scenario-explorer",
    title: "IIASA Scenario Explorer",
    description: "Interactive platform hosting IPCC and other integrated assessment model scenarios (AR6, SSP, NGFS).",
    landingPage: "https://data.ece.iiasa.ac.at/",
    keywords: ["scenarios", "IPCC", "IAM", "SSP", "climate pathways"],
    themes: ["scenarios", "climate"],
    distributions: [
      { slug: "iiasa-explorer-web", title: "Scenario Explorer Web", kind: "interactive-web-app", accessURL: "https://data.ece.iiasa.ac.at/" },
      { slug: "iiasa-explorer-api", title: "Scenario Explorer API", kind: "api-access", accessURL: "https://data.ece.iiasa.ac.at/api/" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Write entities
// ---------------------------------------------------------------------------
mkdirSync(DISTS_DIR, { recursive: true });
mkdirSync(RECORDS_DIR, { recursive: true });
mkdirSync(SERVICES_DIR, { recursive: true });
mkdirSync(SERIES_DIR, { recursive: true });

let dsCount = 0, distCount = 0, crCount = 0, svcCount = 0, dserCount = 0;

// DataServices first (referenced by Distributions)
for (const svc of DATA_SERVICES) {
  if (existsSync(join(SERVICES_DIR, `${svc.slug}.json`))) continue;

  const svcId = mintId("data-service", "svc");
  entityIds[`DataService:${svc.slug}`] = svcId;

  const entity: Record<string, any> = {
    _tag: "DataService",
    id: svcId,
    title: svc.title,
    description: svc.description,
    publisherAgentId: agentId(svc.publisherSlug),
    endpointURLs: svc.endpointURLs,
    servesDatasetIds: [], // will be populated below
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
  };
  if (svc.endpointDescription) entity.endpointDescription = svc.endpointDescription;
  if (svc.conformsTo) entity.conformsTo = svc.conformsTo;

  writeFileSync(join(SERVICES_DIR, `${svc.slug}.json`), JSON.stringify(entity, null, 2) + "\n");
  console.log(`  DataService: ${svc.slug}`);
  svcCount++;
}

// DatasetSeries
for (const dser of DATASET_SERIES) {
  if (existsSync(join(SERIES_DIR, `${dser.slug}.json`))) continue;

  const dserId = mintId("dataset-series", "dser");
  entityIds[`DatasetSeries:${dser.slug}`] = dserId;

  const entity = {
    _tag: "DatasetSeries",
    id: dserId,
    title: dser.title,
    description: dser.description,
    publisherAgentId: agentId(dser.publisherSlug),
    cadence: dser.cadence,
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
  };

  writeFileSync(join(SERIES_DIR, `${dser.slug}.json`), JSON.stringify(entity, null, 2) + "\n");
  console.log(`  DatasetSeries: ${dser.slug}`);
  dserCount++;
}

// Datasets + Distributions + CatalogRecords
const serviceDatasetMap = new Map<string, string[]>(); // service slug -> dataset ids

for (const ds of DATASETS) {
  if (existsSync(join(DATASETS_DIR, `${ds.slug}.json`))) {
    console.log(`  skip: ${ds.slug} (exists)`);
    continue;
  }

  const datasetId = mintId("dataset", "ds");
  entityIds[`Dataset:${ds.slug}`] = datasetId;

  // Create distributions
  const distIds: string[] = [];
  const dataServiceIds: string[] = [];

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
    if (dist.dataServiceSlug) {
      const svcId = entityIds[`DataService:${dist.dataServiceSlug}`];
      if (svcId) {
        distEntity.accessServiceId = svcId;
        if (!dataServiceIds.includes(svcId)) dataServiceIds.push(svcId);
        if (!serviceDatasetMap.has(dist.dataServiceSlug)) serviceDatasetMap.set(dist.dataServiceSlug, []);
        serviceDatasetMap.get(dist.dataServiceSlug)!.push(datasetId);
      }
    }

    writeFileSync(join(DISTS_DIR, `${dist.slug}.json`), JSON.stringify(distEntity, null, 2) + "\n");
    distCount++;
  }

  // Create dataset
  const datasetEntity: Record<string, any> = {
    _tag: "Dataset",
    id: datasetId,
    title: ds.title,
    publisherAgentId: agentId(ds.publisherSlug),
    aliases: ds.aliases ?? [],
    createdAt: TS,
    updatedAt: TS,
    description: ds.description,
    distributionIds: distIds,
    keywords: ds.keywords,
    themes: ds.themes,
  };
  if (ds.landingPage) datasetEntity.landingPage = ds.landingPage;
  if (dataServiceIds.length > 0) datasetEntity.dataServiceIds = dataServiceIds;

  writeFileSync(join(DATASETS_DIR, `${ds.slug}.json`), JSON.stringify(datasetEntity, null, 2) + "\n");
  dsCount++;

  // Create catalog record
  const crId = mintId("catalog-record", "cr");
  entityIds[`CatalogRecord:${ds.slug}-cr`] = crId;

  const crEntity = {
    _tag: "CatalogRecord",
    id: crId,
    catalogId: catalogId(ds.publisherSlug),
    primaryTopicType: "dataset" as const,
    primaryTopicId: datasetId,
  };

  writeFileSync(join(RECORDS_DIR, `${ds.slug}-cr.json`), JSON.stringify(crEntity, null, 2) + "\n");
  crCount++;

  console.log(`  ${ds.slug}: dataset + ${ds.distributions.length} dist + CR`);
}

// Update DataService servesDatasetIds
for (const [svcSlug, datasetIdList] of serviceDatasetMap) {
  const svcPath = join(SERVICES_DIR, `${svcSlug}.json`);
  if (existsSync(svcPath)) {
    const svc = JSON.parse(readFileSync(svcPath, "utf-8"));
    const existing = new Set(svc.servesDatasetIds ?? []);
    for (const id of datasetIdList) existing.add(id);
    svc.servesDatasetIds = [...existing];
    writeFileSync(svcPath, JSON.stringify(svc, null, 2) + "\n");
  }
}

// Save entity IDs
writeFileSync(join(ROOT, ".entity-ids.json"), JSON.stringify(entityIds, null, 2) + "\n");

console.log(`\n=== Publisher Dataset Harvest Results ===`);
console.log(`Datasets: ${dsCount}`);
console.log(`Distributions: ${distCount}`);
console.log(`CatalogRecords: ${crCount}`);
console.log(`DataServices: ${svcCount}`);
console.log(`DatasetSeries: ${dserCount}`);
