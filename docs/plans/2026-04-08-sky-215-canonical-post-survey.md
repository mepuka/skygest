# SKY-215: Canonical Post Survey — Hand-Resolve Representative Posts Through V/S/O Seam

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hand-resolve the 289 pre-selected posts through the Variable / Series / Observation seam, producing Variable, Series, and Candidate records plus enough DCAT catalog records to support resolution. Stress-test the Phase 0 schemas against real editorial cases, surface multi-expert clusters, and document schema gaps.

**Scope:** This is a **SKY-215 plan only.** Catalog records created here are a side effect — they seed SKY-216, but "done" means the SKY-215 acceptance criteria are met. SKY-216 (full catalog backfill) is a separate workstream.

**Architecture:** Data curation task producing JSON files in `references/cold-start/`. Each entity is a standalone JSON file that decodes against the Phase 0 Effect Schema modules in `src/domain/data-layer/`. A validation test reads all cold-start files and decodes them, verifying referential integrity. The survey data has been pre-classified into `references/cold-start/survey/` with cluster keys, data products, and resolution richness scores.

**Tech Stack:** Effect Schema (Phase 0 modules), `@effect/vitest` for validation tests, Bun for tooling scripts, staging MCP for post data.

**Linear ticket:** [SKY-215](https://linear.app/pure-logic-industrial/issue/SKY-215). Catalog records produced here feed [SKY-216](https://linear.app/pure-logic-industrial/issue/SKY-216) but do not close it.

**Canonical design source:** [Data intelligence layer design session](https://linear.app/pure-logic-industrial/document/data-intelligence-layer-design-session-locked-decisions-april-8-2026-446a5f47d8fb) — D1 (V/S/O), D2 (seven-facet Variable), D3 (IDs), D5 (DCAT), D7 (Candidate), D8 (dual-track cold-start)

**Phase 0 schemas (already landed, PR #71):**
- `src/domain/data-layer/ids.ts` — 11 branded ID types (`https://id.skygest.io/{kind}/{prefix}_{suffix}`)
- `src/domain/data-layer/alias.ts` — `ExternalIdentifier`, `AliasScheme`, `AliasRelation`, `Aliases`
- `src/domain/data-layer/variable.ts` — `Variable`, `Series`, `Observation`
- `src/domain/data-layer/candidate.ts` — `Candidate`, `DataLayerRecord`
- `src/domain/data-layer/catalog.ts` — `Agent`, `Catalog`, `CatalogRecord`, `Dataset`, `Distribution`, `DataService`, `DatasetSeries`
- `src/domain/data-layer/schema-org.ts` — export codecs

**ID format:** `https://id.skygest.io/{entity-kind}/{prefix}_{ULID}`
- IDs are **opaque**. The suffix is a ULID — it carries no semantic meaning. Do not encode publisher names, geography, or entity descriptions into the suffix. The ULID is a minting convention for ordering; the regex validates only URI shape and prefix, not suffix semantics.
- The regex validates `^https://id\.skygest\.io/{kind}/{prefix}_[A-Za-z0-9]{10,}$`.
- Use `scripts/cold-start-id.ts` to mint IDs. It generates proper ULIDs.

**Record format:** Plain JS objects with `_tag` discriminator. See `tests/data-layer-fixtures.test.ts` for canonical examples. Key patterns:
- Every entity has `_tag` literal field
- Most entities have `aliases: ExternalIdentifier[]`, `createdAt`, `updatedAt` (IsoTimestamp)
- `CatalogRecord` does NOT have aliases or timestamps — only catalog-tracking dates
- `Candidate.sourceRef.contentId` accepts `at://` and `x://` URIs
- Optional fields are simply omitted (not `null`), per `Schema.optionalKey`

---

## Survey corpus (pre-classified)

**Source files:**
- `references/cold-start/survey/classified-posts-v2.json` — 717 posts, full classification
- `references/cold-start/survey/multi-expert-clusters.json` — 60 multi-expert clusters

**Corpus statistics:**
- 717 unique posts (692 Bluesky + 17 Twitter + 14 manually curated)
- 280 with numeric claims (39%)
- 199 high-richness (best for V/S/O resolution)
- 59 unique data products identified
- 60 multi-expert clusters (2+ authors citing same dataset)
- 20 publishers mapped

**Working set:** `references/cold-start/survey/selected-for-resolution.json` (289 posts). This is the **source of truth** for which posts get resolved. It was produced by scoring all 717 classified posts and selecting based on multi-expert cluster membership, category diversity, publisher diversity, and geography diversity. Each entry includes a `selection_reason`. Do not re-derive this set — use it as-is.

**Key multi-expert clusters (prioritize for resolution):**

| Cluster Key | Experts | Posts | Data Product |
|-------------|---------|-------|-------------|
| `eia/today-in-energy` | 13 | 25 | EIA Today in Energy |
| `rtoinsider/grid-market-news` | 10 | 70 | RTO Insider |
| `unfccc/climate-negotiations` | 9 | 14 | UNFCCC |
| `iea/news-analysis` | 9 | 11 | IEA News & Analysis |
| `eia/electricity-data` | 9 | 11 | EIA Electricity Data |
| `ember/other` | 7 | 9 | Ember |
| `iea/demand` | 7 | 7 | IEA |
| `bnef/energy-transition-investment` | 5 | 5 | BNEF ETI |
| `ember/european-electricity-review` | 4 | 5 | Ember EER |
| `ercot/demand-us-tx` | 3 | 3 | ERCOT |
| `entso-e/iberian-blackout-report-2025` | 3 | 3 | ENTSO-E IBR |
| `ercot/solar-generation-records` | 3 | 3 | ERCOT Solar |
| `eia/generation-us` | 5 | 6 | EIA Gen |

---

## Task 1: Infrastructure — directory structure, validation test, ID helper

**Files:**
- Create: `references/cold-start/README.md`
- Create: `references/cold-start/catalog/agents/` (directory)
- Create: `references/cold-start/catalog/catalogs/` (directory)
- Create: `references/cold-start/catalog/datasets/` (directory)
- Create: `references/cold-start/catalog/distributions/` (directory)
- Create: `references/cold-start/catalog/data-services/` (directory)
- Create: `references/cold-start/catalog/dataset-series/` (directory)
- Create: `references/cold-start/catalog/catalog-records/` (directory)
- Create: `references/cold-start/variables/` (directory)
- Create: `references/cold-start/series/` (directory)
- Create: `references/cold-start/candidates/` (directory)
- Create: `references/cold-start/reports/` (directory)
- Create: `scripts/cold-start-id.ts`
- Create: `tests/cold-start-validation.test.ts`

**Step 1: Create directory structure**

```bash
mkdir -p references/cold-start/{catalog/agents,catalog/catalogs,catalog/datasets,catalog/distributions,catalog/data-services,catalog/dataset-series,catalog/catalog-records,variables,series,candidates,reports}
```

**Step 2: Write cold-start README**

Create `references/cold-start/README.md`:

```markdown
# Cold-Start Data (SKY-215 + SKY-216)

Seed data for the data intelligence layer. Every JSON file in this directory
decodes against the Phase 0 Effect Schema modules in `src/domain/data-layer/`.

## Structure

- `survey/` — Classified corpus (717 posts) and multi-expert cluster analysis
- `catalog/` — DCAT entities (Agent, Catalog, Dataset, Distribution, DataService, DatasetSeries, CatalogRecord)
- `variables/` — Variable records (seven-facet composition)
- `series/` — Series records (Variable + fixed dims)
- `candidates/` — Candidate records (post → V/S/O resolution)
- `reports/` — Schema-gap and multi-expert cluster reports

## Validation

Run `bun run test -- tests/cold-start-validation.test.ts` to validate all records.

## ID convention

IDs use the format `https://id.skygest.io/{entity-kind}/{prefix}_{ULID}`.
IDs are opaque — the ULID suffix carries no semantic meaning.
Use `bun scripts/cold-start-id.ts <entity-kind>` to mint new IDs.
```

**Step 3: Write ID generation helper**

Create `scripts/cold-start-id.ts`:

```ts
/**
 * Mint opaque cold-start IDs using ULID.
 * Usage: bun scripts/cold-start-id.ts <entity-kind> [count]
 * Example: bun scripts/cold-start-id.ts agent       → prints 1 agent ID
 *          bun scripts/cold-start-id.ts dataset 5    → prints 5 dataset IDs
 */
import { ulid } from "ulid";

const PREFIXES: Record<string, string> = {
  variable: "var", series: "ser", observation: "obs", agent: "ag",
  catalog: "cat", "catalog-record": "cr", dataset: "ds",
  distribution: "dist", "data-service": "svc", "dataset-series": "dser", candidate: "cand",
};

const kind = process.argv[2];
const count = parseInt(process.argv[3] || "1", 10);
if (!kind || !PREFIXES[kind]) {
  console.error("Usage: bun scripts/cold-start-id.ts <entity-kind> [count]");
  console.error("Kinds:", Object.keys(PREFIXES).join(", "));
  process.exit(1);
}

const prefix = PREFIXES[kind];
for (let i = 0; i < count; i++) {
  console.log(`https://id.skygest.io/${kind}/${prefix}_${ulid()}`);
}
```

> **Dependency:** Requires `ulid` package. Run `bun add -d ulid` if not already installed.

**Step 4: Write validation test**

Create `tests/cold-start-validation.test.ts` — reads all JSON files from `references/cold-start/`, decodes each against the appropriate schema based on `_tag`, and verifies referential integrity (all referenced IDs exist within the cold-start set).

```ts
import { describe, expect, it } from "@effect/vitest";
import { Schema, Either } from "effect";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  Variable, Series, Observation, Candidate,
  Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries,
} from "../src/domain/data-layer";

const ROOT = join(import.meta.dirname, "..", "references", "cold-start");

const SCHEMAS: Record<string, Schema.Schema<any>> = {
  Variable, Series, Observation, Candidate,
  Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries,
};

async function collectJson(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory() && !["reports", "survey"].includes(e.name)) out.push(...await collectJson(full));
    else if (e.isFile() && e.name.endsWith(".json")) out.push(full);
  }
  return out;
}

describe("Cold-start validation", () => {
  it("all JSON files decode against their schema", async () => {
    const files = await collectJson(ROOT);
    expect(files.length).toBeGreaterThan(0);
    const errors: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      const tag = raw._tag;
      if (!tag || !SCHEMAS[tag]) { errors.push(`${rel}: unknown _tag "${tag}"`); continue; }
      const result = Schema.decodeUnknownEither(SCHEMAS[tag])(raw);
      if (Either.isLeft(result)) {
        errors.push(`${rel}: decode failed — ${JSON.stringify(result.left).slice(0, 200)}`);
      }
    }
    if (errors.length > 0) throw new Error(`Decode errors:\n${errors.join("\n")}`);
  });

  it("referential integrity — all referenced IDs exist", async () => {
    const files = await collectJson(ROOT);
    const allIds = new Set<string>();
    const refs: Array<{ file: string; field: string; id: string }> = [];
    const REF_FIELDS = [
      "variableId", "seriesId", "sourceDistributionId", "publisherAgentId",
      "parentAgentId", "catalogId", "primaryTopicId", "datasetId",
      "accessServiceId", "duplicateOf", "inSeries",
      "referencedDistributionId", "referencedDatasetId", "referencedAgentId",
      "referencedVariableId", "referencedSeriesId",
    ];
    const REF_ARRAYS = ["distributionIds", "dataServiceIds", "servesDatasetIds"];

    for (const file of files) {
      const rel = relative(ROOT, file);
      const raw = JSON.parse(await readFile(file, "utf-8"));
      if (raw.id) allIds.add(raw.id);
      for (const f of REF_FIELDS) {
        if (raw[f] && typeof raw[f] === "string" && raw[f].startsWith("https://id.skygest.io/"))
          refs.push({ file: rel, field: f, id: raw[f] });
      }
      for (const f of REF_ARRAYS) {
        if (Array.isArray(raw[f])) for (const id of raw[f])
          if (typeof id === "string" && id.startsWith("https://id.skygest.io/"))
            refs.push({ file: rel, field: f, id });
      }
    }
    const missing = refs.filter(r => !allIds.has(r.id));
    if (missing.length > 0)
      throw new Error(`Missing IDs:\n${missing.map(m => `  ${m.file}: ${m.field} → ${m.id}`).join("\n")}`);
  });
});
```

**Step 5: Verify helper works**

Run: `bun scripts/cold-start-id.ts agent`
Expected: `https://id.skygest.io/agent/ag_<ULID>` (a fresh opaque ULID each time)

**Step 6: Commit**

```bash
git add references/cold-start/README.md scripts/cold-start-id.ts tests/cold-start-validation.test.ts references/cold-start/survey/
git commit -m "chore(cold-start): infrastructure + 717-post classified survey corpus (SKY-215)"
```

---

## Task 2: Catalog seed — original data publishers as DCAT Agent + Catalog + Dataset + CatalogRecord

Create Agent, Catalog, Dataset, Distribution, and **CatalogRecord** entities for the original data publishers referenced in the survey. This provides the DCAT backbone that Candidate records point at.

**Intermediary vs. original data publisher distinction:** The raw survey frequency is led by intermediaries — Enerdata (145 posts), Energy Storage News (72), RTO Insider (70), S&P Global (69). These are news aggregators that cite original data publishers. For DCAT catalog purposes, we seed the **original data publishers** whose datasets the experts actually reference. Intermediaries may appear as additional Agents if a Candidate explicitly cites them as the access path (e.g., a Distribution with `kind: "landing-page"` pointing at an RTO Insider article), but they are not the publisher of the underlying dataset.

**Original data publishers to seed (10):**

| Publisher | Survey Posts (direct) | Agent | Key Datasets |
|-----------|----------------------|-------|-------------|
| EIA | 73 | U.S. Energy Information Administration | Today in Energy, Electricity Data, State CO2, STEO, AEO, RECS, Petroleum |
| IEA | 70 | International Energy Agency | World Energy Investment, WEO, Renewables, Oil Market Report, Data Portal |
| Ember | 55 | Ember | European Electricity Review, Global Electricity Review, Data Explorer, Battery Storage |
| BNEF | 21 | BloombergNEF | Energy Transition Investment, Battery Price Survey, Data Center Demand |
| FERC | 19 | Federal Energy Regulatory Commission | Energy Infrastructure Update |
| ERCOT | 16 | Electric Reliability Council of Texas | Real-time generation data, solar records |
| CAISO | 12 | California ISO | Today's Outlook, Western EIM |
| PJM | 10 | PJM Interconnection | Capacity Auction Results, Load Forecast |
| NREL | 10 | National Renewable Energy Laboratory | ATB, Geothermal, Inertia Studies |
| IRENA | 7 | International Renewable Energy Agency | Renewable Capacity Statistics, Renewable Costs |

**Files per publisher:** `catalog/agents/{pub}.json`, `catalog/catalogs/{pub}-*.json`, `catalog/datasets/{pub}-*.json`, `catalog/distributions/{pub}-*.json`, `catalog/catalog-records/{pub}-*.json`, optional `catalog/data-services/{pub}-*.json`

**On-demand expansion:** The 10 publishers above are the seed. If a selected post in `selected-for-resolution.json` depends on a publisher outside this set (e.g., ENTSO-E, UNFCCC, SPP, NYISO, MISO, Climate Action Tracker, LBNL), create that publisher's Agent, Catalog, and Dataset records on demand during Task 5 resolution. The seed is a starting point, not a closed list.

**Step 1: Create all 10 Agent records**

Each Agent includes: `_tag: "Agent"`, `id`, `kind: "organization"`, `name`, `alternateNames`, `homepage`, `aliases` (ROR ID, Wikidata QID, homepage URL where available). IDs are opaque ULIDs minted via `scripts/cold-start-id.ts`.

**Step 2: Create Catalog records**

One Catalog per publisher representing their primary data portal.

**Step 3: Create Dataset + Distribution records**

For each of the 59 identified data products, create a Dataset with at least one Distribution. Key products from the survey (top 20):

- EIA Today in Energy (25 posts, 13 experts)
- EIA Electricity Data (11 posts, 9 experts)
- EIA State CO2 Emissions, STEO, AEO, RECS, Petroleum Navigator, International
- IEA News & Analysis, Data Portal, World Energy Investment, WEO, Renewables, Oil Market Report, Solar PV Supply Chains
- Ember European Electricity Review, Global Electricity Review, Data Explorer, Turkiye Review, Battery Storage Analysis
- BNEF Energy Transition Investment, Battery Price Survey, Data Center Demand, Corporate Clean Energy Buying
- FERC Energy Infrastructure Update, Orders & News
- ERCOT Solar Generation Records, Battery/RTC+B Data
- CAISO Today's Outlook, Western EIM, Battery Discharge Records, 100% WWS Days
- PJM Capacity Auction Results, Load Forecast
- NREL ATB, Geothermal
- IRENA Renewable Capacity Statistics, Renewable Costs
- ENTSO-E Iberian Blackout Report
- Climate Action Tracker Country Assessments
- LBNL Interconnection Queue Analysis

**Step 4: Create DataService records where APIs exist**

- EIA Open Data API v2
- IEA Data API
- CAISO OASIS

**Step 5: Create CatalogRecord records**

Every Dataset gets at least one CatalogRecord linking it to its publisher's Catalog. This is the federation primitive — it tracks when Skygest first saw the dataset and whether the record is authoritative (publisher's own catalog) or harvested (discovered via a third party). For cold-start, all records are authoritative with `isAuthoritative: true`.

Where a dataset is also discoverable via a second catalog (e.g., an EIA dataset that also appears on data.gov), create a second CatalogRecord with `isAuthoritative: false` and `duplicateOf` pointing to the authoritative record. This exercises the federation provenance model from D5.

**Step 6: Run validation**

Run: `bun run test -- tests/cold-start-validation.test.ts`

**Step 7: Commit**

```bash
git add references/cold-start/catalog/
git commit -m "feat(cold-start): DCAT catalog seed — 10 publishers, ~50 datasets, CatalogRecords (SKY-215)"
```

---

## Task 3: Variables — create the Variable taxonomy from survey categories

Create Variable records covering all the data categories found in the survey. Each Variable uses the seven-facet composition from D2.

**Variable taxonomy (derived from survey categories):**

| Variable | measuredProperty | domainObject | technologyOrFuel | statisticType | unitFamily |
|----------|-----------------|--------------|------------------|---------------|------------|
| Installed renewable capacity | capacity | renewable power | - | stock | power |
| Installed solar PV capacity | capacity | solar photovoltaic | solar PV | stock | power |
| Installed wind capacity | capacity | wind turbine | wind | stock | power |
| Installed offshore wind capacity | capacity | offshore wind turbine | offshore wind | stock | power |
| Installed battery storage capacity | capacity | battery storage | battery | stock | power |
| Installed nuclear capacity | capacity | nuclear reactor | nuclear | stock | power |
| Installed electrolyzer capacity | capacity | electrolyzer | hydrogen | stock | power |
| Electricity generation | generation | electricity | - | flow | energy |
| Solar electricity generation | generation | electricity | solar PV | flow | energy |
| Wind electricity generation | generation | electricity | wind | flow | energy |
| Coal electricity generation | generation | electricity | coal | flow | energy |
| Clean electricity share | share | electricity | - | share | dimensionless |
| Wholesale electricity price | price | electricity | - | price | currency_per_energy |
| Battery pack price | price | lithium-ion battery pack | battery | price | currency_per_energy |
| Offshore wind capital cost | price | offshore wind farm | offshore wind | price | currency |
| CO2 emissions from energy | emissions | energy consumption | - | flow | mass_co2e |
| Energy transition investment | investment | energy transition | - | flow | currency |
| Clean energy investment | investment | clean energy | - | flow | currency |
| Data center power demand | demand | data center | - | stock | power |
| Electricity demand | demand | electricity | - | flow | energy |
| Interconnection queue backlog | capacity | interconnection queue | - | stock | power |
| Heat pump installations | count | heat pump | heat pump | stock | dimensionless |

**Step 1: Create ~22 Variable JSON files** in `references/cold-start/variables/`

**Step 2: Run validation**

**Step 3: Commit**

```bash
git commit -m "feat(cold-start): Variable taxonomy — 22 seven-facet Variables from survey categories (SKY-215)"
```

---

## Task 4: Series — create Series records for key geography + frequency combinations

Create Series records that lock Variables to specific reporting contexts. Prioritize combinations that appear in multi-expert clusters.

**Key Series (from cluster analysis):**

- US electricity generation (annual) — EIA
- US-TX solar generation (daily/hourly) — ERCOT
- US-TX electricity demand (hourly) — ERCOT
- US-CA battery discharge (daily) — CAISO
- US-CA solar generation (daily) — CAISO
- US-CA electricity price (hourly) — CAISO
- EU coal generation by country (annual) — Ember
- EU solar generation by country (annual) — Ember
- Turkey wholesale electricity price — Ember
- South Africa clean electricity share (monthly) — Ember
- Global renewable capacity (annual) — IRENA
- Global solar PV capacity (annual) — IRENA
- Global energy transition investment (annual) — BNEF
- Global clean energy investment (annual) — IEA
- Global battery pack price (annual) — BNEF
- US data center power demand (forecast) — BNEF
- US CO2 emissions by state (annual) — EIA
- US interconnection queue (annual) — LBNL
- US-CA interconnection queue (cluster) — CAISO
- US-PJM capacity auction (annual) — PJM
- US-PJM load forecast — PJM
- Germany wholesale electricity price — ENTSO-E/EPEX

**Step 1: Create ~25 Series JSON files** in `references/cold-start/series/`

**Step 2: Run validation**

**Step 3: Commit**

```bash
git commit -m "feat(cold-start): Series records — 25 geography+frequency combinations (SKY-215)"
```

---

## Task 5: Candidates — resolve high-richness posts in batches

This is the core survey work. Resolve the 289 pre-selected posts into Candidate records.

**Working set:** Read `references/cold-start/survey/selected-for-resolution.json` (289 posts, source of truth). Do not re-derive the set. Each entry includes `selection_reason` (multi-expert cluster membership, category diversity, publisher diversity, or geography diversity).

**Batch structure (by publisher, parallelizable):**

| Batch | Publisher(s) | Est. Posts | Key Clusters |
|-------|-------------|-----------|-------------|
| 5a | EIA | ~50 | today-in-energy, electricity-data, state-co2, generation-us |
| 5b | IEA | ~45 | news-analysis, demand, forecast, world-energy-investment |
| 5c | Ember | ~35 | european-electricity-review, electricity-data-explorer, global |
| 5d | ERCOT + CAISO + PJM + SPP | ~35 | solar-records, demand, battery, capacity-auction |
| 5e | BNEF + IRENA + FERC + NREL | ~30 | energy-transition-investment, capacity-statistics, infrastructure-update |
| 5f | Remaining (ENTSO-E, UNFCCC, CAT, Twitter, manual) | ~45 | blackout-report, climate-negotiations, cross-platform |

**For each post, the Candidate record includes:**
- `sourceRef.contentId` — the post URI (`at://` or `x://`)
- `referencedAgentId` — the original data publisher (not the intermediary)
- `referencedDatasetId` — the specific dataset (from Task 2)
- `referencedDistributionId` — the specific access path (from Task 2)
- `referencedVariableId` — the Variable (from Task 3)
- `referencedSeriesId` — the Series, if geography/frequency is determinable (from Task 4)
- `assertedValue` / `assertedUnit` / `assertedTime` — if the post makes a specific numeric claim (optional — resolution does not require a numeric assertion)
- `rawLabel` — the data claim in the post's own words
- `rawDims` — key-value pairs for any contextual dimensions
- `resolutionState` — `"resolved"`, `"partially_resolved"`, or `"source_only"`

**Resolution state rules:**
- `resolved` — Variable + Series + Distribution all identified. The post clearly references a specific dataset at a known geography and frequency. A numeric assertion is common but **not required** — a post that links directly to "EIA ERCOT wind capacity data" is resolved even without citing a specific MW number.
- `partially_resolved` — Variable and/or Dataset identified, but Series or Distribution unclear. The post references a topic and publisher but doesn't pin down the specific reporting context.
- `source_only` — Post references data but we can only identify the publisher, not the specific dataset or variable. Common for policy commentary and opinion posts that mention a publisher in passing.

**Step 1-6: Create Candidate JSON files in batches** (one batch per step)

Each batch: read the selected posts from `selected-for-resolution.json` for that publisher group, create Candidate files in `references/cold-start/candidates/`, run validation after each batch. If a post requires an Agent or Dataset not yet created in Task 2, create it on demand (see Task 2 on-demand expansion rule).

**Step 7: Run full validation**

Run: `bun run test -- tests/cold-start-validation.test.ts`

**Step 8: Commit**

```bash
git commit -m "feat(cold-start): 289 Candidate records resolved from selected-for-resolution.json (SKY-215)"
```

---

## Task 6: Reports — schema-gap analysis + multi-expert cluster report

**Files:**
- Create: `references/cold-start/reports/schema-gaps.md`
- Create: `references/cold-start/reports/multi-expert-clusters.md`

**Step 1: Write schema-gap report**

Compile all gaps surfaced during resolution. Expected gaps from the initial 22-post analysis remain plus any new ones from the expanded corpus:

1. Multi-value Candidates (single post, multiple assertions)
2. Derived shares vs raw stocks
3. Intermediary vs original source (trade press citing agency data)
4. Retail vs wholesale price
5. Cross-source methodology differences (BNEF vs IEA investment)
6. Forecast vs historical distinction
7. Grid operational milestones vs statistical data (e.g., "ERCOT solar record" is a milestone, not a dataset)
8. RTO-as-publisher vs RTO-as-data-subject (ERCOT publishes data about ERCOT)

**Step 2: Write multi-expert cluster report**

Document all 60 clusters with 2+ authors. Focus on the top 15 with 3+ experts. For each:
- Which experts participate
- Whether they agree, disagree, or cite different facets
- The cross-expert join product value

**Step 3: Post reports as comments on SKY-215 in Linear**

**Step 4: Commit**

```bash
git commit -m "docs(cold-start): schema-gap + multi-expert cluster reports (SKY-215)"
```

---

## Task 7: Final validation + ticket update

**Step 1: Full test suite**

Run: `bun run test`

**Step 2: Verify acceptance criteria (per SKY-215)**

- [ ] All hand-resolved post records decode against Phase 0 schema
- [ ] Every resolved post has a Candidate record with appropriate resolutionState
- [ ] Variable records exercise all seven facets across the survey set
- [ ] At least 5 multi-expert clusters surfaced and documented (have 60)
- [ ] Schema-gap report filed with follow-up tickets
- [ ] Output artifacts organized for Phase 3 ingestibility

**Step 3: Commit + update Linear**

```bash
git add -A references/cold-start/ tests/cold-start-validation.test.ts scripts/cold-start-id.ts
git commit -m "feat(cold-start): complete canonical post survey — 717 classified, 289 resolved, 60 clusters (SKY-215)"
```

Move SKY-215 to Done. Post summary comment on SKY-215 with entity counts, cluster count, and schema-gap count. Post a separate comment on SKY-216 noting which catalog records were created as seeds and what expansion remains.

---

## Summary statistics (expected)

| Entity type | Count | Notes |
|-------------|-------|-------|
| Agent | ~10 | Original data publishers (not intermediaries) |
| Catalog | ~10 | One per publisher |
| CatalogRecord | ~55 | One per Dataset minimum, plus federation duplicates |
| Dataset | ~50 | 59 data products identified in survey |
| Distribution | ~60 | Landing pages, APIs, downloads |
| DataService | ~3 | EIA API, IEA API, CAISO OASIS |
| DatasetSeries | ~5 | IRENA annual capacity, Ember annual reviews |
| Variable | ~22 | Full seven-facet taxonomy |
| Series | ~25 | Geography + frequency combinations |
| Candidate | ~289 | All posts from selected-for-resolution.json |
| Schema gaps | ~8 | Documented in report |
| Multi-expert clusters | 60 | Documented in report |
