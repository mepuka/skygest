# cold-start/catalog/ -- DCAT entities

Seven subdirectories, one per DCAT 3 entity type. All records decode
against the Phase 0 Effect Schema modules in
`src/domain/data-layer/`.

| Subdir | DCAT class | Schema | Notes |
|--------|-----------|--------|-------|
| `agents/` | dcat:Agent | `Agent` | Publishers, producers, operators. ~40 entities (EIA, IEA, IRENA, BNEF, ERCOT, etc.) |
| `catalogs/` | dcat:Catalog | `Catalog` | Publisher-scoped collections of Datasets |
| `catalog-records/` | dcat:CatalogRecord | `CatalogRecord` | Federation provenance -- the same Dataset appearing in multiple Catalogs |
| `datasets/` | dcat:Dataset | `Dataset` | The data-products themselves |
| `distributions/` | dcat:Distribution | `Distribution` | Concrete access points for Datasets (CSV download, API, PDF, web UI) |
| `data-services/` | dcat:DataService | `DataService` | API endpoints that serve multiple Datasets (EIA API, IEA API, CAISO OASIS) |
| `dataset-series/` | dcat:DatasetSeries | `DatasetSeries` | Recurring releases (EIA AEO, IEA WEO, Ember EER, etc.) |

CatalogRecord and DataService are derived/auxiliary -- they are
load-bearing for federation provenance but surface in downstream
validation only when their parent Dataset is resolved.

Minted IDs follow `https://id.skygest.io/{entity-kind}/{prefix}_{ULID}`.
The ID ledger is at `../.entity-ids.json`. Use
`bun scripts/cold-start-id.ts <entity-kind>` to mint new IDs.
