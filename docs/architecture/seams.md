# Skygest Seams Inventory

A seam is a place where one component hands data to another and the two could, in principle, change independently. Some seams are Effect layer seams inside one runtime. Others are transport seams across Workers, D1, MCP, or the filesystem. This document is the inventory for the current resolver era: the period after the runtime cut over to the standalone resolver Worker and the resolution kernel.

The most important update versus the previous version of this document is that the high-risk resolver seam is no longer "future Stage 2 or Stage 3 work." It is the live contract between:

- `ResolvePostResponse`
- `DataRefResolutionEnrichment`
- the `RESOLVER` binding
- the D1-backed registry the kernel binds against

The seam set now also has two new wrinkles that matter to the rest of this document:

- the shipped data-ref lookup tools now sit directly on top of the registry and citation read models
- the typed-search read model is wired in code but still deployment-gated because `SEARCH_DB` is not bound in the current worker configs

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
| `DataLayerRegistry` | Stage 1 + kernel -> runtime entity lookups | `src/resolution/dataLayerRegistry.ts` | stabilizing | Every real resolution depends on this lookup contract. |
| `ResolverClient` | enrichment workflow + other callers -> resolver Worker | `ResolvePostRequest`, `ResolvePostResponse` in `src/domain/resolution.ts` | stabilizing | The cross-Worker resolver call now sits on the hot path. |
| `DataRefQueryService` | MCP read surface -> exact entity lookup and reverse citation lookup | `ResolveDataRefInput` / `ResolveDataRefOutput`, `FindCandidatesByDataRefInput` / `FindCandidatesByDataRefOutput` in `src/domain/data-layer/query.ts` | stabilizing | Editors and the model now depend on it for exact lookup and cross-post joins. |
| `EntitySearchService` | `ResolverService.searchCandidates` -> grouped typed candidates | `EntitySearchBundleCandidates` in `src/domain/entitySearch.ts` | stabilizing, binding-gated | Exists in code for ranked fallback, but current worker configs omit `SEARCH_DB`. |
| `PostEnrichmentReadService` | MCP/API readers -> joined enrichment view | `GetPostEnrichmentsOutput` in `src/domain/enrichment.ts` | locked | This is how the editorial side sees the new resolver row. |
| `EditorialPickBundleReadService` | hydrate-story + discussion workflow -> bundled post context | `EditorialPickBundle` in `src/domain/editorial.ts` | locked | Story scaffolding depends on this seam staying stable. |

### Cloudflare transport seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `INGEST_SERVICE` | agent Worker -> ingest Worker | backend fetch routes mounted under `/admin` | locked | The agent Worker still uses this for backend-owned writes. |
| `RESOLVER` Service Binding | ingest/agent Workers -> resolver Worker | `ResolverEntrypoint` RPC in `src/resolver-worker/index.ts` | stabilizing | This is the live resolver transport seam. |
| `POST /v1/resolve/post` | HTTP caller -> resolver Worker | `ResolvePostRequest` / `ResolvePostResponse` | stabilizing | External or tooling callers can hit the same contract over HTTP. |
| `POST /v1/resolve/bulk` | HTTP caller -> resolver Worker | `ResolveBulkRequest` / `ResolveBulkResponse` | stabilizing | Backfill and batch tooling depend on it. |
| `POST /v1/resolve/search-candidates` | HTTP caller -> resolver Worker | `ResolvePostRequest` / `ResolveSearchCandidatesResponse` | stabilizing, binding-gated | Route exists in code for grouped candidate lookup, but deployed workers do not yet bind `SEARCH_DB`. |
| `GET /v1/resolve/health` | uptime checks -> resolver Worker | simple health response | locked | Operational liveness probe. |
| `DB` binding | all Workers -> D1 | D1 row decoders in `src/services/d1/*` | locked | If this fails, everything fails. |
| `SEARCH_DB` binding | resolver Worker -> search D1 | `src/search/Layer.ts` plus `entity_search_*` tables | deployment-gated | Until this binding exists, resolver search uses the empty repo layer. |
| `ONTOLOGY_KV` binding | agent/ingest Workers -> KV | topic expansion and ontology reads | stabilizing | Not the core resolver seam, but still editor-visible. |

### Stored-data seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `posts` | ingest -> every downstream reader | `KnowledgePost` in `src/domain/bi.ts` | locked | The whole enrichment stack keys off `PostUri`. |
| `post_enrichments` | vision, source attribution, resolver -> read services and MCP tools | discriminated union in `src/domain/enrichment.ts` | in flux, additive | This is the busiest JSON seam in the system. |
| `post_enrichments(kind=data-ref-resolution)` | resolver -> editorial read path | `DataRefResolutionEnrichment` with `stage1 + kernel` | stabilizing | New live seam introduced by the cutover. |
| `data_ref_candidate_citations` | resolver write path -> DataRefQueryService / MCP lookup tools | citation projection in `src/domain/data-layer/query.ts` and `src/enrichment/DataRefCandidateCitations.ts` | stabilizing | Powers `find_candidates_by_data_ref` without rescanning enrichments. |
| Registry tables | sync pipeline -> Stage 1, kernel, editorial cache sync | `src/domain/data-layer/*` | stabilizing | The runtime registry is now the real source of truth and now distinguishes publication-side `DatasetSeries` from measurement-side `Series`. |
| `data_layer_audit` | sync/admin writes -> operator inspection | audit rows emitted alongside registry writes | locked | Runtime state changes need traceability. |
| `editorial_picks` / `post_curation` | curation tools -> hydrate-story / editorial reads | `src/domain/editorial.ts` | locked | Story scaffolding begins here. |

### Tooling and filesystem seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `references/cold-start/*` | cold-start ingest + reviewed edits -> sync pipeline, tests, local inspection | checked-in JSON entities | stabilizing | Still the audited seed surface for the registry. |
| energy-profile manifest -> generated profile | `references/energy-profile/shacl-manifest.json` -> `src/domain/generated/energyVariableProfile.ts` | generated facet metadata used by partial-variable algebra and kernel | stabilizing | Resolver facet semantics now depend on this generated seam. |
| `scripts/validate-data-layer-registry.ts` | checked-in registry -> operator / CI guardrail | end-to-end load + invariant checks over `references/cold-start/` | locked | Full-catalog validation moved here after the fast unit suite started skipping the heavy on-disk cases. |
| entity-search projection | checked-in or D1 registry -> search D1 read model | `projectEntitySearchDocs`, `scripts/rebuild-entity-search-index.ts`, `entity_search_*` tables | stabilizing, deployment-gated | Keeps typed search rebuildable rather than source-of-truth. |
| `eval/resolution-kernel/*` | expected outcomes -> diagnostic runs | `expected-outcomes.jsonl`, `run-eval.ts`, run folders | stabilizing | This is the active resolver quality loop. |
| `.skygest/cache/*.json` | cache sync CLIs -> build-graph, discussion workflow | editorial cache manifests | locked | Editorial read-side work depends on these local mirrors. |
| Story and annotation frontmatter | hydrate-story + discussion workflow -> build-graph | `src/domain/narrative/*` | locked at the base level | The core editorial working surface. |
| `@skygest/domain/*` alias | `skygest-editorial` -> shared Cloudflare Schemas | tsconfig `paths` alias | locked | One broken alias breaks both repos at once. |

### MCP and editorial seams

| Seam | Producer -> Consumer | Contract | State | Why it matters |
|---|---|---|---|---|
| `get_post_enrichments` | MCP reader -> post enrichment read service | `GetPostEnrichmentsOutput` | locked | The model can already read stored kernel outcomes here. |
| `get_editorial_pick_bundle` | hydrate-story / discussion workflow -> bundle reader | `EditorialPickBundle` | locked | Story scaffolding depends on it. |
| `resolve_data_ref` | MCP reader -> registry lookup | dedicated lookup schema in `src/domain/data-layer/query.ts` | shipped | The editor and the model can now resolve one canonical URI or alias pair on demand. |
| `find_candidates_by_data_ref` | MCP reader -> citation reverse lookup | dedicated lookup schema in `src/domain/data-layer/query.ts` | shipped | The editor and the model can now ask which stored candidate citations reference one entity. |
| hydrate-story data-ref projection | planned story refresh -> filesystem frontmatter | additive `dataRefs` projection | planned (`SKY-242`) | Missing bridge from stored resolver rows into local story files. |
| build-graph unresolved-ref warnings | planned validator extension -> operator/editor warning surface | warning-only validation over local caches | planned (`SKY-243`) | Missing fail-loud editorial guardrail. |

## Stability heat map

Ordered by current blast radius, highest first.

**1. `@skygest/domain/*` alias.** This is still the single bridge that keeps both repos on one Schema set. Break it and the editorial repo loses type-safe imports immediately.

**2. `post_enrichments` discriminated union.** This is the system's busiest stored seam. The new `data-ref-resolution` variant is additive and safe; any rename or shape split would ripple through the MCP surface, read services, and editorial bundle assembly quickly.

**3. `ResolvePostResponse` <-> `DataRefResolutionEnrichment`.** This is the seam that just changed under the system. It now defines the live resolver story as `stage1 + kernel`. If the docs, read services, or tool consumers drift from that, architecture confusion returns immediately.

**4. `@skygest/DataLayerRegistry` lookup contract.** Stage 1, the kernel, `resolve_data_ref`, `find_candidates_by_data_ref`, and any future typed-search caller now depend on this one prepared surface. It carries series-backed dataset and agent shelves, tolerant distribution URL lookup, dataset landing-page lookup, and publisher-aware dataset matching, so changes here now touch more shipped behavior than they did in the previous refresh.

**5. `RESOLVER` binding plus `ResolverEntrypoint` RPC.** The resolver is now a real third Worker. This transport seam is cheap to misuse because it looks like a local service call while crossing a Worker boundary.

**6. Checked-in registry plus sync pipeline plus registry validator plus generated energy profile.** This is the source material behind the runtime registry and the kernel's facet semantics. Drift here produces quiet resolver quality regressions that look like runtime bugs, and the full-catalog validator is now the guardrail that catches them.

## Current seam risks

### 1. The shipped lookup tools are only as good as citation freshness and resolver quality

`resolve_data_ref` is exact and deterministic, but `find_candidates_by_data_ref` only sees the citations produced when resolver rows are saved. Join density will track kernel quality and write-path freshness, not just tool availability.

### 2. Story files still lag the stored runtime state

The resolver row and the lookup tools live in D1 today. The story-file projection of those data refs does not. That is `SKY-242`, followed by the validator warning pass in `SKY-243`.

### 3. Typed search is wired in code, but not yet in deploy config

`ResolverService.searchCandidates` and `/v1/resolve/search-candidates` now exist, but current wrangler configs do not bind `SEARCH_DB`, so the resolver search layer still falls back to the empty repo.

### 4. Full-catalog validation moved out of the fast unit suite

The on-disk registry tests are now intentionally skipped in the fast suite. `scripts/validate-data-layer-registry.ts` is the guardrail that catches full-catalog decode and invariant problems.

## Actor exposure

**Reader**

- Consumes the published artifact only.
- Depends indirectly on `StoryFrontmatter`, `EditionFrontmatter`, and the editorial compile path.

**Editor**

- Uses the discussion workflow, `hydrate-story`, `spawn-arc`, and `build-graph`.
- Reads current resolver output directly through `get_post_enrichments`, `resolve_data_ref`, and `find_candidates_by_data_ref`.
- Does not yet get resolver-backed `dataRefs` projected into story files automatically.

**MCP-calling LLM**

- Already has rich read access through `get_post_enrichments`, `get_editorial_pick_bundle`, thread tools, post search, and pipeline status.
- Can already inspect structured kernel outcomes for posts that have run through the resolver.
- Already has the ad-hoc data-ref lookup and cross-expert join tools.
- Does not yet get the typed search path as an MCP tool, and the resolver-side search route is still binding-gated.

**Operator**

- Controls the admin API, cache sync, registry sync, the registry validator, energy-profile generation, kernel eval runs, and deploys.
- Is the person who can compare stored resolver rows, citation rows, and validator output against the kernel eval harness and decide whether the current runtime is good enough to lean on.

## What changed in this refresh

1. The shipped lookup tools are now documented as real seams rather than planned ones.
2. The registry contract is now described as carrying real series-backed narrowing, tolerant URL lookup, landing-page lookup, and publisher-aware dataset matching.
3. The citation read model behind `find_candidates_by_data_ref` is now called out explicitly.
4. The registry validator is now treated as a first-class guardrail seam because the fast unit suite skips the heavy full-catalog checks.
5. The typed-search seam is now documented as code-real but deployment-gated.
