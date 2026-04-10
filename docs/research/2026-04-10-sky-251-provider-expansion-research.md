# SKY-251 Provider Expansion Research — 2026-04-10

**Parent issue:** [SKY-251 — Cold-start registry expansion: 16 agents, 6+ datasets, variable coverage gaps](https://linear.app/pure-logic-industrial/issue/SKY-251)
**Sibling plan in flight:** `docs/plans/2026-04-10-sky-254-eia-dcat-ingestion.md`

## Purpose

SKY-251 quantifies the cold-start data gap: 71% of in-scope gold-set entries cannot resolve at all because the publisher AGENT is missing; another 19% have the agent but lack the specific dataset/distribution. SKY-254 is building an Effect-native DCAT ingestion pipeline for EIA (walk → graph → validate → write). This research doc captures the provider landscape for adapting that same pipeline to every other SKY-251 tier-1/tier-2 publisher, so we can build **reusable adapters** rather than N bespoke scripts.

Four parallel research agents investigated provider catalog APIs grouped by region/vertical. Their verbatim briefs are preserved below, followed by a synthesis and the adapter-shape taxonomy.

---

## Cluster A — NOAA / WMO / IPCC (climate gaps)

### NOAA Global Monitoring Laboratory (`gml.noaa.gov`)

**Catalog API?** None. GML has no DCAT, REST, or CKAN catalog. The only JSON endpoint (`gml.noaa.gov/ccl/getresults.php`) returns tank calibration results keyed by serial number — useless for dataset discovery. Everything else is flat files with stable URLs under `/webdata/ccgg/trends/co2/` (e.g. `co2_mm_mlo.csv`, `co2_annmean_mlo.csv`, `co2_weekly_mlo.csv`, `co2_daily_mlo.csv`) plus an HTML "Data Finder" form at `gml.noaa.gov/data/data.php`.

**DCAT mapping.** One `Agent` (NOAA GML, ROR exists). One `Catalog` = "GML CCGG Trends" (synthetic). One `Dataset` per product (MLO monthly, annual, weekly, daily, growth rate). Each Dataset gets 2 `Distribution`s (`.txt` + `.csv`). No `DataService` — static files. Authoritative DOI exists for MLO continuous: `10.15138/yaf1-bk21`.

**Alias scheme.** DOI is the stable anchor (already in enum); add `noaa-gml-product` as local key (e.g. `mlo-co2-monthly`).

**Auth/rate/pagination.** None. Static files, public.

**Walk shape.** Flat — ~6-10 known products per species.

**Effort.** **Hand-curated JSON, not a walker.** ~50-line script that emits a fixed list of known GML products. Reuse Stage 2/3 validate-and-write pipeline only.

### NOAA NCEI Climate Data Online (CDO v2)

**Catalog API?** Yes — documented REST at `https://www.ncei.noaa.gov/cdo-web/api/v2/` with 7 endpoints: `datasets`, `datacategories`, `datatypes`, `locationcategories`, `locations`, `stations`, `data`. All return JSON `{metadata: {resultset: {offset, count, limit}}, results: [...]}`. Each item has `id`, `name`, `mindate`, `maxdate`, `datacoverage`.

**DCAT mapping.** `Agent` = NOAA NCEI. `Catalog` = "NCEI CDO". Each `/datasets` entry (GHCND, GSOM, GSOY, NORMAL_*, NEXRAD2, etc. — ~11 total) → `Dataset`. `datatypes` filtered by dataset → `Dataset` facets (DCAT `theme`/`keyword`). `stations` too numerous (>125k) to materialize — treat as `DataService` metadata. The `/data` endpoint = one `DataService` per dataset.

**Alias scheme.** Add `noaa-cdo-dataset-id` (values like `GHCND`, `GSOM`). Datatypes use `noaa-cdo-datatype`.

**Auth/rate/pagination.** Requires free token (`X-Token` header). **5 req/sec, 10,000 req/day, 1000 results/page**. `limit` + `offset` pagination. Free registration.

**Walk shape.** Shallow tree: `datasets → datatypes/locations/stations`. Not deeply recursive like EIA — top-level `datasets` returns the entire taxonomy in one page.

**Effort.** **New variant of the EIA walker.** Rename `response.routes` traversal into explicit parallel fetches of the 7 sibling endpoints. Reuse Stage 1 cache, Stage 2 graph, Stage 3 validate. Closest EIA analogue, highest strategic value — NOAA:climate :: EIA:energy.

### WMO (World Meteorological Organization)

**Catalog API?** Effectively no. Two candidates:
- `climatedata-catalogue-wmo.org` — HTML selector pages for Global/Regional/National. No REST, no OAI-PMH, no CKAN, no DCAT. Assessment metadata is human-request-only.
- `library.wmo.int` — each "State of the Global Climate" report has a record page (`/records/item/{id}-state-of-the-global-climate-{year}`). PDF-only. Report IDs: 56294 (2021), 66214 (2022), 68835 (2023), 69807 (2025).

No DOI on WMO reports themselves. Related Copernicus "Indicators of Global Climate Change" papers in ESSD **do** carry DOIs and Zenodo archives — better primary-source anchor for the EEI chart.

**DCAT mapping.** Synthetic DCAT (same pattern as planned SKY-252 Ember work). `Agent` = WMO (ROR + Wikidata). `Catalog` = "WMO State of the Global Climate" publication series. Each annual report → `CatalogRecord` + `Dataset` (PDF + any extracted CSV appendix as `Distribution`). EEI chart: attach provenance via `wasDerivedFrom` → ESSD/Zenodo DOI.

**Alias scheme.** Add `wmo-pub-no` (e.g. `WMO-No.1316`) and `wmo-library-record` (e.g. `66214`). Keep `doi` for companion Copernicus datasets.

**Effort.** **Synthetic DCAT**, not a walker. ~5 annual reports, hand-maintained.

### IPCC AR6 WGI (`ipcc-data.org` / `interactive-atlas.ipcc.ch`)

**Catalog API?** Partial. `ipcc-browser.ipcc-data.org` is a single-page app backed by an undocumented JSON API. Dataset records at `/browser/dataset/{id}/{version}` (numeric IDs 6171, 7305, 7713). Each ships structured JSON (title, DOI, version history, spatial/temporal coverage, variables, distribution URLs). Underlying data dual-hosted at CSIC handle repo + Copernicus CDS.

**DCAT mapping.** Very clean. `Agent` = IPCC (already in registry). `Catalog` = "IPCC DDC AR6 WGI". Each browser record → `Dataset` (DOI + version). Distributions → CSIC handle URL + CDS DOI URL. The AR6 Figure 6.16 / Atlas data are addressable by Zenodo DOIs (e.g. `10.5281/zenodo.14986548` for Atlas.17, `...14986546` for Atlas.16) — use Zenodo DOI as canonical id, not interactive-atlas URL.

**Alias scheme.** `doi` (exists) covers most cases. Add `ipcc-ddc-record` (numeric browser ID) as fallback.

**Effort.** **New variant.** Reverse-engineer 2-3 browser endpoints, simple fetch-by-id loop. Stage 2/3 reused as-is. NB: `ipcc.json` already in registry; SKY-251 specifically calls out gold-12 as a false-positive skip that just needs the candidate file to be created.

### Cluster A Summary

| Provider | API shape | Adapter | Gold-set unblock |
|---|---|---|---|
| NOAA GML | Static files | Hand-curated JSON | gold-31 (Mauna Loa) |
| NOAA NCEI CDO | Shallow REST tree | New walker variant | Strategic (no direct gold-set hit today) |
| WMO | No API, PDFs | Synthetic DCAT | gold-13 (EEI chart) |
| IPCC AR6 DDC | Undocumented JSON + Zenodo DOIs | Small fetch-by-id variant | gold-12 (AR6 6.16 candidate fix) |

---

## Cluster B — European grid (highest gold-set leverage)

### energy-charts.info (Fraunhofer ISE)

**Machine-readable catalog.** Yes. OpenAPI 3 spec at `https://api.energy-charts.info/openapi.json`, Swagger UI at `https://api.energy-charts.info/`. No auth, public, CC BY 4.0 for most data. Rate limit: soft, polite use ~1 req/s.

**Shape — FLAT, not walkable.** No route tree. Fixed set of ~16 endpoints; all variation via query parameters (`country`, `bzn`, `start`, `end`, `year`, `time_step`). The EIA-style `response.routes[]` lazy `whileLoop` does not apply. Instead, walker iterates the OpenAPI `paths` object once.

**Endpoint inventory (~16):**
- *Generation:* `/public_power`, `/public_power_forecast`, `/total_power`, `/frequency`
- *Capacity:* `/installed_power`
- *Price:* `/price` (day-ahead EUR/MWh per bidding zone)
- *Renewable share:* `/signal`, `/ren_share_forecast`, `/ren_share_daily_avg`, `/solar_share`, `/solar_share_daily_avg`, `/wind_onshore_share(_daily_avg)`, `/wind_offshore_share(_daily_avg)`
- *Cross-border:* `/cbet`, `/cbpf`

**DCAT mapping.**
- **Agent:** Fraunhofer ISE. The charts themselves are derived views — NOT the Datasets. Upstream data (ENTSO-E, Destatis, AGEB, SMARD) is already or will be covered by other agents. Energy-Charts' value-add is normalisation and a stable aggregate endpoint.
- **Catalog:** one — `energy-charts-api`.
- **DataService:** one — the REST API base URL.
- **Dataset:** one per endpoint-shape, with country/zone as a dimension (NOT a dataset split). ~16 Datasets, not ~16 × 30 countries. A dataset like `energy-charts/public_power` has `spatial=*EU+national` and `temporal=2015-present`.
- **Distribution:** JSON response per Dataset; optional CSV variant where exposed.

**Alias scheme.** Add `energy-charts-endpoint`. Value is path fragment without slash (`public_power`, `price`, `installed_power`). Matches upstream OpenAPI `operationId` conventions. **Enum extension required.**

**Ingest effort.** *OpenAPI adapter variant* — ~40% of EIA script. No tree walk. Fetch `openapi.json` once, iterate `paths`, materialize one `Dataset` + one `Distribution` per path, reuse Stage 2/3. No walk cache needed (single-shot).

**Gold-set unblocks:** gold-01 Ember Türkiye review, gold-06 battery spreads (context), gold-19 Ember UK gas heatmap, gold-21 OWID per-capita gas, gold-36 Hausfather 1.5C. SKY-251 lists Fraunhofer ISE as blocking 5 gold-set entries.

### NESO — National Energy System Operator GB

**Machine-readable catalog.** Yes, **standard CKAN**. Base: `https://api.neso.energy/api/3/action/`. No auth for reads.

**Shape — FLAT (CKAN package list).** `package_list` returns **227 packages** today. Not a tree — keyed flat list. Full detail via `package_show?id={name}`. Incremental walk is `package_list` once, then N × `package_show`.

**Rate limits.** 1 req/s on CKAN API, 2 req/min on Datastore. Our walk cache + 30-day TTL fits well.

**DCAT mapping (CKAN is DCAT-native).**
- **Agent:** NESO (rename of National Grid ESO; legacy alias `national-grid-eso`).
- **Catalog:** one NESO CKAN catalog.
- **DataService:** CKAN Action API base URL. Optionally DataStore SQL endpoint (`datastore_search_sql`) as a second DataService.
- **Dataset = CKAN package** (1:1). 227 datasets day one.
- **Distribution = CKAN resource.** Each resource → Distribution with `downloadURL = resource.url`, `mediaType = resource.format`.
- **CatalogRecord:** CKAN provides `metadata_created` / `metadata_modified` natively — first provider where CatalogRecord is non-synthetic.

**DCAT-AP.** NESO does not expose DCAT-AP JSON-LD publicly, but the CKAN model *is* DCAT internally via `ckanext-dcat`. Not required since we normalize to domain Effect schemas.

**Alias scheme.** Add `ckan-package-id`. Value is CKAN `name` slug. **Generic across publishers — this is the meta opportunity.** A single alias scheme + generic CKAN adapter covers NESO + data.gov.uk + Elia Open Data + data.gouv.fr + Fingrid Open Data + many EU TSOs. **One enum addition unlocks a whole adapter family.**

**Ingest effort.** *CKAN adapter variant* — ~50% of EIA script. Tree-walk logic replaced by `package_list` → per-package `package_show` concurrency-limited fan-out (`concurrency: 1` to respect 1 req/s). Validate + `Graph.topo` emit unchanged. **Write once, reuse ≥6×.**

**Gold-set unblocks:** gold-14 Carbon Brief UK record wind (likely "historic demand data" + "wind generation forecast"). NESO backs many UK chart discussions cited in SKY-251 tier 1.

### ENTSO-E Transparency Platform

**Machine-readable catalog.** **No catalog endpoint.** REST API is parameter-query-only: `documentType` (A65, A75, A44 …) + `in_Domain` / `out_Domain` (EIC codes) + `periodStart` / `periodEnd`. No `listDatasets`, no path tree. Auth: **security token required** (free registration). Rate limit: 400 req/min per token.

**Shape — matrix, not walkable.** (documentType × area EIC × time window). ~40 documentTypes × 100+ EIC areas. The catalog is implicit in the cross-product. Ingest must be *declarative* — we enumerate documentTypes and treat each as a Dataset.

**Documentation.**
- User guide: `transparency.entsoe.eu/content/static_content/Static content/web api/Guide.html`
- Postman collection: `documenter.getpostman.com/view/7009892/2s93JtP3F6`
- Reference code: `EnergieID/entsoe-py` → `mappings.py` has the canonical documentType → human-name table.

**DCAT mapping.**
- **Agent:** ENTSO-E (exists).
- **Catalog:** one (exists implicitly via DataService).
- **DataService:** `entsoe-transparency-api.json` (exists). Extend with `endpointDescription` pointing at Postman collection.
- **Dataset (new, manual):** one per documentType we commit to: `A65-system-total-load`, `A75-actual-generation-per-type`, `A44-day-ahead-prices`, `A85-imbalance-prices`, etc. Hand-curated — no catalog API to parse.
- **Distribution:** one per Dataset, XML/JSON with EIC+time as query params.

**Battery price spreads (gold-06).** This is a Modo Energy **derived** product built on ENTSO-E A44 + A85. Correct modelling:
1. Add `ENTSO-E A44 Day-ahead Prices` Dataset under existing ENTSO-E Catalog.
2. Add `ENTSO-E A85 Imbalance Prices` Dataset.
3. Create a **separate Modo Energy Agent + Dataset** `modo-energy/battery-price-spreads` with `wasDerivedFrom` referencing (1) and (2). Matches DCAT `prov:wasDerivedFrom`.

**Alias scheme.** Add `entsoe-document-type` (A44, A65, A75, A85…). Reuse existing `entsoe-eic` for areas.

**Ingest effort.** *No script — manual synthetic DCAT entries.* Bespoke matrix walker costs more than 4-6 hand-written JSON files. Derive dataset files from small script iterating hard-coded `[A44, A65, A75, A85, A73, A69]`.

### Cluster B Summary

| Provider | API shape | Adapter | Effort | New alias |
|---|---|---|---|---|
| energy-charts.info | Flat OpenAPI ~16 endpoints | OpenAPI walker variant | ~40% of EIA script | `energy-charts-endpoint` |
| NESO | CKAN flat list, 227 pkgs | **Generic CKAN adapter** (reusable ≥6×) | ~50% of EIA script | `ckan-package-id` |
| ENTSO-E | Parameter matrix, no catalog | None — manual synthetic DCAT | 4-6 hand-written files | `entsoe-document-type` |

---

## Cluster C — International DCAT hubs

### Eurostat (`ec.europa.eu/eurostat`)

**API shape.** SDMX 2.1 and SDMX 3.0 REST, with JSON-stat 2.0 as lightweight format. Base: `https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/`. Catalog listing: `dataflow/all/all/latest` returns complete dataflow registry. Structure queries return DSD (datastructure definitions) for dimensions. Also harvested into data.europa.eu as DCAT-AP.

**Tree vs flat.** Dataflows returned flat, but organized into a theme tree via `categorisation` + `categoryscheme` SDMX artifacts. Walker: flat pagination over `/dataflow/all/all/latest`, then hydrate via `/datastructure/` per dataflow.

**DCAT mapping.** `Dataflow → dcat:Dataset`, `Agency (ESTAT) → dcat:Agent`, SDMX-ML + JSON-stat + TSV → `dcat:Distribution`. Dataset code (`nrg_bal_c`) maps cleanly to existing `eurostat-code` alias — **no enum change needed**.

**Auth / limits.** No key. Public, soft rate-limited; downloads throttled to ~50 MB / 20 dimensions per call. Use SDMX `dataflow/all` for discovery, skip heavy data pulls.

**Catalog size.** ~8,000-10,000 dataflows. Energy subtree alone (`nrg_*`, `nrg_bal_*`, `nrg_pc_*`, `nrg_inf_*`) is ~400 dataflows.

**Effort.** Drop-in tree walker. Closest to EIA since Eurostat is hierarchical with clean "list all + fetch structure" split. Extra step: pull `categoryscheme` + `categorisation` so our `catalog` entities mirror Eurostat themes.

**Gold-set unlocks.** Directly relevant to Ember UK gas, OWID per-capita gas, UK record wind (Carbon Brief pulls Eurostat + ENTSO-E). Activates the dormant `eurostat-code` alias.

### IRENA / IRENASTAT (`pxweb.irena.org`)

**API shape.** PX-Web JSON REST v1 at `https://pxweb.irena.org/api/v1/en/IRENASTAT/`. Nodes return children recursively until you hit a leaf `.px` table with dimensions and observations. Metadata payload is classic PX-Web: `{id, type:'l'|'t', text, children[]}`.

**Tree vs flat.** **Fully tree-shaped** (database → topic folder → `.px` table). Same `Effect.whileLoop` pattern as EIA — cleanest reuse of existing walker code.

**DCAT mapping.** folder node → `dcat:Catalog`, `.px` table → `dcat:Dataset`, CSV/JSON/PX download variants → `dcat:Distribution`. IRENA agent already exists.

**Alias scheme.** PX table IDs look like `ELECCAP` / `Country_ELECSTAT_2025_H1-PX.px`. **Recommendation: add `px-table`** (generic) so the same scheme works for Nordic NSIs later (SCB, Statistics Finland, Statistics Norway — all use PX-Web).

**Auth / limits.** No key; PX-Web limits are per-cell (~100k cells per data query). Metadata walks are cheap.

**Catalog size.** ~20-30 leaf tables across Power Capacity/Generation, Energy Balances, RE Costs, Public Finance, Employment. Small, full walk in seconds.

**Solar PV Supply Chain Cost Tool (gold-09).** Confirmed **not in IRENASTAT PX-Web**. Standalone Excel-based modeling tool published alongside the Feb 2026 report (`irena.org/Publications/2026/Feb/Solar-PV-Supply-Chain-Cost-Tool...`). Needs manual DCAT authoring pointing at report PDF + XLSX.

**Effort.** Drop-in tree walk for IRENASTAT (2-3 hours). Solar PV Supply Chain Cost Tool remains manual catalog entry.

### IEA (`iea.org`)

**API shape.** No official public REST/DCAT catalog. Undocumented `api.iea.org` powers the Energy Statistics Data Browser; community scrapers exist. Most IEA data is paywalled.

**Effort.** **Not worth automating.** IEA = manual provider. `iea-api.json` stays as sole data-service.

### data.europa.eu (EU Open Data Portal)

**API shape.** Dual surface:
- **CKAN action API** at `https://data.europa.eu/api/hub/search/` — `datasets/` (Elastic-backed search), plus legacy CKAN `package_search`/`package_show`/`organization_list`. Returns DCAT-AP-flavoured JSON.
- **SPARQL endpoint** at `https://data.europa.eu/sparql` — RDF store (Virtuoso) with full DCAT-AP 2/3 triples.

**Tree vs flat.** Flat pagination. Themes filtered via `dcat:theme` facets.

**DCAT mapping.** **Native DCAT-AP.** Publishers → `dcat:Agent`, datasets → `dcat:Dataset`, distributions → `dcat:Distribution`, catalogs → `dcat:Catalog`. Literally our vocabulary.

**Harvest coverage.** >1.7M datasets from 170+ catalogs including Eurostat, EEA, JRC, national portals. **ENTSO-E is NOT harvested** (publishes via own SFTP + REST). **IRENA is NOT harvested**. Fraunhofer ISE inconsistent (some in Fordatis). So the "subsume multiple publishers" promise is real for EU-funded sources but excludes most SKY-251 critical energy-transparency feeds.

**Auth / limits.** No key. CKAN endpoint ~60 req/min. SPARQL has ~60s query-time limit.

**Alias scheme.** Dataset URIs stable (`http://data.europa.eu/88u/dataset/...`). Reuse existing `url` alias; let publisher-specific aliases carry upstream identifier as secondary.

**Effort.** CKAN action API adapter. Filter by publisher facet + theme `ENER`. ~1 day. SPARQL as backup for richer joins.

**Gold-set unlocks.** Ember (some harvested), EEA (GHG inventories), JRC PV-GIS, JRC IDEES. **Does NOT unlock:** ENTSO-E battery spreads, NESO, NOAA, WMO, Fraunhofer ISE, IRENA.

### OECD Data Explorer (`data-explorer.oecd.org`)

**API shape.** SDMX 2.0/2.1 REST at `https://sdmx.oecd.org/public/rest/`. Powered by .Stat Suite (same engine Eurostat partly uses).

**Tree vs flat.** Flat dataflow listing; agency prefixes encode quasi-hierarchy.

**DCAT mapping.** `Dataflow → dcat:Dataset`, agency → `dcat:Agent`.

**Alias scheme.** Identifier triple `{agency,flow,version}` (e.g. `OECD.ENV,DF_AIR_GHG,1.0`). **Add `sdmx-df`** — covers OECD + ESTAT SDMX 3.0 + UIS + ILOSTAT + UNSD.

**Catalog size.** ~1,500 dataflows across all OECD agencies. Energy-relevant (`OECD.ENV`, `OECD.SDD.NAD`) ~80 dataflows.

**Effort.** SDMX adapter. **Written generically, the same adapter runs against Eurostat SDMX 3.0 AND OECD.** ~2 days for shared abstraction, trivial per-provider config.

### Cluster C Summary

| Provider | API shape | Adapter | Alias | Effort |
|---|---|---|---|---|
| Eurostat | SDMX 2.1/3.0 | **Shared SDMX adapter** | `eurostat-code` (exists) | ~1 week with OECD |
| IRENASTAT | PX-Web tree | PX-Web variant of EIA walker | `px-table` | 2-3 hours |
| IEA | No API | Manual only | existing `iea-shortname` | — |
| data.europa.eu | CKAN + SPARQL | **Shared CKAN adapter** | `url` (exists) | ~1 day |
| OECD | SDMX 2.0/2.1 | **Shared SDMX adapter** | `sdmx-df` | bundled |

---

## Cluster D — US federal & small publishers

### data.gov (CKAN 2.11.4 @ `catalog.data.gov`)

**Catalog API.** Standard CKAN Action API at `https://catalog.data.gov/api/3/action/…`. Verified working:
- `package_search?q=…&fq=…&rows=N&start=K` — paginated full-text + faceted search
- `package_show?id=<slug-or-uuid>` — full package with resources
- `organization_list?all_fields=true&limit=…` — 132 organizations total
- `status_show` — confirms CKAN 2.11.4 + DCAT + DCAT-JSON extensions

**Size.** **402,377 datasets total.** Full walk infeasible; scope by `publisher` or `organization`.

**Auth / limits.** No API key for reads. Rate-limiting lenient — budget ~60 req/min, back off on 429. `rows` max 1000 per call. DCAT JSON-LD per-dataset at `/dataset/<slug>.jsonld` (behind 308 redirect — don't use; harvest `package_show` JSON instead).

**Sub-agency discovery.** Sub-agencies like USFWS and BLM are **not separate CKAN organizations**. They roll up to `doi-gov` (16,925 datasets). Filter by **DCAT-US `publisher` extras field**, not `organization`:
- `fq=publisher:"U.S. Fish and Wildlife Service"` → **598 datasets**
- `fq=publisher:"Bureau of Land Management"` → **800 datasets**
- `fq=organization:usace-army-mil` → **3 datasets** (USACE is its own org but barely populated)

**DCAT mapping.**
- CKAN `organization` → `Agent` (Publisher). Use `package.extras.publisher` to create a child `Agent` when it differs from CKAN org (common for DOI sub-bureaus).
- CKAN `package` → `Dataset`. Map `extras.identifier` (stable DCAT-US identifier) or fall back to CKAN UUID. `title`, `notes`→description, `tags`→keywords, `extras.theme`, `extras.modified`, `extras.landingPage`, `extras.bureauCode`, `extras.programCode`.
- CKAN `resource` → `Distribution`. `url`→`downloadURL`/`accessURL`, `format`, `mimetype`→`mediaType`, `name`→`title`.
- Top-level `Catalog` = `data.gov`. Root `DataService` = CKAN action API (`endpointURL=https://catalog.data.gov/api/3/action`).
- Optional `CatalogRecord` per package using `metadata_created`/`metadata_modified`.

**Alias scheme.** Need **two new enum values**:
1. `ckan-package-id` — CKAN UUID (universal across CKAN instances).
2. `dcat-us-identifier` — stable `extras.identifier` in DCAT-US 1.1.

Prefer `dcat-us-identifier` when present, fall back to `ckan-package-id`.

**Adapter effort.** Dedicated CKAN/DCAT-US adapter. Covers data.gov + LCCC + open.canada.ca + NESO + data.europa.eu. Comparable to EIA script.

**Phase 1 scope.** ~50 curated energy/climate datasets via targeted `q=` queries, NOT full 402k walk.

### USFWS ECOS

No standalone REST API with machine-readable DCAT. ECOS "Data Services" page lists a few downloadable tables; IPaC is interactive web form only. ECOS is mid-migration to "ECOSPHERE". **Section 7 consultation data is NOT bulk-downloadable**. TLS cert currently fails verification from automated fetchers.

**Adapter effort.** **Covered by data.gov CKAN adapter** (598 packages). Section 7: **synthetic DCAT** — Agent + Dataset pointing at IPaC, no Distributions.

### BLM + USACE

**BLM.** Primary portal is **BLM Geospatial Business Platform Hub** (`gbp-blm-egis.hub.arcgis.com`) — ArcGIS Hub, not CKAN. ArcGIS Hub publishes a `data.json` DCAT-US catalog at root (standard for all Esri Hubs). Also harvests 800 datasets into data.gov via same `data.json`. **Preferred: harvest via data.gov** — same adapter, no ArcGIS code. Later upgrade: ArcGIS Hub adapter for higher fidelity.

**USACE.** Two channels: `geospatial-usace.opendata.arcgis.com` (ArcGIS Hub with `data.json`) + 3 datasets in data.gov. **Preferred: ArcGIS Hub `data.json`** — same DCAT-US shape as data.gov. CKAN adapter needs a sibling "data.json DCAT-US" code path (cheap — same schemas, different transport).

**Adapter effort.** **Dedicated DCAT-US (`data.json`) adapter**, sharing schemas with CKAN adapter.

**Gold-set impact.** BLM ~800, USACE ~200 from GBP including NID dam inventory and hydropower datasets.

### LCCC (Low Carbon Contracts Company, UK)

**Genuine CKAN 2.11.3 instance** at `dp.lowcarboncontracts.uk`. Verified via `status_show`. **36 datasets**, 2 organizations, 6 groups. Tags: CfD, Forecast, SOFM. DataStore + S3 extensions active. CfD Register, capacity market auctions, actual CfD generation, avoided-GHG all present.

**Catalog API.** `https://dp.lowcarboncontracts.uk/api/3/action/...` — identical CKAN API to data.gov.

**Adapter effort.** **Covered by CKAN adapter** — config-only (change base URL).

**Gold-set impact.** Unlocks CfD-register gold candidate + any UK subsidy-linked energy posts. All 36 datasets in-scope energy.

### 440 Megatonnes / Canadian Climate Institute

Static site at `440megatonnes.ca/data/`. **7 named data products.** Downloads are ZIP/XLSX/CSV from own S3 + interactive dashboard. **Not** on open.canada.ca CKAN. CC-BY 4.0.

**Adapter effort.** **Synthetic DCAT (manual entry)**. Not worth scripting 7 datasets.

### Canary Media

Newsroom, not data publisher. Chart-of-the-week articles visualizing third-party data (BNEF, EIA, Ember). No API.

**DCAT mapping.** **Agent only**. No `DataService`, no `Dataset`, no `Distribution`. Same "synthetic DCAT" case as Ember/Carbon Brief — register publisher so posts can cite Canary articles as `wasDerivedFrom`, underlying data belongs to whichever source Canary cites.

### Channel Infrastructure NZ (refining-nz)

NZX-listed. Investor Centre publishes PDFs + occasional XLSX operational data. No API. Continuous Disclosure via NZX, not machine-readable.

**Adapter effort.** **Manual synthetic DCAT.** ~3 curated Dataset entries.

### BDH (Bundesverband der Deutschen Heizungsindustrie)

Primary site is `bdh-industrie.de` (**not** `bdh-koeln.de` — update agent file). Press-release PDFs with annual heat-generator sales. No CSV, no API.

**Adapter effort.** **Manual synthetic DCAT.** Agent + 1 Dataset.

### Cluster D Summary

| Provider | API shape | Adapter | New alias |
|---|---|---|---|
| data.gov | CKAN 2.11, 402k pkgs | **Shared CKAN adapter** (phase 1 scoped queries) | `ckan-package-id`, `dcat-us-identifier` |
| USFWS | No API; via data.gov | Shared CKAN adapter + synthetic entry for Section 7 | covered |
| BLM + USACE | ArcGIS Hub `data.json` | **`data.json` DCAT-US sibling code path** | covered |
| LCCC | CKAN 2.11.3, 36 pkgs | Shared CKAN adapter (config-only) | covered |
| 440 Megatonnes | Static site | Manual synthetic DCAT | `url` |
| Canary Media | News site | Manual Agent-only | `url` |
| Channel Infrastructure NZ | PDFs | Manual synthetic DCAT | `url` |
| BDH | Press releases | Manual synthetic DCAT (fix domain → `bdh-industrie.de`) | `url` |

---

## Synthesis — adapter shape taxonomy

Across all four clusters, provider-specific ingest reduces to **five adapter shapes**, each a thin driver over reusable harness code (Stages 2-3 from SKY-254):

| Shape | Adapter | Covers |
|---|---|---|
| **Hierarchical REST tree** (EIA-style) | Keep EIA walker, generalize `response.routes[]` accessor + `buildCandidateNodes` | EIA, IRENASTAT (PX-Web), NOAA NCEI CDO |
| **SDMX dataflow + DSD** | New shared adapter | Eurostat, OECD, future UNSD/ILOSTAT/UIS |
| **CKAN Action API** | New shared adapter | NESO, data.gov, LCCC, data.europa.eu, data.gov.uk, open.canada.ca |
| **DCAT-US `data.json`** | Sibling code path to CKAN (same decoder, different transport) | BLM, USACE, any ArcGIS Hub |
| **OpenAPI / flat REST** | Small variant — iterate `openapi.json paths` | Fraunhofer ISE energy-charts |
| *no catalog API* | **Synthetic DCAT** (manual JSON, no script) | NOAA GML, WMO, ENTSO-E documentTypes, Modo, Canary, 440MT, Channel NZ, BDH, IEA |

All five script-shapes share Stage 2 (`buildIngestGraph` / `Graph.topo`) and Stage 3 (`Effect.partition` validate → atomic write).

### Target harness structure (post-SKY-254)

```
src/ingest/dcat-harness/     ← generalized Stage 2/3
  IngestNode.ts              ← tagged-union over DCAT classes
  IngestEdge.ts              ← dependency-direction edges
  buildGraph.ts              ← Graph.directed constructor
  validateAndWrite.ts        ← Effect.partition + Graph.topo emitter
  loadCatalogIndex.ts        ← existing entity index loader
  CatalogContext.ts          ← publisher-agnostic BuildContext
  Adapter.ts                 ← Adapter<TResponse, TContext> interface

src/ingest/dcat-adapters/
  eia-tree.ts                ← existing SKY-254 walker, rebased on harness
  ckan.ts                    ← NESO, data.gov, LCCC, data.europa.eu
  dcat-us-datajson.ts        ← BLM, USACE, ArcGIS Hubs
  sdmx.ts                    ← Eurostat, OECD
  pxweb.ts                   ← IRENASTAT, Nordic NSIs
  openapi-flat.ts            ← Fraunhofer ISE energy-charts
  ncei-cdo.ts                ← NOAA climate (variant of eia-tree)

scripts/
  cold-start-ingest-eia.ts       ← CLI wrapper → eia-tree adapter
  cold-start-ingest-ckan.ts      ← CLI wrapper parameterized by base URL
  cold-start-ingest-sdmx.ts      ← CLI wrapper parameterized by agency
  cold-start-ingest-pxweb.ts     ← CLI wrapper
  cold-start-ingest-ncei-cdo.ts  ← CLI wrapper
  cold-start-ingest-energy-charts.ts  ← CLI wrapper
  cold-start-synthetic-dcat-bootstrap.ts  ← writes a batch of hand-curated JSONs
```

### Recommended sequencing

Order by **gold-set unblocks per day of effort**:

1. **SKY-254 EIA walker** — ship as-is to force the harness seam.
2. **Harness factoring** — extract Stages 2/3 into `src/ingest/dcat-harness/`, rebase `eia-tree` adapter on it. Do this during the first non-EIA adapter PR (not before SKY-254 merges).
3. **CKAN adapter** — highest leverage. Unblocks NESO (gold-14, UK derivatives), LCCC (CfD register), data.gov USFWS/BLM surface, later data.europa.eu. ~1 week including DCAT-US `data.json` sibling.
4. **SDMX adapter** — Eurostat + OECD. Activates dormant `eurostat-code` alias. ~1 week.
5. **PX-Web variant** — IRENASTAT, shares most EIA code. ~2 days. Partial gold-09 unblock.
6. **Synthetic DCAT batch PR** — NOAA GML, WMO, IPCC AR6 candidate fix, IRENA Solar PV Cost Tool, ENTSO-E documentTypes + Modo battery spreads, Canary Media, 440 Megatonnes, Channel Infrastructure NZ, BDH (domain fix). ~1 day.
7. **Fraunhofer ISE OpenAPI variant** — biggest remaining tier-1 gap (5 blocked entries). ~3 days.
8. **NCEI CDO walker variant** — strategic not urgent; climate twin of EIA.

### Alias scheme enum additions (12 total)

Required across the whole program:

```ts
"ckan-package-id",        // CKAN adapter
"dcat-us-identifier",     // CKAN + data.json adapters
"sdmx-df",                // SDMX adapter
"px-table",               // PX-Web adapter
"energy-charts-endpoint", // OpenAPI flat adapter
"entsoe-document-type",   // ENTSO-E synthetic DCAT
"noaa-gml-product",       // NOAA GML synthetic DCAT
"noaa-cdo-dataset-id",    // NCEI CDO walker
"noaa-cdo-datatype",      // NCEI CDO walker
"wmo-pub-no",             // WMO synthetic DCAT
"wmo-library-record",     // WMO synthetic DCAT
"ipcc-ddc-record"         // IPCC fetch-by-id variant
```

Consistent with `project_alias_scheme_growth.md` memory: enum growth during cold-start is expected and research-driven.

### Open questions

1. **Harness timing:** factor Stages 2/3 out of `cold-start-ingest-eia.ts` **during** the first non-EIA adapter PR (one extra adapter is enough to see the boundary) vs. before merging SKY-254 (adds scope to that PR) vs. retrofit after 2+ adapters land.
2. **Modo Energy modeling for gold-06:** distinct Agent with `wasDerivedFrom` → ENTSO-E A44+A85, or treat Modo as non-publishing analyst (editorial-only Agent, no dataset) like Canary Media?
3. **CKAN scope for data.gov:** Phase 1 target of ~50 curated energy/climate `q=` queries, or full walk of ~1,500 energy/climate publishers?
4. **CatalogRecord first-class support:** NESO is the first provider where CKAN gives us non-synthetic `metadata_created`/`metadata_modified`. Do we start populating CatalogRecord systematically, or keep treating it as optional/derived as in SKY-254?

---

## Source references (verbatim from research agents)

**Cluster A:**
- [NOAA GML Trends in CO2 Data](https://gml.noaa.gov/ccgg/trends/data.html)
- [NOAA GML MLO Dataset DOI 10.15138/yaf1-bk21](https://gml.noaa.gov/data/dataset.php?item=mlo-co2-observatory-monthly)
- [NOAA CDO Web Services v2](https://www.ncdc.noaa.gov/cdo-web/webservices/v2)
- [NOAA CDO v2 Token Request](https://www.ncdc.noaa.gov/cdo-web/token)
- [WMO State of the Global Climate series](https://wmo.int/publication-series/state-of-global-climate)
- [ESSD Indicators of Global Climate Change 2024](https://essd.copernicus.org/articles/17/2641/2025/)
- [IPCC DDC AR6 landing page](https://www.ipcc-data.org/ar6landing.html)
- [IPCC browser dataset record 6171](https://ipcc-browser.ipcc-data.org/browser/dataset/6171/0)
- [IPCC AR6 Atlas Figure 6.16 Zenodo](https://zenodo.org/records/14986548)

**Cluster B:**
- [Energy-Charts API OpenAPI](https://api.energy-charts.info/openapi.json)
- [NESO CKAN API guidance](https://www.neso.energy/data-portal/api-guidance)
- [NESO package_list](https://api.neso.energy/api/3/action/package_list)
- [ENTSO-E Transparency API Postman](https://documenter.getpostman.com/view/7009892/2s93JtP3F6)
- [entsoe-py documentType reference](https://github.com/EnergieID/entsoe-py/blob/master/entsoe/mappings.py)
- [ENTSO-E EIC codes](https://www.entsoe.eu/data/energy-identification-codes-eic/)

**Cluster C:**
- [Eurostat API introduction](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction)
- [Eurostat SDMX 3.0 getting started](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-getting-started/sdmx3.0)
- [data.europa.eu API documentation](https://dataeuropa.gitlab.io/data-provider-manual/api-documentation/)
- [data.europa.eu SPARQL](https://data.europa.eu/en/about/sparql)
- [IRENASTAT PxWeb](https://pxweb.irena.org/pxweb/en/IRENASTAT)
- [IRENA Solar PV Supply Chain Cost Tool (Feb 2026)](https://www.irena.org/Publications/2026/Feb/Solar-PV-Supply-Chain-Cost-Tool-Methodology-results-and-analysis)
- [Statistics Finland PxWeb API docs](https://pxdata.stat.fi/api1.html)
- [OECD SDMX dataflow endpoint](https://sdmx.oecd.org/public/rest/dataflow)
- [.Stat Suite typical use cases](https://sis-cc.gitlab.io/dotstatsuite-documentation/using-api/typical-use-cases/)

**Cluster D:**
- [catalog.data.gov CKAN API status_show](https://catalog.data.gov/api/3/action/status_show)
- [DCAT-US Schema v1.1](https://resources.data.gov/resources/dcat-us/)
- [LCCC Data Portal (CKAN 2.11.3)](https://dp.lowcarboncontracts.uk/)
- [ECOS Data Services – USFWS](https://ecos.fws.gov/ecp/services)
- [BLM Geospatial Business Platform Hub](https://gbp-blm-egis.hub.arcgis.com/)
- [USACE Geospatial Open Data](https://geospatial-usace.opendata.arcgis.com/)
- [440 Megatonnes Data](https://440megatonnes.ca/data/)
- [Channel Infrastructure NZ Investor Centre](https://channelnz.com/investor-centre/)
- [BDH Bundesverband der Deutschen Heizungsindustrie](https://www.bdh-industrie.de/)
