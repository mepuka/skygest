# Entity Search Trace: One Post Through The Cutover Path

This document replaces the old resolver trace. The shipped backend no longer runs:

`vision -> source attribution -> resolver worker -> Stage 1 -> bundle resolution -> data-ref-resolution`

The live path is now:

`vision -> source attribution -> search_entities`

Vision and source attribution are extraction outputs. `search_entities` is the canonical ontology-aligned read/search surface. It can be called by MCP, admin routes, future editorial tooling, and future linking workflows.

## Prep Loop

### 0A. Provider ingest -> git-backed snapshot

- **Component:** `scripts/cold-start-ingest-*.ts` and `src/ingest/dcat-harness/`
- **Input:** provider catalog/API surfaces
- **Output:** `.generated/cold-start/`
- **Why it matters:** search quality starts with clean ontology-aligned entity data

### 0B. Snapshot -> D1 registry

- **Component:** `scripts/sync-data-layer.ts`, `src/data-layer/Sync.ts`
- **Output:** D1 data-layer tables for Agent, Dataset, Distribution, Series, Variable, and deferred families
- **Why it matters:** D1 is the runtime source of truth for hydration

### 0C. Registry -> search projection

- **Component:** `src/search/*`, `src/services/d1/EntitySearchRepoD1.ts`
- **Output:** `SEARCH_DB` rows for text search, exact URL probes, hostname probes, aliases, and hydration
- **Why it matters:** search can only return what projection stores and hydrates

### 0D. Registry/search corpus -> AI Search

- **Component:** Cloudflare AI Search binding `ENERGY_INTEL_SEARCH`
- **Output:** semantic recall candidates
- **Why it matters:** AI Search improves recall, but D1 remains authoritative for returned payloads

### 0E. Snapshot -> ontology-store validation

- **Component:** `packages/ontology-store/`
- **Output:** RDF emit, SHACL validation, reload, and distill checks
- **Why it matters:** this validates ontology/export health offline without putting RDF reasoning in the Worker hot path

## Runtime Path

### 1. Post intake -> `posts` row

- **Component:** `IngestRunWorkflow`
- **Output:** `KnowledgePost` in D1
- **Why it matters:** downstream enrichment and editorial reads key off `PostUri`

### 2. Vision enrichment -> `post_enrichments(kind=vision)`

- **Component:** `VisionEnrichmentExecutor`
- **Output:** `VisionEnrichment`
- **Why it matters:** chart titles, visible URLs, source lines, axes, and media clues become structured extraction data

### 3. Source attribution -> `post_enrichments(kind=source-attribution)`

- **Component:** `SourceAttributionExecutor`
- **Output:** `SourceAttributionEnrichment`
- **Why it matters:** publisher and content-source hints remain useful context for readers, editors, and future search/linking workflows

There is no resolver call after this step. The enrichment workflow no longer writes `data-ref-resolution`.

### 4. A caller searches ontology entities

- **Component:** `EntitySearchService.searchEntities`
- **Surface:** `search_entities`
- **Inputs:** query text and/or exact probes
- **Outputs:** branded ontology entity hits plus fail-closed warnings

Search inputs can include:

- exact IRIs
- normalized URLs
- normalized hostnames
- aliases
- query text
- requested entity families
- limit

Enabled families:

- Agent
- Dataset
- Distribution
- Series
- Variable

Deferred families fail closed with warnings:

- Catalog
- CatalogRecord
- DatasetSeries
- DataService

### 5. Search normalizes probes

- **Component:** `src/platform/Normalize.ts`
- **Why it matters:** query-side URL, hostname, and alias values must normalize the same way stored projection values do

This prevents exact probes from silently missing because of schemes, `www`, query strings, fragments, casing, or alias-scheme differences.

### 6. Search ranks and hydrates results

The service combines:

1. exact IRI matches
2. exact URL matches
3. exact hostname matches
4. exact alias matches
5. lexical D1 search
6. Cloudflare AI Search semantic recall

Exact probes occupy the deterministic top scoring band. Fuzzy and semantic recall are merged below exact matches and hydrated from D1 before returning.

### 7. Search emits observability

- **Workers Logs:** structured Effect JSON logs
- **Analytics Engine:** one request datapoint through `REQUEST_METRICS`
- **Version metadata:** deploy tags from `CF_VERSION_METADATA`

Minimum production fields include route, status, duration, enabled/deferred entity families, exact probe counts, hydration misses, fail-closed counts, AI Search latency, hydration latency, and worker version metadata.

## What The Response Means

A `search_entities` response is a search result, not a durable link.

It can be used by:

- an editor or model looking up an entity
- an admin/operator debugging the registry
- future linking workflows that want candidate entities

It should not directly create graph edges, citation rows, or story frontmatter. Those writes belong in dedicated workflows that can apply review, provenance, and versioning rules.

## Feedback Loop

Search quality now improves through:

1. better registry coverage
2. better exact URL/hostname/alias projection
3. better labels and descriptions in the search document
4. better AI Search recall configuration
5. better hydration tests
6. observability over misses and fail-closed requests

The old resolver eval loop is gone. The useful replacement is a smaller loop: curated search probes, projection tests, hydration tests, and staging metrics.

## What This Trace Means Now

1. There is one ontology search surface.
2. Search is read-only candidate retrieval.
3. D1 projection/hydration is authoritative.
4. AI Search improves recall but does not define payloads.
5. Enrichment stops at extraction outputs.
6. Linking and edge creation are future workflows, not hidden search side effects.
