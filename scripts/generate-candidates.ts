/**
 * Generate Candidate JSON files from selected-for-resolution.json.
 * Maps each post to its best-matching catalog/variable/series entities.
 *
 * Usage: bun scripts/generate-candidates.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const BASE = join(import.meta.dirname, "..", "references", "cold-start");
const OUT = join(BASE, "candidates");
const TS = "2026-04-08T00:00:00.000Z";

mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Load inputs
// ---------------------------------------------------------------------------
const posts: any[] = JSON.parse(readFileSync(join(BASE, "survey", "selected-for-resolution.json"), "utf-8"));
const entityIds: Record<string, string> = JSON.parse(readFileSync(join(BASE, ".entity-ids.json"), "utf-8"));
const varIds: Record<string, string> = JSON.parse(readFileSync(join(BASE, "variables", ".variable-ids.json"), "utf-8"));
const serIds: Record<string, string> = JSON.parse(readFileSync(join(BASE, "series", ".series-ids.json"), "utf-8"));

function eid(tag: string, slug: string): string | undefined {
  return entityIds[`${tag}:${slug}`];
}

function mintId(): string {
  return `https://id.skygest.io/candidate/cand_${ulid()}`;
}

// ---------------------------------------------------------------------------
// Publisher → Agent slug mapping
// ---------------------------------------------------------------------------
const PUB_TO_AGENT: Record<string, string> = {
  eia: "eia", iea: "iea", ember: "ember", bnef: "bnef", ferc: "ferc",
  ercot: "ercot", caiso: "caiso", pjm: "pjm", nrel: "nrel", irena: "irena",
  "entso-e": "entso-e", unfccc: "unfccc", climate_action_tracker: "cat",
  spp: "spp",
  // Intermediaries map to the original publisher where possible
  enerdata: "iea",      // Enerdata typically cites IEA/IRENA data
  energystoragenews: "ember", // ESN covers storage, often cites Ember/BNEF
  rtoinsider: "ferc",   // RTO Insider covers FERC/ISO news
  spglobal: "caiso",    // S&P Global often covers CAISO/market data
  miso: "pjm",          // MISO is its own but we don't have a separate agent; PJM as closest grid operator agent
  nyiso: "pjm",         // Same — closest grid operator
};

// ---------------------------------------------------------------------------
// Cluster key → Dataset slug mapping (best effort)
// ---------------------------------------------------------------------------
function clusterToDataset(cluster: string, pub: string): string | undefined {
  // Direct publisher matches
  if (cluster.startsWith("eia-")) {
    if (cluster.includes("solar") || cluster.includes("generation")) return "eia-electricity-data";
    if (cluster.includes("gas") || cluster.includes("nuclear") || cluster.includes("battery")) return "eia-electricity-data";
    if (cluster.includes("capacity")) return "eia-electricity-data";
    if (cluster.includes("emissions")) return "eia-state-co2";
    if (cluster.includes("price")) return "eia-petroleum";
    if (cluster.includes("us")) return "eia-today-in-energy";
    return "eia-today-in-energy";
  }
  if (cluster.startsWith("iea-")) {
    if (cluster.includes("solar")) return "iea-solar-pv";
    if (cluster.includes("demand")) return "iea-demand";
    if (cluster.includes("gas")) return "iea-data-portal";
    if (cluster.includes("generation")) return "iea-data-portal";
    if (cluster.includes("price")) return "iea-data-portal";
    if (cluster.includes("nuclear")) return "iea-data-portal";
    if (cluster.includes("forecast")) return "iea-renewables";
    return "iea-news-analysis";
  }
  if (cluster.startsWith("ember-")) {
    if (cluster.includes("generation-eu")) return "ember-eer-dataset";
    if (cluster.includes("generation-de") || cluster.includes("generation-gb") || cluster.includes("generation-in")) return "ember-data-explorer";
    if (cluster.includes("solar")) return "ember-data-explorer";
    if (cluster.includes("gas")) return "ember-data-explorer";
    if (cluster.includes("capacity")) return "ember-data-explorer";
    if (cluster.includes("price")) return "ember-data-explorer";
    return "ember-data-explorer";
  }
  if (cluster.startsWith("bnef-")) {
    if (cluster.includes("battery")) return "bnef-battery-price";
    if (cluster.includes("wind") || cluster.includes("solar")) return "bnef-eti";
    if (cluster.includes("demand") || cluster.includes("nuclear") || cluster.includes("gas")) return "bnef-datacenter";
    if (cluster.includes("price")) return "bnef-battery-price";
    return "bnef-eti";
  }
  if (cluster.startsWith("ercot-")) {
    if (cluster.includes("solar")) return "ercot-solar-records";
    if (cluster.includes("battery")) return "ercot-battery";
    if (cluster.includes("demand") || cluster.includes("transmission")) return "ercot-generation";
    return "ercot-generation";
  }
  if (cluster.startsWith("caiso-")) {
    if (cluster.includes("solar")) return "caiso-todays-outlook";
    if (cluster.includes("grid-ops") || cluster.includes("generation")) return "caiso-todays-outlook";
    if (cluster.includes("capacity")) return "caiso-todays-outlook";
    return "caiso-todays-outlook";
  }
  if (cluster.startsWith("ferc-")) {
    if (cluster.includes("nuclear") || cluster.includes("capacity") || cluster.includes("solar")) return "ferc-infrastructure-update";
    if (cluster.includes("demand") || cluster.includes("forecast")) return "ferc-orders";
    return "ferc-infrastructure-update";
  }
  if (cluster.startsWith("pjm-")) {
    if (cluster.includes("capacity") || cluster.includes("nuclear")) return "pjm-capacity-auction";
    if (cluster.includes("demand")) return "pjm-load-forecast";
    return "pjm-capacity-auction";
  }
  if (cluster.startsWith("irena-")) return "irena-capacity-stats-dataset";
  if (cluster.startsWith("nrel-")) {
    if (cluster.includes("solar")) return "nrel-atb";
    return "nrel-atb";
  }
  if (cluster.startsWith("unfccc-")) return "unfccc-negotiations";
  if (cluster.startsWith("entso-e-")) {
    if (cluster.includes("wind") || cluster.includes("solar")) return "entsoe-transparency";
    return "entsoe-iberian-blackout";
  }
  if (cluster.startsWith("spp-")) return "spp-generation";
  if (cluster.startsWith("climate_action_tracker")) return "cat-country-assessments";

  // Intermediaries
  if (cluster.startsWith("enerdata-")) {
    if (cluster.includes("capacity")) return "irena-capacity-stats-dataset";
    if (cluster.includes("emissions")) return "iea-data-portal";
    if (cluster.includes("price")) return "iea-data-portal";
    if (cluster.includes("load")) return "iea-demand";
    return "iea-data-portal";
  }
  if (cluster.startsWith("energystoragenews-")) {
    if (cluster.includes("capacity")) return "ember-battery";
    if (cluster.includes("generation")) return "ember-data-explorer";
    return "ember-data-explorer";
  }
  if (cluster.startsWith("rtoinsider-")) {
    if (cluster.includes("price-us-ca")) return "caiso-todays-outlook";
    if (cluster.includes("price")) return "eia-electricity-data";
    return "ferc-orders";
  }
  if (cluster.startsWith("spglobal-")) {
    if (cluster.includes("price-us-ca")) return "caiso-todays-outlook";
    if (cluster.includes("capacity-us-ca")) return "caiso-todays-outlook";
    if (cluster.includes("capacity-global")) return "irena-capacity-stats-dataset";
    return "eia-electricity-data";
  }
  if (cluster.startsWith("miso-")) return "eia-electricity-data";
  if (cluster.startsWith("nyiso-")) return "eia-electricity-data";
  if (cluster.startsWith("fossil-")) return "eia-petroleum";
  if (cluster.startsWith("eu-")) return "ember-eer-dataset";

  return undefined;
}

// ---------------------------------------------------------------------------
// Cluster key → Variable slug mapping
// ---------------------------------------------------------------------------
function clusterToVariable(cluster: string): string | undefined {
  // Solar
  if (cluster.includes("solar") && !cluster.includes("price")) {
    if (cluster.includes("capacity")) return "installed-solar-pv-capacity";
    if (cluster.includes("generation")) return "solar-electricity-generation";
    return "solar-electricity-generation";
  }
  // Wind
  if (cluster.includes("wind")) {
    if (cluster.includes("capacity")) return "installed-wind-capacity";
    return "wind-electricity-generation";
  }
  // Battery
  if (cluster.includes("battery")) {
    if (cluster.includes("price")) return "battery-pack-price";
    return "installed-battery-storage-capacity";
  }
  // Nuclear
  if (cluster.includes("nuclear")) return "installed-nuclear-capacity";
  // Gas
  if (cluster.includes("gas")) return "electricity-generation";
  // Generation
  if (cluster.includes("generation")) return "electricity-generation";
  // Capacity
  if (cluster.includes("capacity") && !cluster.includes("auction")) return "installed-renewable-capacity";
  if (cluster.includes("auction")) return "installed-renewable-capacity";
  // Demand / Load
  if (cluster.includes("demand") || cluster.includes("load")) return "electricity-demand";
  // Price
  if (cluster.includes("price")) return "wholesale-electricity-price";
  // Emissions
  if (cluster.includes("emissions")) return "co2-emissions-from-energy";
  // Forecast
  if (cluster.includes("forecast")) return "electricity-demand";
  // Grid ops
  if (cluster.includes("grid-ops")) return "electricity-generation";
  // Transmission / interconnection
  if (cluster.includes("transmission")) return "interconnection-queue-backlog";

  return undefined;
}

// ---------------------------------------------------------------------------
// Cluster key → Series slug mapping
// ---------------------------------------------------------------------------
function clusterToSeries(cluster: string, geo: string): string | undefined {
  const varSlug = clusterToVariable(cluster);
  if (!varSlug) return undefined;

  // Try to match based on variable + geography
  if (varSlug === "solar-electricity-generation") {
    if (geo === "us-tx" || cluster.includes("ercot")) return "us-tx-solar-generation-daily";
    if (geo === "us-ca" || cluster.includes("caiso")) return "us-ca-solar-generation-daily";
    if (geo === "eu" || cluster.includes("-eu")) return "eu-solar-generation-annual";
  }
  if (varSlug === "wind-electricity-generation") {
    if (geo === "us-tx" || cluster.includes("ercot")) return "us-tx-wind-generation-daily";
  }
  if (varSlug === "coal-electricity-generation") {
    if (geo === "eu" || cluster.includes("-eu")) return "eu-coal-generation-annual";
  }
  if (varSlug === "electricity-generation") {
    if (cluster.includes("us") && !cluster.includes("us-ca") && !cluster.includes("us-tx")) return "us-electricity-generation-annual";
    if (cluster.includes("global") || geo === "global") return "global-electricity-generation-annual";
  }
  if (varSlug === "electricity-demand") {
    if (cluster.includes("ercot") || geo === "us-tx") return "us-tx-electricity-demand-hourly";
    if (cluster.includes("pjm")) return "us-pjm-load-forecast";
  }
  if (varSlug === "wholesale-electricity-price") {
    if (geo === "us-ca" || cluster.includes("us-ca") || cluster.includes("caiso")) return "us-ca-electricity-price-hourly";
    if (cluster.includes("de") || cluster.includes("germany")) return "de-wholesale-electricity-price";
    if (cluster.includes("tr") || cluster.includes("turkiye")) return "tr-wholesale-electricity-price";
  }
  if (varSlug === "installed-renewable-capacity") {
    if (cluster.includes("irena") || geo === "global") return "global-renewable-capacity-annual";
    if (cluster.includes("pjm")) return "us-pjm-capacity-auction-annual";
  }
  if (varSlug === "installed-solar-pv-capacity") {
    if (geo === "global" || cluster.includes("global")) return "global-solar-pv-capacity-annual";
  }
  if (varSlug === "installed-battery-storage-capacity") {
    if (geo === "us-ca" || cluster.includes("caiso")) return "us-ca-battery-discharge-daily";
  }
  if (varSlug === "co2-emissions-from-energy") {
    if (cluster.includes("us") || geo === "us") return "us-co2-emissions-by-state-annual";
  }
  if (varSlug === "interconnection-queue-backlog") {
    if (geo === "us" || cluster.includes("us")) return "us-interconnection-queue-annual";
    if (geo === "us-ca" || cluster.includes("caiso")) return "us-ca-interconnection-queue";
  }
  if (varSlug === "battery-pack-price") return "global-battery-pack-price-annual";

  return undefined;
}

// ---------------------------------------------------------------------------
// Geography normalization from cluster key
// ---------------------------------------------------------------------------
function extractGeo(cluster: string, geoField: string): string {
  if (cluster.includes("us-tx") || cluster.includes("ercot")) return "us-tx";
  if (cluster.includes("us-ca") || cluster.includes("caiso")) return "us-ca";
  if (cluster.includes("us-pjm") || cluster.includes("pjm")) return "us-pjm";
  if (cluster.includes("us-spp") || cluster.includes("spp-")) return "us-spp";
  if (cluster.includes("us-miso") || cluster.includes("miso")) return "us-miso";
  if (cluster.includes("-us") || cluster.includes("us-")) return "us";
  if (cluster.includes("-eu") || cluster.includes("eu-")) return "eu";
  if (cluster.includes("-de") || cluster.includes("germany")) return "de";
  if (cluster.includes("-gb")) return "gb";
  if (cluster.includes("-fr")) return "fr";
  if (cluster.includes("-es")) return "es";
  if (cluster.includes("-in")) return "in";
  if (cluster.includes("-cn") || cluster.includes("china")) return "cn";
  if (cluster.includes("-au") || cluster.includes("australia")) return "au";
  if (cluster.includes("global")) return "global";
  if (geoField && geoField !== "unspecified" && geoField !== "unknown") return geoField;
  return "unspecified";
}

// ---------------------------------------------------------------------------
// Distribution slug for a dataset
// ---------------------------------------------------------------------------
function datasetToDistribution(dsSlug: string): string | undefined {
  // Prefer landing-page distributions (first dist for each dataset usually)
  const webSlugs: Record<string, string> = {
    "eia-today-in-energy": "eia-tie-web",
    "eia-electricity-data": "eia-elec-web",
    "eia-state-co2": "eia-co2-web",
    "eia-steo": "eia-steo-web",
    "eia-aeo-dataset": "eia-aeo-web",
    "eia-recs": "eia-recs-web",
    "eia-petroleum": "eia-pet-web",
    "eia-international": "eia-intl-web",
    "eia-generation-us": "eia-gen-web",
    "iea-news-analysis": "iea-news-web",
    "iea-data-portal": "iea-data-web",
    "iea-wei": "iea-wei-web",
    "iea-weo-dataset": "iea-weo-web",
    "iea-renewables": "iea-renew-web",
    "iea-omr": "iea-omr-web",
    "iea-solar-pv": "iea-solar-web",
    "iea-demand": "iea-demand-web",
    "ember-eer-dataset": "ember-eer-web",
    "ember-ger-dataset": "ember-ger-web",
    "ember-data-explorer": "ember-explorer-web",
    "ember-turkiye": "ember-turkiye-web",
    "ember-battery": "ember-battery-web",
    "bnef-eti": "bnef-eti-web",
    "bnef-battery-price": "bnef-batt-web",
    "bnef-datacenter": "bnef-dc-web",
    "bnef-corporate-clean": "bnef-corp-web",
    "ferc-infrastructure-update": "ferc-eiu-web",
    "ferc-orders": "ferc-orders-web",
    "ercot-generation": "ercot-gen-web",
    "ercot-solar-records": "ercot-solar-web",
    "ercot-battery": "ercot-batt-web",
    "caiso-todays-outlook": "caiso-outlook-web",
    "caiso-western-eim": "caiso-eim-web",
    "caiso-battery-discharge": "caiso-batt-web",
    "caiso-100pct-wws": "caiso-wws-web",
    "pjm-capacity-auction": "pjm-rpm-web",
    "pjm-load-forecast": "pjm-load-web",
    "nrel-atb": "nrel-atb-web",
    "nrel-geothermal": "nrel-geo-web",
    "irena-capacity-stats-dataset": "irena-cap-web",
    "irena-costs": "irena-cost-web",
    "entsoe-iberian-blackout": "entsoe-ibr-web",
    "entsoe-transparency": "entsoe-tp-web",
    "unfccc-negotiations": "unfccc-neg-web",
    "unfccc-ndc": "unfccc-ndc-web",
    "cat-country-assessments": "cat-country-web",
    "lbnl-queue": "lbnl-queue-web",
    "spp-generation": "spp-gen-web",
  };
  return webSlugs[dsSlug];
}

// ---------------------------------------------------------------------------
// Generate candidates
// ---------------------------------------------------------------------------
let resolved = 0, partial = 0, sourceOnly = 0;

for (let i = 0; i < posts.length; i++) {
  const post = posts[i];
  const cluster = post.cluster_key || "generic";
  const pub = post.publisher || "unknown";
  const geo = extractGeo(cluster, post.geography);

  const id = mintId();

  // Map to entities
  const agentSlug = PUB_TO_AGENT[pub];
  const agentId = agentSlug ? eid("Agent", agentSlug) : undefined;

  const dsSlug = clusterToDataset(cluster, pub);
  const datasetId = dsSlug ? eid("Dataset", dsSlug) : undefined;

  const distSlug = dsSlug ? datasetToDistribution(dsSlug) : undefined;
  const distId = distSlug ? eid("Distribution", distSlug) : undefined;

  const varSlug = clusterToVariable(cluster);
  const variableId = varSlug ? varIds[varSlug] : undefined;

  const serSlug = clusterToSeries(cluster, geo);
  const seriesId = serSlug ? serIds[serSlug] : undefined;

  // Determine resolution state
  let resolutionState: string;
  if (variableId && seriesId && distId) {
    resolutionState = "resolved";
    resolved++;
  } else if (variableId || datasetId) {
    resolutionState = "partially_resolved";
    partial++;
  } else {
    resolutionState = "source_only";
    sourceOnly++;
  }

  // Build rawDims from available context
  const rawDims: Record<string, string> = {};
  if (geo !== "unspecified") rawDims.geography = geo;
  if (post.categories?.[0]) rawDims.category = post.categories[0];

  // Extract numeric claims if present
  const candidate: Record<string, any> = {
    _tag: "Candidate",
    id,
    sourceRef: { contentId: post.uri },
    resolutionState,
    createdAt: TS,
  };

  if (agentId) candidate.referencedAgentId = agentId;
  if (datasetId) candidate.referencedDatasetId = datasetId;
  if (distId) candidate.referencedDistributionId = distId;
  if (variableId) candidate.referencedVariableId = variableId;
  if (seriesId) candidate.referencedSeriesId = seriesId;
  if (post.text_snippet) candidate.rawLabel = post.text_snippet;
  if (Object.keys(rawDims).length > 0) candidate.rawDims = rawDims;

  // Add numeric claim if present
  if (post.has_numeric_claim && post.numeric_claims?.length > 0) {
    const claim = post.numeric_claims[0];
    if (claim.value !== undefined) candidate.assertedValue = claim.value;
    if (claim.unit) candidate.assertedUnit = claim.unit;
    if (claim.time_period) candidate.assertedTime = { label: claim.time_period };
  }

  // Write file — use index for unique naming
  const safeUri = post.uri.replace(/[^a-zA-Z0-9]/g, "_").slice(-40);
  writeFileSync(join(OUT, `cand-${String(i).padStart(3, "0")}-${safeUri}.json`), JSON.stringify(candidate, null, 2) + "\n");
}

console.log(`Generated ${posts.length} Candidate records`);
console.log(`  resolved: ${resolved}`);
console.log(`  partially_resolved: ${partial}`);
console.log(`  source_only: ${sourceOnly}`);
