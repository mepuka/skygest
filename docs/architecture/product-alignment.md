# Product Alignment Matrix

This document maps actor-facing experiences to the current backend after the resolver hard cutover.

The important product change is simple: the system no longer exposes old resolver rows as the bridge between posts and ontology entities. The bridge is now `search_entities`, a single typed search surface over the ontology-aligned entity registry and search projection.

## 1. Actors And Core Experiences

### Reader

1. **R1 - Headline names the question.** Opens a published edition and gets a story shaped around a real question.
2. **R2 - Chart with provenance.** Sees a chart with expert, post, and source/provider context attached.
3. **R3 - Data entity context.** Can eventually follow claims to ontology entities through curated links.
4. **R4 - Temporal grounding.** Can tell whether a story is about a new event or a longer-running arc.

### Editor

1. **E1 - Voice-drops into a hydrated story.** Opens a scaffold with post, expert, media, and source context.
2. **E2 - Search ontology entities.** Looks up agents, datasets, distributions, series, and variables through one tool.
3. **E3 - Curate without losing hand edits.** Refreshes story context without overwriting editor notes.
4. **E4 - Link deliberately.** Creates durable data/entity links through a dedicated future workflow, not by trusting search results blindly.

### MCP-calling Model

1. **M1 - Entity search.** Uses `search_entities` for typed ontology lookup.
2. **M2 - Inspect post context.** Reads posts, enrichments, and editorial bundles.
3. **M3 - Reason about missing coverage.** Sees fail-closed warnings for not-yet-enabled entity families.
4. **M4 - Prepare linking candidates.** Uses search output as candidate input for future linking workflows.

### Operator

1. **O1 - Observe search health.** Uses Workers Logs and Analytics Engine metrics to inspect search requests and misses.
2. **O2 - Single pipeline-health read.** Checks ingest/enrichment/search health without old resolver counters.
3. **O3 - Improve registry/search quality.** Rebuilds projection and validates ontology-store output.
4. **O4 - Deploy without stale resolver bindings.** Ships only the ingest and agent Workers.

## 2. Matrix

Legend:

- `shipped` is live and load-bearing
- `limited` is live but intentionally incomplete
- `planned` is future work
- `n/a` is not required

| # | Experience | Ingest | Vision | Source | Entity Search | Registry | AI Search | Metrics | MCP | HTTP/Admin | Editorial Caches | hydrate-story | build-graph | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | shipped | n/a | n/a | n/a | n/a | n/a | n/a | shipped | n/a | n/a | shipped | shipped | limited |
| R2 | Chart with provenance | shipped | shipped | shipped | n/a | n/a | n/a | shipped | shipped | n/a | n/a | shipped | shipped | limited |
| R3 | Data entity context | shipped | shipped | shipped | limited | shipped | limited | shipped | shipped | shipped | planned | planned | planned | limited |
| R4 | Temporal grounding | shipped | n/a | n/a | n/a | n/a | n/a | n/a | shipped | n/a | n/a | shipped | shipped | limited |
| E1 | Hydrated story | shipped | shipped | shipped | n/a | n/a | n/a | n/a | shipped | n/a | shipped | shipped | shipped | n/a |
| E2 | Search ontology entities | n/a | n/a | n/a | shipped | shipped | limited | shipped | shipped | shipped | planned | planned | n/a | n/a |
| E3 | Curate without losing edits | shipped | shipped | shipped | n/a | n/a | n/a | n/a | shipped | n/a | n/a | shipped | shipped | n/a |
| E4 | Link deliberately | shipped | shipped | shipped | shipped | shipped | limited | shipped | planned | planned | planned | planned | planned | planned |
| M1 | Entity search | n/a | n/a | n/a | shipped | shipped | limited | shipped | shipped | shipped | n/a | n/a | n/a | n/a |
| M2 | Inspect post context | shipped | shipped | shipped | n/a | n/a | n/a | n/a | shipped | shipped | n/a | n/a | n/a | n/a |
| M3 | Reason about missing coverage | n/a | n/a | n/a | shipped | shipped | limited | shipped | shipped | shipped | n/a | n/a | n/a | n/a |
| M4 | Prepare linking candidates | n/a | n/a | n/a | shipped | shipped | limited | shipped | shipped | shipped | n/a | n/a | n/a | n/a |
| O1 | Observe search health | n/a | n/a | n/a | shipped | n/a | limited | shipped | n/a | shipped | n/a | n/a | n/a | n/a |
| O2 | Pipeline health | shipped | shipped | shipped | shipped | n/a | n/a | shipped | shipped | shipped | n/a | n/a | n/a | n/a |
| O3 | Registry/search quality | n/a | n/a | n/a | shipped | shipped | limited | shipped | n/a | shipped | shipped | n/a | n/a | n/a |
| O4 | Deploy cleanly | shipped | shipped | shipped | shipped | shipped | shipped | shipped | n/a | n/a | n/a | n/a | n/a | n/a |

## 3. What The Cutover Changed

The old resolver path is gone:

- no resolver Worker
- no `RESOLVER` binding
- no resolver RPC
- no Stage 1 or bundle resolver service
- no live `data-ref-resolution` enrichment kind
- no data-ref MCP lookup tools

The replacement is narrower and cleaner:

- one `search_entities` surface
- branded entity IDs and entity types
- exact probes for IRI, URL, hostname, and alias
- D1 lexical search and hydration
- Cloudflare AI Search recall
- fail-closed warnings for deferred entity families
- request metrics and deploy-version tags

## 4. What Is Still Missing

### Editorial linking

Search returns candidates. It does not create links. Durable entity links should come from a dedicated workflow that records evidence, review status, and versioning.

### Deferred entity families

Catalog, CatalogRecord, DatasetSeries, and DataService are not enabled search families yet. They need projection and hydration work before they become part of the search contract.

### Story projection

Story frontmatter should eventually carry deliberate links, not raw search hits. That should wait for the linking workflow.

### Join surfaces

"Who else cited this entity?" is still a future read surface over durable links. It should not be rebuilt on top of old resolver rows.

## 5. What We Should Build Next

1. Strengthen search projection coverage for enabled families.
2. Add curated search smoke cases and dashboards around misses.
3. Design the linking workflow as a write path separate from search.
4. Then add story projection and cross-post joins over durable links.

## What Changed In This Refresh

1. Replaced resolver-centered product language with entity-search language.
2. Removed old `resolve_data_ref` and `find_candidates_by_data_ref` assumptions.
3. Treated AI Search as recall, not authority.
4. Moved edge creation into future dedicated workflows.
5. Made observability part of the product readiness story.
