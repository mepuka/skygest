# Data Intelligence Layer Schemas

Effect Schema modules for the Skygest data intelligence layer. Implements decisions D1–D7 from the [canonical design doc](https://linear.app/pure-logic-industrial/document/data-intelligence-layer-design-session-locked-decisions-april-8-2026-446a5f47d8fb).

## V/S/O Three-Tier Seam (D1)

- **Variable** — place- and time-independent measurable concept (e.g., "installed wind generating capacity"). Seven optional facets define identity: `measuredProperty`, `domainObject`, `technologyOrFuel`, `statisticType`, `aggregation`, `basis`, `unitFamily`.
- **Series** — a Variable locked to a fixed reporting context via `fixedDims` (place, sector, market, frequency). E.g., "ERCOT installed wind capacity, annual."
- **Observation** — a single data point within a Series: value + time + provenance back to a Distribution.

Two Variables are the same exactly when their seven facets line up. Geography lives on Series, not Variable. Time lives on Observation, not Variable.

## Seven DCAT Entities (D5)

Full-fidelity W3C DCAT 3 modeling — never collapse a DCAT class into a field on another class.

| Entity | DCAT Class | Role |
|---|---|---|
| Agent | `foaf:Agent` | Person, organization, or program that publishes data |
| Catalog | `dcat:Catalog` | Curated collection of dataset metadata |
| CatalogRecord | `dcat:CatalogRecord` | A catalog's entry about a Dataset — distinct from the Dataset itself |
| Dataset | `dcat:Dataset` | Conceptual collection of data |
| Distribution | `dcat:Distribution` | Specific access point for a Dataset (CSV, API, PDF, etc.) |
| DataService | `dcat:DataService` | API described as a service linked from Distributions |
| DatasetSeries | `dcat:DatasetSeries` | Recurring releases (annual Form 860, monthly Ember snapshots) |

CatalogRecord is the only entity without managed timestamps or aliases — it carries catalog-tracking dates (`firstSeen`, `lastSeen`, `sourceModified`) only.

## Candidate / Observation (D7)

- **Candidate** — editorial primitive produced by post extraction. May be partially resolved. References data-layer entities via optional ID fields.
- **Observation** — data primitive from ingestion. All fields required.

These are independent types discriminated by `_tag`, unioned in `DataLayerRecord`.

## Alias Relations (D4)

SKOS-aligned: `exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, plus Skygest's `methodologyVariant` extension. Enforced `(scheme, value)` uniqueness per entity at decode time.

## Identifiers (D3)

Opaque URIs: `https://id.skygest.io/{entity-kind}/{prefix}_{ULID}`. Each entity kind has a branded Effect Schema type that rejects malformed URIs at the decode boundary.

## Ontology Annotations

Every entity schema carries `.annotate()` metadata linking back to formal ontology specs:
- `[DcatClass]` — W3C DCAT 3 class IRI
- `[DcatProperty]` — DCAT/Dublin Core property IRI (on fields)
- `[SchemaOrgType]` — schema.org export target
- `[SdmxConcept]` — SDMX information model concept
- `[DesignDecision]` — which D1–D12 decision locked the shape

Formal specs stored in `references/ontology/`.

## schema.org Export Codecs (D6)

Pure functions mapping internal types to schema.org JSON-LD. Lossy by design — schema.org cannot represent the seven-facet Variable composition, SKOS alias relations beyond `sameAs`, or DataService/DatasetSeries as first-class entities.
