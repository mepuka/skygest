# Resolution Trace: One Post, Two Runtime Passes plus One Prep Loop

This document walks a single real post through the Skygest pipeline as it will exist after SKY-238 (Slice 2c) ships, but it now starts one step earlier than the March snapshot: with the prep loop that makes Stage 1 worth running at all. The post is `at://did:plc:3zhdeyok4trlrd3cijz7p4e6/app.bsky.feed.post/3m7rx7sb6q22l` — a Bluesky post about the 25th anniversary of the UK's first offshore wind farm (Blyth Offshore Wind), citing Ember data with a chart. It was chosen because the gold file at `references/cold-start/candidates/cand-284-jz7p4e6_app_bsky_feed_post_3m7rx7sb6q22l.json` pins the target Stage 1 resolution to a concrete publisher (Ember), dataset (Ember Data Explorer), distribution, and UK-electricity variable — every intermediate stage has somewhere real to land. Effect vocabulary is load-bearing throughout: every named component is a Service Tag, a Workflow class, a Worker name, or a Schema you can grep.

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

### Stage 0C. Staging snapshot → Stage 1 eval rows

- **Component:** `scripts/build-stage1-eval-snapshot.ts`, `src/platform/D1Snapshot.ts`, `src/eval/Stage1EvalSnapshotBuilder.ts`, `eval/resolution-stage1/run-eval.ts`.
- **Primitive:** cached `wrangler d1 export` → local sqlite snapshot, then the Stage 1 snapshot builder over the gold-set manifest.
- **Input:** current staging D1 state plus `references/cold-start/survey/gold-set-resolver.json`.
- **Output:** `eval/resolution-stage1/snapshot.jsonl` and the paired build report. Recent follow-ups removed the Twitter-only block and made the staging snapshot cache the default path, so both `at://` and `x://` posts now participate in the same eval loop.
- **For cand-284:** one snapshot row whose `postContext`, `vision`, and `sourceAttribution` come from the same staging-shaped data Stage 1 will see after deploy. *Shipped (`SKY-235`, `SKY-248`, `SKY-249`).*

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
- **Primitive:** `Stage1Resolver` (Tag `@skygest/Stage1Resolver`) layered on `DataLayerRegistry` (Tag `@skygest/DataLayerRegistry`, `src/services/DataLayerRegistry.ts:7-22`). The lookup contract is defined in `src/resolution/dataLayerRegistry.ts`, and `SKY-237` shipped the D1-backed prepared registry (`src/bootstrap/D1DataLayerRegistry.ts`) that now feeds that same contract; Slice 2c is the deployment step that moves this logic behind the resolver Worker fast path.
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
  - `residuals` is likely a single `DeferredToStage2Residual` covering the "25 years" temporal framing, which Stage 1 does not model. *Shipped in code (`SKY-235`); Slice 2c wires it into the resolver Worker fast path.*
  - The new Ember API-backed datasets from `SKY-265` widen future coverage, but they do not change cand-284's current gold target; the post still lands on the hand-curated Explorer dataset/distribution pair above. That distinction matters when reading Stage 1 regressions: this gold file is still measuring the legacy analytical-product path, not the new API route family.

### Stage 5. Stage 2 resolver

- **Component:** `src/resolution/Stage2Resolver.ts` (does not yet exist).
- **Primitive:** will follow the `Stage1Resolver` pattern — Tag `@skygest/Stage2Resolver`, layered on `DataLayerRegistry`.
- **Input:** a `Stage1Result` whose `residuals[]` contain `DeferredToStage2Residual` entries plus the original `Stage1Input`.
- **Output:** shape not yet authored; will add facet-decomposition matches against the seven-facet `Variable` composition from the April 8 D2 design (variable, observation_time, reference_area, unit, sector, frequency, measure). Will produce a `Stage2Output` with additional `Candidate` rows marked at facet grain plus narrowed residuals.
- **For cand-284:** would turn the `rawDims = { geography: "gb", category: "generation" }` hint plus the "Monday marked 25 years" temporal frame into facet-decomposed matches against the UK generation variable. *Planned — Slice 2d (SKY-239). NOT YET IMPLEMENTED — design session pending.*

### Stage 6. Stage 3 resolver

- **Component:** `DataRefResolverWorkflow` at `src/resolver-worker/DataRefResolverWorkflow.ts`.
- **Primitive:** `class DataRefResolverWorkflow extends WorkflowEntrypoint<...>`, hosted by the `skygest-resolver` Worker and reached via the `RESOLVER_RUN_WORKFLOW` Workflow binding declared in the resolver Worker's dedicated Wrangler config. Dispatched by `launcher.startIfAbsent` when Stage 2 residuals warrant LLM escalation.
- **Input:** Stage 2 candidate set + residuals + the original `Stage1Input`.
- **Output:** constrained-output LLM pick over the Stage 2 candidate set; writes resolved `Candidate` rows back into D1 via the Registry's write surface.
- **For cand-284:** would not normally fire — the Ember resolution is clean enough that Stage 1 alone produces accepted matches. *Planned — Slice 6 (SKY-240). NOT YET IMPLEMENTED — design session pending; Slice 2c ships only a workflow stub, real LLM body lands in Slice 6.*

### Stage 7. `data-ref-resolution` enrichment persisted via SKY-238 fast path

- **Component:** `skygest-resolver` Worker entry `src/resolver-worker/index.ts` (new), called from `EnrichmentRunWorkflow`.
- **Primitive:** new standalone Worker `skygest-resolver`, deployed from its own Wrangler config, with a `DB` D1 binding and a `RESOLVER_RUN_WORKFLOW` Workflow binding. HTTP surface:
  - `POST /v1/resolve/post` — single post
  - `POST /v1/resolve/bulk` — batch
  - `GET /v1/resolve/health`
  Both `skygest-bi-ingest` (`wrangler.toml`) and `skygest-bi-agent` (`wrangler.agent.toml`) declare a `RESOLVER` Service Binding; the Effect client wrapper lives at `src/resolver/Client.ts`.
- **Workflow step:** `EnrichmentRunWorkflow` gains one `step.do("call resolver service binding")` at the end of the source-attribution run, gated behind `AppConfig.enableDataRefResolution`. The step loads the vision + source-attribution rows from `post_enrichments`, calls `env.RESOLVER.fetch(...)` via the client, and persists the fast-path response as a new `post_enrichments` row with `enrichment_type = "data-ref-resolution"` (additive, no D1 migration).
- **Observability boundary:** the resolver client forwards `x-skygest-request-id` when present so request correlation survives the Worker hop. Cloudflare trace propagation across the Service Binding is handled separately by `SKY-272`; resolver-specific events and metrics belong to `SKY-278`.
- **New enrichment variant:**

```typescript
// src/domain/enrichment.ts (Slice 2c additions)
export const EnrichmentKind = Schema.Literals([
  "vision",
  "source-attribution",
  "grounding",
  "data-ref-resolution"
]);
export const DataRefResolutionEnrichment = Schema.Struct({
  kind: Schema.Literal("data-ref-resolution"),
  stage1: Stage1Result,
  stage2: Schema.optionalKey(Stage2Output),
  stage3: Schema.optionalKey(
    Schema.Struct({
      jobId: Schema.String,
      status: Schema.Literal("queued")
    })
  ),
  resolverVersion: Schema.String,
  registryVersion: Schema.String,
  processedAt: Schema.Number
});
```

- **Response shape:**

```typescript
type ResolvePostResponse = {
  postUri: PostUri;
  stage1: Stage1Result;
  stage2?: Stage2Output;        // lands in Slice 2d / SKY-239
  stage3?: { jobId: string; status: "queued" };
  resolverVersion: string;
  registryVersion: string;
  latencyMs: { stage1: number; stage2?: number; total: number };
};
```

- **Persistence:** one `post_enrichments` row, `enrichment_type = "data-ref-resolution"`, body carrying the staged resolver result, with Stage 1 already populated for the four cand-284 matches enumerated in Stage 4. *Planned — Slice 2c (SKY-238).*
- **Context note:** by the time this step lands, the D1 registry it reads from is already materially broader than the March architecture snapshot: EIA, Energy Charts, Ember API, and GridStatus catalog state now sit in the same lookup surface as the original hand-curated entities. The deployment slice is moving a stronger resolver substrate, not standing up an empty worker.

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
- **For cand-284:** one story scaffold and one `PostAnnotationFrontmatter` whose `source_providers` contains the Ember `ProviderId`; `data_refs` will carry the four `Candidate` IDs from Stage 1 once `SKY-242` lands. The cache substrate that later validates those refs is already shipped in `SKY-232`; the build-graph warning pass over them is the follow-on `SKY-243`. *Shipped (base); `dataRefs:` block is `SKY-242`, NOT YET IMPLEMENTED.*

### Stage 10. Discussion skill consumes the hydrated story

- **Component:** `.claude/skills/discussion/SKILL.md` in `skygest-editorial`.
- **Primitive:** Claude Code Skill — no Effect Tag. Reads the story file, calls MCP tools (`get_post_enrichments`, `get_post_thread`, `list_editorial_picks`, …) for additional context, and writes editorial prose back into the markdown body and arc files under `narratives/<slug>/index.md`.
- **Input:** the hydrated `StoryFrontmatter` + post-annotation files from Stage 9, plus any MCP responses it pulls mid-conversation.
- **Output:** in-place edits to the same story markdown and arc markdown; on next read, `build-graph` revalidates the frontmatter against `@skygest/domain/narrative`.
- **For cand-284:** the editor would discuss the 25-year offshore-wind frame, pull additional Ember context if warranted, and write a narrative body that cites the Candidate IDs from Stage 7 once they are available on disk. The ad-hoc MCP lookup/join pair that would let the skill resolve or cross-reference those data refs mid-conversation is still `SKY-241` / `SKY-244`. *Shipped (voice loop); data-ref lookup/join tools are planned.*

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
- **Who:** not yet wired.
- **Intent:** same workflow run, on behalf of the Operator; will fire when Stage 1 emits `DeferredToStage2Residual`.
- **Failure mode:** will surface the same way as Stage 1 — empty or ambiguous `data_refs` on the annotation.

### Stage 6. Stage 3 resolver
- **Who:** not yet wired.
- **Intent:** the `skygest-resolver` Worker, on behalf of the Operator, starts `DataRefResolverWorkflow` via `launcher.startIfAbsent` when Stage 2 residuals justify LLM escalation.
- **Failure mode:** `stage3.status = "queued"` in the fast-path response but no completion row ever lands; visible via `get_post_enrichments` as a `data-ref-resolution` row whose `stage3.jobId` is present but whose staged result never advances.

### Stage 7. `data-ref-resolution` fast-path persist
- **Who:** Cloudflare Workflow scheduler, on behalf of the Operator's Slice 2c deploy.
- **Intent:** end of the `EnrichmentRunWorkflow`, `step.do("call resolver service binding")` calls `env.RESOLVER.fetch(...)` and writes the response as a new `post_enrichments` row. The Operator's intent is "make data-ref resolution a normal enrichment lane so MCP tools can read it without a second round trip".
- **Failure mode:** `AppConfig.enableDataRefResolution = false`, or the Service Binding 500s — the Operator sees a missing `data-ref-resolution` row via `list_enrichment_gaps`.

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
| Worker hops | 3 | `skygest-bi-ingest` (host of `IngestRunWorkflow` + `EnrichmentRunWorkflow`) → `skygest-resolver` (Slice 2c; hosts the Stage 1 HTTP surface, is invoked via `RESOLVER` for Stage 7, and can optionally launch `DataRefResolverWorkflow` for Stage 6) → `skygest-bi-agent` (host of MCP Surface + HTTP API, reaches backend via `INGEST_SERVICE` Service Binding). |
| Workflow class invocations | 3 | `IngestRunWorkflow` (Stage 1), `EnrichmentRunWorkflow` (Stages 2, 3, 4, 7), `DataRefResolverWorkflow` (Stage 6, planned). |
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
7. `skygest-resolver` Worker → `Stage1Resolver` → `DataLayerRegistry` → response → D1 row (Stages 4 and 7)
8. Editor (voice) → Discussion Skill → MCP-calling LLM (Stage 8 open)
9. MCP-calling LLM → `curate_post` + `submit_editorial_pick` MCP tools → `skygest-bi-agent` → `INGEST_SERVICE` → D1 rows (Stage 8)
10. MCP-calling LLM → `get_editorial_pick_bundle` + `hydrate-story` → filesystem write (Stage 9)
11. Editor (voice) → Discussion Skill → filesystem edits → `build-graph` → Reader-facing markdown (Stage 10)

The Reader never appears in the handoff chain for a single post — Reader reads `editions/published/*.md`, which is a downstream compilation of many story files. For cand-284 the chain terminates at handoff 11, inside `skygest-editorial`.
