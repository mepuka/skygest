# skygest-cloudflare/references/

Reference material for the data intelligence layer (SKY-213 epic).

## `cold-start/`

Live entity data seeded during SKY-215 and SKY-216. These JSON files
are the canonical source of truth for the data-layer registry:
Variables, Series, Candidates from the canonical post survey, and
the full DCAT catalog graph (Agents, Catalogs, CatalogRecords,
Datasets, Distributions, DataServices, DatasetSeries).

Every file here decodes against the Phase 0 Effect Schema modules in
`src/domain/data-layer/`. See `cold-start/README.md` for structure
details.

The `skygest-editorial` repo consumes this data through a read-only
cache mirror under `.skygest/cache/`, populated by
`scripts/sync-data-layer-cache.ts` (SKY-232). Editorial never
hand-edits the cache. Canonical edits happen here in cloudflare,
followed by a re-sync.

## `ontology/`

Standards reference documents for the data-layer schemas. Consult
these when reasoning about alias relations, DCAT class semantics,
or cross-walk mappings:

- `dcat3-reference.md` -- DCAT 3 core + DCAT-AP profiles
- `oeo-reference.md` -- Open Energy Ontology
- `schema-org-reference.md` -- schema.org equivalents for export codecs
- `sdmx-reference.md` -- SDMX for statistical data exchange
- `skos-reference.md` -- SKOS for alias relation semantics

These docs are adjacent to the schema code they describe. If you need
them from the editorial repo, they live here cross-repo.

## Canonical design source

See the Linear doc "Data intelligence layer design session -- locked
decisions (April 8, 2026)" for the twelve trunk decisions D1-D12
that this material implements.
