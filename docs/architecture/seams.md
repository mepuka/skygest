# Skygest Seams Inventory

A seam is a place where one component hands data to another and the two could, in principle, change independently. Some seams are Effect layer seams inside one runtime. Others are transport seams across Workers, D1, MCP, or the filesystem. This document is the inventory for the current resolver era: the period after the runtime cut over to the standalone resolver Worker and the resolution kernel.

The most important updates versus the previous version of this document are that the high-risk resolver seam is no longer "future Stage 2 or Stage 3 work," the registry seam is now graph-backed, and the seed surface is now a fetched snapshot rather than an in-tree directory. The live resolver contract now sits between:

- `ResolvePostResponse`
- `DataRefResolutionEnrichment`
- the `RESOLVER` binding
- the D1-backed registry plus `PreparedDataLayerRegistry.graph` that the kernel binds against

## Inventory

### Effect layer seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `IngestWorkflowLauncher` | cron + admin ingest routes -> `IngestRunWorkflow` | `IngestRunParams` in `src/domain/polling.ts` | locked | Breaks the head-sweep and manual ingest launch path. |
| `EnrichmentWorkflowLauncher` | ingest workflow + admin enrichment routes -> `EnrichmentRunWorkflow` | `EnrichmentRunParams` in `src/domain/enrichmentRun.ts` | locked | Breaks the lane runner for every post. |
| `VisionEnrichmentExecutor` | enrichment workflow -> `post_enrichments(kind=vision)` | `VisionEnrichment` in `src/domain/enrichment.ts` | locked | Source attribution and resolver input both depend on it. |
| `SourceAttributionExecutor` | enrichment workflow -> `post_enrichments(kind=source-attribution)` | `SourceAttributionEnrichment` in `src/domain/enrichment.ts` | locked | Publisher hints disappear if this breaks. |
| `Stage1Resolver` | `ResolverService` -> Stage 1 direct matches and residuals | `Stage1Input`, `Stage1Result` in `src/domain/stage1Resolution.ts` | stabilizing | Still the front half of the live resolver path. |
| `ResolutionKernel` | `ResolverService` -> authoritative resolver outcomes | `ResolutionOutcome` in `src/domain/resolutionKernel.ts` | stabilizing | This is now the live resolver result, not an experiment. |
| `DataLayerRegistry` | Stage 1 + kernel + shared graph consumers -> runtime entity lookups and relationship walks | `PreparedDataLayerRegistry.graph` + `src/resolution/dataLayerRegistry.ts` | stabilizing | Resolver narrowing, ingest graph validation, and typed entity-search projection now depend on this one graph-backed contract. |
| `ResolverClient` | enrichment workflow + other callers -> resolver Worker | `ResolvePostRequest`, `ResolvePostResponse` in `src/domain/resolution.ts` | stabilizing | The cross-Worker resolver call now sits on the hot path. |
| `PostEnrichmentReadService` | MCP/API readers -> joined enrichment view | `GetPostEnrichmentsOutput` in `src/domain/enrichment.ts` | locked | This is how the editorial side sees the new resolver row. |
| `EditorialPickBundleReadService` | hydrate-story + discussion workflow -> bundled post context | `EditorialPickBundle` in `src/domain/editorial.ts` | locked | Story scaffolding depends on this seam staying stable. |

### Cloudflare transport seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `INGEST_SERVICE` | agent Worker -> ingest Worker | backend fetch routes mounted under `/admin` | locked | The agent Worker still uses this for backend-owned writes. |
| `RESOLVER` Service Binding | ingest/agent Workers -> resolver Worker | `ResolverEntrypoint` RPC in `src/resolver-worker/index.ts` | stabilizing | This is the live resolver transport seam. |
| `POST /v1/resolve/post` | HTTP caller -> resolver Worker | `ResolvePostRequest` / `ResolvePostResponse` | stabilizing | External or tooling callers can hit the same contract over HTTP. |
| `POST /v1/resolve/bulk` | HTTP caller -> resolver Worker | `ResolveBulkRequest` / `ResolveBulkResponse` | stabilizing | Backfill and batch tooling depend on it. |
| `GET /v1/resolve/health` | uptime checks -> resolver Worker | simple health response | locked | Operational liveness probe. |
| `DB` binding | all Workers -> D1 | D1 row decoders in `src/services/d1/*` | locked | If this fails, everything fails. |
| `SEARCH_DB` binding | resolver/agent staging Workers -> typed search D1 | `SearchRuntimeEnvBindings`, `src/search/Layer.ts` | stabilizing, staging-only | The staged typed-search substrate now exists before the editor-facing lookup tools do. |
| `ONTOLOGY_KV` binding | agent/ingest Workers -> KV | topic expansion and ontology reads | stabilizing | Not the core resolver seam, but still editor-visible. |

### Stored-data seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `posts` | ingest -> every downstream reader | `KnowledgePost` in `src/domain/bi.ts` | locked | The whole enrichment stack keys off `PostUri`. |
| `post_enrichments` | vision, source attribution, resolver -> read services and MCP tools | discriminated union in `src/domain/enrichment.ts` | in flux, additive | This is the busiest JSON seam in the system. |
| `post_enrichments(kind=data-ref-resolution)` | resolver -> editorial read path | `DataRefResolutionEnrichment` with `stage1 + kernel` | stabilizing | New live seam introduced by the cutover. |
| Registry tables | sync pipeline -> Stage 1, kernel, editorial cache sync | `src/domain/data-layer/*` | stabilizing | The runtime registry is now the real source of truth. |
| `entity_search_docs` / `entity_search_doc_urls` / `entity_search_fts` | search rebuild scripts -> typed search readers | `src/search/migrations.ts`, `src/domain/entitySearch.ts` | stabilizing, staging-only | Derived typed lookup corpus behind future ad-hoc lookup and semantic recall. |
| `data_layer_audit` | sync/admin writes -> operator inspection | audit rows emitted alongside registry writes | locked | Runtime state changes need traceability. |
| `editorial_picks` / `post_curation` | curation tools -> hydrate-story / editorial reads | `src/domain/editorial.ts` | locked | Story scaffolding begins here. |

### Tooling and filesystem seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `skygest-ingest-artifacts` -> `.generated/cold-start/*` | git-pinned snapshot fetch -> sync pipeline, tests, local inspection | fetched JSON snapshot rooted at `.generated/cold-start/` | stabilizing | This is now the audited seed surface every local and CI consumer actually reads. |
| canonical D1 snapshot -> `SEARCH_DB` rebuild | operator scripts -> derived typed search index | `scripts/rebuild-search-db.ts`, `src/search/projectFromDataLayer.ts`, `src/search/rebuildPlan.ts` | stabilizing, staging-only | The search index is rebuilt from the canonical registry source rather than the fetched files directly. |
| energy-profile manifest -> generated profile | `references/energy-profile/shacl-manifest.json` -> `src/domain/generated/energyVariableProfile.ts` | generated facet metadata used by partial-variable algebra and kernel | stabilizing | Resolver facet semantics now depend on this generated seam. |
| `.skygest/cache/*.json` | cache sync CLIs -> build-graph, discussion workflow | editorial cache manifests | locked | Editorial read-side work depends on these local mirrors. |
| Story and annotation frontmatter | hydrate-story + discussion workflow -> build-graph | `src/domain/narrative/*` | locked at the base level | The core editorial working surface. |
| `@skygest/domain/*` alias | `skygest-editorial` -> shared Cloudflare Schemas | tsconfig `paths` alias | locked | One broken alias breaks both repos at once. |

### MCP and editorial seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `get_post_enrichments` | MCP reader -> post enrichment read service | `GetPostEnrichmentsOutput` | locked | The model can already read stored kernel outcomes here. |
| `get_editorial_pick_bundle` | hydrate-story / discussion workflow -> bundle reader | `EditorialPickBundle` | locked | Story scaffolding depends on it. |
| `resolve_data_ref` | planned MCP tool -> registry lookup | dedicated lookup schema, not yet shipped | planned (`SKY-241`) | Missing ad-hoc lookup seam for the editor/model. |
| `find_candidates_by_data_ref` | planned MCP tool -> cross-post lookup | dedicated join schema, not yet shipped | planned (`SKY-244`) | Missing cross-expert join seam. |
| hydrate-story data-ref projection | planned story refresh -> filesystem frontmatter | additive `dataRefs` projection | planned (`SKY-242`) | Missing bridge from stored resolver rows into local story files. |
| build-graph unresolved-ref warnings | planned validator extension -> operator/editor warning surface | warning-only validation over local caches | planned (`SKY-243`) | Missing fail-loud editorial guardrail. |

## Stability heat map

Ordered by current blast radius, highest first.

**1. `@skygest/domain/*` alias.** This is still the single bridge that keeps both repos on one Schema set. Break it and the editorial repo loses type-safe imports immediately.

**2. `post_enrichments` discriminated union.** This is the system's busiest stored seam. The new `data-ref-resolution` variant is additive and safe; any rename or shape split would ripple through the MCP surface, read services, and editorial bundle assembly quickly.

**3. `ResolvePostResponse` <-> `DataRefResolutionEnrichment`.** This is the seam that just changed under the system. It now defines the live resolver story as `stage1 + kernel`. If the docs, read services, or tool consumers drift from that, architecture confusion returns immediately.

**4. `@skygest/DataLayerRegistry` graph-backed contract.** Stage 1, the kernel, ingest graph validation, and future lookup tools all depend on this one prepared registry surface. The code path for agent narrowing now exists, but the backing shelves are still incomplete until `SKY-317`, so changes here need extra care.

**5. `RESOLVER` binding plus `ResolverEntrypoint` RPC.** The resolver is now a real third Worker. This transport seam is cheap to misuse because it looks like a local service call while crossing a Worker boundary.

**6. Git-pinned snapshot plus sync pipeline plus generated energy profile.** This is the source material behind the runtime registry and the kernel's facet semantics. Drift here produces quiet resolver quality regressions that look like runtime bugs.

**7. `SEARCH_DB` projection and rebuild chain.** The typed search substrate is now real in staging, but it is derived and rebuilt out-of-band. Drift between canonical registry state and the staged search index would be easy to misread as a lookup-tool bug.

## Current seam risks

### 1. Agent narrowing is only partially real

The runtime can carry `agentId` on resolved outcomes and call agent-scoped lookup paths, but the live registry shelves needed to make that narrowing effective are still incomplete. `SKY-317` exists because this is a real architecture gap, not a documentation nit.

### 2. The model can read kernel outputs, but cannot yet query them on demand

`get_post_enrichments` already exposes stored resolver rows. The staged `SEARCH_DB` substrate and rebuild scripts now exist, but what is still missing is the direct lookup seam (`SKY-241`) and the cross-expert join seam (`SKY-244`).

### 3. Story files still lag the stored runtime state

The resolver row lives in D1 today. The story-file projection of those data refs does not. That is `SKY-242`, followed by the validator warning pass in `SKY-243`.

### 4. The seed surface moved out of tree, so pin drift matters more now

The runtime still depends on reviewed cold-start seed data, but the working copy now arrives through a git-pinned fetch into `.generated/cold-start/`. If the pin, the fetched tree, and the sync pipeline drift apart, local validation, staged search rebuilds, and runtime registry state can quietly describe different worlds.

## Actor exposure

**Reader**

- Consumes the published artifact only.
- Depends indirectly on `StoryFrontmatter`, `EditionFrontmatter`, and the editorial compile path.

**Editor**

- Uses the discussion workflow, `hydrate-story`, `spawn-arc`, and `build-graph`.
- Reads current resolver output indirectly through MCP tools.
- Does not yet get resolver-backed `dataRefs` projected into story files automatically.

**MCP-calling LLM**

- Already has rich read access through `get_post_enrichments`, `get_editorial_pick_bundle`, thread tools, post search, and pipeline status.
- Can already inspect structured kernel outcomes for posts that have run through the resolver.
- Still lacks the ad-hoc data-ref lookup and cross-expert join tools, even though staging now has the supporting typed-search substrate.

**Operator**

- Controls the admin API, cache sync, registry sync, snapshot fetch, search DB migrate/rebuild flow, energy-profile generation, kernel eval runs, and deploys.
- Is the person who can compare stored resolver rows against the kernel eval harness and decide whether the current runtime is good enough to lean on.

## What changed in this refresh

1. The live resolver seam remains documented as shipped.
2. The registry seam is now described as graph-backed, not just lookup-backed.
3. The seed surface is now described as the fetched `.generated/cold-start` snapshot instead of `references/cold-start/`.
4. The staged `SEARCH_DB` transport and stored-data seams are now called out explicitly.
5. The generated energy-profile seam remains explicit because it is load-bearing for the kernel.
6. The document still distinguishes between shipped resolver transport and still-missing editorial lookup/projection seams.
