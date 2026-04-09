/**
 * Catalog deepening pass — ISOs, commercial stubs, non-traditional sources
 *
 * Adds:
 *  - New agents: Lazard, Aurora, Kayrros, TransitionZero, Carbon Brief,
 *    Electricity Maps, RMI, Energy Institute
 *  - ISO deepening: PJM + ENTSO-E additional datasets
 *  - Commercial deepening: Rystad, Wood Mac, S&P Global flagship products
 *  - Non-traditional resolution stubs: research firms, satellite analytics,
 *    think tanks with data products experts frequently cite
 *
 * Usage: bun scripts/catalog-harvest/harvest-deepening.ts
 *
 * SKY-216: Phase 1 — Catalog deepening
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
// New agents
// ---------------------------------------------------------------------------
interface AgentDef {
  slug: string;
  name: string;
  alternateNames: string[];
  kind: "organization" | "person" | "consortium" | "program";
  homepage: string;
  aliases: Array<{ scheme: string; value: string; relation: string }>;
}

const NEW_AGENTS: AgentDef[] = [
  {
    slug: "lazard",
    name: "Lazard",
    alternateNames: [],
    kind: "organization",
    homepage: "https://www.lazard.com",
    aliases: [
      { scheme: "wikidata", value: "Q1808050", relation: "exactMatch" },
      { scheme: "url", value: "https://www.lazard.com", relation: "exactMatch" },
    ],
  },
  {
    slug: "aurora-energy",
    name: "Aurora Energy Research",
    alternateNames: ["Aurora"],
    kind: "organization",
    homepage: "https://auroraer.com",
    aliases: [
      { scheme: "wikidata", value: "Q113547654", relation: "exactMatch" },
      { scheme: "url", value: "https://auroraer.com", relation: "exactMatch" },
    ],
  },
  {
    slug: "kayrros",
    name: "Kayrros",
    alternateNames: [],
    kind: "organization",
    homepage: "https://www.kayrros.com",
    aliases: [
      { scheme: "url", value: "https://www.kayrros.com", relation: "exactMatch" },
    ],
  },
  {
    slug: "transition-zero",
    name: "TransitionZero",
    alternateNames: [],
    kind: "organization",
    homepage: "https://www.transitionzero.org",
    aliases: [
      { scheme: "url", value: "https://www.transitionzero.org", relation: "exactMatch" },
    ],
  },
  {
    slug: "carbon-brief",
    name: "Carbon Brief",
    alternateNames: [],
    kind: "organization",
    homepage: "https://www.carbonbrief.org",
    aliases: [
      { scheme: "wikidata", value: "Q21711070", relation: "exactMatch" },
      { scheme: "url", value: "https://www.carbonbrief.org", relation: "exactMatch" },
    ],
  },
  {
    slug: "electricity-maps",
    name: "Electricity Maps",
    alternateNames: ["Tomorrow", "electricityMap"],
    kind: "organization",
    homepage: "https://www.electricitymaps.com",
    aliases: [
      { scheme: "url", value: "https://www.electricitymaps.com", relation: "exactMatch" },
    ],
  },
  {
    slug: "rmi",
    name: "Rocky Mountain Institute",
    alternateNames: ["RMI"],
    kind: "organization",
    homepage: "https://rmi.org",
    aliases: [
      { scheme: "wikidata", value: "Q7353781", relation: "exactMatch" },
      { scheme: "ror", value: "https://ror.org/01k6mbp38", relation: "exactMatch" },
      { scheme: "url", value: "https://rmi.org", relation: "exactMatch" },
    ],
  },
  {
    slug: "energy-institute",
    name: "Energy Institute",
    alternateNames: ["EI", "formerly BP Statistical Review"],
    kind: "organization",
    homepage: "https://www.energyinst.org",
    aliases: [
      { scheme: "wikidata", value: "Q113655344", relation: "exactMatch" },
      { scheme: "url", value: "https://www.energyinst.org", relation: "exactMatch" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Dataset definitions for deepening
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
  accessRights?: "public" | "restricted" | "nonPublic";
  license?: string;
  temporal?: string;
  aliases?: Array<{ scheme: string; value: string; relation: string }>;
  inSeries?: string; // dataset series slug
}

interface DatasetSeriesDef {
  publisherSlug: string;
  slug: string;
  title: string;
  description: string;
  cadence: "annual" | "quarterly" | "monthly" | "weekly" | "daily" | "irregular";
}

const NEW_SERIES: DatasetSeriesDef[] = [
  {
    publisherSlug: "lazard",
    slug: "lazard-lcoe",
    title: "Lazard Levelized Cost of Energy Analysis",
    description: "Annual analysis of levelized cost of energy across generation technologies",
    cadence: "annual",
  },
  {
    publisherSlug: "energy-institute",
    slug: "ei-statistical-review",
    title: "Energy Institute Statistical Review of World Energy",
    description: "Annual global energy statistics, formerly BP Statistical Review",
    cadence: "annual",
  },
  {
    publisherSlug: "entso-e",
    slug: "entso-e-tyndp",
    title: "ENTSO-E Ten-Year Network Development Plan",
    description: "Biennial European electricity network development scenarios and plans",
    cadence: "irregular",
  },
];

const NEW_DATASETS: DatasetDef[] = [
  // =================================================================
  // PJM deepening
  // =================================================================
  {
    publisherSlug: "pjm",
    slug: "pjm-state-of-market",
    title: "PJM State of the Market Report",
    description: "Independent Market Monitor annual and quarterly reports on PJM market performance, including energy, capacity, and ancillary services markets.",
    landingPage: "https://www.monitoringanalytics.com/reports/PJM_State_of_the_Market/",
    keywords: ["market monitor", "energy market", "capacity market", "ancillary services", "competition"],
    themes: ["electricity", "market data"],
    accessRights: "public",
    distributions: [
      { slug: "pjm-som-web", title: "Monitoring Analytics Reports", kind: "landing-page", accessURL: "https://www.monitoringanalytics.com/reports/PJM_State_of_the_Market/" },
      { slug: "pjm-som-pdf", title: "State of the Market PDF Reports", kind: "download", accessURL: "https://www.monitoringanalytics.com/reports/PJM_State_of_the_Market/", format: "PDF" },
    ],
  },
  {
    publisherSlug: "pjm",
    slug: "pjm-interconnection-queue",
    title: "PJM Interconnection Queue",
    description: "Active and completed generation and transmission interconnection requests in the PJM footprint, including project type, capacity, fuel, and status.",
    landingPage: "https://www.pjm.com/planning/services-requests/interconnection-queues",
    keywords: ["interconnection", "queue", "generation", "solar", "wind", "battery", "planning"],
    themes: ["electricity", "infrastructure", "planning"],
    accessRights: "public",
    distributions: [
      { slug: "pjm-queue-web", title: "PJM Queue Dashboard", kind: "interactive-web-app", accessURL: "https://www.pjm.com/planning/services-requests/interconnection-queues" },
      { slug: "pjm-queue-download", title: "PJM Queue Data Download", kind: "download", accessURL: "https://www.pjm.com/planning/services-requests/interconnection-queues", format: "Excel" },
    ],
  },
  {
    publisherSlug: "pjm",
    slug: "pjm-renewable-integration",
    title: "PJM Renewable Integration Study",
    description: "Analysis of renewable energy integration impacts on PJM grid reliability, including curtailment, ramping, and operational challenges.",
    landingPage: "https://www.pjm.com/planning/resource-adequacy-planning/renewable-integration-study",
    keywords: ["renewable integration", "curtailment", "reliability", "ramping", "variable generation"],
    themes: ["electricity", "renewables", "reliability"],
    accessRights: "public",
    distributions: [
      { slug: "pjm-ris-web", title: "PJM Renewable Integration Study", kind: "landing-page", accessURL: "https://www.pjm.com/planning/resource-adequacy-planning/renewable-integration-study" },
    ],
  },

  // =================================================================
  // ENTSO-E deepening
  // =================================================================
  {
    publisherSlug: "entso-e",
    slug: "entso-e-tyndp-dataset",
    title: "ENTSO-E TYNDP Scenarios and Data",
    description: "Ten-Year Network Development Plan scenario datasets including demand forecasts, generation adequacy, and grid development needs across Europe.",
    landingPage: "https://tyndp.entsoe.eu/",
    keywords: ["TYNDP", "scenarios", "network development", "adequacy", "European grid"],
    themes: ["electricity", "planning", "scenarios"],
    accessRights: "public",
    inSeries: "entso-e-tyndp",
    distributions: [
      { slug: "entso-e-tyndp-web", title: "TYNDP Portal", kind: "interactive-web-app", accessURL: "https://tyndp.entsoe.eu/" },
      { slug: "entso-e-tyndp-data", title: "TYNDP Scenario Data", kind: "download", accessURL: "https://tyndp.entsoe.eu/maps-data", format: "Excel/CSV" },
    ],
  },
  {
    publisherSlug: "entso-e",
    slug: "entso-e-adequacy-assessment",
    title: "ENTSO-E European Resource Adequacy Assessment (ERAA)",
    description: "Annual assessment of European electricity supply adequacy, including probabilistic analysis of generation adequacy under various scenarios.",
    landingPage: "https://www.entsoe.eu/outlooks/eraa/",
    keywords: ["adequacy", "ERAA", "resource adequacy", "capacity", "Europe"],
    themes: ["electricity", "reliability", "planning"],
    accessRights: "public",
    distributions: [
      { slug: "entso-e-eraa-web", title: "ERAA Portal", kind: "landing-page", accessURL: "https://www.entsoe.eu/outlooks/eraa/" },
      { slug: "entso-e-eraa-data", title: "ERAA Data Downloads", kind: "download", accessURL: "https://www.entsoe.eu/outlooks/eraa/", format: "Excel" },
    ],
  },
  {
    publisherSlug: "entso-e",
    slug: "entso-e-statistical-factsheet",
    title: "ENTSO-E Statistical Factsheet",
    description: "Annual European electricity statistics: generation capacity, production by fuel, consumption, cross-border exchanges, and system length.",
    landingPage: "https://www.entsoe.eu/publications/statistics-and-data/",
    keywords: ["statistics", "generation", "consumption", "cross-border", "Europe"],
    themes: ["electricity", "statistics"],
    accessRights: "public",
    distributions: [
      { slug: "entso-e-factsheet-web", title: "ENTSO-E Statistics Page", kind: "landing-page", accessURL: "https://www.entsoe.eu/publications/statistics-and-data/" },
      { slug: "entso-e-factsheet-pdf", title: "Statistical Factsheet PDF", kind: "download", accessURL: "https://www.entsoe.eu/publications/statistics-and-data/", format: "PDF" },
    ],
  },

  // =================================================================
  // Rystad deepening
  // =================================================================
  {
    publisherSlug: "rystad",
    slug: "rystad-shale-well-cube",
    title: "Rystad Shale Well Cube",
    description: "Well-level production, completion, and cost data for North American shale plays, with type curves and decline analysis.",
    landingPage: "https://www.rystadenergy.com/energy-themes/oil-gas/shale/",
    keywords: ["shale", "well data", "production", "completion", "decline curves"],
    themes: ["oil and gas", "upstream"],
    accessRights: "restricted",
    distributions: [
      { slug: "rystad-shale-web", title: "Rystad Shale Analytics", kind: "interactive-web-app", accessURL: "https://www.rystadenergy.com/energy-themes/oil-gas/shale/" },
    ],
  },
  {
    publisherSlug: "rystad",
    slug: "rystad-renewables-cube",
    title: "Rystad Renewables Cube",
    description: "Global renewables asset database: solar and wind project pipeline, costs, capacity factors, and developer market share.",
    landingPage: "https://www.rystadenergy.com/energy-themes/renewables/",
    keywords: ["renewables", "solar", "wind", "project pipeline", "capacity factors"],
    themes: ["renewables", "infrastructure"],
    accessRights: "restricted",
    distributions: [
      { slug: "rystad-renewables-web", title: "Rystad Renewables Analytics", kind: "interactive-web-app", accessURL: "https://www.rystadenergy.com/energy-themes/renewables/" },
    ],
  },
  {
    publisherSlug: "rystad",
    slug: "rystad-supply-cost-curves",
    title: "Rystad Energy Supply Cost Curves",
    description: "Global oil and gas supply cost curves by resource type, breakeven prices, and production forecasts.",
    landingPage: "https://www.rystadenergy.com/energy-themes/oil-gas/",
    keywords: ["supply cost", "breakeven", "upstream", "oil", "gas", "production forecast"],
    themes: ["oil and gas", "economics"],
    accessRights: "restricted",
    distributions: [
      { slug: "rystad-cost-curves-web", title: "Rystad Supply Cost Platform", kind: "interactive-web-app", accessURL: "https://www.rystadenergy.com/energy-themes/oil-gas/" },
    ],
  },

  // =================================================================
  // Wood Mackenzie deepening
  // =================================================================
  {
    publisherSlug: "wood-mackenzie",
    slug: "woodmac-lens-upstream",
    title: "Wood Mackenzie Lens Upstream",
    description: "Global upstream oil and gas analytics: asset valuations, company benchmarking, M&A screening, and production forecasts.",
    landingPage: "https://www.woodmac.com/lens/upstream/",
    keywords: ["upstream", "oil", "gas", "asset valuation", "M&A", "production"],
    themes: ["oil and gas", "upstream"],
    accessRights: "restricted",
    distributions: [
      { slug: "woodmac-upstream-web", title: "Lens Upstream Platform", kind: "interactive-web-app", accessURL: "https://www.woodmac.com/lens/upstream/" },
    ],
  },
  {
    publisherSlug: "wood-mackenzie",
    slug: "woodmac-horizons",
    title: "Wood Mackenzie Horizons",
    description: "Long-term global energy supply, demand, and investment scenarios to 2060 across all fuels and technologies.",
    landingPage: "https://www.woodmac.com/horizons/",
    keywords: ["energy transition", "scenarios", "long-term", "demand", "investment"],
    themes: ["energy transition", "scenarios", "forecasts"],
    accessRights: "restricted",
    distributions: [
      { slug: "woodmac-horizons-web", title: "Horizons Platform", kind: "interactive-web-app", accessURL: "https://www.woodmac.com/horizons/" },
    ],
  },
  {
    publisherSlug: "wood-mackenzie",
    slug: "woodmac-hydrogen-service",
    title: "Wood Mackenzie Future Energy — Hydrogen",
    description: "Global hydrogen market intelligence: production costs, project pipeline, electrolyser supply chain, and demand forecasts.",
    landingPage: "https://www.woodmac.com/market-insights/topics/hydrogen/",
    keywords: ["hydrogen", "green hydrogen", "electrolyser", "production cost", "demand"],
    themes: ["hydrogen", "energy transition"],
    accessRights: "restricted",
    distributions: [
      { slug: "woodmac-hydrogen-web", title: "Hydrogen Market Insights", kind: "landing-page", accessURL: "https://www.woodmac.com/market-insights/topics/hydrogen/" },
    ],
  },

  // =================================================================
  // S&P Global deepening
  // =================================================================
  {
    publisherSlug: "sp-global",
    slug: "sp-global-wepp",
    title: "S&P Global World Electric Power Plants Database (WEPP)",
    description: "Comprehensive global database of electric power generating units: capacity, fuel type, technology, ownership, and operational status.",
    landingPage: "https://www.spglobal.com/commodityinsights/en/ci/products/world-electric-power-plants-database.html",
    keywords: ["power plants", "capacity", "global", "database", "generation"],
    themes: ["electricity", "infrastructure"],
    accessRights: "restricted",
    distributions: [
      { slug: "sp-wepp-web", title: "WEPP Product Page", kind: "landing-page", accessURL: "https://www.spglobal.com/commodityinsights/en/ci/products/world-electric-power-plants-database.html" },
    ],
  },
  {
    publisherSlug: "sp-global",
    slug: "sp-global-giem",
    title: "S&P Global Integrated Energy Model (GIEM)",
    description: "Integrated global energy model covering supply, demand, pricing, and emissions across oil, gas, power, and renewables.",
    landingPage: "https://www.spglobal.com/commodityinsights/en/ci/products/global-integrated-energy-model.html",
    keywords: ["energy model", "supply", "demand", "pricing", "emissions", "integrated"],
    themes: ["energy", "scenarios", "forecasts"],
    accessRights: "restricted",
    distributions: [
      { slug: "sp-giem-web", title: "GIEM Product Page", kind: "landing-page", accessURL: "https://www.spglobal.com/commodityinsights/en/ci/products/global-integrated-energy-model.html" },
    ],
  },

  // =================================================================
  // New non-traditional sources — resolution stubs
  // =================================================================

  // --- Lazard ---
  {
    publisherSlug: "lazard",
    slug: "lazard-lcoe-dataset",
    title: "Lazard Levelized Cost of Energy+ (LCOE+)",
    description: "Annual analysis comparing the levelized cost of energy for various generation technologies including solar, wind, gas, nuclear, storage, and hydrogen.",
    landingPage: "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/",
    keywords: ["LCOE", "levelized cost", "solar", "wind", "nuclear", "battery", "hydrogen"],
    themes: ["economics", "electricity", "energy transition"],
    accessRights: "public",
    inSeries: "lazard-lcoe",
    distributions: [
      { slug: "lazard-lcoe-web", title: "Lazard LCOE+ Interactive", kind: "interactive-web-app", accessURL: "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/" },
      { slug: "lazard-lcoe-pdf", title: "Lazard LCOE+ PDF", kind: "download", accessURL: "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/", format: "PDF" },
    ],
  },
  {
    publisherSlug: "lazard",
    slug: "lazard-lcos",
    title: "Lazard Levelized Cost of Storage (LCOS)",
    description: "Annual analysis of energy storage costs across technologies: lithium-ion, flow batteries, compressed air, and pumped hydro.",
    landingPage: "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/",
    keywords: ["LCOS", "battery storage", "lithium-ion", "flow battery", "cost"],
    themes: ["storage", "economics"],
    accessRights: "public",
    distributions: [
      { slug: "lazard-lcos-web", title: "Lazard LCOS Interactive", kind: "landing-page", accessURL: "https://www.lazard.com/research-insights/levelized-cost-of-energyplus/" },
    ],
  },

  // --- Aurora Energy Research ---
  {
    publisherSlug: "aurora-energy",
    slug: "aurora-power-market-forecasts",
    title: "Aurora Energy Research European Power Market Forecasts",
    description: "Long-term European electricity price forecasts covering GB, Germany, Nordics, Iberia, and other markets. Includes baseload, peak, and capture prices.",
    landingPage: "https://auroraer.com/insight/long-term-forecast/",
    keywords: ["power prices", "forecasts", "Europe", "baseload", "capture price"],
    themes: ["electricity", "market data", "forecasts"],
    accessRights: "restricted",
    distributions: [
      { slug: "aurora-forecasts-web", title: "Aurora Forecasts Platform", kind: "interactive-web-app", accessURL: "https://auroraer.com/" },
    ],
  },
  {
    publisherSlug: "aurora-energy",
    slug: "aurora-hydrogen-forecasts",
    title: "Aurora Energy Research Hydrogen Market Intelligence",
    description: "Global hydrogen production cost forecasts, project pipeline tracking, and demand projections by end-use sector.",
    landingPage: "https://auroraer.com/insight/hydrogen/",
    keywords: ["hydrogen", "production cost", "green hydrogen", "project pipeline"],
    themes: ["hydrogen", "energy transition"],
    accessRights: "restricted",
    distributions: [
      { slug: "aurora-hydrogen-web", title: "Aurora Hydrogen Intelligence", kind: "landing-page", accessURL: "https://auroraer.com/insight/hydrogen/" },
    ],
  },

  // --- Kayrros ---
  {
    publisherSlug: "kayrros",
    slug: "kayrros-methane-watch",
    title: "Kayrros Methane Watch",
    description: "Satellite-based methane emission detection and quantification from oil & gas infrastructure, coal mines, and landfills worldwide.",
    landingPage: "https://www.kayrros.com/methane-watch/",
    keywords: ["methane", "satellite", "emissions", "detection", "oil and gas"],
    themes: ["emissions", "satellite", "oil and gas"],
    accessRights: "restricted",
    distributions: [
      { slug: "kayrros-methane-web", title: "Methane Watch Platform", kind: "interactive-web-app", accessURL: "https://www.kayrros.com/methane-watch/" },
    ],
  },
  {
    publisherSlug: "kayrros",
    slug: "kayrros-asset-observation",
    title: "Kayrros Asset Observation",
    description: "Satellite and geospatial monitoring of energy infrastructure: crude oil storage, LNG terminal utilization, solar/wind farm construction progress.",
    landingPage: "https://www.kayrros.com/",
    keywords: ["satellite", "crude storage", "LNG", "geospatial", "infrastructure monitoring"],
    themes: ["satellite", "oil and gas", "infrastructure"],
    accessRights: "restricted",
    distributions: [
      { slug: "kayrros-asset-web", title: "Kayrros Platform", kind: "interactive-web-app", accessURL: "https://www.kayrros.com/" },
    ],
  },

  // --- TransitionZero ---
  {
    publisherSlug: "transition-zero",
    slug: "tz-global-coal-countdown",
    title: "TransitionZero Global Coal Countdown",
    description: "Open tracker of coal-fired power plant retirements, commitments, and stranded asset risk across global markets.",
    landingPage: "https://www.transitionzero.org/products/coal-countdown",
    keywords: ["coal", "retirement", "stranded assets", "power plants", "global"],
    themes: ["coal", "energy transition"],
    accessRights: "public",
    distributions: [
      { slug: "tz-coal-countdown-web", title: "Coal Countdown Dashboard", kind: "interactive-web-app", accessURL: "https://www.transitionzero.org/products/coal-countdown" },
    ],
  },
  {
    publisherSlug: "transition-zero",
    slug: "tz-asset-level-data",
    title: "TransitionZero Asset-Level Data",
    description: "Open-source asset-level data on fossil fuel power plants, including capacity, age, emissions, and financial exposure.",
    landingPage: "https://www.transitionzero.org/",
    keywords: ["asset-level", "power plants", "emissions", "fossil fuel", "open data"],
    themes: ["emissions", "infrastructure", "energy transition"],
    accessRights: "public",
    distributions: [
      { slug: "tz-asset-web", title: "TransitionZero Platform", kind: "interactive-web-app", accessURL: "https://www.transitionzero.org/" },
    ],
  },

  // --- Carbon Brief ---
  {
    publisherSlug: "carbon-brief",
    slug: "carbon-brief-data-explorer",
    title: "Carbon Brief Country Profiles & Data Explorer",
    description: "Interactive country-level climate and energy data visualizations, including emissions trajectories, energy mix, and climate finance.",
    landingPage: "https://www.carbonbrief.org/category/country-profiles/",
    keywords: ["country profiles", "climate", "emissions", "energy mix", "data visualization"],
    themes: ["climate", "emissions", "energy"],
    accessRights: "public",
    distributions: [
      { slug: "carbon-brief-explorer-web", title: "Carbon Brief Data Explorer", kind: "interactive-web-app", accessURL: "https://www.carbonbrief.org/" },
    ],
  },

  // --- Electricity Maps ---
  {
    publisherSlug: "electricity-maps",
    slug: "electricity-maps-live",
    title: "Electricity Maps Live Carbon Intensity",
    description: "Real-time and historical carbon intensity of electricity generation by zone, covering 200+ regions worldwide.",
    landingPage: "https://app.electricitymaps.com/",
    keywords: ["carbon intensity", "real-time", "electricity", "grid", "clean energy"],
    themes: ["emissions", "electricity", "grid operations"],
    accessRights: "public",
    distributions: [
      { slug: "elecmaps-live-web", title: "Electricity Maps App", kind: "interactive-web-app", accessURL: "https://app.electricitymaps.com/" },
      { slug: "elecmaps-api", title: "Electricity Maps API", kind: "api-access", accessURL: "https://api.electricitymap.org/" },
    ],
  },

  // --- RMI ---
  {
    publisherSlug: "rmi",
    slug: "rmi-utility-transition-hub",
    title: "RMI Utility Transition Hub",
    description: "Analysis of US utility clean energy targets, IRP filings, and progress toward decarbonization commitments.",
    landingPage: "https://utilitytransitionhub.rmi.org/",
    keywords: ["utility", "clean energy", "IRP", "decarbonization", "US"],
    themes: ["electricity", "energy transition"],
    accessRights: "public",
    distributions: [
      { slug: "rmi-uth-web", title: "Utility Transition Hub Dashboard", kind: "interactive-web-app", accessURL: "https://utilitytransitionhub.rmi.org/" },
    ],
  },
  {
    publisherSlug: "rmi",
    slug: "rmi-global-energy-perspective",
    title: "RMI Global Energy Perspective",
    description: "Analysis of global clean energy deployment trajectories, including X-Change reports on solar, batteries, EVs, and electrification.",
    landingPage: "https://rmi.org/insight/x-change/",
    keywords: ["clean energy", "deployment", "solar", "batteries", "EV", "electrification"],
    themes: ["energy transition", "global"],
    accessRights: "public",
    distributions: [
      { slug: "rmi-xchange-web", title: "RMI X-Change Reports", kind: "landing-page", accessURL: "https://rmi.org/insight/x-change/" },
    ],
  },

  // --- Energy Institute ---
  {
    publisherSlug: "energy-institute",
    slug: "ei-statistical-review-dataset",
    title: "Energy Institute Statistical Review of World Energy",
    description: "Comprehensive global energy dataset covering primary energy consumption, production, reserves, trade, prices, and CO2 emissions for 75+ years.",
    landingPage: "https://www.energyinst.org/statistical-review",
    keywords: ["world energy", "statistics", "consumption", "production", "reserves", "historical"],
    themes: ["energy", "global", "statistics"],
    accessRights: "public",
    inSeries: "ei-statistical-review",
    distributions: [
      { slug: "ei-review-web", title: "Statistical Review Interactive", kind: "interactive-web-app", accessURL: "https://www.energyinst.org/statistical-review" },
      { slug: "ei-review-download", title: "Statistical Review Data Download", kind: "download", accessURL: "https://www.energyinst.org/statistical-review", format: "Excel/CSV" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Write entities
// ---------------------------------------------------------------------------
mkdirSync(AGENTS_DIR, { recursive: true });
mkdirSync(CATALOGS_DIR, { recursive: true });
mkdirSync(DATASETS_DIR, { recursive: true });
mkdirSync(DISTS_DIR, { recursive: true });
mkdirSync(RECORDS_DIR, { recursive: true });
mkdirSync(SERIES_DIR, { recursive: true });

let agCount = 0, catCount = 0, dsCount = 0, distCount = 0, crCount = 0, dserCount = 0;

// --- New Agents + Catalogs ---
for (const ag of NEW_AGENTS) {
  if (existsSync(join(AGENTS_DIR, `${ag.slug}.json`))) {
    console.log(`  skip agent: ${ag.slug} (exists)`);
    continue;
  }

  const agId = mintId("agent", "ag");
  entityIds[`Agent:${ag.slug}`] = agId;

  const agentEntity = {
    _tag: "Agent",
    id: agId,
    kind: ag.kind,
    name: ag.name,
    alternateNames: ag.alternateNames,
    homepage: ag.homepage,
    aliases: ag.aliases,
    createdAt: TS,
    updatedAt: TS,
  };

  writeFileSync(
    join(AGENTS_DIR, `${ag.slug}.json`),
    JSON.stringify(agentEntity, null, 2) + "\n",
  );
  agCount++;
  console.log(`  Agent: ${ag.slug}`);

  // Create matching Catalog
  const catId = mintId("catalog", "cat");
  entityIds[`Catalog:${ag.slug}`] = catId;

  const catalogEntity = {
    _tag: "Catalog",
    id: catId,
    title: `${ag.name} Data Catalog`,
    publisherAgentId: agId,
    homepage: ag.homepage,
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
  };

  writeFileSync(
    join(CATALOGS_DIR, `${ag.slug}.json`),
    JSON.stringify(catalogEntity, null, 2) + "\n",
  );
  catCount++;
  console.log(`  Catalog: ${ag.slug}`);
}

// --- Dataset Series ---
for (const dser of NEW_SERIES) {
  if (existsSync(join(SERIES_DIR, `${dser.slug}.json`))) {
    console.log(`  skip series: ${dser.slug} (exists)`);
    continue;
  }

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

  writeFileSync(
    join(SERIES_DIR, `${dser.slug}.json`),
    JSON.stringify(entity, null, 2) + "\n",
  );
  dserCount++;
  console.log(`  DatasetSeries: ${dser.slug}`);
}

// --- Datasets + Distributions + CatalogRecords ---
for (const ds of NEW_DATASETS) {
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
  if (ds.accessRights) datasetEntity.accessRights = ds.accessRights;
  if (ds.license) datasetEntity.license = ds.license;
  if (ds.temporal) datasetEntity.temporal = ds.temporal;
  if (ds.inSeries) {
    const seriesId = entityIds[`DatasetSeries:${ds.inSeries}`];
    if (!seriesId) throw new Error(`DatasetSeries:${ds.inSeries} not found in entity-ids`);
    datasetEntity.inSeries = seriesId;
  }

  writeFileSync(
    join(DATASETS_DIR, `${ds.slug}.json`),
    JSON.stringify(datasetEntity, null, 2) + "\n",
  );
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

console.log(`\n=== Catalog Deepening Results ===`);
console.log(`New Agents: ${agCount}`);
console.log(`New Catalogs: ${catCount}`);
console.log(`New DatasetSeries: ${dserCount}`);
console.log(`New Datasets: ${dsCount}`);
console.log(`New Distributions: ${distCount}`);
console.log(`New CatalogRecords: ${crCount}`);
