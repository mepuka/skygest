# Skygest System Context

This document maps the top-level subsystems across `skygest-cloudflare` and `skygest-editorial`, the seams between them, and the four actors that drive the system. Effect vocabulary is load-bearing here: every subsystem name is a Tag, a Workflow class, a Worker name, or a script you can grep for.

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
    Ingest[Post Ingest<br/>IngestRunWorkflow +<br/>ExpertPollCoordinatorDo]
    Enrich[Enrichment Chain<br/>EnrichmentRunWorkflow]
    Vision[Vision Lane<br/>VisionEnrichmentExecutor]
    SrcAttr[Source-Attribution Lane<br/>SourceAttributionExecutor]
    Stage1[Data-Ref Resolution Stage 1<br/>Stage1Resolver]
    Registry[Data Layer Registry<br/>D1-backed, SKY-237 shipped]
    Resolver[skygest-resolver Worker<br/>planned Slice 2c]
    Stage3[DataRefResolverWorkflow<br/>planned Slice 6]
    MCP[MCP Surface<br/>src/mcp/Router.ts]
    Api[HTTP API<br/>src/api + src/admin]
  end

  subgraph TOOLS[Local Tooling in skygest-cloudflare]
    direction TB
    ColdStart[Cold-start Ingest Toolchain<br/>scripts/cold-start-ingest-*.ts +<br/>src/ingest/dcat-harness]
    Seed[Checked-in Cold-start Registry<br/>references/cold-start/*]
    Snapshot[Stage 1 Eval Tooling<br/>build-stage1-eval-snapshot +<br/>D1Snapshot]
  end

  subgraph ED[skygest-editorial]
    direction TB
    Hydrate[hydrate-story<br/>scripts/hydrate-story.ts]
    Sync[Cache Sync CLIs<br/>sync-experts, sync-data-layer-cache]
    Caches[Editorial Caches<br/>.skygest/cache/*.json]
    BuildGraph[build-graph Validator<br/>scripts/build-graph.ts]
    Discussion[Discussion Skill<br/>.claude/skills/discussion]
    Stories[Story Files<br/>narratives/&lt;slug&gt;/stories/*.md]
    Arcs[Narrative Arcs<br/>narratives/&lt;slug&gt;/index.md]
    Editions[Editions<br/>editions/published/*.md]
  end

  DomainBridge[/"@skygest/domain<br/>tsconfig path alias"/]

  IngestWorker -->|hosts Workflow class| Ingest
  IngestWorker -->|hosts Workflow class| Enrich
  AgentWorker -->|hosts handler| MCP
  AgentWorker -->|hosts handler| Api
  AgentWorker -->|Service Binding<br/>INGEST_SERVICE| IngestWorker

  Ingest -->|D1 row: posts| Enrich
  Enrich --> Vision
  Vision -->|D1 row: post_enrichments<br/>kind=vision| SrcAttr
  SrcAttr -->|D1 row: post_enrichments<br/>kind=source-attribution| Enrich
  Enrich -.->|Service Binding<br/>RESOLVER| Resolver
  Resolver -->|runs| Stage1
  Resolver -->|D1 row: post_enrichments<br/>kind=data-ref-resolution| Enrich
  Stage1 -.->|cold-start load<br/>D1-backed registry| Registry

  Resolver -.->|launches via<br/>Workflow binding| Stage3
  Stage3 -.->|D1 write| Registry

  ColdStart -->|filesystem write| Seed
  Seed -->|sync-data-layer CLI| Registry
  Registry -.->|wrangler d1 export cache| Snapshot
  Snapshot -.->|snapshot.jsonl feeds| Stage1

  MCP -->|D1 row read| Enrich
  MCP -->|D1 row read| Registry
  Api -->|D1 row read| Enrich

  CF -.->|src/domain/*<br/>Schemas + branded IDs| DomainBridge
  DomainBridge -.->|tsconfig paths<br/>resolved by Bun| ED

  Sync -->|MCP tool call| MCP
  Sync -->|filesystem write| Caches
  Hydrate -->|MCP tool call<br/>get_editorial_pick_bundle| MCP
  Hydrate -->|filesystem write| Stories
  Caches -->|filesystem read| BuildGraph
  Stories -->|filesystem read| BuildGraph
  Arcs -->|filesystem read| BuildGraph
  Discussion -->|filesystem rw| Stories
  Discussion -->|filesystem rw| Arcs
  Discussion -->|MCP tool call| MCP
  Stories -->|filesystem read| Editions

  Editor -->|voice + Skill tool| Discussion
  MCPModel -->|tool calls over MCP| MCP
  Operator -->|HTTPS bearer auth| Api
  Operator -->|bun run| Sync
  Operator -->|bun run| ColdStart
  Operator -->|bun run| Snapshot
  Operator -->|wrangler deploy| IngestWorker
  Reader -->|reads published markdown| Editions

  classDef cf fill:#e1f5ff,stroke:#0288d1,color:#01579b
  classDef ed fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c
  classDef bridge fill:#fff9c4,stroke:#f9a825,color:#f57f17
  classDef tools fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef actor fill:#c8e6c9,stroke:#388e3c,color:#1b5e20
  classDef planned stroke-dasharray: 5 5

  class IngestWorker,AgentWorker,Ingest,Enrich,Vision,SrcAttr,Stage1,MCP,Api cf
  class Registry,Resolver,Stage3 cf
  class Hydrate,Sync,Caches,BuildGraph,Discussion,Stories,Arcs,Editions ed
  class DomainBridge bridge
  class ColdStart,Seed,Snapshot tools
  class Reader,Editor,MCPModel,Operator actor
  class Resolver,Stage3 planned
```

## Subsystems

### skygest-cloudflare

**skygest-bi-ingest Worker** (`wrangler.toml` root, `src/worker/filter.ts`). The backend Worker that hosts the durable async surface: `IngestRunWorkflow`, `EnrichmentRunWorkflow`, the `ExpertPollCoordinatorDo` Durable Object, and the `*/15 * * * *` cron that fires `IngestWorkflowLauncher.startCronHeadSweep`. It owns the `DB` D1 binding, the `ONTOLOGY_KV` namespace, and the `TRANSCRIPTS_BUCKET` R2 bucket; everything write-side passes through it. *Shipped.*

**skygest-bi-agent Worker** (`wrangler.agent.toml`, `src/worker/feed.ts`). The frontend Worker that serves the public/admin HTTP API and the MCP endpoint. It still uses the `INGEST_SERVICE` Service Binding for backend-owned write paths and workflow-backed routes, but it also carries its own `DB`, `ONTOLOGY_KV`, and `TRANSCRIPTS_BUCKET` bindings for direct read/admin handlers declared in `src/worker/feed.ts`. *Shipped.*

**Post Ingest** (`src/ingest/`). Polls Bluesky and Twitter for tracked experts and writes new posts to D1. Exposes `IngestWorkflowLauncher` (Tag `@skygest/IngestWorkflowLauncher`) and the `IngestRunWorkflow` Workflow class, with `ExpertPollCoordinatorDo` coordinating head/backfill/reconcile sweeps; depends on `ExpertsRepoD1`, `ExpertSyncStateRepoD1`, and the platform HTTP/Bluesky clients. *Shipped.*

**Enrichment Chain** (`src/enrichment/`). Runs the lane DAG over each post via `EnrichmentRunWorkflow` and `EnrichmentPlanner`. Exposes `EnrichmentWorkflowLauncher` and persists every lane output as a `post_enrichments` row keyed by `EnrichmentKind`; depends on Post Ingest for input rows and on each lane executor below. *Shipped.*

**Vision Lane** (`src/enrichment/vision/`). Calls Gemini (`GEMINI_VISION_MODEL`) to extract `sourceLines`, `visibleUrls`, `organizationMentions`, `logoText`, and chart titles from post media. Exposes `VisionEnrichmentExecutor` (Tag `@skygest/VisionEnrichmentExecutor`) layered on `GeminiVisionServiceLive`; depends only on the post media and the Gemini client. *Shipped.*

**Source-Attribution Lane** (`src/source/`). Translates the Vision output into ranked `providerCandidates` against the legacy hostname registry. Exposes `SourceAttributionExecutor` (Tag `@skygest/SourceAttributionExecutor`) layered on `SourceAttributionMatcher` and `ProviderRegistry`; depends on the Vision lane (`awaiting-vision` stop reason) and on `src/source/registry.ts` indices. *Shipped; frozen for new providers per April 8 D12 Discipline 1.*

**Data-Ref Resolution Stage 1** (`src/resolution/`). The pure deterministic resolver from D-A4 that emits `Stage1Result` with accepted matches plus typed residuals. Exposes `Stage1Resolver` (Tag `@skygest/Stage1Resolver`) over the `DataLayerRegistry` lookup contract; depends on the Vision and Source-Attribution outputs and on registry lookups for canonical URIs, agent labels and homepage domains, dataset titles and aliases, distribution URLs and host/url-prefix matches, and variable aliases. *Shipped in code (`SKY-235`); Slice 2c deploys it through the resolver Worker.*

**Cold-start Ingest Toolchain** (`scripts/cold-start-ingest-eia.ts`, `scripts/cold-start-ingest-energy-charts.ts`, `scripts/cold-start-ingest-ember.ts`, `scripts/cold-start-ingest-gridstatus.ts`, `src/ingest/dcat-harness/`). Local Effect scripts that fetch upstream catalog surfaces and project them into Skygest's checked-in DCAT-shaped cold-start state. The shared harness owns alias merging, slug stability, validation, graph construction, and atomic writes; provider adapters own fetch and mapping rules. *Shipped (`SKY-254`, `SKY-257`, `SKY-261`, `SKY-265`, `SKY-266`).*

**Checked-in Cold-start Registry** (`references/cold-start/`). The reviewed JSON seed surface for Agents, Datasets, Distributions, Variables, Series, Catalogs, CatalogRecords, DataServices, DatasetSeries, and Candidates. Written by the cold-start ingest scripts plus targeted manual curation; read by `scripts/sync-data-layer.ts`, the Stage 1 fixture loaders, and the resolver/eval tests. Runtime no longer reads it directly in production — D1 does — but this tree is still the human-auditable seed and merge surface. *Shipped.*

**Data Layer Registry (D1)** (`variables`, `series`, `distributions`, `datasets`, `agents`, `catalogs`, `catalog_records`, `data_services`, `dataset_series`). The nine-entity DCAT-shaped registry that is now the runtime source of truth for Stage 1. It is loaded through `src/bootstrap/D1DataLayerRegistry.ts`, seeded from `references/cold-start/` by `scripts/sync-data-layer.ts`, exposed for operator CRUD/audit by `src/data-layer/Router.ts`, and records write provenance in `data_layer_audit`; it is depended on by Stage 1, future Stages 2 and 3, the Resolver Worker, and the Editorial Caches sync. *Shipped (`SKY-237`).*

**Stage 1 Eval Tooling** (`scripts/build-stage1-eval-snapshot.ts`, `src/platform/D1Snapshot.ts`, `src/eval/Stage1EvalSnapshotBuilder.ts`, `eval/resolution-stage1/`). The local resolver-quality loop. Builds `snapshot.jsonl` rows from either a direct sqlite path or a cached staging D1 export (`wrangler d1 export` → local sqlite import), then runs the Stage 1 eval against those rows. Recent follow-ups removed the Twitter-only block and made staging refresh the default path, so the eval corpus now tracks both `at://` and `x://` posts against current staging data. *Shipped (`SKY-235`, `SKY-248`, `SKY-249`).*

**skygest-resolver Worker** (planned, dedicated Wrangler config alongside `wrangler.toml` and `wrangler.agent.toml`). Standalone Worker hosting the resolver service over HTTP and a Service Binding for in-process callers (the Enrichment Chain, future drag-and-drop UIs). It will own the D1 binding for the Registry and a Workflow binding for `DataRefResolverWorkflow`; it builds on the shipped Stage 1 logic and shipped D1 registry. *Planned (`SKY-238`).*

**DataRefResolverWorkflow** (planned). Async Stage 3 Workflow that runs LLM reranking over Stage 2 residuals and writes resolved Candidates back to D1. Dispatched by the Resolver Worker via `launcher.startIfAbsent` when residuals warrant escalation; depends on the Registry, the Stage 2 candidate set, and the Gemini/LLM client layer. *Planned (SKY-217 Slice 6).*

**MCP Surface** (`src/mcp/Router.ts`, `src/mcp/Toolkit.ts`). Exposes the MCP tool surface (`get_post_enrichments`, `get_editorial_pick_bundle`, `list_curation_candidates`, `expand_topics`, `curate_post`, `submit_editorial_pick`, …) via `mcpServerLayer` over `McpServer.layerHttp`. Hosted by the agent Worker; depends on the D1 repos and on `WorkflowPromptsLayer` / `ReadOnlyPromptsLayer` for the prompt selection split. Current surface does not yet expose `resolve_data_ref` / `find_candidates_by_data_ref`; those are planned as `SKY-241` / `SKY-244` once the resolver Worker exists. *Shipped.*

**HTTP API Surface** (`src/api/Router.ts`, `src/admin/Router.ts`, plus `src/ingest/Router.ts` and `src/enrichment/Router.ts` mounted under `/admin`). The HttpApi handlers for public reads (`/api/*`) and operator writes (`/admin/*`). Authorized by `authorizeOperator` (bearer-token); depends on the same D1 repos and on the workflow launchers above. *Shipped.*

### skygest-editorial

**hydrate-story** (`scripts/hydrate-story.ts` → `src/narrative/HydrateStory.ts`). Pulls an `EditorialPickBundle` from staging via MCP and writes a story scaffold under `narratives/<slug>/stories/` plus per-post annotations under `post-annotations/<date>/`. Pure Effect script with no Service Tag of its own; depends on the MCP tool surface and on `StoryFrontmatter` from `@skygest/domain/narrative`. *Shipped; `dataRefs:` block extension is `SKY-242`.*

**Cache Sync CLIs** (`scripts/sync-experts.ts`, `scripts/sync-data-layer-cache.ts` → `src/narrative/ExpertCacheSync.ts`, `SyncDataLayerCacheCli.ts`). Refresh the local registry caches from staging on demand. Use Effect's `KeyValueStore.layerFileSystem` + `SchemaStore` to write `.skygest/cache/*.json`; depend on the MCP read path. *Shipped for experts and the five data-layer caches (`SKY-232`).*

**Editorial Caches** (`.skygest/cache/experts.json`, `variables.json`, `series.json`, `distributions.json`, `datasets.json`, `agents.json`). Hydration-time mirror of the Cloudflare D1 registry, validated via the same Effect Schemas. Read-only from build-graph and the discussion skill; written only by the sync CLIs. *Shipped (experts + data-layer caches; `SKY-232`).*

**build-graph Validator** (`scripts/build-graph.ts` → `src/narrative/BuildGraph.ts`). Walks `narratives/`, `stories/`, `post-annotations/`, `argument-patterns/`, `editions/` and validates frontmatter against the narrative Schemas today. The additional fail-loud data-layer reference warning pass over `variables.json`, `series.json`, `distributions.json`, `datasets.json`, and `agents.json` is the planned `SKY-243` extension. Depends on the Editorial Caches and on `@skygest/domain/narrative` node and edge Schemas. *Shipped (core validator); data-layer ref warnings are planned (`SKY-243`).*

**Discussion Skill** (`.claude/skills/discussion/SKILL.md`). The voice-driven editorial loop: the editor talks, the Skill calls MCP tools to surface context, and writes residue back into story files. No Effect Tag — it's a Claude Code Skill — but it depends on `hydrate-story`, `hydrate-story-append`, `spawn-arc`, the MCP surface, and on the Story File frontmatter contract. *Shipped.*

**Story Files** (`narratives/<slug>/stories/*.md`). Markdown + YAML frontmatter, decoded by `StoryFrontmatter` from `@skygest/domain/narrative`. The frontmatter carries `headline`, `question`, `narrative_arcs`, `argument_pattern`, `posts`, `experts`, `entities`, `source_providers`, `data_refs`; depend on the validator and on the discussion skill for editing. *Shipped.*

**Narrative Arcs** (`narratives/<slug>/index.md`). Long-running question containers parented above stories. Decoded by `NarrativeFrontmatter`; spawned by `scripts/spawn-arc.ts` and refreshed via the discussion skill's arc-mode. *Shipped.*

**Editions** (`editions/drafts/*.md`, `editions/published/*.md`). Reader-facing weekly compilations that gather story files into a single published artifact, decoded by `EditionFrontmatter`. Compiled by the `edition-compile` Skill, gated by human review; depend on Story Files and on the validator. *In-progress (template + Skill shipped, compile workflow not yet exercised end-to-end).*

### Cross-repo bridge

**@skygest/domain** (tsconfig `paths` alias, not an npm workspace). `skygest-editorial/tsconfig.json` maps `@skygest/domain/*` to `../skygest-cloudflare/src/domain/*`; Bun resolves the import directly off the sibling directory at script time. The cloudflare repo has no `workspaces` field — the bridge is purely a TypeScript/Bun resolver convention that pins both repos to the same on-disk Schemas. *Shipped.*

## Actors

**Reader** consumes the published markdown under `editions/published/` in `skygest-editorial`. Reader has no live touchpoint with either Worker; the artifact is the contract.

**Editor** drives the system through voice into the Discussion Skill, which fans out to the MCP Surface, the hydrate-story script, the spawn-arc script, and the build-graph validator. The Editor never calls Cloudflare HTTP endpoints directly — every write into the cloudflare repo goes through MCP tools or the Operator surface.

**MCP-calling LLM** is the model running inside the Discussion Skill (and inside future agentic discussion bundles). It is a first-class consumer of the MCP Surface and is the reason every MCP tool returns Schema-decoded structured output rather than free-form prose; the tool surface is its API.

**Operator** runs the admin HTTP API (`/admin/ingest/*`, `/admin/enrichment/*`) over bearer-token auth, runs the local sync and ingest CLIs (`bun run sync-experts`, `bun run sync-data-layer`, `bun run build-stage1-eval-snapshot`, `bun scripts/cold-start-ingest-*.ts`), and runs `wrangler deploy` against the Worker configs (`wrangler.toml`, `wrangler.agent.toml`, and the resolver config once `SKY-238` lands). Operator is the only actor allowed to mutate Worker code, refresh the cold-start registry, or fire repair endpoints.

## Seams

| Seam | What crosses | Schema (file) |
|---|---|---|
| `@skygest/domain` bridge | Every shared Schema and branded ID — `Did`, `PostUri`, `StoryFrontmatter`, `EditorialPickBundle`, `Variable`, `Series`, `Distribution` | `src/domain/types.ts`, `src/domain/narrative/`, `src/domain/editorial/`, `src/domain/data-layer/` (in `skygest-cloudflare`, imported via tsconfig `paths`) |
| Vision → Source-Attribution | `VisionEnrichment` row written by `VisionEnrichmentExecutor`, read by `SourceAttributionExecutor` | `src/domain/enrichment.ts` (`VisionEnrichment`) |
| Source-Attribution → Stage 1 Resolver | `SourceAttributionEnrichment` row with ranked `providerCandidates`, plus the Vision row | `src/domain/enrichment.ts` (`SourceAttributionEnrichment`) |
| Stage 1 Resolver → Resolver Worker | `Stage1Result` produced inside the resolver runtime before it is wrapped and persisted | `src/domain/stage1Resolution.ts` (`Stage1Input`, `Stage1Result`) |
| D1 → Resolver Worker | Full registry tables loaded once at Worker cold start into the shipped lookup contract: canonical URI, agent label/homepage domain, dataset title/alias, distribution URL/hostname/url-prefix, and variable alias lookups | `src/domain/data-layer/{Variable,Series,Distribution,Dataset,Agent,Catalog,CatalogRecord,DataService,DatasetSeries}.ts`, `src/resolution/dataLayerRegistry.ts` |
| Cold-start ingest toolchain → checked-in registry | Reviewed JSON entity files and id-ledger updates under `references/cold-start/` | `src/domain/data-layer/`, `src/ingest/dcat-harness/` |
| Checked-in registry → D1 registry | `syncCheckedInDataLayer` plan plus the nine-table D1 writes and `data_layer_audit` rows | `src/data-layer/Sync.ts`, `src/domain/data-layer/` |
| D1 snapshot cache → Stage 1 eval builder | cached sqlite snapshot + `snapshot.jsonl` / build-report artifacts produced from staging D1 exports | `src/platform/D1Snapshot.ts`, `src/domain/stage1Eval.ts`, `src/domain/stage1EvalBuild.ts` |
| Resolver Worker → Enrichment Chain | `ResolvePostRequest` / `ResolvePostResponse` over the `RESOLVER` Service Binding; response wraps `stage1: Stage1Result` and reserves optional `stage2` / `stage3` additions | `src/domain/stage1Resolution.ts`, `src/domain/enrichment.ts` (`EnrichmentKind`) *(Slice 2c)* |
| MCP read path | Tool requests / Schema-validated responses over `McpServer.layerHttp` | `src/mcp/Toolkit.ts` plus the response Schemas in `src/domain/api.ts` |
| Editorial cache mirror | Schema-validated cache manifests written to `.skygest/cache/*.json` by the sync CLIs | `ExpertCacheManifest`, `VariableCacheManifest`, `SeriesCacheManifest`, `DistributionCacheManifest`, `DatasetCacheManifest`, `AgentCacheManifest` (in `skygest-editorial/src/narrative/*Cache.ts`, decoded against `src/domain/data-layer/` types) |
| Discussion Skill ↔ Story File | YAML frontmatter + markdown body, validated on read by `build-graph` | `src/domain/narrative/Story.ts` (`StoryFrontmatter`) |

## Current state, anchored to SKY-217

| Subsystem | State |
|---|---|
| Post Ingest, Enrichment Chain, Vision Lane, Source-Attribution Lane | Shipped |
| MCP Surface, HTTP API Surface, both Workers | Shipped |
| Stage 1 Resolver (`src/resolution/`) | Shipped in code — **`SKY-235`**; deployment path lands in **Slice 2c** |
| Data Layer Registry (D1, nine tables) | Shipped — **`SKY-237`** |
| Cold-start Ingest Toolchain, Checked-in Cold-start Registry, Stage 1 Eval Tooling | Shipped — **`SKY-254` / `SKY-257` / `SKY-261` / `SKY-265` / `SKY-266` / `SKY-248` / `SKY-249`** |
| skygest-resolver Worker + Service Binding | Planned — **Slice 2c** |
| Stage 2 facet decomposition | Planned — **Slice 2d** (design session pending) |
| `DataRefResolverWorkflow` (Stage 3) | Planned — **Slice 6** (design session pending) |
| `resolve_data_ref` / `find_candidates_by_data_ref` MCP tools | Planned — **`SKY-241` / `SKY-244`** |
| hydrate-story `dataRefs:` block | Planned — **`SKY-242`** |
| build-graph data-layer ref warnings | Planned — **`SKY-243`** |
| Editorial Caches (experts + data-layer), hydrate-story core, build-graph core, Discussion Skill, Story Files, Narrative Arcs, sync-experts, `@skygest/domain` bridge | Shipped — **`SKY-232`** for the data-layer caches |
| Editions compile workflow | In-progress (template + Skill shipped) |
