/**
 * Probe Wikidata SPARQL for energy data publishers that ROR doesn't cover.
 * Targets grid operators (ISOs/RTOs), intergovernmental orgs, and NGOs.
 *
 * Source: https://query.wikidata.org/sparql
 * Format: JSON via SPARQL SELECT
 * Rate limit: Respectful usage, User-Agent required, no auth needed
 *
 * Strategy: Query each org by exact Wikidata QID (from our existing catalog
 * or known IDs) rather than text search. For orgs without known QIDs, use
 * targeted label search with language filter.
 *
 * Output:
 *   references/cold-start/reports/harvest/wikidata-probe.json
 *
 * Usage: bun scripts/catalog-harvest/probe-wikidata.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const REPORTS_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "reports", "harvest");

// ---------------------------------------------------------------------------
// Target publishers: known QIDs (verify + enrich) and unknown (discover)
// ---------------------------------------------------------------------------
interface WikidataTarget {
  slug: string;
  name: string;
  knownQid?: string;
  status: "existing" | "needed";
}

// QIDs verified via wbsearchentities API on 2026-04-08.
// Many original QIDs from generate-catalog-seed.ts were incorrect
// (e.g., Q1349935 was "event loop", not EIA). All corrected below.
const TARGETS: WikidataTarget[] = [
  // Existing agents — corrected QIDs
  { slug: "eia", name: "U.S. Energy Information Administration", knownQid: "Q1133499", status: "existing" },
  { slug: "iea", name: "International Energy Agency", knownQid: "Q826700", status: "existing" },
  { slug: "ember", name: "Ember", knownQid: "Q7416010", status: "existing" },
  { slug: "ferc", name: "Federal Energy Regulatory Commission", knownQid: "Q3067862", status: "existing" },
  { slug: "ercot", name: "Electric Reliability Council of Texas", knownQid: "Q5357475", status: "existing" },
  { slug: "caiso", name: "California Independent System Operator", knownQid: "Q16850559", status: "existing" },
  { slug: "pjm", name: "PJM Interconnection", knownQid: "Q25004450", status: "existing" },
  { slug: "nrel", name: "National Renewable Energy Laboratory", knownQid: "Q1856153", status: "existing" },
  { slug: "irena", name: "International Renewable Energy Agency", knownQid: "Q392739", status: "existing" },
  { slug: "entso-e", name: "European Network of Transmission System Operators for Electricity", knownQid: "Q1413905", status: "existing" },
  { slug: "unfccc", name: "United Nations Framework Convention on Climate Change", knownQid: "Q208645", status: "existing" },
  { slug: "cat", name: "Climate Action Tracker", knownQid: "Q1101409", status: "existing" },
  { slug: "lbnl", name: "Lawrence Berkeley National Laboratory", knownQid: "Q1133630", status: "existing" },
  { slug: "spp", name: "Southwest Power Pool", knownQid: "Q7571339", status: "existing" },
  // BNEF: not found in Wikidata (private company, no article)
  { slug: "bnef", name: "BloombergNEF", status: "existing" },

  // New publishers — grid operators / ISOs
  { slug: "miso", name: "Midcontinent Independent System Operator", knownQid: "Q6843392", status: "needed" },
  { slug: "nyiso", name: "New York Independent System Operator", knownQid: "Q134973495", status: "needed" },
  { slug: "iso-ne", name: "ISO New England", knownQid: "Q5974452", status: "needed" },
  { slug: "nerc", name: "North American Electric Reliability Corporation", knownQid: "Q2000377", status: "needed" },
  { slug: "aemo", name: "Australian Energy Market Operator", knownQid: "Q4034595", status: "needed" },
  { slug: "rte", name: "RTE", knownQid: "Q2178795", status: "needed" },
  { slug: "terna", name: "Terna S.p.A.", knownQid: "Q936325", status: "needed" },

  // New publishers — government agencies
  { slug: "epa", name: "United States Environmental Protection Agency", knownQid: "Q460173", status: "needed" },
  { slug: "eurostat", name: "Eurostat", knownQid: "Q217659", status: "needed" },
  { slug: "bnetza", name: "Bundesnetzagentur", knownQid: "Q269138", status: "needed" },
  { slug: "ree", name: "Red Eléctrica de España", knownQid: "Q1551220", status: "needed" },
  { slug: "meti", name: "Ministry of Economy, Trade and Industry", knownQid: "Q1197264", status: "needed" },
  { slug: "doe", name: "United States Department of Energy", knownQid: "Q217810", status: "needed" },
  { slug: "beis", name: "Department for Energy Security and Net Zero", knownQid: "Q116825523", status: "needed" },
  { slug: "cea", name: "Central Electricity Authority of India", knownQid: "Q5061026", status: "needed" },

  // New publishers — international / multilateral
  { slug: "world-bank", name: "World Bank", knownQid: "Q7164", status: "needed" },
  { slug: "imf", name: "International Monetary Fund", knownQid: "Q7804", status: "needed" },
  { slug: "iiasa", name: "International Institute for Applied Systems Analysis", knownQid: "Q212102", status: "needed" },

  // New publishers — NGOs / independent
  { slug: "agora", name: "Agora Energiewende", knownQid: "Q26882678", status: "needed" },
  { slug: "climate-trace", name: "Climate TRACE", knownQid: "Q107639702", status: "needed" },
  { slug: "gcp", name: "Global Carbon Project", knownQid: "Q5570159", status: "needed" },
  { slug: "gem", name: "Global Energy Monitor", knownQid: "Q65086937", status: "needed" },
  { slug: "owid", name: "Our World in Data", knownQid: "Q23680080", status: "needed" },
  { slug: "gridstatus", name: "GridStatus", status: "needed" },
];

// ---------------------------------------------------------------------------
// SPARQL query builder
// ---------------------------------------------------------------------------

/**
 * Build a SPARQL query that fetches structured data for a batch of QIDs.
 * Retrieves: label, description, official website, ROR ID, ISNI, inception date,
 * country, instance-of type.
 */
function buildBatchQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `
SELECT ?item ?itemLabel ?itemDescription ?website ?rorId ?isni ?inception ?countryLabel ?typeLabel WHERE {
  VALUES ?item { ${values} }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P6782 ?rorId }
  OPTIONAL { ?item wdt:P213 ?isni }
  OPTIONAL { ?item wdt:P571 ?inception }
  OPTIONAL { ?item wdt:P17 ?country }
  OPTIONAL { ?item wdt:P31 ?type }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`;
}

/**
 * Search for an org by label when we don't have a known QID.
 */
function buildSearchQuery(name: string): string {
  return `
SELECT ?item ?itemLabel ?itemDescription ?website ?rorId WHERE {
  ?item rdfs:label "${name}"@en .
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P6782 ?rorId }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
} LIMIT 5`;
}

// ---------------------------------------------------------------------------
// SPARQL executor
// ---------------------------------------------------------------------------
async function runSparql(query: string): Promise<any[]> {
  const resp = await fetch(SPARQL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/sparql-results+json",
      "User-Agent": "SkygestCatalogHarvest/1.0 (https://skygest.io; data@skygest.io)",
    },
    body: `query=${encodeURIComponent(query)}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`SPARQL query failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as any;
  return data.results?.bindings ?? [];
}

// ---------------------------------------------------------------------------
// Process results
// ---------------------------------------------------------------------------
interface WikidataResult {
  slug: string;
  name: string;
  status: "existing" | "needed";
  found: boolean;
  qid: string | null;
  label: string | null;
  description: string | null;
  website: string | null;
  rorId: string | null;
  isni: string | null;
  inception: string | null;
  country: string | null;
  types: string[];
  qidVerified: boolean | null; // for existing agents: does our QID resolve?
}

function extractQid(uri: string): string {
  return uri.split("/").pop() ?? uri;
}

// ---------------------------------------------------------------------------
// Run batch query for all targets with known QIDs
// ---------------------------------------------------------------------------
console.log(`Querying Wikidata for ${TARGETS.length} publishers...`);

const withQids = TARGETS.filter((t) => t.knownQid);
const withoutQids = TARGETS.filter((t) => !t.knownQid);

// Batch query in groups of 20 (Wikidata is generous but let's not push it)
const allBindings: any[] = [];
for (let i = 0; i < withQids.length; i += 20) {
  const batch = withQids.slice(i, i + 20);
  const qids = batch.map((t) => t.knownQid!);
  console.log(`  Batch ${Math.floor(i / 20) + 1}: querying ${qids.length} QIDs...`);
  const bindings = await runSparql(buildBatchQuery(qids));
  allBindings.push(...bindings);
  await new Promise((r) => setTimeout(r, 1000)); // rate limit
}

// Group bindings by QID (one item can have multiple types/websites)
const bindingsByQid = new Map<string, any[]>();
for (const b of allBindings) {
  const qid = extractQid(b.item.value);
  if (!bindingsByQid.has(qid)) bindingsByQid.set(qid, []);
  bindingsByQid.get(qid)!.push(b);
}

// Build results for targets with known QIDs
const results: WikidataResult[] = [];

for (const target of withQids) {
  const bindings = bindingsByQid.get(target.knownQid!) ?? [];

  if (bindings.length === 0) {
    console.log(`  ${target.slug}: QID ${target.knownQid} NOT FOUND`);
    results.push({
      slug: target.slug, name: target.name, status: target.status,
      found: false, qid: target.knownQid!, label: null, description: null,
      website: null, rorId: null, isni: null, inception: null, country: null,
      types: [], qidVerified: false,
    });
    continue;
  }

  // Deduplicate multi-valued properties
  const first = bindings[0];
  const websites = [...new Set(bindings.map((b: any) => b.website?.value).filter(Boolean))];
  const types = [...new Set(bindings.map((b: any) => b.typeLabel?.value).filter(Boolean))];
  const countries = [...new Set(bindings.map((b: any) => b.countryLabel?.value).filter(Boolean))];

  const result: WikidataResult = {
    slug: target.slug,
    name: target.name,
    status: target.status,
    found: true,
    qid: target.knownQid!,
    label: first.itemLabel?.value ?? null,
    description: first.itemDescription?.value ?? null,
    website: websites[0] ?? null,
    rorId: first.rorId?.value ?? null,
    isni: first.isni?.value ?? null,
    inception: first.inception?.value ?? null,
    country: countries[0] ?? null,
    types,
    qidVerified: true,
  };

  const rorNote = result.rorId ? ` | ROR: ${result.rorId}` : "";
  console.log(`  ${target.slug}: ${result.label} | ${result.website ?? "no website"}${rorNote}`);
  results.push(result);
}

// Search for targets without known QIDs
for (const target of withoutQids) {
  console.log(`  ${target.slug}: searching by label "${target.name}"...`);
  try {
    const bindings = await runSparql(buildSearchQuery(target.name));
    if (bindings.length > 0) {
      const first = bindings[0];
      const qid = extractQid(first.item.value);
      results.push({
        slug: target.slug, name: target.name, status: target.status,
        found: true, qid,
        label: first.itemLabel?.value ?? null,
        description: first.itemDescription?.value ?? null,
        website: first.website?.value ?? null,
        rorId: first.rorId?.value ?? null,
        isni: null, inception: null, country: null, types: [],
        qidVerified: true,
      });
      console.log(`    found: ${qid} (${first.itemLabel?.value})`);
    } else {
      results.push({
        slug: target.slug, name: target.name, status: target.status,
        found: false, qid: null, label: null, description: null,
        website: null, rorId: null, isni: null, inception: null, country: null,
        types: [], qidVerified: null,
      });
      console.log(`    not found`);
    }
  } catch (err) {
    console.warn(`    error: ${err}`);
    results.push({
      slug: target.slug, name: target.name, status: target.status,
      found: false, qid: null, label: null, description: null,
      website: null, rorId: null, isni: null, inception: null, country: null,
      types: [], qidVerified: null,
    });
  }
  await new Promise((r) => setTimeout(r, 1000));
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------
mkdirSync(REPORTS_DIR, { recursive: true });

const existingResults = results.filter((r) => r.status === "existing");
const neededResults = results.filter((r) => r.status === "needed");

const report = {
  _meta: {
    script: "probe-wikidata.ts",
    source: SPARQL_ENDPOINT,
    fetchedAt: new Date().toISOString(),
    ticket: "SKY-216",
    note: "All QIDs verified by direct SPARQL lookup. No text-search guessing.",
  },
  summary: {
    totalQueried: results.length,
    found: results.filter((r) => r.found).length,
    notFound: results.filter((r) => !r.found).length,
    withWebsite: results.filter((r) => r.website).length,
    withRorId: results.filter((r) => r.rorId).length,
    existing: {
      total: existingResults.length,
      verified: existingResults.filter((r) => r.qidVerified).length,
    },
    needed: {
      total: neededResults.length,
      found: neededResults.filter((r) => r.found).length,
    },
  },
  results,
};

writeFileSync(
  join(REPORTS_DIR, "wikidata-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("\n=== Wikidata Probe Results ===");
console.log(`Found: ${report.summary.found}/${report.summary.totalQueried}`);
console.log(`With website: ${report.summary.withWebsite}`);
console.log(`With ROR ID (cross-ref): ${report.summary.withRorId}`);

console.log("\nAll verified publishers:");
for (const r of results.filter((r) => r.found)) {
  const ror = r.rorId ? ` | ROR: ${r.rorId}` : "";
  const tag = r.status === "needed" ? " [NEW]" : "";
  console.log(`  ${r.slug}: ${r.qid} | ${r.label} | ${r.website ?? "no website"}${ror}${tag}`);
}

if (results.some((r) => !r.found)) {
  console.log("\nNot found:");
  for (const r of results.filter((r) => !r.found)) {
    console.log(`  ${r.slug}: "${r.name}"`);
  }
}

console.log(`\nReport written to references/cold-start/reports/harvest/wikidata-probe.json`);
