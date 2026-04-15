# Deep Research Prompt — Cloudflare-native Entity Search Service for Domain-Typed Chart Resolution

**Date**: 2026-04-13
**Linear ticket**: SKY-345 (research) → SKY-342 (implementation)
**Expected output location**: `docs/research/2026-04-NN-entity-search-architecture.md`
**Reframe context**: `/Users/pooks/Dev/ontology_skill/docs/plans/2026-04-13-chart-resolution-reframe-design.md`

This prompt is intended to be pasted into a deep-research tool (Perplexity Pro, Claude Research, ChatGPT Deep Research, or similar) as a single self-contained brief. It is versioned in the repo so future iterations of the same research — when the catalog grows, when the Cloudflare runtime evolves, or when the constraints change — have a clear starting point.

---

## What I need from you

I'm building an entity-resolution service for a domain-specific application (energy data and charts) that runs entirely in the Cloudflare Workers ecosystem. I need a deep architectural research report that surveys: (1) how this category of problem is solved generally, (2) what the current state of the art is for serverless / edge-deployed information retrieval, and (3) how to map a typed RDF/DCAT/SKOS ontology onto a search index so I can do retrieval-with-scope and post-link reasoning in one pipeline. The output should be a written architectural recommendation, not just a list of tools.

The problem is **not new in category** — it's well-trodden in entity linking, semantic search, and linked-data retrieval. What's new is the constraint set: it has to run in Cloudflare's edge runtime, integrate with a typed Effect-TS / Schema-driven codebase, support a moderately-sized typed ontology (~10k entities now, 50–100k target), and serve a sub-100ms query budget end-to-end.

---

## The application context

**Skygest** is an editorial intelligence layer for energy news. Operators ingest social media posts (Bluesky, Twitter) that contain charts, screenshots, and links. A vision enrichment pipeline (Gemini 2.5 Flash) extracts structured analysis from each chart asset. A separate source-attribution enrichment resolves "who published this" from text + URL signals. Curators then surface the highest-signal posts.

The piece this research is about: **given a chart asset extracted from a social post, resolve its features to entries in our typed catalog so we can answer questions like "this chart shows EIA Hourly Electric Grid Monitor wind generation data, here's the underlying dataset, here's the publishing agent, here are related variables."**

---

## The data we're working with

### Input: enriched chart bundles

Each chart asset in a post produces a typed bundle. Concretely (real schema field names from our codebase):

```ts
type EnrichedBundle = {
  asset: VisionAssetAnalysisV2;
  sourceAttribution: SourceAttributionEnrichment | null;
  postContext: { postUri, text, links[], linkCards[], threadCoverage };
};

type VisionAssetAnalysisV2 = {
  title: string | null;                           // chart title (often a sentence)
  xAxis: { label, unit } | null;
  yAxis: { label, unit } | null;
  series: Array<{ legendLabel, unit }>;          // per-line discriminators on multi-line charts
  sourceLines: Array<{                            // "Source: X" footer text
    sourceText: string;
    datasetName: string | null;                   // vision-extracted catalog name (sparse — ~12% populated)
  }>;
  temporalCoverage: TimePeriod | null;
  chartTypes: ("line-chart" | "bar-chart" | ...);
  keyFindings: Array<{ text, assetKeys }>;
  visibleUrls: Array<string>;                     // URLs literally drawn on the chart image
  organizationMentions: Array<{ name, location }>;
  logoText: Array<string>;                        // logos identified in the chart
};

type SourceAttributionEnrichment = {
  provider: { providerId, providerLabel, sourceFamily } | null;
  contentSource: { url, title, domain, publication } | null;
  // Note: provider is resolved by an upstream enrichment step.
  // On real data it's populated only ~8% of the time.
};
```

### The catalog we're resolving TO

A DCAT-aligned entity catalog with explicit type hierarchy:

```
Agent ─┬─ publishes ─→ Dataset ─┬─ hasSeries ─→ Series ─→ implementsVariable ─→ Variable
       │                         └─ distribution ─→ Distribution
       └─ homepage URL
```

Concrete current sizes (will grow):
- 66 Agents (66 with `homepage` set, all have `name` and `alternateNames`)
- 1430 Datasets (1404 with `landingPage`, all with `title` and `aliases[]`)
- 3128 Distributions (each with `accessURL`/`downloadURL`/`kind ∈ {download, api-access, landing-page, interactive-web-app, ...}`)
- ~variable, ~series tables (smaller)
- A separate **vocabulary ontology** (`skygest-energy-vocab` v0.2) with 8 SKOS ConceptSchemes, 114 concepts, 771 surface-form entries across facets: `measuredProperty`, `domainObject`, `technologyOrFuel`, `statisticType`, `aggregation`, `unitFamily`, `policyInstrument`. These are reasoning vocabularies, not entities — but a Variable's `measuredProperty: "generation"` is a SKOS concept that has its own surface forms.

The full target structure is RDF/OWL with SHACL shapes and a property chain `Dataset hasSeries ∘ implementsVariable → hasVariable`. We have 74 SPARQL competency questions, HermiT-clean.

### Worked example

A real chart from the snapshot:
- **Chart title**: "Wind and solar reached 22% of Türkiye's electricity mix, yet coal still remains dominant at 34%"
- **xAxis**: { label: null, unit: null }
- **yAxis**: { label: "Share of electricity generation", unit: "%" }
- **series**: [`{legendLabel: "Wind+Solar", unit: "%"}`, `{legendLabel: "Coal", unit: "%"}`, `{legendLabel: "Gas", unit: "%"}`, ...]
- **sourceLines**: [`{sourceText: "Source: Ember Türkiye Electricity Review 2026", datasetName: null}`]
- **visibleUrls**: [`https://ember-energy.org/latest-insights/turkiye-electricity-review-2026/`]
- **logoText**: ["EMBER"]
- **organizationMentions**: [`{name: "EPİAŞ", ...}`, `{name: "TEİAŞ", ...}`, `{name: "EMBER", ...}`]
- **sourceAttribution.provider**: null (upstream resolver missed it)

The desired resolution:
- **Agent**: `Ember` (resolvable via logo text, organization mention, URL hostname)
- **Dataset**: `Ember Türkiye Electricity Review 2026` (matchable by source-line text, by URL landingPage, by chart title containing "Türkiye electricity")
- **Series**: the country-yearly electricity mix series (one per fuel type)
- **Variables**: `electricity-share-by-source-Türkiye` × multiple discriminators
- **Reasoning post-checks**: yAxis unit `%` should be compatible with the Variable's `unitFamily: dimensionless-share`, NOT `unitFamily: energy`

This single example exercises every signal type: text, URL, brand mark, organization name, axis label, axis unit, series labels, temporal scope, and ontological consistency check.

---

## The deployment context

The application runs as a **Cloudflare Worker** with these bindings already in use:
- **D1** (Cloudflare's distributed SQLite) for transactional data — supports FTS5 full-text natively
- **KV** (key-value, eventually consistent global) for cache-shaped reads
- **R2** (object storage, S3-API) for blobs
- **Workflows** (durable execution) and **Durable Objects** for stateful coordination
- **Workers AI** (Llama, BGE-base-en, Whisper, etc.) for inference at the edge — no separate model server
- **Vectorize** (Cloudflare's managed vector index) for dense embedding storage and ANN search
- **Hyperdrive** for connection pooling to external Postgres if needed

The codebase is **TypeScript with Effect.ts** (the `effect` library, not RxJS-style). All IO is wrapped as `Effect`, services use `ServiceMap.Service` + `Layer.effect` dependency injection, errors are `Schema.TaggedError`, schemas are the single source of truth via `effect/Schema`. Worker bundles must contain zero Node built-ins; only Effect platform APIs (`FileSystem`, `Path`, `HttpClient`, `DateTime`) are allowed in `src/`.

The query budget is **sub-100ms** for the hot path (operator types a query → results render). The index can be built offline at deploy time. Live updates from the curation MCP (admins adding agents/datasets) are a Phase 3 concern.

---

## What we've tried, and why we're rebuilding

We built two iterations of a procedural resolver:

**Iteration 1**: A "Stage 1" file (`Stage1.ts`) that walks each vision field with a different `pushXMatch` / `pushYAlias` function — 9 different probe functions, each routing a specific field to a specific exact-key lookup on a `DataLayerRegistryLookup` interface (`findDatasetByTitle`, `findAgentByLabel`, `findDistributionByUrl`, etc.). This worked but spread the logic so thinly across the file that you couldn't tell which signal feeds which rung.

**Iteration 2**: A "Stage 2 kernel" (`Interpret → Bind → Assemble`) that took Stage 1's output and tried to fold partial Variable shapes via facet algebra, using a `subsumes()` lattice operation. Optimizing this against a 76-row gold set produced violent bucket count swings on every vocabulary tweak — classification-eval framing on what is fundamentally a retrieval problem.

**Iteration 3** (also discarded): A "bundle-oriented" rung-by-rung function (`resolveDataReference`) that explicitly walked Agent → Dataset → Series → Variable with one probe function per rung. Cleaner but still procedural — adding a new signal still meant wiring a new probe into the rung.

**The diagnosis we converged on**: this is a multi-field information retrieval problem against a typed entity corpus, and we keep reinventing search per-signal-type instead of building search once. **The new direction is to build a real entity search service that all of the above call into uniformly**, with the ontology used for index structure (denormalizing parent labels into child docs, exposing typed scope filters, encoding SKOS surface forms as searchable fields) and post-link reasoning (unit algebra, cross-facet consistency, SHACL validation) — but never inside the retrieval hot path.

This is why the research is a category-of-problems question, not a novel-technique question. **Linked-data search engines, scholarly entity linking, biomedical entity normalization, ESCO/Wikidata QID resolution — all of these have solved variants of this problem.** I want to know what current best practice looks like and how it maps onto the Cloudflare runtime constraints.

---

## Architectural questions I want answered

### 1. Search backend selection (Cloudflare-native)

Which production search backends are realistic from inside a Cloudflare Worker, given the constraints above? Specifically compare:

- **D1 + SQLite FTS5** — BM25, contentless tables, SQL filters, single-store. What are the real limits on FTS5 index size and query throughput in D1 today? What are people doing in production with this? What goes wrong above ~100k rows?
- **Vectorize** alone — dense-only retrieval, no lexical. What model do you embed with (Workers AI BGE-base? OpenAI? Cohere?) and what's the latency profile from a Worker?
- **D1 FTS5 + Vectorize hybrid** — BM25 lexical primary, dense secondary, fused at query time. How is fusion typically done (RRF, normalized score sum, learned)? What does the query path look like when both stores are involved?
- **In-memory JS in the Worker bundle** (MiniSearch, Orama, FlexSearch) — viable if catalog stays under ~20k entities? What's the bundle-size impact and cold-start cost?
- **WASM-compiled engines** (Tantivy → WASM, DuckDB-WASM with FTS) — has anyone shipped these in production Workers?
- **External managed** (Algolia, Typesense Cloud, Meilisearch Cloud) — what's the latency cost from a Worker calling these via REST? Worth the dependency for our scale?

For each viable option, please assess against: **query latency, index size ceiling, hybrid-search support, scoping-filter composability with text queries (e.g., "find Datasets with text 'X' AND publisherAgentId IN [...]"), denormalization support, write-side complexity (full rebuild vs. incremental), local test backend story, cost trajectory at our scale.**

### 2. Mapping a typed DCAT/SKOS ontology onto a search index

This is the heart of the research. I want a deep dive into how teams in linked-data search, scholarly entity linking, and knowledge graph retrieval handle this. Specifically:

- **Document model**: when you have multiple entity types (Agent, Dataset, Series, Variable, Distribution) in one corpus, do you index them as one document type with a `entityType` field, or one collection per type? What are the tradeoffs? How do hybrid systems (Algolia, Typesense, Vespa) do this?
- **Denormalization of parent labels into child docs**: a Variable's search doc should probably include its parent Dataset's title and its parent Agent's name as searchable fields, so a query like "EIA hourly grid monitor wind generation" can hit the Variable directly without doing two-step Agent → Dataset → Variable narrowing at query time. What's the standard pattern? How aggressive should denormalization be? When does it stop paying off?
- **SKOS surface forms**: each Variable has facets that point to SKOS Concepts (`measuredProperty: "generation"`, `domainObject: "electricity"`, `technologyOrFuel: "wind"`), and each Concept has multiple `prefLabel` + `altLabel` surface forms. Do you flatten these into the entity doc, index Concepts as their own searchable type, or both? How do systems like Wikidata search, FAST, RAMEAU handle this?
- **Property-chain materialization**: in OWL we can derive `Dataset hasVariable Variable` from `hasSeries ∘ implementsVariable`. Do production systems materialize these chains as direct edges in the search index, or compute them at query time, or skip them?
- **Aliases / brand variants**: an Agent like "Fraunhofer Institute for Solar Energy Systems ISE" also publishes under the brand "Energy-Charts.info". How do entity linking systems handle brand-vs-parent disambiguation? Look at how Wikidata QID resolution handles disambiguation pages and aliases.

### 3. Retrieval + reasoning split

The reframe doc I'm working from argues that **linking** (find the entity) and **reasoning** (verify the entity is consistent with what the chart says) should be solved by different code paths — search-and-rank for linking, ontology-based validation for reasoning, with reasoning running as post-link checks rather than inside the matching hot path. I want to know:

- Is this a recognized pattern? What's it called? Who's done it well?
- Where do production systems draw the line between IR and KR/reasoning? Look at scholarly entity linking (BLINK, ReFinED, mGENRE), biomedical NER+normalization (BioBERT pipelines), Wikidata candidate-then-rank approaches.
- For the reasoning side specifically: how do production systems run SHACL, SPARQL, or unit-algebra checks at scale without putting them in the request hot path? Async post-link validation? Eventual-consistency flag-not-block patterns?

### 4. Multi-field query construction from heterogeneous bundles

Our input bundles have ~10 distinct signal types (chart title, axis labels, series legends, source line text, visible URLs, link cards, post text, organization mentions, logo text, content source domain). Each has different match characteristics — chart title is usually a descriptive sentence (low-trust as a Dataset name), logo text is high-precision but low-coverage, source line text often contains the dataset name embedded in prose.

How do production multi-field IR systems handle this?
- One query per field with weighted score fusion?
- One concatenated query with field-weighted BM25 (Elasticsearch-style)?
- Per-field re-rankers?
- A learning-to-rank model on top?

Look at how systems like ColBERT-v2, SPLADE, BGE rerankers, and Cohere Rerank handle multi-field documents with heterogeneous signal trust. Also look at how scholarly search (OpenAlex, Semantic Scholar) handles author-title-venue-year multi-field queries.

### 5. Evaluation methodology

The reframe doc explicitly argues against the "did we pick the right entity?" classification framing because tuning vocabulary causes violent bucket count swings on a 76-row gold set. What's the right evaluation framing for entity linking?
- **Recall@K** — is the true entity in the top-K candidates?
- **MRR** — where in the ranked list does the true entity appear?
- **Scope precision** — for type/agent-scoped queries, what fraction of returned hits are in-scope?
- **NDCG, MAP** — for queries with known relevance grades

Survey what production entity linking systems actually use, what gold set sizes are realistic, and how systems like BLINK / ReFinED measure themselves.

### 6. Local dev and test backend strategy

We want unit tests to use an in-memory backend (no D1 binding required) and production to use the real Cloudflare backend, both behind a single Effect Service interface. Is this a recognized pattern? What's the right level of abstraction — service interface that hides storage entirely, or service interface that exposes a query AST that both backends translate?

### 7. Incremental index updates

Phase 3 wants live updates from the curation MCP — when an admin adds a new agent or dataset, the search index should reflect it without a full rebuild. How do production hybrid lexical+dense systems handle incremental updates? D1 + FTS5 supports row-level inserts; Vectorize supports upserts; what does the dual-write story look like?

### 8. Prior art / related systems to study

Please survey and summarize the architectural lessons from these systems specifically — I want to understand what they got right, what they got wrong, and what's transferable:

- **Wikidata search and the QID resolver** — denormalization, alias handling, property-based ranking
- **BLINK** (Facebook) — dense entity linking via biencoder + crossencoder rerank
- **ReFinED** (Amazon) — fine-grained entity linking with type constraints
- **DBpedia Spotlight** — older but dense-reference-based linker
- **Semantic Scholar / OpenAlex** — multi-field scholarly search with author/venue/title/year fields
- **PubMed / MeSH** — controlled vocabulary search with hierarchy
- **ESCO** (European skills classification) — typed multilingual hierarchy with surface forms
- **FAST / RAMEAU** — library subject heading search
- **Sindice / Swoogle** (defunct but historically important) — semantic web search engines
- **Modern Cloudflare-deployed search systems** — anything documented publicly about what production teams are doing with D1 FTS5 + Vectorize, especially in the 10k–100k entity range
- **Orama, MiniSearch, FlexSearch** in production — case studies of in-memory edge search

---

## What I want as output

A structured architectural recommendation document, ~3000–5000 words, with these sections:

1. **Problem framing** — restate the problem in IR/entity-linking terminology so it's grounded in the literature
2. **Category survey** — how this problem class is solved generally, with the prior art above
3. **Cloudflare backend comparison** — concrete, numbers where possible, ranked
4. **Recommended architecture** — service interface, document model, index population strategy, query planning, retrieval+reasoning split, test backend, incremental update path
5. **Mapping the DCAT/SKOS ontology** — concrete document schemas for each entity type with denormalization decisions called out
6. **Evaluation strategy** — what metrics to compute, what gold set size is realistic, how to avoid the classification-eval trap
7. **Tradeoffs and risks** — what could go wrong, what's the recovery path if the chosen backend caps out
8. **Implementation slices** — a sequenced plan to get from "nothing" to "running in production"

Please cite specific papers, blog posts, GitHub repositories, and production case studies. Don't paraphrase — link the sources and quote the load-bearing claims so I can verify them.

If there's a question I should be asking but didn't, flag it explicitly.
