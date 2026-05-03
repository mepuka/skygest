# Skygest Entity Search Improvement Plan

Prepared after the resolver hard cutover.

This document replaces the old resolver improvement plan. The live backend no longer treats `data-ref-resolution`, Stage 1, bundle resolution, or the standalone resolver Worker as part of the runtime architecture.

The live contract is:

`vision -> source attribution -> search_entities`

`search_entities` is a read-only candidate search surface. Linking, edge creation, and story projection are separate future workflows.

## 1. What Is Live Today

The current entity search path does six things:

1. Accepts exact probes and query text through one typed request.
2. Normalizes URLs, hostnames, and aliases before probing.
3. Searches enabled ontology families: Agent, Dataset, Distribution, Series, and Variable.
4. Fails closed for deferred families: Catalog, CatalogRecord, DatasetSeries, and DataService.
5. Uses Cloudflare AI Search for semantic recall.
6. Hydrates returned payloads from D1 search projection rows.

That is the contract the rest of the system should treat as authoritative for search.

## 2. What Is Still Missing

### Projection Completeness

Deferred families need explicit projection and hydration before they can be enabled. The trap to avoid is exposing a schema because the D1 table exists while search projection is still missing.

### Search Quality

Exact URL, hostname, alias, and title coverage still determine most practical quality. Projection quality should improve before ranking complexity grows.

### Linking

Search results are candidates. Durable links need a dedicated workflow with evidence, review state, versioning, and write permissions.

### Freshness

Search projection and AI Search indexes need rebuild/version discipline. Metrics should make stale or missing projection visible.

## 3. Decisions

| Decision | Recommendation | Why |
|---|---|---|
| Runtime authority | Keep `search_entities` as the one search surface. | Multiple lookup surfaces recreate resolver drift. |
| AI Search role | Use AI Search for recall only. | D1 hydration and domain schemas remain the source of truth. |
| Entity-family gating | Fail closed until projection and hydration are complete. | Empty or partial families should not look like valid misses. |
| Linking | Build as a separate workflow. | Search should not create edges as a side effect. |
| Observability | Ship with search, not after it. | Misses and hydration failures are otherwise silent. |

## 4. Recommended Next Tracks

### Track A: Search Quality

- expand exact URL and hostname projection
- improve aliases and labels
- add curated exact-probe and lexical smoke cases
- keep deterministic ranking ahead of semantic recall

### Track B: Deferred Entity Families

- add projection for Catalog, CatalogRecord, DatasetSeries, and DataService
- add hydration tests for each family
- enable each family only when search output is complete

### Track C: Linking Workflow

- define link evidence and review states
- make link creation an explicit workflow
- write graph edges only after candidate review/acceptance rules pass
- expose joins over durable links, not raw search hits

### Track D: Observability And Freshness

- keep per-request Analytics Engine metrics
- tag logs and metrics with Worker version metadata
- track hydration misses and fail-closed counts
- version search projection and AI Search rebuilds

## 5. Success Criteria

The next iteration is successful when:

1. `search_entities` remains the only ontology search API.
2. Enabled families return hydrated branded entities.
3. Deferred families fail closed with clear warnings.
4. Search misses can be inspected through metrics and logs.
5. No code path writes old resolver rows.
6. Future links are created by deliberate workflows, not search side effects.

## 6. Non-Goals

- reviving the resolver Worker
- preserving old `data-ref-resolution` rows as product data
- hiding linking writes inside search
- making AI Search authoritative
- enabling partially projected entity families

## 7. Implementation Order

1. Keep the resolver deletion clean: no bindings, no deploy target, no live schema.
2. Harden the entity-search contract and tests.
3. Add dashboards and curated smoke probes.
4. Expand projection coverage one entity family at a time.
5. Design and implement linking as its own write workflow.
