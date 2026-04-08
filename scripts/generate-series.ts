/**
 * Generate Series JSON files for SKY-215 cold-start.
 * Usage: bun scripts/generate-series.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulid";

const ROOT = join(import.meta.dirname, "..", "references", "cold-start", "series");
const TS = "2026-04-08T00:00:00.000Z";

const varIds: Record<string, string> = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "references", "cold-start", "variables", ".variable-ids.json"), "utf-8")
);

function mintId(): string {
  return `https://id.skygest.io/series/ser_${ulid()}`;
}

interface SeriesDef {
  slug: string;
  label: string;
  variableSlug: string;
  place?: string;
  sector?: string;
  market?: string;
  frequency?: string;
  extra?: Record<string, string>;
}

const SERIES: SeriesDef[] = [
  // EIA
  { slug: "us-electricity-generation-annual", label: "U.S. electricity generation (annual)", variableSlug: "electricity-generation", place: "US", frequency: "annual" },
  { slug: "us-co2-emissions-by-state-annual", label: "U.S. CO2 emissions by state (annual)", variableSlug: "co2-emissions-from-energy", place: "US", frequency: "annual", extra: { granularity: "state" } },

  // ERCOT
  { slug: "us-tx-solar-generation-daily", label: "ERCOT solar generation (daily)", variableSlug: "solar-electricity-generation", place: "US-TX", market: "ERCOT", frequency: "daily" },
  { slug: "us-tx-electricity-demand-hourly", label: "ERCOT electricity demand (hourly)", variableSlug: "electricity-demand", place: "US-TX", market: "ERCOT", frequency: "hourly" },
  { slug: "us-tx-wind-generation-daily", label: "ERCOT wind generation (daily)", variableSlug: "wind-electricity-generation", place: "US-TX", market: "ERCOT", frequency: "daily" },

  // CAISO
  { slug: "us-ca-battery-discharge-daily", label: "CAISO battery discharge (daily)", variableSlug: "installed-battery-storage-capacity", place: "US-CA", market: "CAISO", frequency: "daily" },
  { slug: "us-ca-solar-generation-daily", label: "CAISO solar generation (daily)", variableSlug: "solar-electricity-generation", place: "US-CA", market: "CAISO", frequency: "daily" },
  { slug: "us-ca-electricity-price-hourly", label: "CAISO electricity price (hourly)", variableSlug: "wholesale-electricity-price", place: "US-CA", market: "CAISO", frequency: "hourly" },
  { slug: "us-ca-clean-share-daily", label: "CAISO clean electricity share (daily)", variableSlug: "clean-electricity-share", place: "US-CA", market: "CAISO", frequency: "daily" },

  // Ember
  { slug: "eu-coal-generation-annual", label: "EU coal generation by country (annual)", variableSlug: "coal-electricity-generation", place: "EU", frequency: "annual", extra: { granularity: "country" } },
  { slug: "eu-solar-generation-annual", label: "EU solar generation by country (annual)", variableSlug: "solar-electricity-generation", place: "EU", frequency: "annual", extra: { granularity: "country" } },
  { slug: "tr-wholesale-electricity-price", label: "Turkey wholesale electricity price", variableSlug: "wholesale-electricity-price", place: "TR", frequency: "monthly" },
  { slug: "za-clean-electricity-share-monthly", label: "South Africa clean electricity share (monthly)", variableSlug: "clean-electricity-share", place: "ZA", frequency: "monthly" },

  // IRENA
  { slug: "global-renewable-capacity-annual", label: "Global renewable capacity (annual)", variableSlug: "installed-renewable-capacity", place: "GLOBAL", frequency: "annual" },
  { slug: "global-solar-pv-capacity-annual", label: "Global solar PV capacity (annual)", variableSlug: "installed-solar-pv-capacity", place: "GLOBAL", frequency: "annual" },

  // BNEF
  { slug: "global-energy-transition-investment-annual", label: "Global energy transition investment (annual)", variableSlug: "energy-transition-investment", place: "GLOBAL", frequency: "annual" },
  { slug: "global-battery-pack-price-annual", label: "Global battery pack price (annual)", variableSlug: "battery-pack-price", place: "GLOBAL", frequency: "annual" },
  { slug: "us-data-center-demand-forecast", label: "U.S. data center power demand (forecast)", variableSlug: "data-center-power-demand", place: "US", frequency: "annual", extra: { type: "forecast" } },

  // IEA
  { slug: "global-clean-energy-investment-annual", label: "Global clean energy investment (annual)", variableSlug: "clean-energy-investment", place: "GLOBAL", frequency: "annual" },

  // LBNL
  { slug: "us-interconnection-queue-annual", label: "U.S. interconnection queue (annual)", variableSlug: "interconnection-queue-backlog", place: "US", frequency: "annual" },

  // CAISO interconnection
  { slug: "us-ca-interconnection-queue", label: "CAISO interconnection queue", variableSlug: "interconnection-queue-backlog", place: "US-CA", market: "CAISO", frequency: "irregular" },

  // PJM
  { slug: "us-pjm-capacity-auction-annual", label: "PJM capacity auction results (annual)", variableSlug: "installed-renewable-capacity", place: "US-PJM", market: "PJM", frequency: "annual", extra: { type: "auction" } },
  { slug: "us-pjm-load-forecast", label: "PJM load forecast", variableSlug: "electricity-demand", place: "US-PJM", market: "PJM", frequency: "annual", extra: { type: "forecast" } },

  // ENTSO-E
  { slug: "de-wholesale-electricity-price", label: "Germany wholesale electricity price", variableSlug: "wholesale-electricity-price", place: "DE", market: "EPEX", frequency: "hourly" },

  // Global generation
  { slug: "global-electricity-generation-annual", label: "Global electricity generation (annual)", variableSlug: "electricity-generation", place: "GLOBAL", frequency: "annual" },
];

mkdirSync(ROOT, { recursive: true });

const idMap: Record<string, string> = {};

for (const s of SERIES) {
  const varId = varIds[s.variableSlug];
  if (!varId) {
    console.error(`Missing variable: ${s.variableSlug}`);
    process.exit(1);
  }

  const id = mintId();
  idMap[s.slug] = id;

  const fixedDims: Record<string, any> = {};
  if (s.place) fixedDims.place = s.place;
  if (s.sector) fixedDims.sector = s.sector;
  if (s.market) fixedDims.market = s.market;
  if (s.frequency) fixedDims.frequency = s.frequency;
  if (s.extra) fixedDims.extra = s.extra;

  writeFileSync(join(ROOT, `${s.slug}.json`), JSON.stringify({
    _tag: "Series",
    id,
    label: s.label,
    variableId: varId,
    fixedDims,
    aliases: [],
    createdAt: TS,
    updatedAt: TS,
  }, null, 2) + "\n");
}

writeFileSync(join(ROOT, ".series-ids.json"), JSON.stringify(idMap, null, 2) + "\n");
console.log(`Generated ${SERIES.length} Series records`);
