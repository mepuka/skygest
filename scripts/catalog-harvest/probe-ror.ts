/**
 * Probe the ROR API v2 to harvest Agent aliases (ROR IDs, Wikidata QIDs,
 * websites) for all target energy data publishers.
 *
 * Source: https://api.ror.org/v2/organizations
 * Format: JSON, paginated, Elasticsearch query support
 * Rate limit: Generous for small queries (no key required)
 *
 * Output:
 *   references/cold-start/reports/harvest/ror-probe.json   (structured report)
 *
 * Usage: bun scripts/catalog-harvest/probe-ror.ts
 *
 * SKY-216: Phase 1 Track 1 — Catalog backfill
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROR_API = "https://api.ror.org/v2/organizations";
const REPORTS_DIR = join(import.meta.dirname, "..", "..", "references", "cold-start", "reports", "harvest");

// ---------------------------------------------------------------------------
// Target publishers: existing (verify aliases) + new (discover aliases)
// ---------------------------------------------------------------------------
interface PublisherQuery {
  slug: string;
  query: string;
  status: "existing" | "needed";
  currentRor?: string;
  currentWikidata?: string;
}

const PUBLISHERS: PublisherQuery[] = [
  // Existing agents — verify and enrich
  { slug: "eia", query: "Energy Information Administration", status: "existing", currentRor: "https://ror.org/026v3a610", currentWikidata: "Q1349935" },
  { slug: "iea", query: "International Energy Agency", status: "existing", currentRor: "https://ror.org/005fmfm13", currentWikidata: "Q192350" },
  { slug: "ember", query: "Ember Climate", status: "existing", currentWikidata: "Q98476350" },
  { slug: "ferc", query: "Federal Energy Regulatory Commission", status: "existing", currentRor: "https://ror.org/05zcbgd14", currentWikidata: "Q1400970" },
  { slug: "nrel", query: "National Renewable Energy Laboratory", status: "existing", currentRor: "https://ror.org/036266993", currentWikidata: "Q1579895" },
  { slug: "irena", query: "International Renewable Energy Agency", status: "existing", currentRor: "https://ror.org/01grfn956", currentWikidata: "Q901361" },
  { slug: "unfccc", query: "United Nations Framework Convention on Climate Change", status: "existing", currentRor: "https://ror.org/01mfmr560", currentWikidata: "Q183011" },
  { slug: "lbnl", query: "Lawrence Berkeley National Laboratory", status: "existing", currentRor: "https://ror.org/02jbv0t02", currentWikidata: "Q1133630" },
  { slug: "ercot", query: "Electric Reliability Council of Texas", status: "existing", currentWikidata: "Q5356944" },
  { slug: "caiso", query: "California Independent System Operator", status: "existing", currentWikidata: "Q2933655" },
  { slug: "pjm", query: "PJM Interconnection", status: "existing", currentWikidata: "Q7118859" },
  { slug: "spp", query: "Southwest Power Pool", status: "existing", currentWikidata: "Q7571625" },
  { slug: "bnef", query: "BloombergNEF", status: "existing", currentWikidata: "Q66048424" },
  { slug: "entso-e", query: "ENTSO-E", status: "existing", currentWikidata: "Q938882" },
  { slug: "cat", query: "Climate Action Tracker", status: "existing", currentWikidata: "Q28131250" },

  // New publishers — discover aliases
  { slug: "miso", query: "Midcontinent Independent System Operator", status: "needed" },
  { slug: "nyiso", query: "New York Independent System Operator", status: "needed" },
  { slug: "iso-ne", query: "ISO New England", status: "needed" },
  { slug: "nerc", query: "North American Electric Reliability Corporation", status: "needed" },
  { slug: "epa", query: "Environmental Protection Agency", status: "needed" },
  { slug: "eurostat", query: "Eurostat", status: "needed" },
  { slug: "agora", query: "Agora Energiewende", status: "needed" },
  { slug: "bnetza", query: "Bundesnetzagentur", status: "needed" },
  { slug: "rte", query: "RTE Reseau de Transport d'Electricite", status: "needed" },
  { slug: "ree", query: "Red Electrica de Espana", status: "needed" },
  { slug: "terna", query: "Terna", status: "needed" },
  { slug: "aemo", query: "Australian Energy Market Operator", status: "needed" },
  { slug: "cea", query: "Central Electricity Authority India", status: "needed" },
  { slug: "meti", query: "Ministry of Economy Trade and Industry Japan", status: "needed" },
  { slug: "world-bank", query: "World Bank", status: "needed" },
  { slug: "imf", query: "International Monetary Fund", status: "needed" },
  { slug: "iiasa", query: "International Institute for Applied Systems Analysis", status: "needed" },
  { slug: "climate-trace", query: "Climate TRACE", status: "needed" },
  { slug: "gcp", query: "Global Carbon Project", status: "needed" },
  { slug: "gridstatus", query: "GridStatus", status: "needed" },
  { slug: "gem", query: "Global Energy Monitor", status: "needed" },
  { slug: "owid", query: "Our World in Data", status: "needed" },
  { slug: "doe", query: "United States Department of Energy", status: "needed" },
  { slug: "beis", query: "Department for Energy Security and Net Zero", status: "needed" },
];

// ---------------------------------------------------------------------------
// Query ROR
// ---------------------------------------------------------------------------
interface RorResult {
  slug: string;
  query: string;
  status: "existing" | "needed";
  found: boolean;
  rorId: string | null;
  name: string | null;
  aliases: string[];
  acronyms: string[];
  website: string | null;
  wikidataId: string | null;
  isniId: string | null;
  fundrefId: string | null;
  types: string[];
  country: string | null;
  confidence: "exact" | "none";
  rejectedReason?: string;
  currentRor?: string;
  currentWikidata?: string;
  rorMatchesExisting: boolean | null;
  wikidataMatchesExisting: boolean | null;
}

// ---------------------------------------------------------------------------
// Name matching — only accept results we can verify
// ---------------------------------------------------------------------------
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Strict name matching — only accept results we can be confident about.
 *
 * "exact": full normalized name equality, OR long substring match (>15 chars)
 *          to avoid false positives on short acronyms like "ISO", "RTE", "CEA".
 * "none": everything else. No fuzzy/word-overlap matching — it produces too
 *         many false positives in this domain (orgs share words like "energy",
 *         "international", "system", "electricity").
 */
function matchConfidence(query: string, orgNames: string[], orgAcronyms: string[]): "exact" | "none" {
  const nq = normalize(query);
  const allNames = [...orgNames, ...orgAcronyms].map(normalize);

  for (const name of allNames) {
    // Full equality
    if (name === nq) return "exact";

    // Substring match — only if the matching portion is long enough to be unambiguous
    // This prevents "iso" matching "iso institut", "rte" matching "realtime embedded", etc.
    if (nq.length >= 15 && name.includes(nq)) return "exact";
    if (name.length >= 15 && nq.includes(name)) return "exact";
  }

  return "none";
}

function extractOrgData(item: any) {
  const names = item.names ?? [];
  const primaryName = names.find((n: any) => n.types?.includes("ror_display"))?.value
    ?? names[0]?.value ?? null;
  const aliases = names.filter((n: any) => n.types?.includes("alias")).map((n: any) => n.value);
  const acronyms = names.filter((n: any) => n.types?.includes("acronym")).map((n: any) => n.value);
  // Include ALL name values (labels in all languages, aliases, acronyms) for matching
  const allNames = names.map((n: any) => n.value).filter(Boolean);
  const website = (item.links ?? [])[0]?.value ?? null;
  const externalIds = item.external_ids ?? [];
  const wikidataId = externalIds.find((e: any) => e.type === "wikidata")?.all?.[0] ?? null;
  const isniId = externalIds.find((e: any) => e.type === "isni")?.all?.[0] ?? null;
  const fundrefId = externalIds.find((e: any) => e.type === "fundref")?.all?.[0] ?? null;
  const types = item.types ?? [];
  const country = item.locations?.[0]?.geonames_details?.country_name ?? null;
  return { rorId: item.id, primaryName, aliases, acronyms, allNames, website, wikidataId, isniId, fundrefId, types, country };
}

const NOT_FOUND: Omit<RorResult, "slug" | "query" | "status" | "currentRor" | "currentWikidata"> = {
  found: false, rorId: null, name: null, aliases: [], acronyms: [],
  website: null, wikidataId: null, isniId: null, fundrefId: null,
  types: [], country: null, confidence: "none",
  rorMatchesExisting: null, wikidataMatchesExisting: null,
};

async function queryRor(publisher: PublisherQuery): Promise<RorResult> {
  const url = `${ROR_API}?query=${encodeURIComponent(publisher.query)}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`  ROR query failed for ${publisher.slug}: ${resp.status}`);
      return { ...NOT_FOUND, slug: publisher.slug, query: publisher.query, status: publisher.status,
        currentRor: publisher.currentRor, currentWikidata: publisher.currentWikidata,
        rejectedReason: `HTTP ${resp.status}` };
    }

    const data = await resp.json() as any;
    const items = data.items ?? [];

    if (items.length === 0) {
      return { ...NOT_FOUND, slug: publisher.slug, query: publisher.query, status: publisher.status,
        currentRor: publisher.currentRor, currentWikidata: publisher.currentWikidata,
        rejectedReason: "no results" };
    }

    // Check ALL results (up to 10) for a name match, not just the top one
    for (const item of items.slice(0, 10)) {
      const org = extractOrgData(item);
      const confidence = matchConfidence(publisher.query, org.allNames, org.acronyms);

      if (confidence !== "none") {
        return {
          slug: publisher.slug, query: publisher.query, status: publisher.status,
          found: true, confidence,
          rorId: org.rorId, name: org.primaryName, aliases: org.aliases, acronyms: org.acronyms,
          website: org.website, wikidataId: org.wikidataId, isniId: org.isniId, fundrefId: org.fundrefId,
          types: org.types, country: org.country,
          currentRor: publisher.currentRor, currentWikidata: publisher.currentWikidata,
          rorMatchesExisting: publisher.currentRor ? org.rorId === publisher.currentRor : null,
          wikidataMatchesExisting: publisher.currentWikidata ? org.wikidataId === publisher.currentWikidata : null,
        };
      }
    }

    // No match passed validation — report the top result that was rejected
    const topOrg = extractOrgData(items[0]);
    return { ...NOT_FOUND, slug: publisher.slug, query: publisher.query, status: publisher.status,
      currentRor: publisher.currentRor, currentWikidata: publisher.currentWikidata,
      rejectedReason: `top result "${topOrg.primaryName}" did not match query "${publisher.query}"` };
  } catch (err) {
    console.warn(`  ROR query error for ${publisher.slug}: ${err}`);
    return { ...NOT_FOUND, slug: publisher.slug, query: publisher.query, status: publisher.status,
      currentRor: publisher.currentRor, currentWikidata: publisher.currentWikidata,
      rejectedReason: `error: ${err}` };
  }
}

// ---------------------------------------------------------------------------
// Run all queries (sequential to be polite to ROR)
// ---------------------------------------------------------------------------
console.log(`Querying ROR for ${PUBLISHERS.length} publishers...`);
const results: RorResult[] = [];

for (const pub of PUBLISHERS) {
  process.stdout.write(`  ${pub.slug}...`);
  const result = await queryRor(pub);
  results.push(result);
  if (result.found) {
    console.log(` [${result.confidence}] ${result.rorId} (${result.name})`);
  } else {
    console.log(` REJECTED: ${result.rejectedReason}`);
  }

  // Small delay between requests
  await new Promise((r) => setTimeout(r, 200));
}

// ---------------------------------------------------------------------------
// Build report
// ---------------------------------------------------------------------------
mkdirSync(REPORTS_DIR, { recursive: true });

const existingResults = results.filter((r) => r.status === "existing");
const neededResults = results.filter((r) => r.status === "needed");

const exactMatches = results.filter((r) => r.confidence === "exact");
const rejected = results.filter((r) => !r.found);

const report = {
  _meta: {
    script: "probe-ror.ts",
    source: ROR_API,
    fetchedAt: new Date().toISOString(),
    ticket: "SKY-216",
    note: "Only includes results where org name matches query. Rejected results listed with reasons.",
  },
  summary: {
    totalQueried: results.length,
    exactMatch: exactMatches.length,
    rejected: rejected.length,
    existing: {
      total: existingResults.length,
      verified: existingResults.filter((r) => r.found).length,
      rorMismatch: existingResults.filter((r) => r.found && r.rorMatchesExisting === false).length,
      wikidataMismatch: existingResults.filter((r) => r.found && r.wikidataMatchesExisting === false).length,
    },
    needed: {
      total: neededResults.length,
      matched: neededResults.filter((r) => r.found).length,
      withRor: neededResults.filter((r) => r.rorId).length,
      withWikidata: neededResults.filter((r) => r.wikidataId).length,
      withWebsite: neededResults.filter((r) => r.website).length,
    },
  },
  verified: results.filter((r) => r.found),
  rejected: rejected.map((r) => ({ slug: r.slug, query: r.query, reason: r.rejectedReason })),
};

writeFileSync(
  join(REPORTS_DIR, "ror-probe.json"),
  JSON.stringify(report, null, 2) + "\n",
);

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------
console.log("\n=== ROR Probe Results (with name validation) ===");
console.log(`Exact match: ${exactMatches.length} | Rejected: ${rejected.length}`);

console.log(`\nVerified matches:`);
for (const r of results.filter((r) => r.found)) {
  const flag = r.status === "existing"
    ? (r.rorMatchesExisting === false ? " [ROR ID DIFFERS from catalog]" : "")
    : " [NEW]";
  console.log(`  [${r.confidence}] ${r.slug}: ${r.name} | ${r.rorId}${flag}`);
}

console.log(`\nRejected (no name match in ROR results):`);
for (const r of rejected) {
  console.log(`  ${r.slug}: ${r.rejectedReason}`);
}

if (existingResults.filter((r) => r.found && r.rorMatchesExisting === false).length > 0) {
  console.log(`\nExisting agents with different ROR ID than catalog (needs review):`);
  for (const r of existingResults.filter((r) => r.found && r.rorMatchesExisting === false)) {
    console.log(`  ${r.slug}: catalog=${r.currentRor} vs ROR=${r.rorId}`);
  }
}

console.log(`\nReport written to references/cold-start/reports/harvest/ror-probe.json`);
