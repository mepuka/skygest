/**
 * Probe the EIA Bulk Download manifest to inspect its JSON shape and
 * map fields to our DCAT catalog schema.
 *
 * Source: https://www.eia.gov/opendata/bulk/manifest.txt
 * Format: JSON object with dataset entries keyed by category code
 * API contract: Single GET, returns DCAT-US (POD schema) compatible metadata
 *
 * Output:
 *   references/cold-start/reports/harvest/eia-manifest-probe.json   (structured report)
 *   references/cold-start/reports/harvest/eia-manifest-raw.json     (raw manifest snapshot)
 *
 * Usage: bun scripts/catalog-harvest/probe-eia-manifest.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_URL = "https://www.eia.gov/opendata/bulk/manifest.txt";
const REPORTS_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "reports", "harvest");

// Existing EIA datasets in our catalog (for overlap detection)
const EXISTING_EIA_SLUGS = [
  "eia-aeo-dataset",
  "eia-electricity-data",
  "eia-generation-us",
  "eia-international",
  "eia-petroleum",
  "eia-recs",
  "eia-state-co2",
  "eia-steo",
  "eia-today-in-energy",
];

// ---------------------------------------------------------------------------
// Fetch manifest
// ---------------------------------------------------------------------------
console.log(`Fetching EIA manifest from ${MANIFEST_URL}...`);
const response = await fetch(MANIFEST_URL);
if (!response.ok) {
  console.error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const text = await response.text();
let manifest: any;
try {
  manifest = JSON.parse(text);
} catch (e) {
  // The manifest may be line-delimited JSON or have a wrapper
  // Try parsing as-is first, then try line-by-line
  console.error("Failed to parse manifest as single JSON object, trying line-delimited...");
  const lines = text.split("\n").filter((l) => l.trim());
  manifest = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Inspect shape
// ---------------------------------------------------------------------------
mkdirSync(REPORTS_DIR, { recursive: true });

// Save raw manifest for reference
writeFileSync(
  join(REPORTS_DIR, "eia-manifest-raw.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Raw manifest saved to reports/harvest/eia-manifest-raw.json`);

// Analyze the structure
const isArray = Array.isArray(manifest);
const topLevelKeys = isArray ? [] : Object.keys(manifest);
const entries = isArray ? manifest : Object.values(manifest);

// Extract dataset-shaped entries (look for title/description/accessURL patterns)
interface ManifestEntry {
  _key?: string;
  title?: string;
  description?: string;
  keyword?: string[];
  accessURL?: string;
  webService?: string;
  format?: string;
  spatial?: string;
  temporal?: string;
  modified?: string;
  identifier?: string;
  publisher?: any;
  person?: string;
  mbox?: string;
  accessLevel?: string;
  license?: string;
  [k: string]: any;
}

const datasetEntries: ManifestEntry[] = [];

function collectEntries(obj: any, parentKey?: string) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    // Check if this object looks like a dataset entry
    if (obj.title || obj.accessURL || obj.webService) {
      datasetEntries.push({ ...obj, _key: parentKey });
    }
    // Recurse into children
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "object" && val !== null) {
        collectEntries(val, key);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      collectEntries(item, parentKey);
    }
  }
}

collectEntries(manifest);

// ---------------------------------------------------------------------------
// Field mapping analysis
// ---------------------------------------------------------------------------
interface FieldMapping {
  eiaField: string;
  dcatField: string;
  coverage: string; // "all", "most", "some", "none"
  sampleValues: any[];
  notes: string;
}

const allFields = new Set<string>();
for (const entry of datasetEntries) {
  for (const key of Object.keys(entry)) {
    allFields.add(key);
  }
}

function fieldCoverage(field: string): { ratio: number; samples: any[] } {
  const withField = datasetEntries.filter((e) => e[field] !== undefined && e[field] !== null);
  const samples = withField.slice(0, 3).map((e) => e[field]);
  return { ratio: withField.length / datasetEntries.length, samples };
}

const FIELD_MAP: Record<string, string> = {
  title: "Dataset.title",
  description: "Dataset.description",
  keyword: "Dataset.keywords",
  accessURL: "Distribution.accessURL (kind: download)",
  webService: "Distribution.accessURL (kind: api-access) + DataService.endpointURLs",
  format: "Distribution.format",
  spatial: "Dataset.themes / Series.fixedDims.place",
  temporal: "Dataset.temporal",
  modified: "Dataset.updatedAt",
  identifier: "Dataset.aliases (scheme: eia-route)",
  publisher: "Agent.name",
  person: "(contact metadata, not mapped)",
  mbox: "(contact metadata, not mapped)",
  accessLevel: "Dataset.accessRights",
  license: "Dataset.license",
};

const fieldMappings: FieldMapping[] = [];
for (const field of allFields) {
  const { ratio, samples } = fieldCoverage(field);
  const coverageLabel = ratio >= 0.95 ? "all" : ratio >= 0.7 ? "most" : ratio >= 0.3 ? "some" : "few";
  fieldMappings.push({
    eiaField: field,
    dcatField: FIELD_MAP[field] ?? "(unmapped)",
    coverage: `${coverageLabel} (${Math.round(ratio * 100)}%)`,
    sampleValues: samples,
    notes: "",
  });
}

// ---------------------------------------------------------------------------
// Overlap analysis with existing catalog
// ---------------------------------------------------------------------------
const overlapAnalysis = datasetEntries.map((entry) => {
  const key = (entry._key ?? entry.identifier ?? "").toLowerCase();
  const title = (entry.title ?? "").toLowerCase();

  // Try to match against existing slugs by keyword
  const possibleMatches = EXISTING_EIA_SLUGS.filter((slug) => {
    const slugWords = slug.replace("eia-", "").replace("-dataset", "").split("-");
    return slugWords.some((w) => key.includes(w) || title.includes(w));
  });

  return {
    key: entry._key ?? entry.identifier,
    title: entry.title,
    accessURL: entry.accessURL,
    webService: entry.webService,
    keywords: entry.keyword,
    existingMatch: possibleMatches.length > 0 ? possibleMatches : null,
    status: possibleMatches.length > 0 ? "overlap" : "new",
  };
});

const overlapCount = overlapAnalysis.filter((e) => e.status === "overlap").length;
const newCount = overlapAnalysis.filter((e) => e.status === "new").length;

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------
const report = {
  _meta: {
    script: "probe-eia-manifest.ts",
    source: MANIFEST_URL,
    fetchedAt: new Date().toISOString(),
    ticket: "SKY-216",
  },
  summary: {
    manifestShape: isArray ? "array" : "object",
    topLevelKeys: topLevelKeys.length > 0 ? topLevelKeys : "(array — no top-level keys)",
    totalDatasetEntries: datasetEntries.length,
    existingEiaDatasets: EXISTING_EIA_SLUGS.length,
    overlap: overlapCount,
    new: newCount,
  },
  fieldMappings,
  overlapAnalysis,
  sampleEntry: datasetEntries[0] ?? null,
};

writeFileSync(
  join(REPORTS_DIR, "eia-manifest-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("\n=== EIA Manifest Probe Results ===");
console.log(`Shape: ${report.summary.manifestShape}`);
if (topLevelKeys.length > 0) {
  console.log(`Top-level keys: ${topLevelKeys.join(", ")}`);
}
console.log(`Dataset entries found: ${datasetEntries.length}`);
console.log(`Overlap with existing catalog: ${overlapCount}`);
console.log(`New (not in catalog): ${newCount}`);
console.log("\nField mappings:");
for (const fm of fieldMappings.filter((f) => f.dcatField !== "(unmapped)")) {
  console.log(`  ${fm.eiaField} -> ${fm.dcatField} [${fm.coverage}]`);
}
console.log("\nUnmapped fields:");
for (const fm of fieldMappings.filter((f) => f.dcatField === "(unmapped)" && f.eiaField !== "_key")) {
  console.log(`  ${fm.eiaField} [${fm.coverage}]`);
}
console.log(`\nReports written to references/cold-start/reports/harvest/`);
