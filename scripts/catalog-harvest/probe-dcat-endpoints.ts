/**
 * Probe DCAT-US data.json and DCAT-AP endpoints from US federal agencies
 * and European publishers.
 *
 * Sources (from dcat_data_research.md):
 *   - DOE:       https://www.energy.gov/data.json          (DCAT-US 3.0)
 *   - EPA:       https://www.epa.gov/data.json             (DCAT-US)
 *   - EIA Atlas: https://atlas.eia.gov/api/feed/dcat-us/1.1.json (DCAT-US 1.1)
 *   - Eurostat:  https://ec.europa.eu/eurostat/api/dissemination/catalogue/dcat/ESTAT/FULL (DCAT-AP RDF)
 *
 * For each endpoint:
 *   1. Fetch the catalog
 *   2. Count total datasets
 *   3. Filter to energy-relevant datasets
 *   4. Analyze field coverage (which DCAT fields map to our schema)
 *   5. Diff against existing catalog entities
 *   6. Output report
 *
 * Output:
 *   references/cold-start/reports/harvest/dcat-endpoints-probe.json
 *
 * Usage: bun scripts/catalog-harvest/probe-dcat-endpoints.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "reports", "harvest");
const CATALOG_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "catalog");

// ---------------------------------------------------------------------------
// Load existing catalog for overlap detection
// ---------------------------------------------------------------------------
function loadExistingDatasets(): Map<string, any> {
  const datasets = new Map<string, any>();
  const glob = new Bun.Glob("datasets/*.json");
  for (const path of glob.scanSync({ cwd: CATALOG_DIR })) {
    const data = JSON.parse(readFileSync(join(CATALOG_DIR, path), "utf-8"));
    if (data._tag === "Dataset") {
      datasets.set(data.title.toLowerCase(), data);
      if (data.landingPage) datasets.set(data.landingPage.toLowerCase(), data);
    }
  }
  return datasets;
}

const existingDatasets = loadExistingDatasets();

// ---------------------------------------------------------------------------
// DCAT-US data.json parser
// ---------------------------------------------------------------------------
interface DcatUsDataset {
  title?: string;
  description?: string;
  keyword?: string[];
  publisher?: { name?: string };
  contactPoint?: { fn?: string; hasEmail?: string };
  identifier?: string;
  accessLevel?: string;
  license?: string;
  landingPage?: string;
  temporal?: string;
  spatial?: string;
  modified?: string;
  issued?: string;
  distribution?: Array<{
    title?: string;
    downloadURL?: string;
    accessURL?: string;
    mediaType?: string;
    format?: string;
    description?: string;
  }>;
  theme?: string[];
  bureauCode?: string[];
  programCode?: string[];
  [k: string]: any;
}

// Energy-relevance heuristic: check title, description, keywords for energy terms
const ENERGY_TERMS = [
  "energy", "electricity", "power", "grid", "solar", "wind", "nuclear",
  "coal", "natural gas", "petroleum", "oil", "renewable", "emission",
  "carbon", "climate", "fuel", "generation", "capacity", "transmission",
  "utility", "electric", "megawatt", "kilowatt", "photovoltaic",
  "hydroelectric", "geothermal", "battery", "storage", "EIA", "FERC",
  "eGRID", "SEDS", "STEO",
];

function isEnergyRelevant(ds: DcatUsDataset): boolean {
  const text = [
    ds.title ?? "",
    ds.description ?? "",
    ...(ds.keyword ?? []),
    ...(ds.theme ?? []),
  ].join(" ").toLowerCase();
  return ENERGY_TERMS.some((term) => text.includes(term.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Probe a DCAT-US data.json endpoint
// ---------------------------------------------------------------------------
interface ProbeResult {
  source: string;
  url: string;
  fetchedAt: string;
  success: boolean;
  error?: string;
  totalDatasets: number;
  energyRelevant: number;
  overlapWithCatalog: number;
  newEnergyDatasets: number;
  fieldCoverage: Record<string, { count: number; pct: string }>;
  topEnergyDatasets: Array<{
    title: string;
    description?: string;
    keywords?: string[];
    landingPage?: string;
    distributions?: number;
    license?: string;
    matchesExisting?: string;
  }>;
}

async function probeDcatUs(name: string, url: string): Promise<ProbeResult> {
  console.log(`\nFetching ${name} from ${url}...`);

  const result: ProbeResult = {
    source: name,
    url,
    fetchedAt: new Date().toISOString(),
    success: false,
    totalDatasets: 0,
    energyRelevant: 0,
    overlapWithCatalog: 0,
    newEnergyDatasets: 0,
    fieldCoverage: {},
    topEnergyDatasets: [],
  };

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "SkygestCatalogHarvest/1.0 (https://skygest.io)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      result.error = `HTTP ${resp.status} ${resp.statusText}`;
      console.log(`  ERROR: ${result.error}`);
      return result;
    }

    const data = await resp.json() as any;
    result.success = true;

    // data.json format: { dataset: [...] } or { "@type": "dcat:Catalog", "dataset": [...] }
    const datasets: DcatUsDataset[] = data.dataset ?? data.datasets ?? (Array.isArray(data) ? data : []);
    result.totalDatasets = datasets.length;
    console.log(`  Total datasets: ${datasets.length}`);

    // Filter energy-relevant
    const energyDs = datasets.filter(isEnergyRelevant);
    result.energyRelevant = energyDs.length;
    console.log(`  Energy-relevant: ${energyDs.length}`);

    // Field coverage across energy datasets
    const fields = [
      "title", "description", "keyword", "publisher", "license",
      "landingPage", "temporal", "spatial", "modified", "distribution",
      "theme", "identifier", "accessLevel",
    ];
    for (const field of fields) {
      const count = energyDs.filter((ds) => {
        const val = ds[field];
        return val !== undefined && val !== null && val !== "" &&
          !(Array.isArray(val) && val.length === 0);
      }).length;
      result.fieldCoverage[field] = {
        count,
        pct: energyDs.length > 0 ? `${Math.round((count / energyDs.length) * 100)}%` : "0%",
      };
    }

    // Overlap detection
    for (const ds of energyDs) {
      const titleMatch = ds.title ? existingDatasets.get(ds.title.toLowerCase()) : null;
      const lpMatch = ds.landingPage ? existingDatasets.get(ds.landingPage.toLowerCase()) : null;
      const match = titleMatch ?? lpMatch;

      if (match) {
        result.overlapWithCatalog++;
      }
    }
    result.newEnergyDatasets = result.energyRelevant - result.overlapWithCatalog;

    // Top energy datasets (sample for review)
    result.topEnergyDatasets = energyDs.slice(0, 30).map((ds) => {
      const titleMatch = ds.title ? existingDatasets.get(ds.title.toLowerCase()) : null;
      const lpMatch = ds.landingPage ? existingDatasets.get(ds.landingPage.toLowerCase()) : null;
      return {
        title: ds.title ?? "(no title)",
        description: ds.description?.slice(0, 150),
        keywords: ds.keyword?.slice(0, 5),
        landingPage: ds.landingPage,
        distributions: ds.distribution?.length ?? 0,
        license: ds.license,
        matchesExisting: (titleMatch ?? lpMatch)?.title ?? undefined,
      };
    });

  } catch (err: any) {
    result.error = err.message ?? String(err);
    console.log(`  ERROR: ${result.error}`);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Run all probes
// ---------------------------------------------------------------------------
const ENDPOINTS = [
  { name: "DOE", url: "https://www.energy.gov/data.json" },
  { name: "EPA", url: "https://www.epa.gov/data.json" },
  { name: "EIA Atlas", url: "https://atlas.eia.gov/api/feed/dcat-us/1.1.json" },
];

const results: ProbeResult[] = [];

for (const ep of ENDPOINTS) {
  const result = await probeDcatUs(ep.name, ep.url);
  results.push(result);
  // Be polite between requests
  await new Promise((r) => setTimeout(r, 2000));
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------
mkdirSync(REPORTS_DIR, { recursive: true });

const report = {
  _meta: {
    script: "probe-dcat-endpoints.ts",
    fetchedAt: new Date().toISOString(),
    ticket: "SKY-216",
  },
  summary: results.map((r) => ({
    source: r.source,
    success: r.success,
    totalDatasets: r.totalDatasets,
    energyRelevant: r.energyRelevant,
    overlapWithCatalog: r.overlapWithCatalog,
    newEnergyDatasets: r.newEnergyDatasets,
    error: r.error,
  })),
  results,
};

writeFileSync(
  join(REPORTS_DIR, "dcat-endpoints-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("\n=== DCAT Endpoints Probe Results ===\n");
for (const r of results) {
  if (!r.success) {
    console.log(`${r.source}: FAILED (${r.error})`);
    continue;
  }
  console.log(`${r.source}:`);
  console.log(`  Total: ${r.totalDatasets} | Energy: ${r.energyRelevant} | Overlap: ${r.overlapWithCatalog} | New: ${r.newEnergyDatasets}`);
  console.log(`  Field coverage (energy datasets):`);
  for (const [field, { pct }] of Object.entries(r.fieldCoverage)) {
    if (pct !== "0%") console.log(`    ${field}: ${pct}`);
  }
  console.log(`  Sample energy datasets:`);
  for (const ds of r.topEnergyDatasets.slice(0, 5)) {
    const match = ds.matchesExisting ? ` [OVERLAP: ${ds.matchesExisting}]` : "";
    console.log(`    - ${ds.title}${match}`);
  }
}

console.log(`\nReport written to references/cold-start/reports/harvest/dcat-endpoints-probe.json`);
