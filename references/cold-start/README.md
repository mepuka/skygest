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
