# SKY-216 Catalog Backfill — Schema Gap Report

Date: 2026-04-08
Ticket: [SKY-216](https://linear.app/pure-logic-industrial/issue/SKY-216)

## Summary

44 publishers cataloged with 92 datasets, 131 distributions, 5 data services,
8 dataset series, and 94 catalog records. All entities decode against the
Phase 0 schema and pass referential integrity + semantic consistency checks.

## Entity coverage

| Entity | Count | Notes |
|--------|-------|-------|
| Agents | 44 | 43 with URL alias, 42 with Wikidata QID, 17 with ROR ID |
| Catalogs | 44 | One per Agent |
| Datasets | 92 | Range: 1–18 per publisher (EIA: 18, IEA: 8, Ember: 5) |
| Distributions | 131 | Avg 1.4 per dataset |
| DataServices | 5 | EIA API, IEA API, CAISO OASIS, GridStatus API, OWID GitHub |
| DatasetSeries | 8 | EIA AEO, IEA WEO, Ember EER/GER, IRENA capacity, Agora, GCP, GEM |
| CatalogRecords | 94 | Including 2 cross-catalog federation records (EIA in data.gov) |

## Gaps identified

### G1: Shallow dataset coverage for new publishers

Most new publishers have only 1–2 datasets. The ticket envisioned "comprehensive
coverage of canonical energy publishers." Publishers with minimal coverage:

- **Grid operators** (MISO, NYISO, ISO-NE, AEMO, RTE, Terna, REE, NERC): 1 dataset each.
  Real coverage would need separate datasets for generation, demand, prices,
  interconnection queues, and capacity — typically 3–5 per ISO.
- **Eurostat**: 1 dataset. Should have separate entries for energy balances,
  electricity prices, renewable energy statistics, GHG emissions.
- **World Bank, IMF, IIASA**: 1–2 each. The ticket listed these as having
  multiple data products.

**Proposed resolution**: Incremental enrichment as the candidate corpus grows.
Prioritize publishers that candidates actually reference.

### G2: Missing `license` field on most datasets

Only Ember datasets have license populated (CC-BY-4.0 from API probe). The
schema supports it, but most datasets were created without it.

**Proposed resolution**: Backfill licenses in a dedicated pass. Many government
datasets are public domain or CC-BY. Commercial publishers (BNEF, WoodMac,
Rystad, S&P) should be marked `"accessRights": "restricted"` — some already are.

### G3: Missing `temporal` coverage on all datasets

No dataset has temporal coverage populated. The schema supports it via the
`temporal` field (string). The EIA manifest provides temporal info
("annual", "monthly", "daily") but in a different format than ISO 8601 intervals.

**Proposed resolution**: Define a convention for temporal (e.g., start/end year
or ISO 8601 interval) and backfill from manifest data and publisher documentation.

### G4: Sparse `accessRights` field

Only the paywalled publishers (Wood Mackenzie, Rystad, S&P Global) have
`accessRights` set. All government and open-data datasets should be marked
`"public"`.

**Proposed resolution**: Default all non-commercial datasets to `"public"`,
mark commercial as `"restricted"`.

### G5: No Distribution-level `mediaType` or `byteSize`

Most Distributions have `format` (human-readable like "CSV", "Excel") but
not `mediaType` (IANA type like "text/csv") or `byteSize`. These are optional
in DCAT but improve machine discoverability.

**Proposed resolution**: Low priority. Add during connector work when we
actually access the distributions.

### G6: Data.gov federation records incomplete

Only 2 CatalogRecords represent cross-catalog federation (EIA STEO and EIA
electricity data appearing in both EIA's catalog and data.gov's catalog).
Many EIA datasets also appear in data.gov, and other publishers (NREL, EPA)
have datasets in data.gov.

**Proposed resolution**: Expand federation CatalogRecords when harvesting
from data.gov CKAN API. Not blocking for resolver matching.

### G7: AliasScheme coverage gaps

The `ExternalIdentifier` alias scheme currently supports 15 values. The
catalog backfill surfaced that several publishers use identifiers not yet
in the scheme:

- **SDMX dataflow IDs** (Eurostat, IEA, IMF): e.g., `nrg_bal_c` for
  Eurostat energy balances. No `sdmx-dataflow` scheme exists.
- **CKAN package IDs** (data.gov, OEDI): e.g., package UUIDs. No
  `ckan-id` scheme exists.
- **Grid operator data item codes** (ENTSO-E): e.g., `A73` for actual
  generation. No `entsoe-item` scheme exists.

**Proposed resolution**: Expand AliasScheme enum during Phase 3 resolver
work when these identifiers become load-bearing for matching. File as
schema revision against SKY-214 per the design doc discipline.
Cross-references: [SKY-225](https://linear.app/pure-logic-industrial/issue/SKY-225)
(research: expand AliasScheme).

### G8: No `description` on several existing datasets

Some datasets from the original `generate-catalog-seed.ts` have minimal
or missing descriptions. The new datasets from harvest scripts all have
descriptions.

**Proposed resolution**: Backfill descriptions on original datasets.
Low effort, high value for resolver context.

## Acquisition method coverage

| Method | Publishers covered | Notes |
|--------|-------------------|-------|
| ROR API (exact match) | 17 | Government agencies and research orgs |
| Wikidata SPARQL | 42 | All except BNEF and GridStatus |
| EIA Bulk Manifest | 1 (EIA: 18 datasets) | 100% DCAT field mapping |
| Hand curation | All 44 | Datasets, distributions, metadata |
| EPA EDG data.json | Probed, not harvested | 1,863 energy datasets available |
| Eurostat DCAT-AP | Not yet probed | RDF/SPARQL, highest priority |
| data.europa.eu SPARQL | Not yet probed | Pan-EU federation |
| RTE ODRÉ DCAT | Not yet probed | French grid DCAT-AP |

## Acceptance criteria status

| Criteria | Met? | Notes |
|----------|------|-------|
| Every Agent has >= 1 alias | Yes (43/44 URL, 1 pending data-gov) | data-gov Agent has empty aliases — add data.gov URL |
| Multi-dist Datasets use full Dist+DataService split | Yes | |
| Recurring publishers have DatasetSeries | Partial (8/~12) | Could add NERC seasonal, DESNZ quarterly, OWID annual |
| Coverage report on ticket | Yes | |
| Schema-gap report filed | Yes (this document) | |
| Output ingestible by Phase 2/3 | Yes | All pass cold-start-validation.test.ts |
