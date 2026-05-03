# Skygest System Context

This document maps the current top-level subsystems after the resolver hard cutover. The live backend no longer has a standalone resolver Worker, a `RESOLVER` binding, Stage 1 matching, bundle resolution, or stored `data-ref-resolution` rows.

The current backend shape is:

`ingest -> vision -> source attribution -> entity search`

`search_entities` is the single ontology-aligned search surface. It combines exact IRI, URL, hostname, alias, lexical, and AI Search recall, then hydrates results from the D1-backed entity-search projection. Linking and edge creation are future workflows, not part of the read/search path.

Effect vocabulary remains load-bearing here: subsystem names map to services, layers, Workflow classes, Worker entry points, or deploy bindings that can be searched in the repo.

## Diagram

```mermaid
graph TD
  Reader([Reader])
  Editor([Editor])
  MCPModel([MCP-calling LLM])
  Operator([Operator])

  subgraph CF[skygest-cloudflare]
    direction TB
    AgentWorker[skygest-bi-agent Worker<br/>src/worker/feed.ts]
    IngestWorker[skygest-bi-ingest Worker<br/>src/worker/filter.ts]
    Ingest[Post Ingest<br/>IngestRunWorkflow + ExpertPollCoordinatorDo]
    Enrich[Enrichment Chain<br/>EnrichmentRunWorkflow]
    Vision[Vision Lane<br/>VisionEnrichmentExecutor]
    Source[Source Attribution Lane<br/>SourceAttributionExecutor]
    EntitySearch[Unified Entity Search<br/>search_entities]
    SearchDb[Search Projection<br/>SEARCH_DB]
    AiSearch[Cloudflare AI Search<br/>ENERGY_INTEL_SEARCH]
    Registry[Ontology-aligned Registry<br/>D1 data-layer tables]
    Metrics[Workers Logs + Analytics Engine<br/>REQUEST_METRICS + CF_VERSION_METADATA]
    MCP[MCP Surface<br/>src/mcp/Router.ts]
    Api[HTTP API<br/>src/api + src/admin]
  end

  subgraph TOOLS[Local Tooling]
    direction TB
    ColdStart[Cold-start Ingest Toolchain<br/>scripts/cold-start-ingest-*.ts]
    Snapshot[Git-backed Snapshot<br/>.generated/cold-start/*]
    SearchRebuild[Search Projection Rebuild<br/>src/search/*]
    OntologyStore[Ontology Store Package<br/>packages/ontology-store]
  end

  subgraph ED[skygest-editorial]
    direction TB
    Hydrate[hydrate-story]
    Sync[Cache Sync CLIs]
    Caches[Editorial Caches<br/>.skygest/cache/*.json]
    BuildGraph[build-graph Validator]
    Discussion[Discussion Skill]
    Stories[Story Files]
    Editions[Editions]
  end

  DomainBridge[/"@skygest/domain<br/>tsconfig path alias"/]

  IngestWorker -->|hosts Workflow class| Ingest
  IngestWorker -->|hosts Workflow class| Enrich
  AgentWorker -->|hosts handler| MCP
  AgentWorker -->|hosts handler| Api
  AgentWorker -->|Service Binding<br/>INGEST_SERVICE| IngestWorker

  Ingest -->|D1 row: posts| Enrich
  Enrich --> Vision
  Vision -->|D1 row: post_enrichments<br/>kind=vision| Source
  Source -->|D1 row: post_enrichments<br/>kind=source-attribution| Enrich

  MCP --> EntitySearch
  Api --> EntitySearch
  EntitySearch --> SearchDb
  EntitySearch --> AiSearch
  EntitySearch --> Registry
  EntitySearch --> Metrics
  Enrich --> Metrics
  Ingest --> Metrics

  ColdStart --> Snapshot
  Snapshot -->|sync-data-layer| Registry
  Registry --> SearchRebuild
  SearchRebuild --> SearchDb
  Snapshot --> OntologyStore

  MCP -->|D1 reads| Enrich
  MCP -->|D1 reads| Registry
  Api -->|D1 reads| Registry

  CF -.->|src/domain/*<br/>Schemas + branded IDs| DomainBridge
  DomainBridge -.->|tsconfig paths<br/>resolved by Bun| ED

  Sync -->|MCP tool call| MCP
  Sync --> Caches
  Hydrate -->|MCP tool call| MCP
  Hydrate --> Stories
  Caches --> BuildGraph
  Stories --> BuildGraph
  Stories --> Editions
  Discussion --> Stories
  Discussion --> MCP

  Reader --> Editions
  Editor --> Discussion
  MCPModel --> MCP
  Operator --> Api
  Operator --> ColdStart
  Operator --> SearchRebuild
  Operator --> OntologyStore
  Operator --> IngestWorker
  Operator --> AgentWorker
```

## Subsystems

### Cloudflare Workers

**skygest-bi-ingest Worker** (`wrangler.toml`, `src/worker/filter.ts`). Hosts ingest, enrichment, the polling Durable Object, and the backend write routes. It owns the write-heavy workflow path.

**skygest-bi-agent Worker** (`wrangler.agent.toml`, `src/worker/feed.ts`). Serves public/admin HTTP routes and MCP. It uses `INGEST_SERVICE` for backend-owned writes and direct read bindings for search and read surfaces.

There is no active resolver Worker. `wrangler.resolver.toml`, resolver RPC, and the `RESOLVER` service binding were removed in the cutover.

### Runtime Flow

**Post Ingest** (`src/ingest/`). Polls tracked experts, writes posts, and launches enrichment.

**Enrichment Chain** (`src/enrichment/`). Runs vision and source attribution. It no longer calls a resolver and no longer writes `data-ref-resolution`.

**Vision Lane** (`src/enrichment/vision/`). Extracts chart/media cues, visible URLs, source lines, titles, and other evidence from post media.

**Source Attribution Lane** (`src/source/`). Produces publisher/source hints. It remains useful extraction output, but it is not a resolver handoff anymore.

**Unified Entity Search** (`src/services/EntitySearchService.ts`, `src/domain/entitySearch.ts`). The canonical search surface. It accepts typed probes and query text, fails closed for not-yet-enabled entity families, records per-request metrics, and returns branded ontology-aligned hits.

Enabled search families are Agent, Dataset, Distribution, Series, and Variable. Catalog, CatalogRecord, DatasetSeries, and DataService are intentionally fail-closed until projection and hydration are complete.

**Search Projection** (`SEARCH_DB`, `src/search/*`, `src/services/d1/EntitySearchRepoD1.ts`). Stores the search documents and exact probe indexes used by `search_entities`.

**AI Search Recall** (`ENERGY_INTEL_SEARCH`). Adds semantic recall to entity search. D1 remains the hydration source of truth for returned entity payloads.

**Data Layer Registry** (`src/domain/data-layer/*`, D1 registry tables). The ontology-aligned source of truth for entities and graph relationships.

**Observability** (`src/platform/Observability.ts`). Workers Logs are enabled. Analytics Engine records one search datapoint per `search_entities` request, and `CF_VERSION_METADATA` tags logs/metrics with deploy version metadata.

### Tooling

**Cold-start Ingest Toolchain** (`scripts/cold-start-ingest-*.ts`, `src/ingest/dcat-harness/`). Fetches catalog surfaces and projects them into the repo-local snapshot.

**Git-backed Snapshot** (`.generated/cold-start/`). The local source that feeds D1 sync, tests, search rebuilds, and ontology-store validation.

**Ontology Store Package** (`packages/ontology-store/`). Offline RDF emit, SHACL validation, reload, and distill tooling. It stays off the Worker hot path.

### Editorial Bridge

**MCP Surface** (`src/mcp/Router.ts`, `src/mcp/Toolkit.ts`). Exposes post reads, editorial bundles, pipeline status, and entity search. Old data-ref lookup tools are gone; future linking/search tools should build on `search_entities`.

**@skygest/domain** is still the shared schema bridge into `skygest-editorial` via tsconfig path aliases.

## Key Seams

| Seam | What crosses | Current contract |
|---|---|---|
| Worker deploy config | Cloudflare bindings and deploy targets | `wrangler.toml`, `wrangler.agent.toml` only |
| Ingest -> Enrichment | Post rows and workflow params | `IngestRunParams`, `EnrichmentRunParams` |
| Vision -> Source Attribution | Vision extraction payload | `VisionEnrichment` |
| Source Attribution -> Reads/Search | Publisher/source extraction payload | `SourceAttributionEnrichment` |
| Entity search request | Typed probes and query text | `SearchEntitiesRequest` |
| Entity search response | Branded ontology hits and warnings | `SearchEntitiesResponse` |
| Exact probe normalization | URL, hostname, alias matching | `src/platform/Normalize.ts` |
| Search projection | Searchable entity documents | `EntitySearchDocument` |
| AI Search recall | Semantic candidates before hydration | `EntitySemanticRecall` |
| Observability | Request metrics and deploy tags | `REQUEST_METRICS`, `CF_VERSION_METADATA` |
| Editorial bridge | Shared schemas into editorial repo | `@skygest/domain/*` |

## Current State

| Subsystem | State |
|---|---|
| Post ingest, enrichment, vision, source attribution | Shipped |
| Resolver Worker, resolver RPC, `RESOLVER` binding | Removed |
| Stored `data-ref-resolution` enrichment rows | Removed from live contract |
| Unified `search_entities` surface | Shipped |
| Entity-search D1 projection and hydration | Shipped |
| Cloudflare AI Search recall binding | Shipped |
| Search observability via Workers Logs and Analytics Engine | Shipped |
| Data-layer registry and sync pipeline | Shipped |
| Ontology-store validation/export tooling | Shipped as offline tooling |
| Link-writing workflows / edge creation | Future work |
