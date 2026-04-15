# Resolution Trace: One Post Through the Shipped Kernel Path

This document walks one real post through the resolver path that is actually shipped on `main` today. The post is:

`at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l`

It is the same Blyth Offshore Wind / Ember chart example the earlier docs used, because the gold file still gives us a concrete target to reason about:

- Ember as the publisher
- the Ember dataset/distribution pair behind the chart
- the UK electricity variable the chart is talking about

The critical architectural update is that the runtime path is now:

`vision -> source-attribution -> resolver worker -> Stage 1 matching -> resolution kernel -> stored data-ref-resolution row`

There is no live runtime Stage 2 or Stage 3 flow in this branch.

## Snapshot note

This trace describes the shipped contract, not a claim that every gold-set post already resolves perfectly. The resolver now writes real `data-ref-resolution` rows, but the kernel eval harness still shows meaningful accuracy gaps. So the document is about how data moves through the system and where the current quality loop sits.

## Prep loop

### 0A. Provider ingest -> checked-in cold-start registry

- **Component:** `scripts/cold-start-ingest-*.ts` over `src/ingest/dcat-harness/`
- **Input:** provider catalog or API surfaces
- **Output:** reviewed JSON entities under `references/cold-start/`
- **Why it matters:** the resolver only becomes meaningful if the Ember agent, dataset, distribution, and variable already exist in the checked-in registry

This is still the human-reviewed source material behind the runtime registry, even though production no longer reads it directly.

### 0B. Energy-profile manifest -> generated runtime facet metadata

- **Component:** `scripts/generate-energy-profile.ts` and `scripts/sync-energy-profile.ts`
- **Input:** `references/energy-profile/shacl-manifest.json`
- **Output:** `src/domain/generated/energyVariableProfile.ts`
- **Why it matters:** the generated profile is the canonical runtime source of the kernel's facet keys and required dimensions

This became more important after the kernel cutover because the partial-variable algebra and kernel binding logic now depend on the generated runtime profile rather than an implicit hand-maintained shape.

### 0C. Checked-in registry -> D1 runtime registry

- **Component:** `scripts/sync-data-layer.ts`, `src/data-layer/Sync.ts`
- **Input:** `references/cold-start/`
- **Output:** the D1 tables the runtime actually reads
- **Why it matters:** Stage 1 and the kernel now resolve against the D1-backed registry, not the checked-in files directly

The runtime registry is the live source of truth. The checked-in tree remains the reviewed seed surface.

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
  kernel: Schema.Array(ResolutionOutcome),
  resolverVersion: ResolverVersion,
  latencyMs: ResolveLatencyMs
});
```

This is the contract the architecture docs now need to follow everywhere else.

### 5. Inside the resolver: Stage 1 matching -> evidence bundles -> kernel outcomes

- **Components:** `Stage1Resolver`, `buildResolutionEvidenceBundles`, `ResolutionKernel`
- **Why it matters:** this is now the entire live resolver stack

The resolver first runs Stage 1 and produces the familiar direct matches plus typed residuals. It then assembles evidence bundles from:

- post text
- chart title
- x-axis and y-axis
- series labels
- key findings
- source lines
- publisher hints

The kernel binds those bundles against the D1-backed registry and emits `ResolutionOutcome[]`. The live status vocabulary is:

- `Resolved`
- `Ambiguous`
- `Underspecified`
- `Conflicted`
- `OutOfRegistry`
- `NoMatch`

This is the key replacement for the older staged runtime story. The live resolver no longer says "Stage 1, then maybe Stage 2, then maybe Stage 3." It says "Stage 1 plus one authoritative kernel output array."

Two caveats matter:

1. `Resolved` outcomes can now carry `agentId`, which is the architectural hook for agent-aware narrowing.
2. The live registry shelves that make that narrowing effective are still incomplete until `SKY-317`, so the code path exists before the data fully backs it up.

### 6. Resolver result -> stored `data-ref-resolution` enrichment

- **Component:** `src/domain/enrichment.ts`
- **Storage:** `post_enrichments`
- **Why it matters:** the rest of the system reads the stored row, not the in-flight resolver call

Current stored shape:

```ts
export const DataRefResolutionEnrichment = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  stage1: DeferredStage1Result,
  kernel: Schema.Array(ResolutionOutcome),
  resolverVersion: ResolverVersion,
  processedAt: Schema.Number
});
```

That is the new durable seam. The stored row does not carry a runtime Stage 2 or Stage 3 payload because those are not part of the shipped path anymore.

### 7. Editorial read path

- **Current readers:** `get_post_enrichments`, `get_editorial_pick_bundle`
- **Current gap:** `hydrate-story` does not yet project these data refs into story frontmatter

This means the system already has real resolver output in D1 and on the MCP read surface, but the editorial repo still needs the follow-through steps:

- `SKY-241` for direct lookup on demand
- `SKY-242` for story-frontmatter projection
- `SKY-243` for build-graph warnings over unresolved refs
- `SKY-244` for cross-expert join lookup

That is the product gap now. The runtime write path exists; the editorial projection and lookup paths still need to catch up.

## Feedback loop

### 8. No checked-in snapshot harness

`SKY-358` removed the old `eval/resolution-kernel/`, `eval/resolution-stage1/`, and related snapshot and gold-set scaffolding. That is intentional. Those files encoded legacy chart ids and would misstate what the current bundle-resolution work is supposed to prove.

Why this matters for the architecture family:

1. It keeps the docs honest. The resolver is shipped infrastructure, but the old snapshot fixtures are no longer the source of truth.
2. It prevents legacy eval artifacts from defining current requirements.
3. It leaves the next end-to-end bundle-resolution eval surface to `SKY-343` and its follow-ons.

## What this trace means now

1. The resolver infrastructure is no longer hypothetical. It is a shipped Worker and a shipped stored row.
2. The durable resolver contract is now `stage1 + kernel`.
3. The main product gaps are lookup and projection gaps, not missing runtime plumbing.
4. The main quality gaps are kernel accuracy and registry completeness, especially around agent-aware narrowing.
5. Any future LLM reranking or workflow-based follow-up should be described as future work, not as part of today's runtime path.
