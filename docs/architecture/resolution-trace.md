# Resolution Trace: One Post, Two Runtime Passes plus One Prep Loop

This document walks a single real post through the Skygest pipeline as it exists after the April 11-12, 2026 resolver merges: `SKY-238` shipped the resolver Worker and persistence lane on April 11, 2026, `SKY-287` moved the internal Worker seam to typed `WorkerEntrypoint` RPC later that same day, and `SKY-239` / `SKY-306` / `SKY-307` plus PR #91 shipped the Stage 2 runtime, vocabulary loader, and comparative eval loop on April 12, 2026. The post is `at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l` — a Bluesky post about the 25th anniversary of the UK's first offshore wind farm (Blyth Offshore Wind), citing Ember data with a chart. It was chosen because the gold file at `references/cold-start/candidates/cand-284-jz7p4e6_app_bsky_feed_post_3m7rx7sb6q22l.json` pins the target direct-grain resolution to a concrete publisher (Ember), dataset (Ember Data Explorer), distribution, and UK-electricity variable — every intermediate stage has somewhere real to land. Effect vocabulary is load-bearing throughout: every named component is a Service Tag, a Workflow class, a Worker name, or a Schema you can grep.

## Prep loop — how cand-284 became resolvable

### Stage 0A. Provider ingest → checked-in cold-start registry

- **Component:** cold-start ingest toolchain, `scripts/cold-start-ingest-{eia,energy-charts,ember,gridstatus}.ts` over `src/ingest/dcat-harness/`.
- **Primitive:** one provider adapter plus the shared harness. The adapter fetches upstream catalog material; the harness owns alias merging, slug stability, validation, graph construction, and atomic writes.
- **Input:** provider-specific catalog or OpenAPI surfaces (EIA, Fraunhofer Energy Charts, Ember API, GridStatus).
- **Output:** reviewed JSON entities under `references/cold-start/` — Agents, Datasets, Distributions, CatalogRecords, DataServices, Variables, Series, plus the existing Candidate corpus.
- **For cand-284:** Ember now exists in two shapes inside the seed state: the older hand-curated Explorer path that the gold file still pins, and the newer API-backed monthly/yearly routes from `SKY-265`. This post still resolves against the Explorer path today. *Shipped (`SKY-254`, `SKY-257`, `SKY-261`, `SKY-265`, `SKY-266`).*

### Stage 0B. Checked-in registry → D1 registry

- **Component:** `scripts/sync-data-layer.ts`, `src/data-layer/Sync.ts`, `src/bootstrap/D1DataLayerRegistry.ts`, `src/data-layer/Router.ts`.
- **Primitive:** `syncCheckedInDataLayer(...)` diff plan plus the nine D1 repos and the `data_layer_audit` ledger. The runtime lookup contract still comes from `prepareDataLayerRegistry(...)` / `toDataLayerRegistryLookup(...)`; only the storage backing changed.
- **Input:** the checked-in cold-start tree under `references/cold-start/`.
- **Output:** the nine D1 tables (`variables`, `series`, `distributions`, `datasets`, `agents`, `catalogs`, `catalog_records`, `data_services`, `dataset_series`) plus `data_layer_audit`.
- **For cand-284:** the Ember agent/dataset/distribution/variable rows that the gold file names are loaded into D1 and served through `d1DataLayerRegistryLayer`. *Shipped (`SKY-237`).*

### Stage 0C. Vocabulary sync → checked-in Stage 2 facet vocabularies

- **Component:** `scripts/sync-vocabulary.ts`, `references/vocabulary/`, `src/resolution/facetVocabulary/`.
- **Primitive:** checked-in JSON facet vocabularies synced from the ontology repo, then loaded once at runtime by `FacetVocabulary`.
- **Input:** exported vocabulary surfaces for the currently shipped Stage 2 facets.
- **Output:** four checked-in JSON files under `references/vocabulary/`: `statistic-type.json`, `aggregation.json`, `unit-family.json`, and `technology-or-fuel.json`.
- **For cand-284:** Stage 2 now has canonical surface forms for signals like "offshore wind" and the chart's unit/aggregation hints before the post ever reaches the runtime path. *Shipped (`SKY-239`, `SKY-306`).*

### Stage 0D. Staging snapshot → Stage 1 + Stage 2 eval rows

- **Component:** `scripts/build-stage1-eval-snapshot.ts`, `src/platform/D1Snapshot.ts`, `src/eval/Stage1EvalSnapshotBuilder.ts`, `eval/resolution-stage1/run-eval.ts`, `eval/resolution-stage2/run-eval.ts`.
- **Primitive:** cached `wrangler d1 export` → local sqlite snapshot, then one shared snapshot builder feeding both the Stage 1 harness and the comparative Stage 1 + Stage 2 harness.
- **Input:** current staging D1 state plus `references/cold-start/survey/gold-set-resolver.json`.
- **Output:** `eval/resolution-stage1/snapshot.jsonl` plus local comparative Stage 2 eval reports. The first Stage 1 + Stage 2 run on April 12, 2026 surfaced concrete backlog on vocabulary misclassification, ambiguity, and coverage (`SKY-308`, `SKY-309`, `SKY-310`).
- **For cand-284:** one snapshot row whose `postContext`, `vision`, and `sourceAttribution` come from the same staging-shaped data the live resolver sees, and which is then reused by both harnesses. *Shipped (`SKY-235`, `SKY-239`, `SKY-248`, `SKY-249`, PR #91).*

## Pass 1 — Runtime data flow

### Stage 1. Post intake → `posts` row

- **Component:** Post Ingest, `src/ingest/IngestRunWorkflow.ts`.
- **Primitive:** `class IngestRunWorkflow extends WorkflowEntrypoint<WorkflowIngestEnvBindings, IngestRunParams>`, launched by `IngestWorkflowLauncher` (Tag `@skygest/IngestWorkflowLauncher`) from the `*/15 * * * *` cron; hosted by `skygest-bi-ingest`.
- **Input:** `IngestRunParams` from `src/domain/polling.ts`, carrying the `Did` `did:plc:3zhdeyok4trlrd3cijz7p4e6` and a `PollMode`.
- **Output:** `KnowledgePost` rows decoded via `KnowledgeRepo.insertPosts`:

```typescript
// src/domain/bi.ts:175-189
export const KnowledgePost = Schema.Struct({
  uri: PostUri,
  did: Did,
  cid: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Number,
  indexedAt: Schema.Number,
  hasLinks: Schema.Boolean,
  status: Schema.Literals(["active", "deleted"]),
  ingestId: Schema.String,
  embedType: Schema.NullOr(EmbedKind),
  topics: Schema.Array(MatchedTopic),
  links: Schema.Array(LinkRecord)
});
```

- **Persistence:** D1 `posts` (migration 1) and `ingest_runs` (migration 3); post body bytes land under `post_payloads` (migration 12).
- **For cand-284:** one `posts` row keyed by `uri = at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l`, `did = did:plc:3zhdeyok4trlrd3cijz7p4e6`, `hasLinks = true`, `embedType` indicating an image embed (the Ember chart). *Shipped.*

### Stage 2. Vision enrichment → `post_enrichments` row, `kind = vision`

- **Component:** Vision Lane, `src/enrichment/VisionEnrichmentExecutor.ts:146-159`.
- **Primitive:** `VisionEnrichmentExecutor` (Tag `@skygest/VisionEnrichmentExecutor`), layered on `GeminiVisionServiceLive` via `src/enrichment/Layer.ts`; dispatched from `EnrichmentRunWorkflow` (`src/enrichment/EnrichmentRunWorkflow.ts`).
- **Input:** the `KnowledgePost` row plus embed metadata resolved to image bytes.
- **Output:**

```typescript
// src/domain/enrichment.ts:172-180
export const VisionEnrichment = Schema.Struct({
  kind: Schema.Literal("vision"),
  summary: VisionPostSummary,
  assets: Schema.Array(VisionAssetEnrichment),
  modelId: Schema.String,
  promptVersion: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  processedAt: Schema.Number
});
```

- **Persistence:** `post_enrichments` row (migration 14) with `enrichment_type = "vision"`; run bookkeeping in `post_enrichment_runs` (migration 15).
- **For cand-284:** `assets[0]` should carry `sourceLines: ["Ember", …]`, `visibleUrls: ["ember-energy.org", …]`, `organizationMentions: ["Ember"]`, `logoText: "Ember"`, plus a chart title referencing UK offshore wind. *TODO: not yet enriched in staging.* *Shipped (lane); unrun for this post.*

### Stage 3. Source attribution → `post_enrichments` row, `kind = source-attribution`

- **Component:** Source-Attribution Lane, `src/enrichment/SourceAttributionExecutor.ts:48-55`.
- **Primitive:** `SourceAttributionExecutor` (Tag `@skygest/SourceAttributionExecutor`), depending on `SourceAttributionMatcher` and `ProviderRegistry` from `src/source/`.
- **Input:** the `VisionEnrichment` row plus the post text and `LinkRecord[]` from the `KnowledgePost`.
- **Output:**

```typescript
// src/domain/enrichment.ts:186-194
const SourceAttributionEnrichmentV2 = Schema.Struct({
  kind: Schema.Literal("source-attribution"),
  provider: Schema.NullOr(ProviderReference),
  resolution: SourceAttributionResolution,
  providerCandidates: Schema.Array(SourceAttributionProviderCandidate),
  contentSource: Schema.NullOr(ContentSourceReference),
  socialProvenance: Schema.NullOr(SocialProvenance),
  processedAt: Schema.Number
});
```

- **Persistence:** `post_enrichments` row with `enrichment_type = "source-attribution"`.
- **For cand-284:** `providerCandidates` should rank Ember first by hostname match on `ember-energy.org` and label match on `"Ember"`. *TODO: not yet enriched in staging; matcher frozen per April 8 D12 Discipline 1, so the legacy provider registry is the only signal this stage contributes.* *Shipped (lane); unrun for this post.*

### Stage 4. Stage 1 resolver → `Stage1Result`

- **Component:** Data-Ref Resolution Stage 1, `src/resolution/Stage1Resolver.ts:18-41` + `src/resolution/Stage1.ts`.
- **Primitive:** `Stage1Resolver` (Tag `@skygest/Stage1Resolver`) layered on `DataLayerRegistry` (Tag `@skygest/DataLayerRegistry`, `src/services/DataLayerRegistry.ts:7-22`). The lookup contract is defined in `src/resolution/dataLayerRegistry.ts`, and `SKY-237` shipped the D1-backed prepared registry (`src/bootstrap/D1DataLayerRegistry.ts`) that now feeds the same contract inside the live resolver Worker fast path.
- **Input:**

```typescript
// src/domain/stage1Resolution.ts:30-39
export const stage1InputFields = {
  postContext: Stage1PostContext,
  vision: Schema.NullOr(VisionEnrichment),
  sourceAttribution: Schema.NullOr(SourceAttributionEnrichment)
} as const;

export const Stage1Input = Schema.Struct(stage1InputFields).annotate({
  description: "All deterministic inputs consumed by the Stage 1 resolver"
});
```

- **Output:**

```typescript
// src/domain/stage1Resolution.ts:288-294
export const Stage1Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),
  residuals: Schema.Array(Stage1Residual)
}).annotate({
  description: "Deterministic Stage 1 output: accepted direct-grain matches plus unresolved residuals"
});
```

- **Evidence vocabulary:**

```typescript
// src/domain/stage1Resolution.ts:166-177
export const Stage1Evidence = Schema.Union([
  ExactDistributionUrlEvidence,
  DistributionUrlPrefixEvidence,
  DistributionHostnameEvidence,
  DatasetTitleEvidence,
  DatasetAliasEvidence,
  AgentProviderEvidence,
  AgentHomepageEvidence,
  AgentLabelEvidence,
  VariableAliasEvidence
]);
```

- **Residual vocabulary:**

```typescript
// src/domain/stage1Resolution.ts:279-286
export const Stage1Residual = Schema.Union([
  UnmatchedUrlResidual,
  UnmatchedDatasetTitleResidual,
  UnmatchedTextResidual,
  AmbiguousCandidatesResidual,
  DeferredToStage2Residual
]);
```

- **For cand-284 — target shape, matching the gold file:**
  - `matches[0]` carries `referencedAgentId = https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1` (Ember, `references/cold-start/catalog/agents/ember.json`, alternateName "Ember Climate", homepage `https://ember-energy.org/`) via `AgentHomepageEvidence` from the `ember-energy.org` hostname plus `AgentLabelEvidence` from the "Ember" `logoText`.
  - `matches[1]` carries `referencedDatasetId = https://id.skygest.io/dataset/ds_01KNQEZ5VN88FSP5QD5M4Z6EGW` (Ember Data Explorer) via `DatasetTitleEvidence` / `DatasetAliasEvidence`.
  - `matches[2]` carries `referencedDistributionId = https://id.skygest.io/distribution/dist_01KNQEZ5VNBTKYXXQN623KFTFG` — one of `ember-explorer-web.json` / `ember-explorer-csv.json` — via `DistributionHostnameEvidence`.
  - `matches[3]` carries `referencedVariableId = https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH` (UK electricity generation variable) via `VariableAliasEvidence` keyed on `rawDims = { geography: "gb", category: "generation" }`.
  - `residuals` is likely a single `DeferredToStage2Residual` covering the "25 years" temporal framing, which Stage 1 does not model. *Shipped end-to-end (`SKY-235`, `SKY-238`).*
  - The new Ember API-backed datasets from `SKY-265` widen future coverage, but they do not change cand-284's current gold target; the post still lands on the hand-curated Explorer dataset/distribution pair above. That distinction matters when reading Stage 1 regressions: this gold file is still measuring the legacy analytical-product path, not the new API route family.

### Stage 5. Stage 2 resolver

- **Component:** `src/resolution/Stage2Resolver.ts`, `src/resolution/Stage2.ts`, `src/resolution/facetVocabulary/`.
- **Primitive:** `Stage2Resolver` (Tag `@skygest/Stage2Resolver`) layered on `DataLayerRegistry` plus `FacetVocabulary`; it calls the pure `runStage2(postContext, stage1, registry.lookup, vocabulary)` kernel and dispatches exhaustively over the typed `Stage1Residual` union. The shipped runtime currently uses four checked-in facets (`statisticType`, `aggregation`, `unitFamily`, `technologyOrFuel`) plus fuzzy dataset-title and agent-label lanes.
- **Input:** `Stage1PostContext` plus the full `Stage1Result`.
- **Output:**

```typescript
// src/domain/stage2Result.ts:24-31
export const Stage2Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),
  corroborations: Schema.Array(Stage2Corroboration),
  escalations: Schema.Array(Stage3Input)
});
```

- **For cand-284:** Stage 2 is not load-bearing for the four direct Ember matches that Stage 1 already makes. Its job is to inspect any leftover text, optionally add corroboration, and, if it still cannot safely resolve the remaining frame, emit a structured `Stage3Input` instead of the old placeholder handoff. *Shipped (`SKY-239`, `SKY-306`, `SKY-307`).*

### Stage 6. Stage 3 resolver

- **Component:** `DataRefResolverWorkflow` at `src/resolver-worker/DataRefResolverWorkflow.ts`.
- **Primitive:** `class DataRefResolverWorkflow extends WorkflowEntrypoint<...>`, hosted by the `skygest-resolver` Worker and reached via the `RESOLVER_RUN_WORKFLOW` Workflow binding declared in the resolver Worker's dedicated Wrangler config. The boundary is real and typed, but the normal fast path only dispatches it on admin-triggered staging runs when `dispatchStage3` is enabled and Stage 2 emitted escalations.
- **Input:** `DataRefResolverRunParams` carrying `postUri` plus `Stage3Input[]`.
- **Output:** today this is a workflow stub and typed handoff boundary, not the final constrained-output LLM body. `SKY-240` is the slice that will turn these escalations into the real Stage 3 reranking path.
- **For cand-284:** would not normally fire. Even when forced in staging, it exercises the workflow envelope rather than the final LLM resolver body. *Stub shipped with `SKY-238`; real Stage 3 body planned in `SKY-240`.*

### Stage 7. `data-ref-resolution` enrichment persisted through the shipped resolver fast path

- **Component:** `skygest-resolver` Worker entry `src/resolver-worker/index.ts`, `src/resolver/ResolverService.ts`, called from `EnrichmentRunWorkflow`.
- **Primitive:** standalone `skygest-resolver`, deployed from `wrangler.resolver.toml`, with a `DB` D1 binding and a `RESOLVER_RUN_WORKFLOW` Workflow binding. It exposes both HTTP routes and typed Service Binding RPC via `ResolverEntrypoint extends WorkerEntrypoint<ResolverWorkerEnvBindings>`. HTTP surface:
  - `POST /v1/resolve/post` — single post
  - `POST /v1/resolve/bulk` — batch
  - `GET /v1/resolve/health`
  Both `skygest-bi-ingest` (`wrangler.toml`) and `skygest-bi-agent` (`wrangler.agent.toml`) declare a typed `RESOLVER` Service Binding; the Effect client wrapper lives at `src/resolver/Client.ts`.
- **Workflow step:** `EnrichmentRunWorkflow` calls `ResolverClient.resolvePost(...)` at the end of the source-attribution run, gated behind `AppConfig.enableDataRefResolution`. The step builds `Stage1Input`, crosses the typed `RESOLVER` Service Binding RPC with the run ID as `x-skygest-request-id`, and persists the response as a new `post_enrichments` row with `enrichment_type = "data-ref-resolution"` (additive, no D1 migration).
- **Observability boundary:** the resolver client forwards `x-skygest-request-id` when present so request correlation survives the Worker hop. Cloudflare trace propagation across the Service Binding is handled separately by `SKY-272`; resolver-specific events and metrics belong to `SKY-278`.
- **New enrichment variant:**

```typescript
// src/domain/enrichment.ts:284-291
export const DataRefResolutionEnrichment = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  stage1: DeferredStage1Result,
  stage2: Schema.optionalKey(Stage2Result),
  stage3: Schema.optionalKey(DataRefResolutionStage3),
  resolverVersion: ResolverVersion,
  processedAt: Schema.Number
});
```

- **Response shape:**

```typescript
export const ResolvePostResponse = Schema.Struct({
  postUri: PostUri,
  stage1: Stage1Result,
  stage2: Schema.optionalKey(Stage2Result),
  stage3: Schema.optionalKey(ResolveStage3Result),
  resolverVersion: ResolverVersion,
  latencyMs: ResolveLatencyMs
});
```

- **Persistence:** one `post_enrichments` row, `enrichment_type = "data-ref-resolution"`, carrying Stage 1 plus optional Stage 2 and queued Stage 3 stub metadata. For cand-284, the direct Ember matches from Stage 1 are already present in this row the moment the resolver fast path succeeds. *Shipped (`SKY-238`, `SKY-287`).*
- **Context note:** by the time this step shipped, the D1 registry it read from was already materially broader than the March architecture snapshot: EIA, Energy Charts, Ember API, and GridStatus catalog state now sit in the same lookup surface as the original hand-curated entities. The deploy shipped a stronger resolver substrate, not an empty Worker.

### Stage 8. Editorial pick → curation skill commit

- **Component:** `curate_post` / `submit_editorial_pick` MCP tools under `src/mcp/Toolkit.ts`, routed through `src/mcp/Router.ts`; HTTP mirror at `src/admin/Router.ts`.
- **Primitive:** MCP Surface (`mcpServerLayer` over `McpServer.layerHttp`), hosted by `skygest-bi-agent`, calling D1 repos inside `skygest-bi-ingest` via the `INGEST_SERVICE` Service Binding.
- **Input:** `PostUri`, editor-supplied editorial score, notes, and provider/entity overrides.
- **Output:**

```typescript
// src/domain/editorial.ts:153-161
export const EditorialPickBundle = Schema.Struct({
  post_uri: PostUri,
  post: EditorialPickBundlePost,
  editorial_pick: EditorialPickBundleEditorialPick,
  enrichments: EditorialPickBundleEnrichments,
  source_providers: Schema.Array(ProviderId),
  resolved_expert: Schema.optionalKey(Schema.String)
});
```

- **Persistence:** `editorial_picks` (migration 11) + `post_curation` (migration 13) rows.
- **For cand-284:** an `editorial_picks` row keyed on the post URI; `source_providers` includes the Ember `ProviderId`; `enrichments` bundles the four `post_enrichments` rows (vision / source-attribution / data-ref-resolution / grounding if present). *Shipped.*

### Stage 9. `hydrate-story` → story scaffold + post annotations

- **Component:** `scripts/hydrate-story.ts` → `src/narrative/HydrateStory.ts` in `skygest-editorial`.
- **Primitive:** pure Effect script, no Service Tag of its own; calls `get_editorial_pick_bundle` over MCP, decodes the response against `EditorialPickBundle`, writes markdown+YAML under `narratives/<slug>/stories/*.md` and `post-annotations/<date>/*.md`. Imports use the `@skygest/domain` tsconfig `paths` alias mapping `@skygest/domain/*` to `../skygest-cloudflare/src/domain/*`.
- **Input:** `EditorialPickBundle` from the MCP tool.
- **Output:** story frontmatter and per-post annotation frontmatter:

```typescript
// src/domain/narrative/story.ts:115-153 (base fields)
// StoryFrontmatter: headline, question, narrative_arcs, argument_pattern,
//                   status, posts, experts, entities, source_providers,
//                   data_refs, curation_date, created
```

```typescript
// src/domain/narrative/post-annotation.ts:20-47
export const PostAnnotationFrontmatter = Schema.Struct({
  post_uri: PostUri,
  author: Did,
  captured_at: IsoTimestamp,
  curation_date: DateStamp,
  editorial_score: EditorialScore,
  enrichments: PostAnnotationEnrichments,
  source_providers: Schema.Array(ProviderId),
  data_refs: Schema.Array(Schema.String),
  entities: Schema.Array(Schema.String),
  argument_pattern: Schema.optionalKey(NonEmptyNarrativeText),
  editor_note: Schema.optionalKey(NonEmptyNarrativeText)
});
```

- **Persistence:** filesystem under `skygest-editorial/narratives/<slug>/stories/` and `post-annotations/<curation_date>/`. Validated on read by `scripts/build-graph.ts`.
- **For cand-284:** one story scaffold and one `PostAnnotationFrontmatter` whose `source_providers` contains the Ember `ProviderId`; `data_refs` will carry the resolved Skygest entity URIs from the resolver row once `SKY-242` lands. The cache substrate that later validates those refs is already shipped in `SKY-232`; the build-graph warning pass over them is the follow-on `SKY-243`. *Shipped (base); `dataRefs:` block is `SKY-242`, not yet implemented.*

### Stage 10. Discussion skill consumes the hydrated story

- **Component:** `.claude/skills/discussion/SKILL.md` in `skygest-editorial`.
- **Primitive:** Claude Code Skill — no Effect Tag. Reads the story file, calls MCP tools (`get_post_enrichments`, `get_post_thread`, `list_editorial_picks`, …) for additional context, and writes editorial prose back into the markdown body and arc files under `narratives/<slug>/index.md`.
- **Input:** the hydrated `StoryFrontmatter` + post-annotation files from Stage 9, plus any MCP responses it pulls mid-conversation.
- **Output:** in-place edits to the same story markdown and arc markdown; on next read, `build-graph` revalidates the frontmatter against `@skygest/domain/narrative`.
- **For cand-284:** the editor would discuss the 25-year offshore-wind frame, pull additional Ember context if warranted, and write a narrative body that cites the resolved entity URIs from Stage 7 once they are available on disk. The ad-hoc MCP lookup/join pair that would let the skill resolve or cross-reference those data refs mid-conversation is still `SKY-241` / `SKY-244`. *Shipped (voice loop); data-ref lookup/join tools are planned.*

## Pass 2 — Actor intentions

Every stage above was set in motion by a named actor. Some handoffs are within one actor's single gesture; some span three. This is the same ten stages, narrated as intentions.

### Stage 1. Post intake
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator's earlier `wrangler deploy` of `skygest-bi-ingest`.
- **Intent:** the `*/15 * * * *` cron fires `IngestWorkflowLauncher.startCronHeadSweep`; the Operator's intent is "keep head sweeps running without me touching anything".
- **Failure mode:** the Operator would see an `ingest_runs` row stuck in a non-terminal status, visible via `/admin/ingest/*` or the MCP `get_pipeline_status` tool.

### Stage 2. Vision enrichment
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator.
- **Intent:** `EnrichmentRunWorkflow` fans out to the Vision Lane because the `KnowledgePost` has `embedType != null`. No human is in the loop on this post.
- **Failure mode:** the Operator would see a `post_enrichment_runs` row in an `error` state, or no `vision` row at all; `list_enrichment_gaps` over MCP surfaces the gap.

### Stage 3. Source attribution
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator.
- **Intent:** `EnrichmentRunWorkflow` chains `SourceAttributionExecutor` after the Vision row is written — the executor refuses with `awaiting-vision` if the lane runs out of order.
- **Failure mode:** ranked `providerCandidates` is empty; the Editor sees this later as an `EditorialPickBundle` with `source_providers: []`.

### Stage 4. Stage 1 resolver
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator.
- **Intent:** same workflow run; Stage 1 is invoked as a service from inside the enrichment step. The Operator's intent is "once the deterministic signals are in D1, resolve them against the registry before any human looks at this post".
- **Failure mode:** `Stage1Result.residuals` non-empty with `AmbiguousCandidatesResidual`; today this is visible as missing resolver output in `get_post_enrichments`, and once `SKY-242` lands it becomes `data_refs: []` during hydration.

### Stage 5. Stage 2 resolver
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator.
- **Intent:** same workflow run; once Stage 1 leaves typed residuals behind, Stage 2 runs the shipped facet/fuzzy kernel before the result is persisted.
- **Failure mode:** the `data-ref-resolution` row exists but contains no useful Stage 2 additions or only `escalations[]`; that now feeds the comparative eval and follow-on tuning backlog (`SKY-308`, `SKY-309`, `SKY-310`) instead of disappearing into an undocumented placeholder.

### Stage 6. Stage 3 resolver
- **Who:** the Operator, on staging/admin-triggered runs only.
- **Intent:** the `skygest-resolver` Worker starts `DataRefResolverWorkflow` via `launcher.startIfAbsent` when Stage 2 emitted `Stage3Input[]` and the run explicitly asked to dispatch Stage 3.
- **Failure mode:** `stage3.status = "queued"` appears in the fast-path response but nothing advances past the stub boundary, which is expected until `SKY-240` lands the real LLM body.

### Stage 7. `data-ref-resolution` fast-path persist
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator's shipped resolver deploy.
- **Intent:** end of the `EnrichmentRunWorkflow`, `ResolverClient.resolvePost(...)` crosses the typed `RESOLVER` binding and writes the response as a new `post_enrichments` row. The Operator's intent is "make data-ref resolution a normal enrichment lane so MCP tools can read it without a second round trip".
- **Failure mode:** `AppConfig.enableDataRefResolution = false`, the RPC call fails, or the persisted payload fails schema decode — the Operator sees a missing `data-ref-resolution` row via `list_enrichment_gaps`.

### Stage 8. Editorial pick
- **Who:** the Editor (Mepuka, by voice) driving the discussion skill, or the Operator directly calling `/admin/editorial/*`.
- **Intent:** the Editor says "pick this post"; the discussion skill resolves that to a `curate_post` MCP call followed by `submit_editorial_pick`. The intent is "accept this as the canonical post for the story I'm writing".
- **Failure mode:** the MCP tool returns an `EditorialPickBundle` missing `enrichments.data_ref_resolution`; the Editor hears the skill report "no data refs yet" and can choose to wait or proceed.

### Stage 9. `hydrate-story`
- **Who:** the Editor, via a discussion-skill tool call, or the Operator running `bun scripts/hydrate-story.ts` directly.
- **Intent:** "turn the curated pick into a story scaffold I can talk into". The script calls `get_editorial_pick_bundle` over MCP, decodes against `EditorialPickBundle`, and writes markdown. The MCP-calling LLM inside the discussion skill is the actual caller of the MCP tool.
- **Failure mode:** schema decode failure on the bundle (most commonly a missing `ProviderId`); the Editor sees a noisy error from the script and nothing is written to disk.

### Stage 10. Discussion skill
- **Who:** the Editor (voice) + the MCP-calling LLM (tool calls) in tight alternation.
- **Intent:** "I want to write a story about this post". The LLM reads the story scaffold, pulls more context through MCP, and writes editorial prose. The Editor's intent is the whole session; the model's intent on each tool call is narrower.
- **Failure mode:** today the editor mostly sees frontmatter-shape errors or stale-cache drift on the next `build-graph` run. Once `SKY-243` lands, unresolved `dataRefs` become explicit warnings instead of implicit drift, and the editor can decide whether to mint data or proceed.

## Seams crossed

| Seam class | Count | Notes |
|---|---:|---|
| Worker hops | 3 | `skygest-bi-ingest` (host of `IngestRunWorkflow` + `EnrichmentRunWorkflow`) → `skygest-resolver` (hosts `ResolverEntrypoint` RPC + HTTP routes, is invoked via `RESOLVER` for Stage 7, and can optionally launch `DataRefResolverWorkflow` for Stage 6) → `skygest-bi-agent` (host of MCP Surface + HTTP API, reaches backend via `INGEST_SERVICE` Service Binding). |
| Workflow class invocations | 2 by default, 3 with Stage 3 dispatch | `IngestRunWorkflow` (Stage 1), `EnrichmentRunWorkflow` (Stages 2, 3, 4, 5, 7), plus `DataRefResolverWorkflow` only when staging/admin runs explicitly dispatch Stage 3. |
| D1 rows written | 7+ | `posts` (1), `post_payloads` (1), `ingest_runs` (1), `post_enrichments` × 3 (`vision`, `source-attribution`, `data-ref-resolution`) + `post_enrichment_runs` (1 per), `editorial_picks` (1), `post_curation` (1). Plus `experts` touched for the author. |
| R2 objects | 0 | `TRANSCRIPTS_BUCKET` is not on this post's path. |
| Files on disk (editorial repo) | 2 | One `narratives/<slug>/stories/*.md` scaffold, one `post-annotations/<curation_date>/*.md`. |
| Repo boundary crossings | 2 | `skygest-cloudflare` → `skygest-editorial` via the `@skygest/domain` tsconfig `paths` alias, once on `EditorialPickBundle` decode inside `hydrate-story`, once on `StoryFrontmatter` / `PostAnnotationFrontmatter` write. |
| **Actor handoffs** | **11** | Counted below. |

Not counted in the table above: the prep loop writes reviewed cold-start JSON into `references/cold-start/`, syncs that tree into the D1 registry, and exports staging D1 snapshots back into local sqlite for the eval harness. Those are now load-bearing for resolver quality, but they happen before the runtime path for any single post starts.

Actor-handoff trace for cand-284 (headline number — 11):

1. Operator → Cloudflare Workflow scheduler (`wrangler deploy` + cron schedule)
2. Scheduler → `IngestRunWorkflow` (Stage 1 run)
3. `IngestRunWorkflow` → `EnrichmentRunWorkflow` (Stage 2 launch)
4. `EnrichmentRunWorkflow` → `VisionEnrichmentExecutor` → Gemini → D1 row (Stage 2)
5. `EnrichmentRunWorkflow` → `SourceAttributionExecutor` → D1 row (Stage 3)
6. `EnrichmentRunWorkflow` → `RESOLVER` Service Binding → `skygest-resolver` Worker (Stage 7 entry)
7. `skygest-resolver` Worker → `ResolverService` → `Stage1Resolver` + `Stage2Resolver` → `DataLayerRegistry` / `FacetVocabulary` → response → D1 row (Stages 4, 5, and 7)
8. Editor (voice) → Discussion Skill → MCP-calling LLM (Stage 8 open)
9. MCP-calling LLM → `curate_post` + `submit_editorial_pick` MCP tools → `skygest-bi-agent` → `INGEST_SERVICE` → D1 rows (Stage 8)
10. MCP-calling LLM → `get_editorial_pick_bundle` + `hydrate-story` → filesystem write (Stage 9)
11. Editor (voice) → Discussion Skill → filesystem edits → `build-graph` → Reader-facing markdown (Stage 10)

The Reader never appears in the handoff chain for a single post — Reader reads `editions/published/*.md`, which is a downstream compilation of many story files. For cand-284 the chain terminates at handoff 11, inside `skygest-editorial`.
