# Catalog Harvest Scripts

Probe and harvest scripts for populating the DCAT-shaped catalog in
`references/cold-start/catalog/`. Part of the **SKY-216** backfill workstream.

## Purpose

These scripts acquire structured metadata from external APIs and repos,
map it to our Effect Schema types (Agent, Dataset, Distribution, DataService,
DatasetSeries, CatalogRecord), and output JSON files that pass
`cold-start-validation.test.ts`.

**Scope:** populate the catalog for *matching* observed posts to known data
sources. We are not building connectors or live harvesters.

## Scripts

### Probe scripts (inspect API shapes, output reports)

| Script | Source | Output |
|--------|--------|--------|
| `probe-eia-manifest.ts` | EIA Bulk Download manifest (`eia.gov/opendata/bulk/manifest.txt`) | Field mapping report + raw manifest snapshot |
| `probe-ror.ts` | ROR API v2 (`api.ror.org/v2/organizations`) | Agent alias enrichments (ROR IDs). Strict name validation — rejects false positives. |
| `probe-wikidata.ts` | Wikidata SPARQL (`query.wikidata.org/sparql`) | Agent QIDs, websites, ROR cross-refs. Covers grid operators ROR misses. |
| `probe-awesome-energy.ts` | `rebase-energy/awesome-energy-datasets` (`data.json`) | Gap report: overlap vs. new sources |

### Harvest scripts (transform + deduplicate + output entities)

| Script | Purpose |
|--------|---------|
| `harvest-catalog.ts` | (Planned) Full transform pipeline: API data -> Effect Schema -> cold-start JSON |

## Usage

All scripts run with Bun from the repo root:

```sh
bun scripts/catalog-harvest/probe-eia-manifest.ts
bun scripts/catalog-harvest/probe-ror.ts
bun scripts/catalog-harvest/probe-wikidata.ts
bun scripts/catalog-harvest/probe-awesome-energy.ts
```

Reports are written to `references/cold-start/reports/harvest/`.

## Provenance

Each probe script documents:
- The source URL and API contract
- When it was last run
- What mapped to our schema vs. what was dropped
- Any caveats or data quality notes

Linear ticket: [SKY-216](https://linear.app/pure-logic-industrial/issue/SKY-216)
Design doc: [Data intelligence layer design session](https://linear.app/pure-logic-industrial/document/data-intelligence-layer-design-session-locked-decisions-april-8-2026-446a5f47d8fb)
