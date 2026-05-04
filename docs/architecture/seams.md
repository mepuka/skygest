# Skygest Seams Inventory

A seam is a place where one component hands data to another and the two could change independently. This inventory describes the post-resolver-cutover backend: enrichment produces extraction outputs, while entity search is the single ontology access surface.

The highest-risk seams are now:

- `search_entities`
- the branded entity-search domain contract
- Cloudflare AI Search recall/ranking
- D1 ontology snapshot hydration
- deploy-versioned observability
- the shared `@skygest/domain` bridge into editorial tooling

## Inventory

### Effect Layer Seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `IngestWorkflowLauncher` | cron/admin routes -> `IngestRunWorkflow` | `IngestRunParams` | locked | Starts the ingest workflow. |
| `EnrichmentWorkflowLauncher` | ingest/admin routes -> `EnrichmentRunWorkflow` | `EnrichmentRunParams` | locked | Starts vision and source-attribution work. |
| `VisionEnrichmentExecutor` | enrichment workflow -> stored vision row | `VisionEnrichment` | locked | Structured media evidence begins here. |
| `SourceAttributionExecutor` | enrichment workflow -> stored source row | `SourceAttributionEnrichment` | locked | Publisher/source evidence remains useful to readers and search consumers. |
| `SearchEntitiesService.searchEntities` | MCP/admin/API -> entity search | `SearchEntitiesRequest` / `SearchEntitiesResponse` | locked for this cutover | This is the one ontology search surface. |
| `OntologySearchIndex` | entity search -> AI Search | ontology metadata filters and ranked chunks | locked | Cloudflare owns fuzzy recall and ranking. |
| `OntologyEntityHydrator` | entity search -> D1 ontology snapshots | branded IRI decode and snapshot load | locked | Returned payloads come from D1, not AI Search chunks. |
| `RequestMetrics` | search/runtime services -> Analytics Engine | one datapoint per search request | stabilizing | Makes silent search regressions visible. |
| `DeployVersion` | runtime services -> logs/metrics | Cloudflare ScriptVersion metadata | stabilizing | Ties behavior back to a deploy. |
| `PostEnrichmentReadService` | MCP/API readers -> joined enrichment view | `GetPostEnrichmentsOutput` | locked | Readers still need vision and source-attribution outputs. |
| `EditorialPickBundleReadService` | hydrate-story/discussion -> bundled post context | `EditorialPickBundle` | locked | Story scaffolding depends on it. |

### Cloudflare Binding Seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `INGEST_SERVICE` | agent Worker -> ingest Worker | backend fetch routes mounted under `/admin` | locked | The agent Worker delegates backend-owned writes here. |
| `DB` | Workers -> primary D1 | D1 row decoders in `src/services/d1/*` | locked | Primary application storage. |
| `ENERGY_INTEL_SEARCH` | agent Worker -> Cloudflare AI Search | ontology search namespace | locked | Provides query recall and ranking. |
| `REQUEST_METRICS` | Workers -> Analytics Engine | request/search datapoints | locked | Production search health is visible in Cloudflare. |
| `CF_VERSION_METADATA` | Workers -> version metadata | deploy version tags | locked | Logs and metrics can be tied to deployments. |
| `ONTOLOGY_KV` | Workers -> KV | ontology/topic reads | stabilizing | Adjacent read surface; not the search authority. |

There is no active `RESOLVER` binding after the cutover.

### Stored Data Seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `posts` | ingest -> downstream readers | `KnowledgePost` | locked | Everything keys off `PostUri`. |
| `post_enrichments(kind=vision)` | vision -> read services | `VisionEnrichment` | locked | Keeps media extraction durable. |
| `post_enrichments(kind=source-attribution)` | source attribution -> read services | `SourceAttributionEnrichment` | locked | Keeps publisher/source extraction durable. |
| `post_enrichments(kind=data-ref-resolution)` | old resolver -> readers | removed from live contract | removed | Old resolved results are not preserved as a runtime surface. |
| `entity_snapshots` | entity ingestion/backfill -> search hydration | ontology runtime entity payloads | locked | Search hydrates AI Search IRIs from this table. |
| Registry tables | sync pipeline -> admin reads, editorial cache sync | `src/domain/data-layer/*` | locked | Legacy data-layer reads still exist outside the new search path. |
| `data_ref_candidate_citations` | old data-ref lookup path | migration 27 drops table | removed | Historical migrations can create it; final schema drops it. |
| `data_layer_audit` | sync/admin writes -> operator inspection | audit rows | locked | Registry changes need traceability. |

### Tooling and Filesystem Seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `.generated/cold-start/*` | fetch/cold-start ingest -> sync/tests/backfills | git-backed snapshot tree | stabilizing | Local source feeding runtime D1 tables. |
| Ontology-store emit/distill | snapshot entities -> RDF/SHACL round trip | `packages/ontology-store/*` | stabilizing | Offline validation/export seam, not Worker hot path. |
| `.skygest/cache/*.json` | cache sync CLIs -> editorial tools | editorial cache manifests | locked | Editorial repo reads local mirrors. |
| Story frontmatter | hydrate-story/discussion -> build-graph | `src/domain/narrative/*` | locked at base level | Filesystem contract for editorial work. |
| `@skygest/domain/*` alias | editorial repo -> Cloudflare schemas | tsconfig `paths` alias | locked | Keeps the repos on one schema set. |

### MCP and Editorial Seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `search_entities` | MCP/model/editor/operator -> entity search | branded typed search response | locked | One search surface replaces resolver/data-ref lookup tools. |
| `get_post_enrichments` | MCP reader -> enrichment read service | vision/source/grounding outputs | locked | The model can inspect extraction results. |
| `get_editorial_pick_bundle` | hydrate-story/discussion -> bundle reader | `EditorialPickBundle` | locked | Story scaffolding depends on it. |
| Future linking workflows | curated/linking jobs -> graph/edge writes | not in this slice | planned | Edge creation should be a dedicated workflow, not search side effect. |

## Stability Heat Map

Ordered by blast radius, highest first.

1. **`@skygest/domain/*` alias.** Breaks shared schemas across repos.
2. **`search_entities` contract.** This is now the system's canonical ontology access surface.
3. **AI Search recall/ranking.** Query search depends on the Cloudflare index and metadata filters.
4. **Ontology snapshot hydration.** Bad hydration makes search look wrong even when AI Search recall is correct.
5. **Exact IRI lookup.** Exact lookup must stay a direct hydration path, not a second search path.
6. **Observability.** Search regressions need metrics and deploy tags at launch, not after an incident.

## Current Seam Risks

### 1. AI Search Is Recall, Not Authority

Cloudflare AI Search can suggest and rank candidates. The response payload still comes from D1 ontology snapshots and branded domain schemas.

### 2. Linking Must Not Leak Into Search

Search returns candidates. Edge creation, citation writes, and durable linking jobs belong in dedicated workflows.

### 3. Historical Migration Names Are Not Live Surfaces

Older migrations can still mention `data_ref_candidate_citations` so existing databases can migrate forward. The final schema drops that table.

## Actor Exposure

**Reader** consumes published artifacts and depends indirectly on story files and editions.

**Editor** uses discussion, hydrate-story, caches, and MCP. The editor should see search results and extraction context, not old resolver rows.

**MCP-calling model** uses `search_entities`, post reads, thread tools, and editorial bundles.

**Operator** runs admin APIs, sync scripts, ontology-store validation, Cloudflare deploys, and observability checks.

## What Changed In This Refresh

1. Removed the resolver Worker seam and `RESOLVER` binding from the live architecture.
2. Removed `data-ref-resolution` as a live stored-data seam.
3. Reframed ontology access around `search_entities`.
4. Made Analytics Engine and version metadata part of the launch contract.
5. Moved linking and edge creation out of search and into future workflows.
