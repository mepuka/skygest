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

### 0B. Snapshot -> D1 ontology snapshots

- **Component:** entity backfill and ontology-store ingestion services
- **Output:** D1 `entity_snapshots` rows for ontology runtime entities
- **Why it matters:** D1 is the runtime source of truth for hydration

### 0C. Ontology corpus -> AI Search

- **Component:** Cloudflare AI Search binding `ENERGY_INTEL_SEARCH`
- **Output:** ranked query candidates with ontology metadata
- **Why it matters:** AI Search owns fuzzy recall and ranking, while D1 remains authoritative for returned payloads

### 0D. Snapshot -> ontology-store validation

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

- **Component:** `SearchEntitiesService.searchEntities`
- **Surface:** `search_entities`
- **Inputs:** exactly one of query text or exact ontology IRI
- **Outputs:** hydrated ontology entity hits

Search inputs can include:

- exact IRIs
- query text
- ontology runtime entity-type filters
- limit

### 5. Search ranks and hydrates results

The service combines:

1. exact IRI direct hydration
2. Cloudflare AI Search hybrid query retrieval

Exact IRI lookup bypasses AI Search. Query search preserves Cloudflare ranking, dedupes repeated chunks by IRI, and hydrates each returned IRI from D1 before responding. AI Search hits that cannot be decoded or hydrated are dropped and counted.

### 6. Search emits observability

- **Workers Logs:** structured Effect JSON logs
- **Analytics Engine:** one request datapoint through `REQUEST_METRICS`
- **Version metadata:** deploy tags from `CF_VERSION_METADATA`

Minimum production fields include route, status, duration, exact IRI hit count, hydration misses, dropped AI hits, AI Search latency, hydration latency, result count, and worker version metadata.

## What The Response Means

A `search_entities` response is a search result, not a durable link.

It can be used by:

- an editor or model looking up an entity
- an admin/operator debugging the registry
- future linking workflows that want candidate entities

It should not directly create graph edges, citation rows, or story frontmatter. Those writes belong in dedicated workflows that can apply review, provenance, and versioning rules.

## Feedback Loop

Search quality now improves through:

1. better ontology snapshot coverage
2. better AI Search corpus documents and metadata
3. better AI Search recall/ranking configuration
4. better hydration tests
5. observability over misses and dropped candidates

The old resolver eval loop is gone. The useful replacement is a smaller loop: curated search cases, corpus tests, hydration tests, and staging metrics.

## What This Trace Means Now

1. There is one ontology search surface.
2. Search is read-only candidate retrieval.
3. D1 ontology snapshot hydration is authoritative.
4. AI Search owns query recall/ranking but does not define payloads.
5. Enrichment stops at extraction outputs.
6. Linking and edge creation are future workflows, not hidden search side effects.
