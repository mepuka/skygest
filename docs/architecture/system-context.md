# Skygest System Context

This document maps the current top-level subsystems across `skygest-cloudflare` and `skygest-editorial` after the April 12, 2026 resolver cutover. The load-bearing change versus the previous architecture snapshot is simple: the live resolver path is now `Stage 1 matching -> Resolution Kernel` inside the standalone `skygest-resolver` Worker. The older "runtime Stage 2 plus Stage 3 workflow" story is not the current system.

Effect vocabulary is still load-bearing here: every subsystem name is a Tag, a Workflow class, a Worker name, or a script you can grep for.

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
    Resolver[skygest-resolver Worker<br/>src/resolver-worker/index.ts]
    Stage1[Stage 1 Matching<br/>src/resolution/Stage1.ts]
    Kernel[Resolution Kernel<br/>src/resolution/ResolutionKernel.ts]
    Registry[Data Layer Registry<br/>D1-backed runtime source of truth]
    MCP[MCP Surface<br/>src/mcp/Router.ts]
    Api[HTTP API<br/>src/api + src/admin]
  end

  subgraph TOOLS[Local Tooling in skygest-cloudflare]
    direction TB
    ColdStart[Cold-start Ingest Toolchain<br/>scripts/cold-start-ingest-*.ts +<br/>src/ingest/dcat-harness]
    Seed[Checked-in Cold-start Registry<br/>references/cold-start/*]
    Profile[Energy Profile Generation<br/>scripts/generate-energy-profile.ts +<br/>scripts/sync-energy-profile.ts]
  end

  subgraph ED[skygest-editorial]
    direction TB
    Hydrate[hydrate-story<br/>scripts/hydrate-story.ts]
    Sync[Cache Sync CLIs<br/>sync-experts, sync-data-layer-cache]
    Caches[Editorial Caches<br/>.skygest/cache/*.json]
    BuildGraph[build-graph Validator<br/>scripts/build-graph.ts]
    Discussion[Discussion Skill<br/>.claude/skills/discussion]
    Stories[Story Files<br/>narratives/<slug>/stories/*.md]
    Arcs[Narrative Arcs<br/>narratives/<slug>/index.md]
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
  SrcAttr -->|Service Binding + RPC<br/>RESOLVER| Resolver
  Resolver --> Stage1
  Stage1 --> Kernel
  Stage1 -.->|registry lookups| Registry
  Kernel -.->|registry lookups| Registry
  Kernel -->|D1 row: post_enrichments<br/>kind=data-ref-resolution| Enrich

  ColdStart -->|filesystem write| Seed
  Seed -->|sync-data-layer CLI| Registry
  Profile -.->|generated facet metadata| Kernel

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
  Operator -->|bun run| Profile
  Operator -->|wrangler deploy| IngestWorker
  Operator -->|wrangler deploy| AgentWorker
  Operator -->|wrangler deploy| Resolver
  Reader -->|reads published markdown| Editions

  classDef cf fill:#e1f5ff,stroke:#0288d1,color:#01579b
  classDef ed fill:#f3e5f5,stroke:#7b1fa2,color:#4a148c
  classDef bridge fill:#fff9c4,stroke:#f9a825,color:#f57f17
  classDef tools fill:#fff3e0,stroke:#ef6c00,color:#e65100
  classDef actor fill:#c8e6c9,stroke:#388e3c,color:#1b5e20

  class IngestWorker,AgentWorker,Ingest,Enrich,Vision,SrcAttr,Resolver,Stage1,Kernel,Registry,MCP,Api cf
  class Hydrate,Sync,Caches,BuildGraph,Discussion,Stories,Arcs,Editions ed
  class DomainBridge bridge
  class ColdStart,Seed,Profile tools
  class Reader,Editor,MCPModel,Operator actor
```

## Subsystems

### skygest-cloudflare

**skygest-bi-ingest Worker** (`wrangler.toml`, `src/worker/filter.ts`). The backend Worker that hosts `IngestRunWorkflow`, `EnrichmentRunWorkflow`, the `ExpertPollCoordinatorDo` Durable Object, and the cron sweep that launches ingest. It owns the write-heavy side of the system and the bindings the async workflows need. *Shipped.*

**skygest-bi-agent Worker** (`wrangler.agent.toml`, `src/worker/feed.ts`). The frontend Worker that serves the public/admin HTTP API and the MCP endpoint. It still uses `INGEST_SERVICE` for backend-owned write paths, while keeping its own direct read/admin bindings for the routes declared in `src/worker/feed.ts`. *Shipped.*

**Post Ingest** (`src/ingest/`). Polls tracked experts, writes new posts to D1, and launches enrichment for new material. Exposes `IngestWorkflowLauncher` and `IngestRunWorkflow`; depends on the expert repos, sync-state repos, and Bluesky/Twitter client layers. *Shipped.*

**Enrichment Chain** (`src/enrichment/`). Runs the lane DAG over each post via `EnrichmentRunWorkflow` and `EnrichmentPlanner`. The important current behavior is that, when `ENABLE_DATA_REF_RESOLUTION` is on, the workflow now calls the resolver after source attribution and persists a `data-ref-resolution` enrichment row containing `stage1` plus `kernel` output. *Shipped.*

**Vision Lane** (`src/enrichment/vision/`). Calls Gemini to extract chart titles, visible URLs, source lines, logo text, and other media cues. Exposes `VisionEnrichmentExecutor` layered on `GeminiVisionServiceLive`. *Shipped.*

**Source-Attribution Lane** (`src/source/`). Turns vision output plus link context into ranked provider hints against the legacy provider registry. Exposes `SourceAttributionExecutor` layered on `SourceAttributionMatcher` and `ProviderRegistry`. This lane still matters because it feeds the resolver, even though the registry it uses is intentionally frozen for new providers. *Shipped; frozen for new providers.*

**skygest-resolver Worker** (`wrangler.resolver.toml`, `src/resolver-worker/index.ts`). Standalone Worker that exposes the resolver over HTTP and over the `RESOLVER` Service Binding through `ResolverEntrypoint`. It is now part of the shipped runtime, not a planned deployment slice. `src/resolver/Client.ts` is the calling seam used by the ingest and agent workers. *Shipped.*

**Stage 1 Matching** (`src/resolution/Stage1.ts`, `src/resolution/Stage1Resolver.ts`). The deterministic first pass that turns post context, vision output, and source-attribution output into direct matches and typed residuals. It still matters, but it is now an internal step inside the resolver stack rather than the whole runtime story. *Shipped.*

**Resolution Kernel** (`src/resolution/ResolutionKernel.ts`, `src/domain/resolutionKernel.ts`). The authoritative resolver output. It takes Stage 1 input plus structured evidence bundles, binds against the D1-backed registry, and emits `ResolutionOutcome[]` with statuses such as `Resolved`, `Ambiguous`, `Underspecified`, `Conflicted`, `OutOfRegistry`, and `NoMatch`. The old runtime Stage 2 path has been removed; the kernel is the live replacement. *Shipped.*

**Data Layer Registry (D1)** (`variables`, `series`, `distributions`, `datasets`, `agents`, `catalogs`, `catalog_records`, `data_services`, `dataset_series`). The runtime source of truth for resolver lookups. It is loaded into a prepared lookup contract at Worker cold start and is fed from the checked-in cold-start tree via `scripts/sync-data-layer.ts`. One current limitation matters: the code path for agent-based narrowing exists, but the live registry shelves are still incomplete until `SKY-317`, so the system should not be described as having fully working agent narrowing yet. *Shipped, with a known completeness gap.*

**Cold-start Ingest Toolchain** (`scripts/cold-start-ingest-*.ts`, `src/ingest/dcat-harness/`). Local Effect scripts that fetch provider catalog surfaces and project them into checked-in Skygest registry data. The shared harness owns merge rules, slug stability, validation, graph construction, and atomic writes. *Shipped.*

**Checked-in Cold-start Registry** (`references/cold-start/`). Human-reviewed JSON seed state for the data layer. Runtime does not read it directly in production anymore, but it remains the audited source that feeds the D1 registry and local tests. *Shipped.*

**Energy Profile Generation** (`scripts/generate-energy-profile.ts`, `scripts/sync-energy-profile.ts`, `src/domain/generated/energyVariableProfile.ts`). The generated profile is now the canonical runtime source of facet metadata for the resolution kernel and partial-variable algebra. This is the bridge between the checked-in structural manifest and the code the resolver actually uses at runtime. *Shipped.*

**MCP Surface** (`src/mcp/Router.ts`, `src/mcp/Toolkit.ts`). Exposes the tool surface used by the discussion workflow and other operator/editor flows. The data-ref resolution rows are already readable through existing read tools such as `get_post_enrichments`, but the dedicated lookup tools `resolve_data_ref` and `find_candidates_by_data_ref` are still not present. *Shipped, with planned data-ref lookup additions.*

**HTTP API Surface** (`src/api/Router.ts`, `src/admin/Router.ts`, plus backend routes mounted under `/admin`). Public reads plus operator writes. Authorized by bearer token on the admin side. *Shipped.*

### skygest-editorial

**hydrate-story** (`scripts/hydrate-story.ts` -> `src/narrative/HydrateStory.ts`). Pulls an `EditorialPickBundle` from staging and writes or refreshes a story scaffold plus per-post annotations. The core scaffold path is shipped; projecting resolver-backed `dataRefs` into story frontmatter is still the open `SKY-242` step. *Shipped core, data-ref projection planned.*

**Cache Sync CLIs** (`scripts/sync-experts.ts`, `scripts/sync-data-layer-cache.ts`). Refresh the local registry mirrors from staging on demand. The data-layer cache substrate is already in place. *Shipped.*

**Editorial Caches** (`.skygest/cache/experts.json`, `variables.json`, `series.json`, `distributions.json`, `datasets.json`, `agents.json`). Read-only local mirrors of the Cloudflare registry. Used by build-graph and the discussion workflow. *Shipped.*

**build-graph Validator** (`scripts/build-graph.ts` -> `src/narrative/BuildGraph.ts`). Validates frontmatter and graph structure across stories, arcs, annotations, and editions. The additional warning pass for unresolved data-layer refs is still open `SKY-243`. *Shipped core, data-layer warning pass planned.*

**Discussion Skill** (`.claude/skills/discussion/SKILL.md`). The editor-facing voice loop. It depends on the MCP read surface, story files, and the editorial scripts. *Shipped.*

**Story Files** (`narratives/<slug>/stories/*.md`). The durable editorial working surface, backed by the shared narrative Schemas. *Shipped.*

**Narrative Arcs** (`narratives/<slug>/index.md`). Parent containers for long-running questions and arc evolution. *Shipped.*

**Editions** (`editions/drafts/*.md`, `editions/published/*.md`). Reader-facing compiled artifacts. The artifact shape exists, but the end-to-end compile loop is still not the center of gravity of current work. *In progress.*

### Cross-repo bridge

**@skygest/domain** (tsconfig `paths` alias, not an npm workspace). `skygest-editorial` imports shared Schemas directly from `../skygest-cloudflare/src/domain/*`. This is still the single load-bearing bridge that keeps the editorial repo and the Cloudflare repo on one set of types. *Shipped.*

## Actors

**Reader** consumes published markdown under `editions/published/`. The artifact is the contract.

**Editor** drives the system through the Discussion Skill, which fans out to MCP read tools, `hydrate-story`, `spawn-arc`, and `build-graph`. The editor does not work by calling raw Worker endpoints directly.

**MCP-calling LLM** is the model inside the discussion workflow and other tool-using flows. The tool surface is its API, which is why structured Schema-backed output matters so much.

**Operator** runs the admin API, sync scripts, cold-start ingest scripts, energy-profile generation and sync, and `wrangler deploy` against the worker configs. The operator is also the person who can turn the resolver lane on in staging and judge whether the stored outputs are trustworthy enough to move forward.

## Key seams

| Seam | What crosses | Current contract |
|---|---|---|
| `@skygest/domain` bridge | Shared Schemas and branded IDs across both repos | `src/domain/*` imported into `skygest-editorial` via tsconfig `paths` |
| Vision -> Source Attribution | Vision enrichment row written by the vision lane | `VisionEnrichment` in `src/domain/enrichment.ts` |
| Source Attribution -> Resolver | Source-attribution row plus vision/post context | `Stage1Input` assembled from `postContext`, `vision`, `sourceAttribution` |
| Resolver service boundary | Resolver request and response across the `RESOLVER` binding or HTTP | `ResolvePostRequest` / `ResolvePostResponse` in `src/domain/resolution.ts` |
| Resolver -> stored enrichment | Persisted resolver result in `post_enrichments` | `DataRefResolutionEnrichment` in `src/domain/enrichment.ts` with `stage1 + kernel` |
| Registry lookup contract | D1-backed entity lookups used by Stage 1 and the kernel | `src/resolution/dataLayerRegistry.ts` |
| Checked-in registry -> D1 registry | Reviewed seed state promoted into runtime tables | `scripts/sync-data-layer.ts`, `src/data-layer/Sync.ts` |
| Energy profile manifest -> generated runtime profile | Structural facet rules promoted into generated runtime code | `references/energy-profile/shacl-manifest.json` -> `src/domain/generated/energyVariableProfile.ts` |
| MCP read path | Tool responses consumed by editorial workflows | `src/mcp/Toolkit.ts` plus response Schemas in `src/domain/*` |
| Editorial cache mirror | Local cached registry manifests | `.skygest/cache/*.json` |
| Story frontmatter | Filesystem contract between scripts, discussion workflow, and validator | `src/domain/narrative/*` |

## Current state

| Subsystem | State |
|---|---|
| Post Ingest, Enrichment Chain, Vision Lane, Source-Attribution Lane | Shipped |
| Resolver Worker + `RESOLVER` Service Binding / `ResolverEntrypoint` RPC | Shipped |
| Stage 1 Matching + Resolution Kernel | Shipped |
| Persisted `data-ref-resolution` enrichment row (`stage1 + kernel`) | Shipped |
| Data Layer Registry (D1), Checked-in Cold-start Registry, sync pipeline | Shipped |
| Energy profile generation and generated runtime facet metadata | Shipped |
| Agent-based narrowing completeness | In progress (`SKY-317`) |
| `resolve_data_ref` / `find_candidates_by_data_ref` MCP tools | Planned (`SKY-241`, `SKY-244`) |
| hydrate-story `dataRefs` projection | Planned (`SKY-242`) |
| build-graph unresolved data-ref warnings | Planned (`SKY-243`) |
| LLM follow-up workflow / old Stage 3 story | Not part of the current runtime; future work only |
| Editorial caches, hydrate-story core, build-graph core, discussion workflow, story files, narrative arcs | Shipped |
| Editions compile workflow | In progress |

## What changed in this refresh

1. The resolver is now described as shipped infrastructure, not a planned slice.
2. The resolver contract is now `stage1 + kernel`, not `stage1 + optional stage2 + stage3`.
3. The old runtime Stage 2 and Stage 3 language was removed because it no longer matches the code on `main`.
4. The old snapshot-based eval harnesses were removed; the next end-to-end bundle eval surface belongs with `SKY-343`.
5. The docs now call out the real remaining gaps: lookup tools, story projection, build-graph warnings, and registry completeness for agent narrowing.
