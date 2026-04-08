/**
 * Generate all DCAT catalog seed entities for SKY-215 cold-start.
 * Produces Agent, Catalog, Dataset, Distribution, DataService, DatasetSeries,
 * and CatalogRecord JSON files in references/cold-start/catalog/.
 *
 * Usage: bun scripts/generate-catalog-seed.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "references", "cold-start", "catalog");
const TS = "2026-04-08T00:00:00.000Z";

// ---------------------------------------------------------------------------
// ID minting
// ---------------------------------------------------------------------------
const PREFIXES: Record<string, string> = {
  agent: "ag", catalog: "cat", "catalog-record": "cr", dataset: "ds",
  distribution: "dist", "data-service": "svc", "dataset-series": "dser",
};

function mintId(kind: string): string {
  return `https://id.skygest.io/${kind}/${PREFIXES[kind]}_${ulid()}`;
}

// ---------------------------------------------------------------------------
// Writer helpers
// ---------------------------------------------------------------------------
function writeEntity(subdir: string, filename: string, entity: Record<string, any>) {
  const dir = join(ROOT, subdir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${filename}.json`), JSON.stringify(entity, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
interface AgentDef {
  slug: string; name: string; alternateNames?: string[];
  homepage?: string; ror?: string; wikidata?: string;
}

const AGENTS: AgentDef[] = [
  { slug: "eia", name: "U.S. Energy Information Administration", alternateNames: ["EIA"], homepage: "https://www.eia.gov", ror: "https://ror.org/026v3a610", wikidata: "Q1349935" },
  { slug: "iea", name: "International Energy Agency", alternateNames: ["IEA"], homepage: "https://www.iea.org", ror: "https://ror.org/005fmfm13", wikidata: "Q192350" },
  { slug: "ember", name: "Ember", alternateNames: ["Ember Climate"], homepage: "https://ember-climate.org", wikidata: "Q98476350" },
  { slug: "bnef", name: "BloombergNEF", alternateNames: ["BNEF", "Bloomberg New Energy Finance"], homepage: "https://about.bnef.com", wikidata: "Q66048424" },
  { slug: "ferc", name: "Federal Energy Regulatory Commission", alternateNames: ["FERC"], homepage: "https://www.ferc.gov", ror: "https://ror.org/05zcbgd14", wikidata: "Q1400970" },
  { slug: "ercot", name: "Electric Reliability Council of Texas", alternateNames: ["ERCOT"], homepage: "https://www.ercot.com", wikidata: "Q5356944" },
  { slug: "caiso", name: "California Independent System Operator", alternateNames: ["CAISO", "California ISO"], homepage: "https://www.caiso.com", wikidata: "Q2933655" },
  { slug: "pjm", name: "PJM Interconnection", alternateNames: ["PJM"], homepage: "https://www.pjm.com", wikidata: "Q7118859" },
  { slug: "nrel", name: "National Renewable Energy Laboratory", alternateNames: ["NREL"], homepage: "https://www.nrel.gov", ror: "https://ror.org/036266993", wikidata: "Q1579895" },
  { slug: "irena", name: "International Renewable Energy Agency", alternateNames: ["IRENA"], homepage: "https://www.irena.org", ror: "https://ror.org/01grfn956", wikidata: "Q901361" },
  // On-demand publishers referenced in selected-for-resolution.json
  { slug: "entso-e", name: "European Network of Transmission System Operators for Electricity", alternateNames: ["ENTSO-E"], homepage: "https://www.entsoe.eu", wikidata: "Q1376tried" },
  { slug: "unfccc", name: "United Nations Framework Convention on Climate Change", alternateNames: ["UNFCCC"], homepage: "https://unfccc.int", ror: "https://ror.org/01mfmr560", wikidata: "Q183011" },
  { slug: "cat", name: "Climate Action Tracker", alternateNames: ["CAT"], homepage: "https://climateactiontracker.org", wikidata: "Q28131250" },
  { slug: "lbnl", name: "Lawrence Berkeley National Laboratory", alternateNames: ["LBNL", "Berkeley Lab"], homepage: "https://www.lbl.gov", ror: "https://ror.org/02jbv0t02", wikidata: "Q1133630" },
  { slug: "spp", name: "Southwest Power Pool", alternateNames: ["SPP"], homepage: "https://www.spp.org", wikidata: "Q7571625" },
];

// ---------------------------------------------------------------------------
// Dataset definitions per publisher
// ---------------------------------------------------------------------------
interface DatasetDef {
  slug: string; title: string; description?: string; landingPage?: string;
  keywords?: string[]; themes?: string[];
  distributions: DistDef[];
  inSeries?: string; // will be resolved to DatasetSeries slug
}

interface DistDef {
  slug: string; kind: string; title?: string;
  accessURL?: string; downloadURL?: string; mediaType?: string; format?: string;
  accessServiceSlug?: string; // resolved to DataService ID
}

interface DataServiceDef {
  slug: string; title: string; description?: string;
  endpointURLs: string[]; endpointDescription?: string;
  conformsTo?: string; servedDatasetSlugs: string[];
}

interface DatasetSeriesDef {
  slug: string; title: string; description?: string;
  cadence: string; publisherSlug: string;
}

const DATASET_SERIES: DatasetSeriesDef[] = [
  { slug: "irena-capacity-stats", title: "IRENA Renewable Capacity Statistics", description: "Annual capacity statistics published by IRENA", cadence: "annual", publisherSlug: "irena" },
  { slug: "ember-eer", title: "Ember European Electricity Review", description: "Annual review of European electricity sector", cadence: "annual", publisherSlug: "ember" },
  { slug: "ember-ger", title: "Ember Global Electricity Review", description: "Annual review of global electricity generation", cadence: "annual", publisherSlug: "ember" },
  { slug: "iea-weo", title: "IEA World Energy Outlook", description: "Annual flagship publication", cadence: "annual", publisherSlug: "iea" },
  { slug: "eia-aeo", title: "EIA Annual Energy Outlook", description: "Annual U.S. energy projections", cadence: "annual", publisherSlug: "eia" },
];

const DATA_SERVICES: DataServiceDef[] = [
  { slug: "eia-api", title: "EIA Open Data API v2", description: "RESTful API providing access to EIA energy data", endpointURLs: ["https://api.eia.gov/v2/"], endpointDescription: "https://www.eia.gov/opendata/documentation.php", conformsTo: "EIA Open Data API v2", servedDatasetSlugs: ["eia-electricity-data", "eia-steo", "eia-petroleum", "eia-state-co2", "eia-generation-us", "eia-international"] },
  { slug: "iea-api", title: "IEA Data API", description: "API access to IEA data portal datasets", endpointURLs: ["https://api.iea.org/"], servedDatasetSlugs: ["iea-data-portal"] },
  { slug: "caiso-oasis", title: "CAISO OASIS", description: "Open Access Same-time Information System for CAISO market data", endpointURLs: ["https://oasis.caiso.com/"], endpointDescription: "https://www.caiso.com/market/Pages/ReportsBulletins/Default.aspx", servedDatasetSlugs: ["caiso-todays-outlook", "caiso-western-eim"] },
];

// Datasets grouped by publisher slug
const DATASETS_BY_PUBLISHER: Record<string, DatasetDef[]> = {
  eia: [
    { slug: "eia-today-in-energy", title: "EIA Today in Energy", description: "Daily analysis articles on current energy topics", landingPage: "https://www.eia.gov/todayinenergy/", keywords: ["energy analysis", "daily briefing"], themes: ["energy policy"], distributions: [
      { slug: "eia-tie-web", kind: "landing-page", title: "Today in Energy web archive", accessURL: "https://www.eia.gov/todayinenergy/" },
    ]},
    { slug: "eia-electricity-data", title: "EIA Electricity Data", description: "Comprehensive U.S. electricity generation, capacity, and consumption data", landingPage: "https://www.eia.gov/electricity/data.php", keywords: ["electricity", "generation", "capacity"], themes: ["electricity"], distributions: [
      { slug: "eia-elec-web", kind: "landing-page", title: "Electricity data browser", accessURL: "https://www.eia.gov/electricity/data/browser/" },
      { slug: "eia-elec-api", kind: "api-access", title: "Electricity data via API", accessURL: "https://api.eia.gov/v2/electricity/", accessServiceSlug: "eia-api" },
    ]},
    { slug: "eia-state-co2", title: "EIA State CO2 Emissions", description: "State-level energy-related carbon dioxide emissions", landingPage: "https://www.eia.gov/environment/emissions/state/", keywords: ["CO2", "emissions", "state"], themes: ["emissions"], distributions: [
      { slug: "eia-co2-web", kind: "landing-page", title: "State CO2 data portal", accessURL: "https://www.eia.gov/environment/emissions/state/" },
      { slug: "eia-co2-xls", kind: "download", title: "State CO2 Excel download", downloadURL: "https://www.eia.gov/environment/emissions/state/excel/table1.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", format: "XLSX" },
    ]},
    { slug: "eia-steo", title: "EIA Short-Term Energy Outlook", description: "Monthly forecast of U.S. and global energy markets", landingPage: "https://www.eia.gov/outlooks/steo/", keywords: ["forecast", "short-term", "outlook"], themes: ["energy forecast"], distributions: [
      { slug: "eia-steo-web", kind: "landing-page", title: "STEO web portal", accessURL: "https://www.eia.gov/outlooks/steo/" },
      { slug: "eia-steo-api", kind: "api-access", title: "STEO data via API", accessURL: "https://api.eia.gov/v2/steo/", accessServiceSlug: "eia-api" },
    ]},
    { slug: "eia-aeo-dataset", title: "EIA Annual Energy Outlook", description: "Long-term U.S. energy projections", landingPage: "https://www.eia.gov/outlooks/aeo/", keywords: ["projections", "long-term", "outlook"], themes: ["energy forecast"], inSeries: "eia-aeo", distributions: [
      { slug: "eia-aeo-web", kind: "landing-page", title: "AEO web portal", accessURL: "https://www.eia.gov/outlooks/aeo/" },
    ]},
    { slug: "eia-recs", title: "EIA Residential Energy Consumption Survey", description: "Household energy use survey data", landingPage: "https://www.eia.gov/consumption/residential/", keywords: ["residential", "consumption", "survey"], themes: ["energy consumption"], distributions: [
      { slug: "eia-recs-web", kind: "landing-page", title: "RECS data tables", accessURL: "https://www.eia.gov/consumption/residential/data/" },
    ]},
    { slug: "eia-petroleum", title: "EIA Petroleum Navigator", description: "U.S. petroleum supply, stocks, and pricing data", landingPage: "https://www.eia.gov/dnav/pet/", keywords: ["petroleum", "oil", "gasoline", "crude"], themes: ["petroleum"], distributions: [
      { slug: "eia-pet-web", kind: "landing-page", title: "Petroleum Navigator", accessURL: "https://www.eia.gov/dnav/pet/" },
      { slug: "eia-pet-api", kind: "api-access", title: "Petroleum data via API", accessURL: "https://api.eia.gov/v2/petroleum/", accessServiceSlug: "eia-api" },
    ]},
    { slug: "eia-international", title: "EIA International Energy Data", description: "International energy statistics and analysis", landingPage: "https://www.eia.gov/international/data/world", keywords: ["international", "global"], themes: ["international energy"], distributions: [
      { slug: "eia-intl-web", kind: "landing-page", title: "International data portal", accessURL: "https://www.eia.gov/international/data/world" },
    ]},
    { slug: "eia-generation-us", title: "EIA U.S. Electricity Generation", description: "Monthly and annual electricity generation by source", landingPage: "https://www.eia.gov/electricity/monthly/", keywords: ["generation", "electricity", "monthly"], themes: ["electricity"], distributions: [
      { slug: "eia-gen-web", kind: "landing-page", title: "Electric Power Monthly", accessURL: "https://www.eia.gov/electricity/monthly/" },
    ]},
  ],
  iea: [
    { slug: "iea-news-analysis", title: "IEA News & Analysis", description: "Commentary and analysis articles on global energy topics", landingPage: "https://www.iea.org/news", keywords: ["analysis", "commentary"], themes: ["energy policy"], distributions: [
      { slug: "iea-news-web", kind: "landing-page", title: "IEA news portal", accessURL: "https://www.iea.org/news" },
    ]},
    { slug: "iea-data-portal", title: "IEA Data Portal", description: "Comprehensive global energy statistics", landingPage: "https://www.iea.org/data-and-statistics", keywords: ["statistics", "global energy"], themes: ["energy data"], distributions: [
      { slug: "iea-data-web", kind: "interactive-web-app", title: "IEA Data Explorer", accessURL: "https://www.iea.org/data-and-statistics/data-tools/energy-statistics-data-browser" },
      { slug: "iea-data-api", kind: "api-access", title: "IEA data API", accessURL: "https://api.iea.org/", accessServiceSlug: "iea-api" },
    ]},
    { slug: "iea-wei", title: "IEA World Energy Investment", description: "Annual global energy investment analysis", landingPage: "https://www.iea.org/reports/world-energy-investment", keywords: ["investment", "clean energy", "fossil fuels"], themes: ["energy investment"], distributions: [
      { slug: "iea-wei-web", kind: "landing-page", title: "World Energy Investment report", accessURL: "https://www.iea.org/reports/world-energy-investment" },
    ]},
    { slug: "iea-weo-dataset", title: "IEA World Energy Outlook", description: "Flagship annual publication with global energy scenarios", landingPage: "https://www.iea.org/reports/world-energy-outlook-2025", keywords: ["outlook", "scenarios", "projections"], themes: ["energy forecast"], inSeries: "iea-weo", distributions: [
      { slug: "iea-weo-web", kind: "landing-page", title: "WEO report landing page", accessURL: "https://www.iea.org/reports/world-energy-outlook-2025" },
    ]},
    { slug: "iea-renewables", title: "IEA Renewables Report", description: "Market analysis and forecast for renewable energy", landingPage: "https://www.iea.org/reports/renewables", keywords: ["renewables", "solar", "wind", "forecast"], themes: ["renewables"], distributions: [
      { slug: "iea-renew-web", kind: "landing-page", title: "Renewables report", accessURL: "https://www.iea.org/reports/renewables" },
    ]},
    { slug: "iea-omr", title: "IEA Oil Market Report", description: "Monthly analysis of global oil markets", landingPage: "https://www.iea.org/reports/oil-market-report", keywords: ["oil", "petroleum", "OPEC"], themes: ["oil markets"], distributions: [
      { slug: "iea-omr-web", kind: "landing-page", title: "Oil Market Report", accessURL: "https://www.iea.org/reports/oil-market-report" },
    ]},
    { slug: "iea-solar-pv", title: "IEA Solar PV Supply Chains", description: "Analysis of global solar PV manufacturing and supply chains", landingPage: "https://www.iea.org/reports/solar-pv-global-supply-chains", keywords: ["solar", "supply chain", "manufacturing"], themes: ["solar"], distributions: [
      { slug: "iea-solar-web", kind: "landing-page", title: "Solar PV Supply Chains report", accessURL: "https://www.iea.org/reports/solar-pv-global-supply-chains" },
    ]},
    { slug: "iea-demand", title: "IEA Electricity Demand", description: "Global electricity demand analysis and projections", landingPage: "https://www.iea.org/reports/electricity-2024", keywords: ["demand", "electricity", "forecast"], themes: ["electricity"], distributions: [
      { slug: "iea-demand-web", kind: "landing-page", title: "Electricity report", accessURL: "https://www.iea.org/reports/electricity-2024" },
    ]},
  ],
  ember: [
    { slug: "ember-eer-dataset", title: "Ember European Electricity Review", description: "Annual review of the European power sector", landingPage: "https://ember-climate.org/insights/research/european-electricity-review-2025/", keywords: ["Europe", "electricity", "coal phase-out"], themes: ["European electricity"], inSeries: "ember-eer", distributions: [
      { slug: "ember-eer-web", kind: "landing-page", title: "European Electricity Review", accessURL: "https://ember-climate.org/insights/research/european-electricity-review-2025/" },
      { slug: "ember-eer-data", kind: "download", title: "EER dataset download", downloadURL: "https://ember-climate.org/data-catalogue/european-electricity-review/", format: "CSV" },
    ]},
    { slug: "ember-ger-dataset", title: "Ember Global Electricity Review", description: "Annual global electricity generation and emissions review", landingPage: "https://ember-climate.org/insights/research/global-electricity-review-2025/", keywords: ["global", "electricity", "emissions"], themes: ["global electricity"], inSeries: "ember-ger", distributions: [
      { slug: "ember-ger-web", kind: "landing-page", title: "Global Electricity Review", accessURL: "https://ember-climate.org/insights/research/global-electricity-review-2025/" },
    ]},
    { slug: "ember-data-explorer", title: "Ember Data Explorer", description: "Interactive tool for exploring electricity generation data by country", landingPage: "https://ember-climate.org/data/data-tools/data-explorer/", keywords: ["explorer", "country data", "generation mix"], themes: ["electricity data"], distributions: [
      { slug: "ember-explorer-web", kind: "interactive-web-app", title: "Ember Data Explorer", accessURL: "https://ember-climate.org/data/data-tools/data-explorer/" },
      { slug: "ember-explorer-csv", kind: "download", title: "Country data download", downloadURL: "https://ember-climate.org/data-catalogue/yearly-electricity-data/", format: "CSV" },
    ]},
    { slug: "ember-turkiye", title: "Ember Turkiye Electricity Review", description: "Analysis of Turkey's electricity sector", landingPage: "https://ember-climate.org/insights/research/turkiye-electricity-review/", keywords: ["Turkey", "electricity"], themes: ["country review"], distributions: [
      { slug: "ember-turkiye-web", kind: "landing-page", title: "Turkiye review", accessURL: "https://ember-climate.org/insights/research/turkiye-electricity-review/" },
    ]},
    { slug: "ember-battery", title: "Ember Battery Storage Analysis", description: "Analysis of battery storage deployment globally", landingPage: "https://ember-climate.org/insights/research/battery-storage/", keywords: ["battery", "storage", "flexibility"], themes: ["storage"], distributions: [
      { slug: "ember-battery-web", kind: "landing-page", title: "Battery storage analysis", accessURL: "https://ember-climate.org/insights/research/battery-storage/" },
    ]},
  ],
  bnef: [
    { slug: "bnef-eti", title: "BloombergNEF Energy Transition Investment", description: "Annual global energy transition investment analysis", landingPage: "https://about.bnef.com/energy-transition-investment/", keywords: ["investment", "energy transition", "clean energy"], themes: ["energy investment"], distributions: [
      { slug: "bnef-eti-web", kind: "landing-page", title: "ETI report landing page", accessURL: "https://about.bnef.com/energy-transition-investment/" },
    ]},
    { slug: "bnef-battery-price", title: "BloombergNEF Battery Price Survey", description: "Annual lithium-ion battery price survey", landingPage: "https://about.bnef.com/blog/lithium-ion-battery-pack-prices/", keywords: ["battery", "lithium-ion", "price"], themes: ["battery costs"], distributions: [
      { slug: "bnef-batt-web", kind: "landing-page", title: "Battery price survey", accessURL: "https://about.bnef.com/blog/lithium-ion-battery-pack-prices/" },
    ]},
    { slug: "bnef-datacenter", title: "BloombergNEF Data Center Demand", description: "Analysis of power demand from data centers and AI", landingPage: "https://about.bnef.com/", keywords: ["data center", "AI", "power demand"], themes: ["electricity demand"], distributions: [
      { slug: "bnef-dc-web", kind: "landing-page", title: "Data center demand analysis", accessURL: "https://about.bnef.com/" },
    ]},
    { slug: "bnef-corporate-clean", title: "BloombergNEF Corporate Clean Energy Buying", description: "Corporate power purchase agreements and clean energy procurement", landingPage: "https://about.bnef.com/", keywords: ["corporate PPA", "clean energy", "procurement"], themes: ["corporate energy"], distributions: [
      { slug: "bnef-corp-web", kind: "landing-page", title: "Corporate clean energy buying", accessURL: "https://about.bnef.com/" },
    ]},
  ],
  ferc: [
    { slug: "ferc-infrastructure-update", title: "FERC Energy Infrastructure Update", description: "Monthly summary of energy infrastructure developments in the U.S.", landingPage: "https://www.ferc.gov/media/energy-infrastructure-update", keywords: ["infrastructure", "generation capacity", "pipeline"], themes: ["energy infrastructure"], distributions: [
      { slug: "ferc-eiu-web", kind: "landing-page", title: "Energy Infrastructure Update", accessURL: "https://www.ferc.gov/media/energy-infrastructure-update" },
      { slug: "ferc-eiu-pdf", kind: "download", title: "EIU PDF report", downloadURL: "https://www.ferc.gov/media/energy-infrastructure-update", mediaType: "application/pdf", format: "PDF" },
    ]},
    { slug: "ferc-orders", title: "FERC Orders & News", description: "Regulatory orders, rulemakings, and news releases", landingPage: "https://www.ferc.gov/news-events", keywords: ["regulation", "orders", "policy"], themes: ["regulation"], distributions: [
      { slug: "ferc-orders-web", kind: "landing-page", title: "FERC news and orders", accessURL: "https://www.ferc.gov/news-events" },
    ]},
  ],
  ercot: [
    { slug: "ercot-generation", title: "ERCOT Real-Time Generation Data", description: "Real-time and historical generation data for the ERCOT grid", landingPage: "https://www.ercot.com/gridinfo/generation", keywords: ["generation", "real-time", "Texas"], themes: ["grid operations"], distributions: [
      { slug: "ercot-gen-web", kind: "landing-page", title: "ERCOT generation data", accessURL: "https://www.ercot.com/gridinfo/generation" },
      { slug: "ercot-gen-csv", kind: "download", title: "ERCOT generation CSV", downloadURL: "https://www.ercot.com/gridinfo/generation", format: "CSV" },
    ]},
    { slug: "ercot-solar-records", title: "ERCOT Solar Generation Records", description: "Solar generation milestones and records in ERCOT", landingPage: "https://www.ercot.com/gridinfo/generation", keywords: ["solar", "records", "Texas"], themes: ["solar generation"], distributions: [
      { slug: "ercot-solar-web", kind: "landing-page", title: "ERCOT solar records", accessURL: "https://www.ercot.com/gridinfo/generation" },
    ]},
    { slug: "ercot-battery", title: "ERCOT Battery/RTC+B Data", description: "Battery storage and renewable-plus-storage data in ERCOT", landingPage: "https://www.ercot.com/gridinfo/generation", keywords: ["battery", "storage", "Texas"], themes: ["storage"], distributions: [
      { slug: "ercot-batt-web", kind: "landing-page", title: "ERCOT battery data", accessURL: "https://www.ercot.com/gridinfo/generation" },
    ]},
  ],
  caiso: [
    { slug: "caiso-todays-outlook", title: "CAISO Today's Outlook", description: "Real-time supply and demand data for the California grid", landingPage: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx", keywords: ["real-time", "supply", "demand", "California"], themes: ["grid operations"], distributions: [
      { slug: "caiso-outlook-web", kind: "interactive-web-app", title: "Today's Outlook dashboard", accessURL: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx" },
    ]},
    { slug: "caiso-western-eim", title: "CAISO Western Energy Imbalance Market", description: "Western EIM real-time market data", landingPage: "https://www.caiso.com/market/Pages/ReportsBulletins/Default.aspx", keywords: ["EIM", "market", "Western"], themes: ["electricity markets"], distributions: [
      { slug: "caiso-eim-web", kind: "landing-page", title: "Western EIM data", accessURL: "https://www.caiso.com/market/Pages/ReportsBulletins/Default.aspx" },
    ]},
    { slug: "caiso-battery-discharge", title: "CAISO Battery Discharge Records", description: "Battery discharge milestones and peak records in CAISO", landingPage: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx", keywords: ["battery", "discharge", "California"], themes: ["storage"], distributions: [
      { slug: "caiso-batt-web", kind: "landing-page", title: "Battery discharge data", accessURL: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx" },
    ]},
    { slug: "caiso-100pct-wws", title: "CAISO 100% WWS Days", description: "Days when California achieved 100% wind/water/solar supply", landingPage: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx", keywords: ["100%", "renewable", "California"], themes: ["renewable milestones"], distributions: [
      { slug: "caiso-wws-web", kind: "landing-page", title: "100% WWS records", accessURL: "https://www.caiso.com/TodaysOutlook/Pages/default.aspx" },
    ]},
  ],
  pjm: [
    { slug: "pjm-capacity-auction", title: "PJM Capacity Auction Results", description: "Results of PJM's Reliability Pricing Model capacity auctions", landingPage: "https://www.pjm.com/markets-and-operations/rpm", keywords: ["capacity", "auction", "RPM"], themes: ["capacity markets"], distributions: [
      { slug: "pjm-rpm-web", kind: "landing-page", title: "RPM auction results", accessURL: "https://www.pjm.com/markets-and-operations/rpm" },
      { slug: "pjm-rpm-xls", kind: "download", title: "Auction results spreadsheet", downloadURL: "https://www.pjm.com/markets-and-operations/rpm", format: "XLSX" },
    ]},
    { slug: "pjm-load-forecast", title: "PJM Load Forecast", description: "PJM system load forecasting reports", landingPage: "https://www.pjm.com/planning/resource-adequacy-planning/load-forecast", keywords: ["load", "forecast", "demand"], themes: ["demand forecasting"], distributions: [
      { slug: "pjm-load-web", kind: "landing-page", title: "Load forecast reports", accessURL: "https://www.pjm.com/planning/resource-adequacy-planning/load-forecast" },
    ]},
  ],
  nrel: [
    { slug: "nrel-atb", title: "NREL Annual Technology Baseline", description: "Cost and performance projections for electricity generation technologies", landingPage: "https://atb.nrel.gov/", keywords: ["technology costs", "LCOE", "projections"], themes: ["technology costs"], distributions: [
      { slug: "nrel-atb-web", kind: "interactive-web-app", title: "ATB interactive data", accessURL: "https://atb.nrel.gov/" },
      { slug: "nrel-atb-csv", kind: "download", title: "ATB data download", downloadURL: "https://atb.nrel.gov/electricity/2024/data", format: "CSV" },
    ]},
    { slug: "nrel-geothermal", title: "NREL Geothermal Studies", description: "Research on geothermal energy potential and technology", landingPage: "https://www.nrel.gov/geothermal/", keywords: ["geothermal", "enhanced", "superhot"], themes: ["geothermal"], distributions: [
      { slug: "nrel-geo-web", kind: "landing-page", title: "Geothermal research", accessURL: "https://www.nrel.gov/geothermal/" },
    ]},
  ],
  irena: [
    { slug: "irena-capacity-stats-dataset", title: "IRENA Renewable Capacity Statistics", description: "Annual global renewable energy capacity by country and technology", landingPage: "https://www.irena.org/Publications/2025/Mar/Renewable-capacity-statistics-2025", keywords: ["capacity", "renewable", "global", "country"], themes: ["renewable capacity"], inSeries: "irena-capacity-stats", distributions: [
      { slug: "irena-cap-web", kind: "landing-page", title: "Capacity Statistics report", accessURL: "https://www.irena.org/Publications/2025/Mar/Renewable-capacity-statistics-2025" },
      { slug: "irena-cap-csv", kind: "download", title: "Capacity data download", downloadURL: "https://www.irena.org/Statistics/Download-Data", format: "CSV" },
    ]},
    { slug: "irena-costs", title: "IRENA Renewable Power Generation Costs", description: "Annual analysis of renewable energy generation costs", landingPage: "https://www.irena.org/Publications/2024/Sep/Renewable-Power-Generation-Costs-in-2023", keywords: ["LCOE", "costs", "renewable"], themes: ["renewable costs"], distributions: [
      { slug: "irena-cost-web", kind: "landing-page", title: "Renewable costs report", accessURL: "https://www.irena.org/Publications/2024/Sep/Renewable-Power-Generation-Costs-in-2023" },
    ]},
  ],
  "entso-e": [
    { slug: "entsoe-iberian-blackout", title: "ENTSO-E Iberian Blackout Report 2025", description: "Investigation report on the April 2025 Iberian Peninsula blackout", landingPage: "https://www.entsoe.eu/news/2025/04/", keywords: ["blackout", "Iberian", "grid failure"], themes: ["grid reliability"], distributions: [
      { slug: "entsoe-ibr-web", kind: "landing-page", title: "Iberian blackout report", accessURL: "https://www.entsoe.eu/news/2025/04/" },
      { slug: "entsoe-ibr-pdf", kind: "download", title: "Blackout investigation PDF", downloadURL: "https://www.entsoe.eu/news/2025/04/", mediaType: "application/pdf", format: "PDF" },
    ]},
    { slug: "entsoe-transparency", title: "ENTSO-E Transparency Platform", description: "European electricity market and grid data", landingPage: "https://transparency.entsoe.eu/", keywords: ["transparency", "European", "market data"], themes: ["electricity markets"], distributions: [
      { slug: "entsoe-tp-web", kind: "interactive-web-app", title: "Transparency Platform", accessURL: "https://transparency.entsoe.eu/" },
    ]},
  ],
  unfccc: [
    { slug: "unfccc-negotiations", title: "UNFCCC Climate Negotiations", description: "Conference proceedings, decisions, and negotiation texts", landingPage: "https://unfccc.int/process-and-meetings", keywords: ["climate", "negotiations", "COP", "Paris Agreement"], themes: ["climate policy"], distributions: [
      { slug: "unfccc-neg-web", kind: "landing-page", title: "UNFCCC meetings portal", accessURL: "https://unfccc.int/process-and-meetings" },
    ]},
    { slug: "unfccc-ndc", title: "UNFCCC NDC Registry", description: "National Determined Contributions submitted by parties", landingPage: "https://unfccc.int/NDCREG", keywords: ["NDC", "pledges", "emissions targets"], themes: ["climate commitments"], distributions: [
      { slug: "unfccc-ndc-web", kind: "landing-page", title: "NDC Registry", accessURL: "https://unfccc.int/NDCREG" },
    ]},
  ],
  cat: [
    { slug: "cat-country-assessments", title: "Climate Action Tracker Country Assessments", description: "Independent scientific analysis of government climate action", landingPage: "https://climateactiontracker.org/countries/", keywords: ["country assessment", "climate policy", "emissions gap"], themes: ["climate policy"], distributions: [
      { slug: "cat-country-web", kind: "landing-page", title: "Country assessment portal", accessURL: "https://climateactiontracker.org/countries/" },
    ]},
  ],
  lbnl: [
    { slug: "lbnl-queue", title: "LBNL Interconnection Queue Analysis", description: "Annual analysis of U.S. electricity interconnection queues", landingPage: "https://emp.lbl.gov/queues", keywords: ["interconnection", "queue", "backlog"], themes: ["grid interconnection"], distributions: [
      { slug: "lbnl-queue-web", kind: "landing-page", title: "Queues analysis report", accessURL: "https://emp.lbl.gov/queues" },
      { slug: "lbnl-queue-xls", kind: "download", title: "Queue data spreadsheet", downloadURL: "https://emp.lbl.gov/queues", format: "XLSX" },
    ]},
  ],
  spp: [
    { slug: "spp-generation", title: "SPP Generation Data", description: "Southwest Power Pool generation mix and records", landingPage: "https://www.spp.org/markets-operations/current-grid-conditions/", keywords: ["generation", "wind", "SPP"], themes: ["grid operations"], distributions: [
      { slug: "spp-gen-web", kind: "landing-page", title: "SPP grid conditions", accessURL: "https://www.spp.org/markets-operations/current-grid-conditions/" },
    ]},
  ],
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

// Track all IDs for referential integrity
const agentIds: Record<string, string> = {};
const catalogIds: Record<string, string> = {};
const datasetIds: Record<string, string> = {};
const distIds: Record<string, string> = {};
const svcIds: Record<string, string> = {};
const dserIds: Record<string, string> = {};

// Step 1: Agents
for (const ag of AGENTS) {
  const id = mintId("agent");
  agentIds[ag.slug] = id;
  const aliases: any[] = [];
  if (ag.ror) aliases.push({ scheme: "ror", value: ag.ror, relation: "exactMatch" });
  if (ag.wikidata) aliases.push({ scheme: "wikidata", value: ag.wikidata, relation: "exactMatch" });
  if (ag.homepage) aliases.push({ scheme: "url", value: ag.homepage, relation: "exactMatch" });

  const entity: Record<string, any> = {
    _tag: "Agent", id, kind: "organization", name: ag.name, aliases, createdAt: TS, updatedAt: TS,
  };
  if (ag.alternateNames) entity.alternateNames = ag.alternateNames;
  if (ag.homepage) entity.homepage = ag.homepage;
  writeEntity("agents", ag.slug, entity);
}

// Step 2: DatasetSeries
for (const dser of DATASET_SERIES) {
  const id = mintId("dataset-series");
  dserIds[dser.slug] = id;
  writeEntity("dataset-series", dser.slug, {
    _tag: "DatasetSeries", id, title: dser.title,
    description: dser.description,
    publisherAgentId: agentIds[dser.publisherSlug],
    cadence: dser.cadence,
    aliases: [], createdAt: TS, updatedAt: TS,
  });
}

// Step 3: DataServices (need dataset IDs — create placeholder, update after datasets)
// Pre-mint service IDs
for (const svc of DATA_SERVICES) {
  svcIds[svc.slug] = mintId("data-service");
}

// Step 4: Datasets + Distributions
const crEntities: any[] = [];
let crIndex = 0;

for (const [pubSlug, datasets] of Object.entries(DATASETS_BY_PUBLISHER)) {
  for (const ds of datasets) {
    const dsId = mintId("dataset");
    datasetIds[ds.slug] = dsId;

    // Create distributions first to collect IDs
    const dsDistIds: string[] = [];
    const dsSvcIds: string[] = [];

    for (const dist of ds.distributions) {
      const distId = mintId("distribution");
      distIds[dist.slug] = distId;
      dsDistIds.push(distId);

      const distEntity: Record<string, any> = {
        _tag: "Distribution", id: distId, datasetId: dsId, kind: dist.kind,
        aliases: [], createdAt: TS, updatedAt: TS,
      };
      if (dist.title) distEntity.title = dist.title;
      if (dist.accessURL) distEntity.accessURL = dist.accessURL;
      if (dist.downloadURL) distEntity.downloadURL = dist.downloadURL;
      if (dist.mediaType) distEntity.mediaType = dist.mediaType;
      if (dist.format) distEntity.format = dist.format;
      if (dist.accessServiceSlug && svcIds[dist.accessServiceSlug]) {
        distEntity.accessServiceId = svcIds[dist.accessServiceSlug];
        if (!dsSvcIds.includes(svcIds[dist.accessServiceSlug])) {
          dsSvcIds.push(svcIds[dist.accessServiceSlug]);
        }
      }
      writeEntity("distributions", dist.slug, distEntity);
    }

    // Create dataset
    const dsEntity: Record<string, any> = {
      _tag: "Dataset", id: dsId, title: ds.title,
      publisherAgentId: agentIds[pubSlug],
      aliases: [], createdAt: TS, updatedAt: TS,
    };
    if (ds.description) dsEntity.description = ds.description;
    if (ds.landingPage) dsEntity.landingPage = ds.landingPage;
    if (ds.keywords) dsEntity.keywords = ds.keywords;
    if (ds.themes) dsEntity.themes = ds.themes;
    if (dsDistIds.length > 0) dsEntity.distributionIds = dsDistIds;
    if (dsSvcIds.length > 0) dsEntity.dataServiceIds = dsSvcIds;
    if (ds.inSeries && dserIds[ds.inSeries]) dsEntity.inSeries = dserIds[ds.inSeries];
    writeEntity("datasets", ds.slug, dsEntity);

    // Create CatalogRecord for this dataset
    const crId = mintId("catalog-record");
    crEntities.push({ dsSlug: ds.slug, pubSlug, crId, dsId });
  }
}

// Step 5: Catalogs
for (const ag of AGENTS) {
  const catId = mintId("catalog");
  catalogIds[ag.slug] = catId;
  writeEntity("catalogs", ag.slug, {
    _tag: "Catalog", id: catId, title: `${ag.name} Data Catalog`,
    publisherAgentId: agentIds[ag.slug],
    homepage: ag.homepage,
    aliases: [], createdAt: TS, updatedAt: TS,
  });
}

// Step 6: DataServices (now we can resolve dataset IDs)
for (const svc of DATA_SERVICES) {
  const pubSlug = svc.slug.split("-")[0]; // eia-api → eia, iea-api → iea, caiso-oasis → caiso
  const servedIds = svc.servedDatasetSlugs
    .map(s => datasetIds[s])
    .filter(Boolean);

  writeEntity("data-services", svc.slug, {
    _tag: "DataService", id: svcIds[svc.slug], title: svc.title,
    description: svc.description,
    publisherAgentId: agentIds[pubSlug],
    endpointURLs: svc.endpointURLs,
    endpointDescription: svc.endpointDescription,
    conformsTo: svc.conformsTo,
    servesDatasetIds: servedIds,
    aliases: [], createdAt: TS, updatedAt: TS,
  });
}

// Step 7: CatalogRecords
for (const cr of crEntities) {
  writeEntity("catalog-records", `${cr.dsSlug}-cr`, {
    _tag: "CatalogRecord", id: cr.crId,
    catalogId: catalogIds[cr.pubSlug],
    primaryTopicType: "dataset",
    primaryTopicId: cr.dsId,
    firstSeen: "2026-04-08",
    isAuthoritative: true,
  });
}

// Step 8: A couple of federation CatalogRecords (data.gov harvesting EIA datasets)
const dataGovAgentId = mintId("agent");
agentIds["data-gov"] = dataGovAgentId;
writeEntity("agents", "data-gov", {
  _tag: "Agent", id: dataGovAgentId, kind: "organization",
  name: "Data.gov", alternateNames: ["U.S. Open Data Portal"],
  homepage: "https://data.gov",
  aliases: [
    { scheme: "url", value: "https://data.gov", relation: "exactMatch" },
    { scheme: "wikidata", value: "Q3557528", relation: "exactMatch" },
  ],
  createdAt: TS, updatedAt: TS,
});

const dataGovCatId = mintId("catalog");
catalogIds["data-gov"] = dataGovCatId;
writeEntity("catalogs", "data-gov", {
  _tag: "Catalog", id: dataGovCatId, title: "Data.gov Catalog",
  publisherAgentId: dataGovAgentId,
  homepage: "https://catalog.data.gov",
  aliases: [], createdAt: TS, updatedAt: TS,
});

// Harvested CatalogRecords — EIA Electricity Data via data.gov
const authCrForElec = crEntities.find(c => c.dsSlug === "eia-electricity-data");
if (authCrForElec) {
  writeEntity("catalog-records", "eia-electricity-data-datagov-cr", {
    _tag: "CatalogRecord", id: mintId("catalog-record"),
    catalogId: dataGovCatId,
    primaryTopicType: "dataset",
    primaryTopicId: authCrForElec.dsId,
    firstSeen: "2026-04-08",
    isAuthoritative: false,
    duplicateOf: authCrForElec.crId,
  });
}

const authCrForSteo = crEntities.find(c => c.dsSlug === "eia-steo");
if (authCrForSteo) {
  writeEntity("catalog-records", "eia-steo-datagov-cr", {
    _tag: "CatalogRecord", id: mintId("catalog-record"),
    catalogId: dataGovCatId,
    primaryTopicType: "dataset",
    primaryTopicId: authCrForSteo.dsId,
    firstSeen: "2026-04-08",
    isAuthoritative: false,
    duplicateOf: authCrForSteo.crId,
  });
}

// Summary
const counts: Record<string, number> = {};
function count(tag: string) { counts[tag] = (counts[tag] || 0) + 1; }

// Count by walking what we wrote
console.log("Catalog seed generated:");
console.log(`  Agents: ${Object.keys(agentIds).length}`);
console.log(`  Catalogs: ${Object.keys(catalogIds).length}`);
console.log(`  Datasets: ${Object.keys(datasetIds).length}`);
console.log(`  Distributions: ${Object.keys(distIds).length}`);
console.log(`  DataServices: ${Object.keys(svcIds).length}`);
console.log(`  DatasetSeries: ${Object.keys(dserIds).length}`);
console.log(`  CatalogRecords: ${crEntities.length + 2}`); // +2 for data.gov harvested
