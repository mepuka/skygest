# Skygest Seams Inventory

A seam is a place where one component hands data to another and the two could, in principle, change independently. Some seams are Effect layer seams inside one runtime. Others are transport seams across Workers, D1, MCP, or the filesystem. This document is the inventory for the current resolver era: the period after the standalone resolver Worker cut over to provenance-first bundle search.

The highest-risk resolver seam is now the live contract between:

- `ResolvePostResponse`
- `DataRefResolutionEnrichment`
- the `RESOLVER` binding
- the D1-backed registry and search projection the resolver reads

## Inventory

### Effect layer seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `IngestWorkflowLauncher` | cron + admin ingest routes -> `IngestRunWorkflow` | `IngestRunParams` in `src/domain/polling.ts` | locked | Breaks the head-sweep and manual ingest launch path. |
| `EnrichmentWorkflowLauncher` | ingest workflow + admin enrichment routes -> `EnrichmentRunWorkflow` | `EnrichmentRunParams` in `src/domain/enrichmentRun.ts` | locked | Breaks the lane runner for every post. |
| `VisionEnrichmentExecutor` | enrichment workflow -> `post_enrichments(kind=vision)` | `VisionEnrichment` in `src/domain/enrichment.ts` | locked | Source attribution and resolver input both depend on it. |
| `SourceAttributionExecutor` | enrichment workflow -> `post_enrichments(kind=source-attribution)` | `SourceAttributionEnrichment` in `src/domain/enrichment.ts` | locked | Publisher hints disappear if this breaks. |
| `Stage1Resolver` | `ResolverService` -> Stage 1 direct matches and residuals | `Stage1Input`, `Stage1Result` in `src/domain/stage1Resolution.ts` | stabilizing | Still the front half of the live resolver path. |
| Bundle resolution search | `ResolverService` -> authoritative asset-level resolver outcomes | `ResolvedAssetBundle` in `src/domain/bundleResolution.ts` | stabilizing | This is now the live resolver result. |
| `DataLayerRegistry` | Stage 1 + bundle resolution -> runtime entity lookups | `src/resolution/dataLayerRegistry.ts` | stabilizing | Exact URL and graph expansion depend on this lookup contract. |
| `EntitySearchService` | bundle resolution -> typed lexical search hits | `src/domain/entitySearch.ts` | stabilizing | This is the main fallback path after exact provenance matches. |
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
| `ONTOLOGY_KV` binding | agent/ingest Workers -> KV | topic expansion and ontology reads | stabilizing | Not the core resolver seam, but still editor-visible. |

### Stored-data seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `posts` | ingest -> every downstream reader | `KnowledgePost` in `src/domain/bi.ts` | locked | The whole enrichment stack keys off `PostUri`. |
| `post_enrichments` | vision, source attribution, resolver -> read services and MCP tools | discriminated union in `src/domain/enrichment.ts` | in flux, additive | This is the busiest JSON seam in the system. |
| `post_enrichments(kind=data-ref-resolution)` | resolver -> editorial read path | `DataRefResolutionEnrichment` with `stage1 + resolution` and legacy `kernel` read compatibility | stabilizing | New live seam introduced by the cleanup. |
| Registry tables | sync pipeline -> Stage 1, bundle resolution, editorial cache sync | `src/domain/data-layer/*` | stabilizing | The runtime registry is now the real source of truth. |
| `data_ref_candidates.citation_source` | candidate citation prep -> MCP and query readers | `"stage1" | "resolution" | "kernel"` in `src/domain/data-layer/query.ts` | stabilizing | New rows now cite `resolution`, old rows still cite `kernel`. |
| `data_layer_audit` | sync/admin writes -> operator inspection | audit rows emitted alongside registry writes | locked | Runtime state changes need traceability. |
| `editorial_picks` / `post_curation` | curation tools -> hydrate-story / editorial reads | `src/domain/editorial.ts` | locked | Story scaffolding begins here. |

### Tooling and filesystem seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `.generated/cold-start/*` | fetch + cold-start ingest -> sync pipeline, tests, local inspection | git-backed snapshot tree | stabilizing | This is the repo-local source that feeds runtime sync and validation. |
| variable vocabulary constants | domain code -> registry validation and normalization | `src/domain/data-layer/variable-vocabulary.ts` | locked | Small closed lists still matter to the data-layer spine after facet removal. |
| ontology-store emit/distill seam | snapshot entities -> RDF, SHACL validation, round-trip rebuild | `packages/ontology-store/*`, committed emit spec, committed shapes | stabilizing | This is the new validation/export seam outside the Worker hot path. |
| `.skygest/cache/*.json` | cache sync CLIs -> build-graph, discussion workflow | editorial cache manifests | locked | Editorial read-side work depends on these local mirrors. |
| Story and annotation frontmatter | hydrate-story + discussion workflow -> build-graph | `src/domain/narrative/*` | locked at the base level | The core editorial working surface. |
| `@skygest/domain/*` alias | `skygest-editorial` -> shared Cloudflare Schemas | tsconfig `paths` alias | locked | One broken alias breaks both repos at once. |

### MCP and editorial seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `get_post_enrichments` | MCP reader -> post enrichment read service | `GetPostEnrichmentsOutput` | locked | The model can already read stored resolution rows here. |
| `get_editorial_pick_bundle` | hydrate-story / discussion workflow -> bundle reader | `EditorialPickBundle` | locked | Story scaffolding depends on it, even though it does not yet materialize `data_refs`. |
| `resolve_data_ref` | MCP tool -> registry exact lookup | `ResolveDataRefInput` / `ResolveDataRefOutput` in `src/domain/data-layer/query.ts` | locked | Shipped ad-hoc exact lookup seam for the editor/model. |
| `find_candidates_by_data_ref` | MCP tool -> stored candidate citation lookup | `FindCandidatesByDataRefInput` / `FindCandidatesByDataRefOutput` in `src/domain/data-layer/query.ts` | stabilizing | Shipped cross-expert join seam over stored candidate citations. |
| hydrate-story data-ref projection | planned story refresh -> filesystem frontmatter | additive `dataRefs` projection | planned (`SKY-242`) | Missing bridge from stored resolver rows into local story files. |
| build-graph unresolved-ref warnings | build-graph CLI -> operator/editor warning surface | warning-only validation over typed IDs and local caches | stabilizing | Shipped guardrail that catches malformed or stale local refs before publish. |

## Stability heat map

Ordered by current blast radius, highest first.

**1. `@skygest/domain/*` alias.** This is still the single bridge that keeps both repos on one Schema set. Break it and the editorial repo loses type-safe imports immediately.

**2. `post_enrichments` discriminated union.** This is the system's busiest stored seam. The new `data-ref-resolution` variant is additive and safe; any rename or shape split would ripple through the MCP surface, read services, and editorial bundle assembly quickly.

**3. `ResolvePostResponse` <-> `DataRefResolutionEnrichment`.** This is the seam that just changed under the system. It now defines the live resolver story as `stage1 + resolution`. If the docs, read services, or tool consumers drift from that, architecture confusion returns immediately.

**4. `DataLayerRegistry` plus `EntitySearchService`.** Stage 1, bundle resolution, and future lookup tools all depend on these two surfaces. If either drifts, provenance resolution quality drops immediately.

**5. `RESOLVER` binding plus `ResolverEntrypoint` RPC.** The resolver is now a real third Worker. This transport seam is cheap to misuse because it looks like a local service call while crossing a Worker boundary.

**6. Snapshot sync plus ontology-store mapping artifacts.** The fetched snapshot, committed emit spec, and committed SHACL shapes now form a secondary but real architecture seam. Drift here produces export and validation surprises that may not show up in the runtime path until much later.

## Current seam risks

### 1. Provenance-first means semantic gaps are intentional

The live runtime deliberately stops at provenance-first output. Agent and dataset resolution are real; variable and series semantic output are not. Future docs and tooling need to describe that as a chosen scope cut, not as a hidden bug.

### 2. The model can query the resolver surface, but bundle hydration still lags

`get_post_enrichments` exposes stored resolver rows, `resolve_data_ref` can resolve exact IDs and aliases, and `find_candidates_by_data_ref` can reverse-join stored candidate citations. What is still missing is a higher-level path that carries those refs into story and annotation frontmatter automatically.

### 3. Story files still lag the stored runtime state

The resolver row lives in D1 today. The story-file projection of those data refs still does not. `build-graph` can now warn on untyped, malformed, or cache-missing refs, but `hydrate-story` still writes empty `data_refs` by default.

### 4. The ontology export seam is real, but not yet product-facing

The ontology-store package now has committed mapping rules and round-trip tests, but reader/editor flows do not consume it yet. That means the seam matters for validation and future interoperability before it matters for day-to-day product behavior.

## Actor exposure

**Reader**

- Consumes the published artifact only.
- Depends indirectly on `StoryFrontmatter`, `EditionFrontmatter`, and the editorial compile path.

**Editor**

- Uses the discussion workflow, `hydrate-story`, `spawn-arc`, and `build-graph`.
- Reads current resolver output indirectly through MCP tools.
- Does not yet get resolver-backed `dataRefs` projected into story files automatically; the current guardrail is build-graph warning output over typed and cached refs.

**MCP-calling LLM**

- Already has rich read access through `get_post_enrichments`, `get_editorial_pick_bundle`, thread tools, post search, and pipeline status.
- Can already inspect structured resolution outcomes for posts that have run through the resolver.
- Already has ad-hoc direct lookup and cross-expert join tools, but still has to compose them manually with bundle and story workflows.

**Operator**

- Controls the admin API, cache sync, registry sync, search projection rebuilds, ontology-store validation, and deploys.
- Is the person who can compare stored resolver rows against targeted verification and decide whether the current runtime is good enough to lean on.

## What changed in this refresh

1. The direct and reverse data-ref lookup seams are now documented as shipped rather than planned.
2. The document now distinguishes between shipped query surfaces and the still-missing hydrate-story projection step.
3. build-graph data-ref warnings are now called out as the current editorial guardrail.
4. Actor exposure is now aligned with the real split: query access is shipped, filesystem materialization is not.
