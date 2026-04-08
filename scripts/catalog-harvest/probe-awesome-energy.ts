/**
 * Probe the rebase-energy/awesome-energy-datasets data.json to find
 * energy data sources we don't yet have in our catalog.
 *
 * Source: https://raw.githubusercontent.com/rebase-energy/awesome-energy-datasets/main/data.json
 * Format: JSON array of dataset entries with name, description, links, format, coverage
 * License: MIT (the catalog itself)
 *
 * Output:
 *   references/cold-start/reports/harvest/awesome-energy-probe.json  (structured report)
 *
 * Usage: bun scripts/catalog-harvest/probe-awesome-energy.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_URL = "https://raw.githubusercontent.com/rebase-energy/awesome-energy-datasets/main/data.json";
const REPORTS_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "reports", "harvest");
const CATALOG_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "catalog");

// ---------------------------------------------------------------------------
// Load existing catalog for overlap detection
// ---------------------------------------------------------------------------
function loadExistingEntities(): { agents: Map<string, any>; datasets: Map<string, any> } {
  const agents = new Map<string, any>();
  const datasets = new Map<string, any>();

  const glob = new Bun.Glob("**/*.json");

  for (const path of glob.scanSync({ cwd: CATALOG_DIR })) {
    const full = join(CATALOG_DIR, path);
    try {
      const data = JSON.parse(readFileSync(full, "utf-8"));
      if (data._tag === "Agent") {
        agents.set(data.name.toLowerCase(), data);
        for (const alt of data.alternateNames ?? []) {
          agents.set(alt.toLowerCase(), data);
        }
        if (data.homepage) {
          agents.set(new URL(data.homepage).hostname, data);
        }
      }
      if (data._tag === "Dataset") {
        datasets.set(data.title.toLowerCase(), data);
        if (data.landingPage) {
          datasets.set(data.landingPage.toLowerCase(), data);
        }
      }
    } catch {}
  }

  return { agents, datasets };
}

// ---------------------------------------------------------------------------
// Fetch awesome-energy-datasets
// ---------------------------------------------------------------------------
console.log(`Fetching awesome-energy-datasets from ${DATA_URL}...`);
const response = await fetch(DATA_URL);
if (!response.ok) {
  console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const entries = await response.json() as any[];
console.log(`Fetched ${entries.length} entries`);

// ---------------------------------------------------------------------------
// Analyze schema shape
// ---------------------------------------------------------------------------
const allFields = new Set<string>();
for (const entry of entries) {
  for (const key of Object.keys(entry)) {
    allFields.add(key);
  }
}

// Field coverage
const fieldCoverage: Record<string, { count: number; ratio: string; samples: any[] }> = {};
for (const field of allFields) {
  const withField = entries.filter((e) => e[field] !== undefined && e[field] !== null && e[field] !== "");
  fieldCoverage[field] = {
    count: withField.length,
    ratio: `${Math.round((withField.length / entries.length) * 100)}%`,
    samples: withField.slice(0, 2).map((e) => e[field]),
  };
}

// Field mapping to our DCAT schema
const FIELD_MAP: Record<string, string> = {
  name: "Dataset.title",
  description: "Dataset.description",
  data_type: "Dataset.keywords (partial)",
  energy_sector: "Dataset.themes",
  format: "Distribution.format",
  coverage: "Dataset.themes / Series.fixedDims.place (partial)",
  links: "Distribution.accessURL + Dataset.landingPage",
};

// ---------------------------------------------------------------------------
// Overlap detection
// ---------------------------------------------------------------------------
const { agents, datasets } = loadExistingEntities();

interface OverlapEntry {
  name: string;
  description: string;
  url: string | null;
  energySector: string[];
  format: string[];
  coverage: string[];
  matchedDataset: string | null;
  matchedAgent: string | null;
  status: "overlap" | "partial" | "new";
  notes: string;
}

const overlapEntries: OverlapEntry[] = entries.map((entry: any) => {
  const name = entry.name ?? "";
  const url = entry.links?.url ?? entry.links?.api ?? null;
  const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return null; } })() : null;

  // Try to match against existing datasets by title
  const titleMatch = datasets.get(name.toLowerCase());

  // Try to match against existing datasets by URL
  const urlMatch = url ? datasets.get(url.toLowerCase()) : null;

  // Try to match publisher by hostname
  const agentMatch = hostname ? agents.get(hostname) : null;

  const matchedDataset = titleMatch?.title ?? urlMatch?.title ?? null;
  const matchedAgent = agentMatch?.name ?? null;

  let status: "overlap" | "partial" | "new";
  let notes = "";
  if (matchedDataset) {
    status = "overlap";
    notes = `Matches existing dataset: ${matchedDataset}`;
  } else if (matchedAgent) {
    status = "partial";
    notes = `Publisher exists (${matchedAgent}) but this specific dataset is new`;
  } else {
    status = "new";
    notes = "New publisher and dataset";
  }

  return {
    name,
    description: entry.description ?? "",
    url,
    energySector: entry.energy_sector ?? [],
    format: entry.format ?? [],
    coverage: entry.coverage ?? [],
    matchedDataset,
    matchedAgent,
    status,
    notes,
  };
});

const overlapCount = overlapEntries.filter((e) => e.status === "overlap").length;
const partialCount = overlapEntries.filter((e) => e.status === "partial").length;
const newCount = overlapEntries.filter((e) => e.status === "new").length;

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------
mkdirSync(REPORTS_DIR, { recursive: true });

const report = {
  _meta: {
    script: "probe-awesome-energy.ts",
    source: DATA_URL,
    fetchedAt: new Date().toISOString(),
    ticket: "SKY-216",
  },
  summary: {
    totalEntries: entries.length,
    overlap: overlapCount,
    partialOverlap: partialCount,
    new: newCount,
    energySectors: [...new Set(entries.flatMap((e: any) => e.energy_sector ?? []))].sort(),
    formats: [...new Set(entries.flatMap((e: any) => e.format ?? []))].sort(),
    coverageTypes: [...new Set(entries.flatMap((e: any) => e.coverage ?? []))].sort(),
  },
  schema: {
    fields: [...allFields].sort(),
    fieldCoverage,
    fieldMapping: FIELD_MAP,
  },
  overlapAnalysis: overlapEntries,
  newSources: overlapEntries.filter((e) => e.status === "new"),
  partialSources: overlapEntries.filter((e) => e.status === "partial"),
};

writeFileSync(
  join(REPORTS_DIR, "awesome-energy-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("\n=== Awesome Energy Datasets Probe Results ===");
console.log(`Total entries: ${entries.length}`);
console.log(`Overlap (already in catalog): ${overlapCount}`);
console.log(`Partial (publisher exists, dataset new): ${partialCount}`);
console.log(`New (publisher + dataset both new): ${newCount}`);
console.log(`\nEnergy sectors covered: ${report.summary.energySectors.join(", ")}`);
console.log(`Formats: ${report.summary.formats.join(", ")}`);

console.log("\nNew sources (not in our catalog):");
for (const entry of overlapEntries.filter((e) => e.status === "new").slice(0, 15)) {
  console.log(`  ${entry.name} | ${entry.energySector.join(",")} | ${entry.url ?? "no url"}`);
}
if (newCount > 15) console.log(`  ... and ${newCount - 15} more`);

console.log("\nPartial matches (publisher exists, new dataset):");
for (const entry of overlapEntries.filter((e) => e.status === "partial")) {
  console.log(`  ${entry.name} | publisher: ${entry.matchedAgent}`);
}

console.log(`\nReport written to references/cold-start/reports/harvest/awesome-energy-probe.json`);
