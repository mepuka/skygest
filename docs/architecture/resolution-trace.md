# Resolution Trace: One Post Through the Shipped Provenance-First Path

This document walks one real post through the resolver path that is actually shipped on `main` today. The post is:

`at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l`

It is the same Blyth Offshore Wind / Ember chart example the earlier docs used, because it still gives us a concrete target to reason about:

- Ember as the publisher
- the Ember dataset/distribution pair behind the chart
- the chart provenance cues that should point at Ember's dataset surface

The critical architectural update is that the runtime path is now:

`vision -> source-attribution -> resolver worker -> Stage 1 matching -> asset bundle search -> stored data-ref-resolution row`

There is no live facet kernel in this branch. Variable and series semantic resolution are future work.

## Snapshot note

This trace describes the shipped contract, not a claim that every post already resolves perfectly. The resolver now writes real `data-ref-resolution` rows, but the live output is intentionally narrower than the older kernel-shaped ambition. The current path is about provenance-first matching: agent, dataset, and distribution-derived scope.

## Prep loop

### 0A. Provider ingest -> git-backed cold-start snapshot

- **Component:** `scripts/cold-start-ingest-*.ts` over `src/ingest/dcat-harness/`
- **Input:** provider catalog or API surfaces
- **Output:** fetched registry snapshot under `.generated/cold-start/`
- **Why it matters:** the resolver only becomes meaningful if the Ember agent, dataset, and distribution already exist in the repo-local snapshot

This is the repo-local source material behind the runtime registry, even though production no longer reads it directly.

### 0B. Snapshot -> D1 runtime registry

- **Component:** `scripts/sync-data-layer.ts`, `src/data-layer/Sync.ts`
- **Input:** `.generated/cold-start/`
- **Output:** the D1 tables the runtime actually reads
- **Why it matters:** Stage 1 and bundle resolution now resolve against the D1-backed registry, not the snapshot files directly

The runtime registry is the live source of truth. The fetched snapshot remains the repo-local seed surface.

### 0C. D1 registry -> entity search projection

- **Component:** search rebuild scripts plus `SEARCH_DB`
- **Input:** data-layer entities promoted from the snapshot
- **Output:** typed search rows used by the resolver
- **Why it matters:** after exact URL and hostname wins, the resolver now falls through to typed search instead of facet stitching

### 0D. Snapshot -> ontology-store round-trip validation

- **Component:** `packages/ontology-store/`
- **Input:** the same `.generated/cold-start/` entity corpus
- **Output:** RDF emission, SHACL validation, Turtle reload, and distill-back tests
- **Why it matters:** this is not part of the hot path, but it is now a real adjacent quality loop that checks whether the catalog snapshot can survive the new ontology export seam

## Runtime path

### 1. Post intake -> `posts` row

- **Component:** `IngestRunWorkflow`
- **Output:** `KnowledgePost` in D1 `posts`
- **Why it matters:** every downstream enrichment and resolver step keys off `PostUri`

For this trace, the post lands as a normal knowledge post with chart media and outbound link context.

### 2. Vision enrichment -> `post_enrichments(kind = vision)`

- **Component:** `VisionEnrichmentExecutor`
- **Output:** `VisionEnrichment`
- **Why it matters:** chart title, visible URL, source lines, logo text, and series text become structured inputs instead of raw image bytes

For the Ember post, the vision lane is where "Ember" and the chart-language cues should first become machine-readable.

### 3. Source attribution -> `post_enrichments(kind = source-attribution)`

- **Component:** `SourceAttributionExecutor`
- **Output:** `SourceAttributionEnrichment`
- **Why it matters:** the resolver gets ranked publisher hints instead of having to infer everything from scratch

This lane still uses the older provider registry, but it remains load-bearing because the resolver treats publisher hints as one of its evidence sources.

### 4. Enrichment workflow calls the resolver

- **Component:** `EnrichmentRunWorkflow` plus `ResolverClient`
- **Transport:** `RESOLVER` Service Binding with `ResolverEntrypoint`
- **Request contract:** `ResolvePostRequest`

The workflow now calls the resolver after source attribution. It can pass the structured Stage 1 input inline so the resolver does not need to re-read the same enrichments off the hot path.

Current response contract:

```ts
export const ResolvePostResponse = Schema.Struct({
  postUri: PostUri,
  stage1: Stage1Result,
  resolution: Schema.Array(ResolvedAssetBundle),
  resolverVersion: ResolverVersion,
  latencyMs: ResolveLatencyMs
});
```

This is the live contract everywhere else in the repo.

### 5. Inside the resolver: Stage 1 matching -> asset bundles -> provenance search

- **Components:** `Stage1Resolver`, `EnrichmentPlanner`, `resolveBundle`
- **Why it matters:** this is now the entire live resolver stack

The resolver first runs Stage 1 and produces the familiar direct matches plus typed residuals. It then assembles asset bundles from:

- post text
- chart title
- x-axis and y-axis
- series labels
- key findings
- source lines
- publisher hints

For each asset bundle, the live resolver now:

- keeps the provenance signals as a trail
- resolves exact URL and exact hostname candidates first
- falls through to entity search for agent and dataset candidates
- expands distribution hits back to dataset scope
- stores empty `series` and `variables` arrays for now

This is the key replacement for the older staged runtime story. The live resolver no longer says "Stage 1 plus kernel outcomes." It says "Stage 1 plus one authoritative asset-resolution array."

Two caveats matter:

1. The runtime is intentionally provenance-first. It can strongly link agent and dataset surfaces before it can semantically resolve the chart's variable.
2. Series and variable semantic resolution are deliberately deferred in this slice.

### 6. Resolver result -> stored `data-ref-resolution` enrichment

- **Component:** `src/domain/enrichment.ts`
- **Storage:** `post_enrichments`
- **Why it matters:** the rest of the system reads the stored row, not the in-flight resolver call

Current stored shape:

```ts
export const DataRefResolutionEnrichmentV2 = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  stage1: DeferredStage1Result,
  resolution: Schema.Array(ResolvedAssetBundle),
  resolverVersion: ResolverVersion,
  processedAt: Schema.Number
});
```

That is the new durable seam. Legacy stored rows with `kernel` are still readable so old enrichments do not break.

### 7. Editorial read path

- **Current readers:** `get_post_enrichments`, `resolve_data_ref`, `find_candidates_by_data_ref`
- **Adjacent bundle reader:** `get_editorial_pick_bundle` still packages pick context, but it does not materialize resolver-backed `data_refs`
- **Current guardrail:** `build-graph` now warns on legacy, malformed, and cache-missing data-layer refs in story and annotation frontmatter

This means the system already has real resolver output in D1, direct and reverse lookup on the MCP surface, and a warning-only editorial validator. The remaining follow-through step is still:

- `SKY-242` for story-frontmatter projection

That is the product gap now. The runtime write path and query path exist; the missing piece is materializing those refs into story and annotation files by default.

## Feedback loop

### 8. No checked-in snapshot harness

The current runtime quality loop is now targeted resolver and enrichment tests over the live `stage1 + resolution` contract, plus repo-search checks that the deleted facet stack is gone from the live code path.

Alongside that, the ontology-store package now adds a separate non-runtime validation loop: emit the snapshot into RDF, validate against SHACL shapes, serialize, reload, and distill back to entities. That loop is about export fidelity and schema drift, not hot-path resolver behavior.

Why this matters for the architecture family:

1. It keeps the docs honest. The resolver is shipped infrastructure, but the old facet fixtures are no longer the source of truth.
2. It prevents legacy eval artifacts from defining current requirements.
3. It makes the new ontology export seam explicit without pretending it is part of the request path.

## What this trace means now

1. The resolver infrastructure is no longer hypothetical. It is a shipped Worker and a shipped stored row.
2. The durable resolver contract is now `stage1 + resolution`.
3. The main product gap is editorial projection and packaging, not missing raw lookup tools.
4. The main quality gaps are provenance coverage, candidate-citation coverage, and registry completeness, not missing facet algebra.
5. The ontology-store package is a real adjacent validation seam, but not part of today's resolver hot path.
6. Any future semantic resolution or reranking should be described as follow-on work, not as part of today's runtime path.
