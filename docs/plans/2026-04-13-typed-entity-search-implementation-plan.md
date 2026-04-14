---
status: proposed
created: 2026-04-13
related:
  - docs/plans/2026-04-13-chart-resolution-reframe-design.md
  - docs/plans/2026-04-12-sky-313-runtime-variable-profile-and-registry-audit-spec.md
  - docs/plans/2026-04-12-sky-314-resolution-kernel-interpret-bind-assemble.md
  - docs/plans/2026-03-14-search-infrastructure-specification.md
  - docs/plans/2026-04-11-sky-239-vocabulary-ontology-architecture.md
---

# Typed entity search implementation plan

## TL;DR

Build typed entity search as a new lexical-first retrieval layer on top of the
existing data-layer spine, not as an extension of the ontology matcher and not
as a replacement for Stage 1 exact lookup.

Day one should:

1. materialize a unified `entity_search_docs` projection from the typed data
   layer
2. index that projection in a dedicated D1 search database with structured
   filter columns
3. expose an Effect-native `EntitySearchService` with rung-specific search
   intents and a dedicated search-storage layer
4. call that service only after the current exact URL / alias / hostname
   lookups have had a chance to win
5. keep Vectorize behind a clean optional recall seam, not in the critical path
6. avoid a dedicated search worker in phase 1; compose the service directly
   into the worker runtime that needs it

The canonical model stays in the existing data-layer tables and schemas. The
search index is a rebuildable read model.

---

## Why this plan fits the repo

The current codebase already has the main pieces we need:

- a typed catalog/domain spine for `Agent`, `Dataset`, `Distribution`,
  `Variable`, and `Series` in `src/domain/data-layer/*`
- a generated ontology-owned field boundary in
  `src/domain/generated/dataLayerSpine.ts`
- a D1-backed registry loader in `src/bootstrap/D1DataLayerRegistry.ts`
- a deterministic exact-match layer in `src/resolution/dataLayerRegistry.ts`
  and `src/resolution/Stage1.ts`
- a working FTS5 service pattern on the post side in
  `src/services/KnowledgeQueryService.ts` and
  `src/services/d1/KnowledgeRepoD1.ts`

The missing piece is not more ontology parsing. The missing piece is a typed
retrieval projection that turns the existing catalog graph into search-friendly
documents with:

- denormalized parent and child labels
- aliases and surface forms
- URL and hostname evidence
- exact filter columns for entity kind and scope
- a stable query service boundary the resolver can call

That is the narrowest change that matches both the existing repo shape and the
retrieval-first direction already captured in the recent resolver design docs.

---

## Existing seams we should preserve

### 1. Canonical source of truth stays relational and typed

Do not make the search index a second source of truth.

The source of truth remains:

- checked-in cold-start catalog files under `references/cold-start/`
- D1 data-layer tables introduced in `src/db/migrations.ts`
- Effect Schema domain types in `src/domain/data-layer/*`

The search index is a projection over those entities.

### 2. Stage 1 exact lookup remains first

Today the repo already has strong exact lookups for:

- canonical URIs
- typed aliases
- dataset titles
- agent labels
- distribution URLs
- distribution URL prefixes
- distribution and homepage hostnames

Those live in `src/resolution/dataLayerRegistry.ts` and are used by
`src/resolution/Stage1.ts` and `src/resolution/bundle/resolveDataReference.ts`.

That logic should stay in front of the new search service.

If a visible URL or exact alias already resolves the target, we should not pay
the cost of ranked retrieval.

### 3. Resolver and retrieval should remain separate services

The post search stack already follows a clean pattern:

- API/router layer owns transport
- query service owns request shaping
- repo owns D1 execution

The resolver stack already follows a similar pattern:

- worker fetch handler owns HTTP
- `ResolverService` owns orchestration
- `Stage1Resolver` and `ResolutionKernel` own typed resolution

Typed entity search should use the same layering instead of letting the
resolver talk directly to SQL.

### 4. Cross-worker seams should stay deliberate

The current architecture docs treat cross-worker seams as expensive and
purpose-built:

- `INGEST_SERVICE` for backend-owned write traffic
- `RESOLVER` for `Stage 1 + kernel` resolution

Phase 1 typed entity search should not introduce another request-time worker
hop.

The service should be composed in-process in the worker that needs it. If a
separate search worker is ever justified later, it should be a conscious
follow-on decision with its own typed transport contract.

### 5. Ontology support should stay offline or post-link

The repo already treats ontology and vocabulary as prebuilt runtime inputs:

- `src/resolution/facetVocabulary/*`
- `src/services/OntologyCatalog.ts`
- `scripts/sync-vocabulary.ts`
- generated profile and spine artifacts under `src/domain/generated/`

Continue that approach.

Search-time behavior should consume precomputed surface forms, canonicals, and
lineage strings. It should not execute ontology reasoning in the hot path.

---

## Addendum: utility centralization prerequisite

## Why this needs to happen first

Typed entity search will depend on one stable contract for:

- exact URL matching
- hostname narrowing
- visible-URL cleanup
- URL-like extraction from mixed text
- lookup URL normalization for index storage and request-time probes

The repo does not have that contract today. It has overlapping helpers with
slightly different behavior across resolver, source attribution, ingestion,
vision cleanup, and ops/import code.

If we skip this cleanup, the new search index will quietly disagree with the
existing exact-match system about what the "same" URL or hostname means.

## Survey findings

### 1. The runtime already has a strong URL helper stack, but it is not the only one

`src/resolution/normalize.ts` is currently the richest URL helper surface. It
already contains:

- URL-like parsing with missing-scheme fallback
- normalized lookup URL construction
- normalized hostname extraction
- URL prefix construction
- URL-like extraction from free text

That makes it the best starting point for the shared contract.

### 2. Source attribution still uses its own URL/domain path

`src/source/normalize.ts` and `src/source/SourceAttributionRules.ts` still
carry separate helpers for:

- hostname parsing
- normalized domain extraction
- domain extraction from mixed source text

This means source attribution can interpret a link, link card, or visible URL
differently from Stage 1 and the future search layer.

### 3. Vision-visible URL cleanup is implemented separately

`src/enrichment/GeminiVisionServiceLive.ts` has its own local logic for:

- trimming OCR punctuation around visible URLs
- inserting a fallback scheme
- validating URL-ish fragments
- extracting URL fragments from noisy text

That logic belongs in the shared URL contract because visible URLs are one of
the highest-value inputs to typed entity search.

### 4. Ingest and import paths still do local hostname extraction

These modules still call `new URL(...).hostname` directly or via tiny local
wrappers:

- `src/bluesky/PostRecord.ts`
- `src/ops/TwitterNormalizer.ts`
- `src/ops/BlueskyNormalizer.ts`

Those are smaller duplications, but they still create drift in stored link
domains and imported evidence.

### 5. Script-level duplication also exists

The same normalization logic is duplicated in lower-risk tooling such as:

- `scripts/catalog-harvest/harvest-provider-registry.ts`
- `scripts/catalog-harvest/probe-awesome-energy.ts`

These are not the first migration targets, but they should follow the shared
contract once it is stable.

### 6. Some URL parsers should remain specialized

Not every URL helper belongs in one file.

These should stay specialized wrappers built on shared base utilities:

- `src/domain/ingestUrl.ts` for supported social-post URL parsing
- `src/bluesky/BlueskyClient.ts` for Bluesky service-endpoint validation
- file-extension mime inference in `src/enrichment/VisionEnrichmentExecutor.ts`

## Centralization target

Create one shared pure URL utility module for cross-runtime behavior.

Recommended target:

- `src/platform/Url.ts`

That module should own the generic shared behaviors:

- hostname normalization
- URL-like parsing with optional scheme fallback
- normalized hostname extraction from URL-like input
- normalized lookup URL construction
- visible-URL cleanup helpers
- URL-like extraction from mixed text
- normalized URL prefix construction

Then keep thin local wrappers where behavior is intentionally specialized.

## Migration priority

### Must migrate before entity search implementation

- `src/resolution/normalize.ts`
- `src/source/normalize.ts`
- `src/source/SourceAttributionRules.ts`
- `src/bluesky/PostRecord.ts`
- `src/enrichment/GeminiVisionServiceLive.ts`

These directly affect runtime evidence and exact-match behavior.

### Immediate follow-on cleanup

- `src/ops/TwitterNormalizer.ts`
- `src/ops/BlueskyNormalizer.ts`

These are important for imported data quality, but they are not the first
typed-entity-search hot path.

### Opportunistic cleanup

- catalog-harvest scripts
- diagnostics and analysis scripts

## Search-specific requirement

The new search projector, search repo, Stage 1 URL probes, and any future URL
reranking must all use the same centralized helper contract.

That is how we guarantee agreement on:

- what gets stored in `url_text`
- how exact URL probes are normalized
- how hostnames are matched
- how URL prefixes are derived
- how visible URLs from vision output are interpreted

Without that, lexical search, exact match, and source attribution will drift
from one another.

---

## Locked decisions

### 1. Canonical backend: D1 + FTS5, with a dedicated search database

Use D1 as the storage and lexical search engine, but do not put the new entity
search projection in the same database as the rest of the application.

Recommended topology:

- primary app database: canonical source of truth
- dedicated search database: derived `entity_search_*` read model

The index is rebuildable, so it is a good candidate for a separate D1 instance.

Rationale:

- the repo already uses D1 everywhere relevant
- Cloudflare D1 is single-threaded per database, so isolating the search queue
  from the rest of the app is valuable
- the Worker write path should use `D1Database.batch()` semantics for real D1
  writes instead of assuming SQL-client transactions, because Effect's current
  D1 client does not expose transaction support
- the resolver worker can cleanly take an additional search binding
- the post search stack already proves out FTS5 in this codebase
- local development and migrations are already built around D1

### 2. No dedicated search worker in phase 1

Phase 1 should introduce a dedicated search database, not a dedicated search
worker.

Implementation rule:

- build typed entity search as shared domain/repo/service modules
- compose it directly into the worker runtime that needs ranked entity search
- do not add a resolver-to-search or agent-to-search RPC seam

Initial runtime consumer:

- the resolver worker, because candidate generation belongs on the same hot
  path as Stage 1 fallback

Future reuse:

- the agent worker can compose the same service later for operator routes, MCP
  tools, or debug endpoints if those become real requirements

### 3. Phase 1 search is lexical-first

Phase 1 should be D1 FTS5 plus exact filters and exact probes.

Vectorize is phase 2 recall, not phase 1 retrieval.

### 4. One unified search corpus, not separate engines per entity type

Do not build five unrelated search systems.

Build one unified search projection with `entityType` plus structured filter
columns. The source tables remain typed and relational, but retrieval should be
one corpus.

### 5. Search documents are derived from the registry graph

Projection code should build search docs from the prepared registry or an
equivalent typed projection input, not from ad hoc SQL joins scattered across
the repo.

That keeps derivation rules in one place and lets the same projector run on:

- checked-in cold-start data in tests
- D1-loaded entities in workers
- rebuild scripts

### 6. Resolver search calls are rung-specific

The service boundary should expose search intents, not generic SQL-ish methods.

Required intent surface:

- `searchAgents`
- `searchDatasets`
- `searchSeries`
- `searchVariables`
- `searchDistributions`
- `resolveBundleCandidates`

### 7. Ontology awareness is materialized, not executed

The search docs should carry:

- current facet canonicals
- current surface forms
- parent and child labels
- future ontology references such as OEO terms when available

But request-time search should not depend on SPARQL, SHACL execution, or graph
traversal outside the already-loaded registry scope.

For the current variable facets, phase 1 should index the existing canonical
string values directly. If SKY-348 later introduces OEO IRIs, those IRIs should
arrive as parallel enrichment fields, not as a replacement for the current
string-valued facet filters.

### 8. Vectorize must be optional from day one

Design the service so lexical retrieval works with no vector binding at all.

The repo currently has no Vectorize binding or code path. Phase 1 must remain
fully functional without it.

---

## Proposed architecture

## High-level flow

```text
catalog entities in D1 / checked-in seed
  -> typed registry load
  -> entity search projector
  -> entity_search_docs + entity_search_fts
  -> EntitySearchRepo
  -> EntitySearchService
  -> resolver or operator/debug consumers

request path:
  Stage 1 exact match
  -> if unresolved or ambiguous, call EntitySearchService
  -> ranked candidates
  -> ResolutionKernel / post-link validation
```

## Worker placement

Treat typed entity search as a shared internal service, not as a new worker.

Phase 1 runtime placement:

- `EntitySearchService` is composed into the resolver worker runtime
- the resolver worker gets both `DB` and `SEARCH_DB`
- ranked entity search runs in-process after Stage 1 exact lookup fails to
  finish the rung

Why this is the right first placement:

- the immediate hot path is resolver fallback, not public typeahead
- it avoids a new request-time worker seam
- it preserves the resolver worker's current role as the place where
  resolution-specific orchestration happens
- it still keeps the search database isolated from the canonical database

What this does not prevent:

- later adding the same service to the agent worker for operator/debug search
- later extracting a dedicated search worker if traffic or deployment cadence
  proves that worthwhile

The key rule is that search remains a library/layer boundary first and only
becomes a transport boundary if we later have evidence that we need one.

## Effect-native service stack

Follow the repo's existing service pattern instead of introducing a new one.

Recommended stack:

1. `src/domain/entitySearch.ts`
2. `src/domain/entitySearchProjection.ts`
3. `src/search/projectEntitySearchDocs.ts`
4. `src/services/EntitySearchRepo.ts`
5. `src/services/d1/EntitySearchRepoD1.ts`
6. `src/services/EntitySemanticRecall.ts`
7. `src/services/EntitySearchService.ts`

Rules:

- use `ServiceMap.Service`, not a one-off service pattern
- define service methods with `Effect.fn`
- keep projector logic pure and outside Effect where practical
- decode unknown input at the outer boundary with Schema decoders
- keep service method dependencies in layers, not in method requirements
- provide optional semantic recall through a no-op default layer

Recommended layer shape:

```ts
makeEntitySearchLayer(env) =
  Layer.mergeAll(
    entitySearchStorageLayer(env),
    entitySearchRepoLayer,
    entitySemanticRecallLayer,
    entitySearchServiceLayer
  )
```

Where:

- `entitySearchStorageLayer(env)` is a narrow storage layer backed by
  `env.SEARCH_DB`
- `entitySearchRepoLayer` depends on the search storage layer only
- `entitySearchServiceLayer` depends on the repo, semantic recall, and
  registry/exact-match helpers

This keeps the second database explicit without leaking it through unrelated
service graphs.

## Dual-D1 layer composition

The repo currently assumes a single D1-backed `SqlClient` inside each provided
subgraph. Adding `SEARCH_DB` should preserve that clarity rather than adding a
second global SQL client to a broad base layer.

Implementation rule:

- keep canonical D1 wiring and search D1 wiring in separate provided
  subgraphs
- do not merge raw `SqlClient` requirements for both databases into one shared
  base layer

In practice:

- canonical repos continue to get `D1Client.layer({ db: env.DB })`
- search repos get their own provided `D1Client.layer({ db: env.SEARCH_DB })`
- merge the fully provided repo layers afterward

That matches the existing `Layer.provideMerge` style in the repo and avoids
muddying which repo talks to which database.

Because Effect memoizes layers by reference equality, the search layer should
be constructed once per worker environment and cached the same way the repo
already caches shared worker parts.

## New modules

### Domain

- `src/domain/entitySearch.ts`
- `src/domain/entitySearchProjection.ts`

These files should define:

- `EntitySearchEntityType`
- `EntitySearchDocument`
- `EntitySearchScope`
- rung-specific query input schemas
- ranked hit output schemas
- optional semantic recall payload shapes

### Projection

- `src/search/projectEntitySearchDocs.ts`

This pure module turns a typed registry seed or prepared registry into search
documents.

### Repo

- `src/services/EntitySearchRepo.ts`
- `src/services/d1/EntitySearchRepoD1.ts`

This owns:

- projection upsert/delete
- lexical query execution
- future vector query adapter hook
- access only to the dedicated search database

### Service

- `src/services/EntitySearchService.ts`

This owns:

- rung-aware query planning
- exact-probe short-circuiting
- lexical candidate retrieval
- optional vector recall fusion
- lightweight result shaping for the resolver

### Runtime composition

- `src/search/Layer.ts` or `src/services/EntitySearchLayer.ts`

This module should own the search-specific layer graph so that resolver and
agent runtimes can opt into it without duplicating wiring.

### Scripts / ops

- `scripts/rebuild-entity-search-index.ts`
- `scripts/diagnose-entity-search.ts`
- later: `scripts/eval-entity-search.ts`

---

## Search document model

## Entity types in scope

Phase 1 should index:

- `Agent`
- `Dataset`
- `Distribution`
- `Series`
- `Variable`

Do not index `Catalog`, `CatalogRecord`, `DataService`, or `DatasetSeries` in
the public resolver path yet. They can be added later for operator/debug use if
needed.

Phase 1 is also DCAT-only in corpus shape.

Posts remain request-time evidence that gets converted into a bundle search
plan. They are not part of the phase-1 entity-search corpus. If the later D4
post URI scheme lands, posts should become a separate corpus under
`https://id.skygest.io/post/...` without changing the DCAT entity index.

## Document shape

Use a unified typed document with three kinds of data:

1. identity and ranking fields
2. structured filter fields
3. denormalized search text

Recommended logical shape:

```ts
type EntitySearchDocument = {
  entityId: string
  entityType: "Agent" | "Dataset" | "Distribution" | "Series" | "Variable"
  primaryLabel: string
  secondaryLabel?: string
  aliases: ReadonlyArray<{ scheme: string; value: string; relation: string }>

  publisherAgentId?: string
  agentId?: string
  datasetId?: string
  variableId?: string
  seriesId?: string

  measuredProperty?: string
  domainObject?: string
  technologyOrFuel?: string
  statisticType?: string
  aggregation?: string
  unitFamily?: string
  policyInstrument?: string
  frequency?: string
  place?: string
  market?: string

  homepageHostname?: string
  landingPageHostname?: string
  accessHostname?: string
  downloadHostname?: string
  canonicalUrls: ReadonlyArray<string>

  primaryText: string
  aliasText: string
  lineageText: string
  urlText: string
  ontologyText: string
  semanticText: string

  payloadJson: string
  updatedAt: string
}
```

## Why one doc per entity

Use one doc per entity, not one doc per alias or one doc per lineage edge.

Reasons:

- easier idempotent upsert/delete
- easier parity testing against canonical tables
- simpler filter logic
- easier future vector sidecar generation

## Denormalization policy

The projector should be intentionally aggressive.

### Agent docs should include

- `name`
- `alternateNames`
- aliases
- homepage URL and hostname
- parent agent labels where available

### Dataset docs should include

- title and description
- aliases
- keywords and themes
- publisher agent labels and aliases
- landing page URL and hostname
- child variable labels and canonical facet labels
- child series labels where available
- child distribution titles and hostnames

### Distribution docs should include

- title and description
- access and download URLs
- hostnames
- aliases
- parent dataset title
- parent publisher labels
- related variable and series labels through the dataset

### Series docs should include

- label
- aliases
- parent dataset title and aliases
- parent publisher labels
- linked variable label and facets
- `fixedDims` values flattened into search text and exact columns

### Variable docs should include

- label and definition
- aliases
- facet canonicals
- facet surface forms from the vocabulary layer
- parent dataset titles
- parent series labels
- parent publisher labels
- related distribution hostnames through linked datasets

This denormalization is the main reason retrieval can replace procedural probe
waterfalls.

---

## Persistence design

## New tables

Add a new migration that creates:

### `entity_search_docs`

Canonical row projection for the entity search read model.

Suggested columns:

- `entity_id TEXT PRIMARY KEY`
- `entity_type TEXT NOT NULL`
- `primary_label TEXT NOT NULL`
- `secondary_label TEXT`
- `publisher_agent_id TEXT`
- `agent_id TEXT`
- `dataset_id TEXT`
- `variable_id TEXT`
- `series_id TEXT`
- `measured_property TEXT`
- `domain_object TEXT`
- `technology_or_fuel TEXT`
- `statistic_type TEXT`
- `aggregation TEXT`
- `unit_family TEXT`
- `policy_instrument TEXT`
- `frequency TEXT`
- `place TEXT`
- `market TEXT`
- `homepage_hostname TEXT`
- `landing_page_hostname TEXT`
- `access_hostname TEXT`
- `download_hostname TEXT`
- `canonical_urls_json TEXT NOT NULL`
- `aliases_json TEXT NOT NULL`
- `payload_json TEXT NOT NULL`
- `primary_text TEXT NOT NULL`
- `alias_text TEXT NOT NULL`
- `lineage_text TEXT NOT NULL`
- `url_text TEXT NOT NULL`
- `ontology_text TEXT NOT NULL`
- `semantic_text TEXT NOT NULL`
- `updated_at TEXT NOT NULL`
- `deleted_at TEXT`

Add ordinary indexes for the structured filter columns we expect to use in the
resolver hot path:

- `entity_type`
- `publisher_agent_id`
- `dataset_id`
- `variable_id`
- `series_id`
- `homepage_hostname`
- `landing_page_hostname`
- `access_hostname`
- `download_hostname`
- `statistic_type`
- `unit_family`

### `entity_search_fts`

Create a standalone FTS5 table driven by explicit upsert/delete code.

Suggested columns:

- `entity_id UNINDEXED`
- `entity_type UNINDEXED`
- `primary_text`
- `alias_text`
- `lineage_text`
- `url_text`
- `ontology_text`

Use:

- `tokenize='porter unicode61'`

Do not depend on FTS export/restore as the durability story. The rebuild path
must always be able to regenerate the FTS table from canonical rows.

## Why standalone FTS first

The repo already has a working standalone FTS pattern for posts and tests
around it. Reusing that operating model is lower-risk than introducing a new
FTS table flavor at the same time as a new search feature.

If storage becomes a real issue later, we can revisit external-content FTS once
the projection and query layer are stable.

---

## Failure model and boundary rules

## Expected outcomes vs real failures

Do not use errors for normal retrieval outcomes.

These should be successful results:

- no hits
- low-confidence hits
- ambiguous candidate sets
- semantic recall disabled

These should be typed expected failures:

- search input decode failure at the route or RPC boundary
- search index unavailable
- rebuild/projection failure
- D1 schema decode failure

These should remain defects:

- impossible invariants inside the projector
- mismatched entity identity assumptions
- bugs that indicate corrupted in-memory logic rather than bad input or bad
  availability

## Error ownership

Recommended ownership split:

- repo layer: `SqlError | DbError`
- service layer: repo errors plus search-specific tagged domain errors where
  needed
- HTTP/RPC boundary: map tagged errors to the existing HTTP envelope types

Suggested new tagged errors:

- `EntitySearchIndexUnavailableError`
- `EntitySearchProjectionError`
- `EntitySearchRebuildError`

Do not add a tagged error for "no match." That is a normal retrieval result.

## Boundary mapping

Follow the repo's current boundary style:

- decode unknowns with `Schema.decodeUnknownEffect`
- use `withHttpErrorMapping` at HTTP routes
- sanitize uncaught failures at the top-level fetch boundary

Expected mapping:

- invalid search payload -> `BadRequest`
- search DB unavailable / unseeded -> `ServiceUnavailable`
- upstream embedding or vector service failure later -> `UpstreamFailure`
- empty candidate list -> `200` with `items: []`

This keeps business logic declarative and pushes transport concerns back to the
existing boundary helpers.

---

## Resolver bundle access patterns

## What is and is not being indexed

We are not indexing the incoming post bundle as a second search corpus.

The index remains the typed entity projection:

- agents
- datasets
- distributions
- series
- variables

The post bundle is request-time evidence. The search service decomposes that
evidence into:

- exact probes
- structured filters
- weighted lexical text
- optional semantic recall text later

That distinction matters because it keeps the architecture clean:

- catalog entities are the searchable corpus
- post/vision/source-attribution signals are the query plan

## Input signal map

The resolver-facing service should treat different bundle elements as
different search access patterns, not as one undifferentiated blob of text.

| Bundle signal | Main use | Access pattern |
|---|---|---|
| `postContext.links[].url` and link domains | high-trust source and distribution hints | exact URL, exact hostname, URL-prefix probe, then URL-text fallback |
| `postContext.linkCards[].uri/title/description` | source landing-page and dataset hints | exact URI/hostname when present, then weighted lexical text |
| `vision.assets[].analysis.visibleUrls[]` | chart-visible source and download hints | exact URL and hostname probes before any lexical search |
| `vision.assets[].analysis.sourceLines[].datasetName` | dataset and series naming hints | weighted dataset/series lexical query |
| `vision.assets[].analysis.organizationMentions[]` | publisher/agent narrowing | exact alias where possible, then agent lexical query |
| `vision.assets[].analysis.logoText[]` | publisher/brand narrowing | exact alias where possible, then agent lexical query |
| `vision.assets[].analysis.title` | dataset, variable, or chart-level phrasing | weighted lexical query across primary, alias, and lineage fields |
| `vision.assets[].analysis.xAxis`, `yAxis`, `series[]`, `keyFindings[]` | variable and series disambiguation | variable/series-focused lexical query plus facet/scope filters |
| `postContext.text` | low-to-medium trust fallback phrasing | lexical expansion only after stronger signals have been used |
| `sourceAttribution.provider` and provider candidates | agent narrowing and scope control | structured `publisherAgentId` filter plus agent exact/lexical probe |

## Query planning by trust level

The request planner should consume signals in descending trust order.

### High trust

- visible URLs
- post links
- exact hostnames
- source-attribution provider IDs
- exact aliases from logo or organization mentions

These should become exact probes and hard boosts first.

### Medium trust

- source line dataset names
- link-card titles
- chart titles
- organization mentions without exact alias hits

These should become weighted lexical retrieval with scope filters.

### Lower trust

- post prose
- key findings
- axis labels
- series legends

These should expand variable and series search, but should not override a
strong URL or hostname hit.

---

## Query planning

## Query stages

Every rung-specific search operation should follow the same shape:

1. normalize input text
2. run exact probes first
3. build structured filters from known scope
4. run D1 FTS retrieval
5. optionally run semantic recall
6. fuse results
7. return ranked hits with match diagnostics

## URL handling

URL evidence needs its own explicit handling rules because it is both the
highest-value exact signal and the easiest place to blur different semantics
if we treat every URL as just text.

### URL sources

Collect URL candidates from:

- post links
- link-card URIs
- vision-visible URLs
- source lines and post text after URL-like extraction

### URL normalization

Use the existing resolver normalization utilities as the shared contract:

- `normalizeDistributionUrl`
- `normalizeDistributionHostname`
- `buildUrlPrefixes`
- `extractUrlLikeStrings`

That gives us a consistent policy for:

- scheme-insensitive matching
- hostname normalization
- path normalization
- selective preservation of exact query parameters for download-style URLs

### URL probe order

When a normalized URL is available, search should probe in this order:

1. exact distribution URL
2. exact dataset landing page
3. exact hostname match
4. normalized URL prefix match
5. weighted `url_text` lexical fallback

Why this order matters:

- exact URL is often enough to resolve a distribution directly
- landing pages frequently identify datasets even when the download URL is not
  present
- hostnames are strong agent and publisher evidence
- prefixes catch structured download families without forcing full fuzzy search
- lexical URL fallback still helps when only fragments survive OCR or copying

### URL indexing shape

The search projection should store URL evidence in two forms at once:

1. exact columns for fast deterministic filtering and probes
2. searchable text for fallback ranking

Exact URL-related columns:

- `homepage_hostname`
- `landing_page_hostname`
- `access_hostname`
- `download_hostname`
- `canonical_urls_json`

Fallback searchable fields:

- `url_text`

`url_text` should include normalized hosts, important path segments, and known
URL aliases, but exact URL decisions should come from the structured columns
first, not from FTS alone.

## Prerequisite cleanup: centralize URL and parsing utilities

Before typed entity search lands, the repo should collapse the current URL and
hostname helpers into a smaller shared surface. The goal is not to invent a
new abstraction for its own sake; it is to make search indexing and candidate
generation use one consistent normalization policy.

Current overlap that should be folded together:

- `src/source/normalize.ts`
  - `parseUrlLike`
  - `normalizeDistributionUrl`
  - `normalizeDistributionHostname`
  - `parseHostname`
  - `parseNormalizedDomain`
  - `extractUrlLikeStrings`
  - `extractStructuredIdentifierCandidates`
- `src/enrichment/GeminiVisionServiceLive.ts`
  - `trimVisibleUrlBoundary`
  - `normalizeVisibleUrlCandidate`
  - `normalizeVisibleUrls`
- `src/bluesky/PostRecord.ts`
  - `hostnameFor`
  - `normalizedHostnameFor`
- `src/ops/TwitterNormalizer.ts`
  - ad hoc `new URL(url).hostname` extraction for tweet links
- `src/ops/BlueskyNormalizer.ts`
  - ad hoc `new URL(...).hostname` extraction for facet and embed URLs
- `src/source/contentSource.ts`
  - domain extraction fallback for link cards and links
- `src/source/SourceAttributionRules.ts`
  - URL-to-domain fallback for links, link cards, and visible URLs
- `src/resolution/normalize.ts`
  - URL fallback parsing and hostname normalization used by resolution

Why this matters:

- visible URLs, link-card URIs, and stored links currently do not share a
  single parser
- hostname cleanup is sometimes done by `normalizeDomain` and sometimes by raw
  `new URL(...).hostname`
- visible-URL extraction has its own boundary trimming and URL fragment logic
  that search indexing will need to reuse
- a search index built before this cleanup would inherit inconsistent canonical
  forms and make later deduping harder

Practical cleanup rule:

- move shared URL parsing and hostname normalization into one domain-level
  utility surface
- have source attribution, enrichment, resolver, and ingest code import that
  shared surface instead of re-declaring URL helpers locally
- add a focused test corpus for representative URL shapes before search docs
  start depending on the utilities

This cleanup should be treated as a prerequisite for search projection work,
not a separate nice-to-have.

## Bundle-to-search handoff

The service boundary should make this planning step explicit.

Recommended internal shape:

```ts
type EntitySearchPlan = {
  exactUrls: ReadonlyArray<string>
  exactHostnames: ReadonlyArray<string>
  aliasTerms: ReadonlyArray<string>
  publisherAgentIds: ReadonlyArray<string>
  datasetHints: ReadonlyArray<string>
  variableHints: ReadonlyArray<string>
  seriesHints: ReadonlyArray<string>
  lexicalText: ReadonlyArray<string>
}
```

This plan is derived from the incoming bundle and then executed against the
entity index. That keeps request-time behavior inspectable, testable, and
separate from the storage model.

## Exact probes

Before FTS, probe the existing registry for:

- canonical URI
- typed alias
- exact distribution URL
- distribution URL prefix
- exact hostname
- exact dataset title where the existing helper is already stronger than FTS

These probes should be part of the service layer, not the repo layer, because
they blend registry lookups with retrieval policy.

## Structured filters

The service should compile scope into exact filter columns:

- `entityType`
- `publisherAgentId`
- `datasetId`
- `seriesId`
- `variableId`
- `unitFamily`
- `statisticType`
- `place`
- `market`
- `frequency`

This is how we keep D1 queries narrow and predictable.

## Lexical ranking

Start with FTS5 BM25 and explicit field weighting.

Target weighting order:

1. exact probe wins
2. `primary_text`
3. `url_text`
4. `alias_text`
5. `lineage_text`
6. `ontology_text`

Return match diagnostics such as:

- matched source: `exact-url | exact-alias | lexical | semantic | fused`
- matched fields
- scope flags applied
- top lexical score / fused rank

Do not try to calibrate raw lexical and semantic scores against each other.

## Future semantic fusion

When Vectorize is added, fuse candidate lists with reciprocal rank fusion in
the service layer.

That means Phase 1 should already shape results into a common candidate form:

```ts
type RetrievalCandidate = {
  entityId: string
  entityType: EntitySearchEntityType
  source: "exact" | "lexical" | "semantic"
  rank: number
  matchedFields: ReadonlyArray<string>
}
```

The lexical path must work on its own when the semantic path is absent.

---

## Resolver integration

## Current state

Today the repo already has:

- Stage 1 exact matching across URL, label, alias, and hostname evidence
- a `resolveDataReference()` runged flow for agent and dataset lookup
- a `ResolutionKernel` that consumes structured evidence bundles

What it does not have is a reusable ranked entity search service.

## Planned integration

### Keep the handoff simple

Do not make the new search service responsible for final ontology reasoning.

Its job is:

- produce typed top-K candidates
- honor scope
- explain why those candidates were returned

The resolver’s job remains:

- validate required facets
- validate scope compatibility
- decide when to abstain
- emit structured gaps or final outcomes

### Where it plugs in

Use the service in two places:

1. after Stage 1 exact lookup leaves a rung unresolved
2. when Stage 1 narrows scope but not the final entity

Examples:

- URL resolved dataset, but not variable:
  use `searchVariables` scoped to `datasetId`
- source attribution resolved agent, but not dataset:
  use `searchDatasets` scoped to `publisherAgentId`
- dataset known, fixed dims known, variable ambiguous:
  use `searchSeries` then `searchVariables`

### Initial hot-path contract

Add a resolver-facing operation:

```ts
resolveBundleCandidates(input: {
  bundle: ResolutionEvidenceBundle
  agentId?: AgentId
  datasetIds?: ReadonlyArray<DatasetId>
  limit?: number
})
```

That operation can internally call the rung-specific search methods while
keeping the resolver entrypoint compact.

---

## Vectorize-ready design without phase-1 coupling

## Day-one preparation

Phase 1 should prepare for Vectorize without depending on it:

- keep `semantic_text` on the projection
- keep stable `entityId` keys for future vector rows
- define a no-op semantic recall service interface

Suggested service seam:

- `src/services/EntitySemanticRecall.ts`

Default layer:

- returns `[]`

Future Vectorize layer:

- embeds `semantic_text`
- stores vectors keyed by `entityId`
- filters by `entityType` and scope metadata where supported
- returns top-K semantic candidates

## Why not bind Vectorize now

The repo does not currently bind Vectorize in Wrangler or `EnvBindings`, and
the resolver path already has enough moving pieces.

Shipping lexical retrieval first gives us:

- a stable projection format
- real retrieval metrics
- a cleaner target for future hybrid fusion

---

## Ontology awareness without hot-path ontology execution

## What to materialize into search docs

Phase 1 should materialize:

- facet canonicals already present on variables
- surface forms from the current vocabulary layer
- publisher and dataset lineage strings
- URL hosts and landing-page text

Phase 1 should not require:

- runtime SPARQL queries
- SHACL execution during search
- OWL or SKOS graph traversal in the request path

## Forward compatibility with the OEO direction

The new search doc model should not hard-code the current seven-facet shelf as
its only semantic representation.

Add an extensible field such as `ontology_text` or `ontology_refs_json` so the
projection can later carry:

- OEO term IRIs
- OEO labels
- future internal fallback IRIs

That allows the search service to survive an eventual move away from pure
facet-shelf binding without rewriting the storage layer again.

---

## Build and rebuild strategy

## Projector input

Use the typed registry as the projector input.

That means the same projection code should accept:

- `PreparedDataLayerRegistry`
- or a wrapper that is trivially derived from it

## Rebuild entrypoints

Implement two rebuild paths:

### 1. Full rebuild script

`scripts/rebuild-entity-search-index.ts`

Responsibilities:

- load canonical entities from the main D1 database through existing repo layers
- prepare the registry
- project search docs
- write projection rows into the dedicated search database
- replace search docs and FTS rows in D1-safe chunked batches
- optionally run FTS optimize

### 2. Incremental sync hook

Extend the existing data-layer sync flow so that data-layer inserts/updates can
trigger entity-search projection updates into the dedicated search database.

Do not block phase 1 on perfect incremental sync. A reliable full rebuild is
enough to start.

## Rebuild source of truth

Rebuild from canonical tables, not from FTS export.

The repo already has evidence that D1 virtual tables complicate export paths,
so the safe contract is:

- canonical tables are durable
- projection rows are rebuildable
- FTS is disposable and reproducible

## Binding layout

Expected worker bindings after rollout:

- `DB`: canonical application database
- `SEARCH_DB`: dedicated entity-search database

Phase 1 requirement:

- the resolver worker takes both `DB` and `SEARCH_DB`

Later optional consumers:

- the agent worker can also take `SEARCH_DB` if it gains operator or MCP
  search routes

Other workers should only take `SEARCH_DB` if they genuinely need typed entity
search.

---

## Implementation slices

## Slice 0: utility centralization prerequisite

Deliver:

- shared URL utility module
- migration of runtime URL and hostname call sites to the shared contract
- removal of duplicate runtime URL helpers where practical
- locked tests for the shared normalization rules

Verification:

- hostname normalization tests
- visible-URL cleanup tests
- URL-like extraction tests
- normalized lookup-URL tests
- regression coverage for stored link domains and source-attribution domain matching

## Slice 1: domain, env, and runtime seam

Deliver:

- `src/domain/entitySearch.ts`
- `src/platform/Env.ts` update for `SEARCH_DB`
- worker config updates for `SEARCH_DB`
- search runtime layer module
- D1 migration for `entity_search_docs` and `entity_search_fts`
- typed repo contract in `src/services/EntitySearchRepo.ts`

Verification:

- env/layer wiring test
- migration idempotency test
- domain schema round-trip tests

## Slice 2: pure projection layer

Deliver:

- `src/search/projectEntitySearchDocs.ts`
- synthetic tests over small registry seeds
- parity tests against checked-in cold-start data

Verification:

- one document per entity in scope
- expected denormalized fields present
- no duplicate `entityId`s

## Slice 3: D1 repo + lexical query path

Deliver:

- `EntitySearchRepoD1`
- upsert/delete/rebuild operations
- lexical search queries with filters
- `scripts/rebuild-entity-search-index.ts`

Verification:

- FTS DDL test
- repo round-trip tests
- search quality tests on synthetic fixtures

## Slice 4: service and resolver integration

Deliver:

- `EntitySearchService`
- default no-op semantic recall layer
- resolver integration after exact Stage 1
- debug script for bundle candidate inspection

Verification:

- resolver-focused tests using checked-in registry
- candidate ordering snapshots for representative bundles

## Slice 5: retrieval eval harness

Deliver:

- `scripts/eval-entity-search.ts`
- gold-set retrieval metrics by rung

Metrics:

- Recall@K
- MRR
- Top-1
- scope precision
- abstain precision

---

## Testing strategy

## Reuse existing patterns

The repo already has strong test seams we should extend:

- `tests/search-quality.test.ts` for FTS behavior
- `tests/data-layer-registry.test.ts` for exact typed lookup behavior
- `tests/resolve-data-reference.test.ts` for runged resolution behavior
- `tests/data-layer-sync.test.ts` and
  `tests/data-layer-registry-repos.test.ts` for persistence parity

## New tests to add

### Projection tests

- `tests/entity-search-projection.test.ts`

Assertions:

- counts by entity type
- projected lineage fields
- hostnames and aliases carried correctly
- variable docs include parent dataset and publisher text

### Repo tests

- `tests/entity-search-repo.test.ts`

Assertions:

- rebuild upserts rows
- delete removes FTS matches
- structured filters narrow results correctly
- exact URL/hostname fields are queryable

### Service tests

- `tests/entity-search-service.test.ts`

Assertions:

- exact probes short-circuit
- scoped lexical search beats unscoped lexical search
- rung-specific methods use the right filters
- no-op semantic recall does not change ordering

### Resolver integration tests

- `tests/entity-search-resolver.test.ts`

Assertions:

- Stage 1 exact hits still win
- ranked retrieval is invoked only when needed
- scoped variable retrieval improves candidate quality
- ambiguous bundles preserve candidate lists instead of forcing a match

---

## Rollout

## Phase 1 posture

Ship the index and service behind internal use first.

Suggested order:

1. land domain, env, and search-layer wiring
2. provision the dedicated search D1 database and binding
3. land migration and projector
4. build the index in local/dev
5. validate on cold-start registry and synthetic cases
6. wire into resolver behind a flag
7. turn on in staging only

## No day-one public API requirement

Do not block initial implementation on a public HTTP endpoint.

The first runtime consumer should be the resolver.

If we need operator inspection early, prefer a debug script before adding a new
HTTP route.

If an operator route is useful later, add it after the retrieval behavior is
stable.

## Scale escape hatches

If D1 query latency becomes the bottleneck later:

1. enable D1 read replication on the dedicated search database and use Sessions
   API for read-heavy flows
2. keep the search projection isolated from the main app database
3. add Vectorize as recall, not replacement
4. consider SQLite-backed Durable Object sharding only if a single D1 database
   genuinely stops meeting throughput goals

---

## Open questions

These do not block the phase-1 storage and service work, but they do affect
later tuning.

### 1. NIL / abstention thresholds

The service should return ranked candidates, but the resolver still needs a
clear abstain policy. We should decide:

- minimum lexical confidence for auto-bind
- minimum scoped-candidate separation
- when to emit `NoMatch` vs `Ambiguous`

### 2. Language normalization policy

The current normalization helpers are good, but we still need an explicit plan
for:

- diacritics
- Turkish casing
- acronym handling
- hostname normalization consistency

### 3. Series search depth

We should decide whether `Series` is:

- a first-class retrieval target in phase 1
- or an internal scoping helper that only the resolver uses

The current plan assumes first-class indexing because the resolver docs already
treat series as a real rung.

### 4. OEO timeline

The newer OEO tracking doc may eventually change what the canonical semantic
payload looks like. The search projection should be prepared for that, but we
should avoid coupling phase 1 delivery to the OEO coverage decision.

---

## Recommended next step

Implement slices 0 and 1 first:

- shared URL and hostname utility cleanup
- domain contract
- env and runtime seam
- migration

That settles two things early:

- one shared normalization contract for exact URL and hostname behavior
- the concrete shape of the search document and runtime boundary

Once those are stable, the projector, repo, query service, and resolver
integration become straightforward follow-on work rather than another
architecture round.
