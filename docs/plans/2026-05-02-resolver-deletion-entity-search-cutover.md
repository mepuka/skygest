# Resolver Deletion + Entity Search Cutover

**Status:** Review-refined draft 2026-05-02. Direction is locked; implementation starts after the prerequisites and open questions in this document are answered.

## Goal

Remove the old resolver path instead of replacing it with another resolver-shaped API.

The supported replacement boundary is one operator/internal `search_entities` surface backed by the ontology-aligned entity graph. Search is read-only. Any future post-to-entity linking or edge creation is handled by dedicated workflows that consume search results and write graph edges intentionally.

This supersedes the earlier "unified Worker API + observability" slice as the next architectural cutover. Minimum search observability ships with the cutover. Broader API composition, docs, Tail Worker, and Logpush work are follow-ups that wrap the new API after the resolver deletion/search boundary is in place.

It also supersedes the older April 16 resolution-workflow direction for this slice. Do not implement `resolution_runs`, `resolution_decisions`, or resolver-derived citation projection as part of this cutover.

## Decisions

1. **No new resolver API.** `EntitySearch` replaces resolver as the supported boundary. Do not introduce a new post-specific `/resolve` surface.
2. **One search surface.** Externally expose one `search_entities` contract. Keep typed/internal helper services for different access patterns, but do not create public per-entity lookup endpoints for this cutover.
3. **Canonical entity hits only.** The response returns ranked canonical entities, not raw AI Search chunks and not old resolver-style decisions.
4. **Exact probes belong in search.** Canonical URI, source URL, homepage domain, dataset landing page, distribution access/download URL, and alias-style probes are structured inputs on `search_entities`. Exact matches outrank fuzzy, keyword, and semantic matches.
5. **Search is read-only.** `search_entities` answers "what entities match this evidence?" It never writes "this post resolved to this entity."
6. **Linking is a separate workflow.** When we want durable post/entity links or graph edges, build dedicated linking workflows that call search, apply linking policy, and commit edges.
7. **Operator/internal first.** The first surface stays behind existing operator/MCP/admin controls. A public search product can be designed later from a stable subset.
8. **Canonical store is authoritative.** D1/ontology store data is the source of truth. Cloudflare AI Search is a retrieval index only; final results must hydrate and validate from canonical storage before returning.
9. **Use the ontology graph, not the legacy data-layer contract.** The new surface points at the unified ontology entity graph from day one. Older data-layer search can be migration material, but not the new API contract.
10. **Fail closed for unfinished entities.** Only entities with canonical storage, projection, hydration, and tests are returned. Do not expose partially modeled entities just because the search index can retrieve text for them.
11. **Delete the resolver in the cutover branch.** Once `search_entities` exists, remove the resolver Worker, bindings, client, routes, tests, and old resolver tools in the same branch.
12. **Deprecate old resolved results completely.** Old `data-ref-resolution` results are not preserved as historical read data and are not migrated into the new search contract.
13. **Keep extraction enrichments.** `vision` and `source-attribution` remain useful extraction outputs. `data-ref-resolution` is removed as a live enrichment type and consumer surface.
14. **Stop enrichment before linking.** The enrichment workflow stops after `vision` and `source-attribution` until the dedicated linking workflow exists.
15. **Use branded schemas, not transport strings.** The search contract extends `src/domain/entitySearch.ts` and uses the existing branded entity, URL, hostname, alias, and match-kind schemas.
16. **Batch canonical hydration.** The search service must merge exact-probe and recall candidates, then hydrate with one batched repository call instead of per-hit D1 reads.
17. **Fail closed by caller type.** Operator/MCP/admin surfaces return an empty result with explicit warnings for not-yet-enabled entity types. Internal workflow/RPC callers raise a typed `EntityTypeNotEnabledError`.

## Prerequisites

These must be locked before implementation starts:

1. **AI Search binding strategy.** `main` does not yet have the AI Search retrieval path wired. `EntitySearchService` is currently D1 FTS5-first, and semantic recall is placeholder-shaped. Choose one path:
   - Direct Wrangler bindings now: add the AI Search namespace/instance binding to active `wrangler*.toml` files.
   - Adopt Alchemy now: merge the declarative Cloudflare resource shape, adopt existing resources where possible, and switch the staging deploy path in the same PR.

   Recommendation: adopt Alchemy if we are comfortable expanding the first PR, because bindings are already changing and the architecture goal is declarative Cloudflare primitives. If scope needs to stay tighter, use Wrangler in PR A and schedule Alchemy as the immediate follow-up.

2. **Enabled entity catalog.** Day-one enabled entities are `Agent`, `Dataset`, `Distribution`, `Series`, and `Variable` only. They have canonical storage, projection, hydration, and tests today. `Catalog`, `CatalogRecord`, `DatasetSeries`, and `DataService` are deferred and must fail closed until projection/hydration support exists.

3. **Normalizer wiring.** Exact URL, hostname, and alias probes must use the same canonical normalizers as stored lookup values before lookup.

4. **Worker bundle gate.** The plan may consume value-shaped ontology-store exports, but request-time Worker code must not import Node-dependent ontology tooling such as RDF emitters or SHACL validation.

5. **Two-PR cutover.** Default to two PRs:
   - PR A: additive `search_entities`, AI Search binding, canonical hydration, minimum observability, writer stop, staging soak.
   - PR B: resolver binding removal, old reader deletion, migration, D1 table cleanup, architecture doc cleanup.

## Branch Hygiene and Sequencing

The deletion should be staged to reduce deploy risk without preserving legacy compatibility.

Recommended sequence:

1. Inventory and pin enabled entities.
2. Add `search_entities`, AI Search retrieval, exact probes, batched hydration, ranking, and observability.
3. Add MCP/admin surfaces and tests.
4. Stop writing `data-ref-resolution`.
5. Soak PR A in staging for one day with smoke checks.
6. In PR B, co-deploy code deletion and the storage migration.
7. Remove resolver service bindings and deploy config after runtime calls are gone.
8. Rebase broader API/docs/Logpush/Tail Worker work onto the new search surface.

## Target Shape

```text
operator / MCP / admin
        |
        v
search_entities
        |
        +-- exact probes: IRI, URL, hostname, alias
        +-- keyword / semantic recall: AI Search retrieval index
        +-- typed filters: entity type, topic, authority, time, source
        |
        v
canonical entity hydration
        |
        v
ranked canonical entity hits
```

## Minimal Abstraction Stack

The implementation should stay small. Do not build a new resolver framework.

Use one public service boundary: evolve the existing `EntitySearchService` into the owner of `search_entities`.

The pieces below are roles in that boundary, not permission to create a parallel search framework. Add leaf services only when the existing repo/service seam cannot cleanly own the role.

1. **`EntitySearchIndex`** — Cloudflare AI Search adapter. Wraps the `ENERGY_INTEL_SEARCH` namespace binding and exposes retrieval only. No domain decisions live here.
2. **`EntityExactLookup`** — canonical exact lookup over the ontology store/D1 graph. Handles IRI, URL, hostname, and alias probes. Exact probes should not depend on AI Search metadata because AI Search has a small custom-metadata budget.
3. **`EntityHydrator`** — hydrates canonical entities by IRI from the authoritative store and decodes them through domain schemas. It must batch hydrate candidate IDs; do not issue one D1 lookup per recalled chunk.
4. **`EntitySearchService.searchEntities`** — orchestration only: normalize request, run exact lookup + retrieval, merge candidates, hydrate, rank, and return canonical hits.

Rules for the stack:

- Leaf services use `ServiceMap.Service` + `Layer.effect` / `Layer.succeed`.
- Service methods return `Effect` values with typed tagged errors.
- Dependencies are provided once in the Worker/app layer, not scattered through business logic.
- `src/domain/entitySearch.ts` is the first contract home for Worker/API/MCP search schemas unless the ontology package owns a generated schema that is imported directly.
- HTTP and MCP both call `EntitySearchService.searchEntities`; neither reimplements search rules.
- Do not expose Cloudflare binding types or raw AI Search chunks above `EntitySearchIndex`.
- Do not let the older data-layer-only methods on `EntitySearchService` become the new public contract. Reuse useful internals only behind `searchEntities`.
- Wire `EntitySearchService` into the agent/feed Worker and MCP layers directly. Do not keep it reachable only through resolver-layer construction.

## Ontology Runtime Boundary

Before deleting the old exact lookup tools, the branch must name the runtime owner for ontology graph reads.

The plan assumes a unified ontology entity graph, but the current repo still has two nearby concepts:

- `packages/ontology-store/` for ontology/RDF/projection work
- `src/search/` and `src/services/EntitySearchService.ts` for data-layer-shaped search

Implementation must choose one runtime boundary and wire everything through it. Recommendation:

- keep `packages/ontology-store` as the source of entity definitions, projection contracts, metadata declarations, and runtime catalog fixtures
- expose Worker-runtime graph reads through `src/services/` layers that hydrate from D1/canonical storage
- use `packages/ontology-store` provisioning metadata to derive bindings and drift tests
- do not make request-time Worker code depend on ad hoc RDF traversal unless that is explicitly chosen and tested

## Domain Model

Add the new contract to `src/domain/entitySearch.ts` rather than extending old resolver schemas or defining request/response shapes inline in routers.

The TypeScript shapes below are illustrative. The implementation contract must be Effect schemas with branded primitives and exported schema-derived types.

Expected domain artifacts:

- `SearchEntitiesInput`
- `SearchEntitiesResult`
- `SearchEntityHit`
- `SearchEntityEvidence`
- `SearchEntityProbe`
- `SearchEntityFilter`
- `SearchEntityMatchReason`
- `SearchEntityError`

Use branded primitives wherever the value has meaning:

- entity IRI: `EntitySearchEntityId`
- entity type: `EntitySearchEntityType`
- source URL: `EntitySearchUrl`
- hostname: `EntitySearchHostname`
- alias scheme/value pair: `AliasScheme` plus a bounded alias value schema
- match reason: extend `EntitySearchMatchKind` with `exact-iri` and `exact-alias`
- evidence kind: a new local `Schema.Literals` enum for search evidence only
- search limit: `SearchLimit`, bounded with `Schema.between(1, 50)`, default `20`
- score/rank if represented outside local implementation details

Do not reuse write-side graph edge provenance literals for `evidence.kind`. Search evidence is a read API explanation; graph edge provenance is a write/linking concern.

Evidence should be bounded:

- at most `3` evidence items per hit
- evidence text capped at `240` characters
- evidence source fields use URLs/IRIs/hostnames where possible rather than plain strings

Errors should be explicit and recoverable:

- unsupported entity type
- invalid probe
- AI Search retrieval failure
- hydration miss
- entity decode failure
- metadata/index drift

Unsupported entity types should fail closed. Do not silently query them through AI Search.

## Cloudflare + Alchemy Shape

The cutover should use Cloudflare primitives directly and declaratively:

- **Worker:** operator/internal `search_entities` route lives on the agent/feed Worker first.
- **AI Search:** bind an AI Search namespace, not the deprecated Workers AI `autorag`/`aiSearch()` accessors.
- **Binding name:** use the ontology provisioning constant for `ENERGY_INTEL_SEARCH`.
- **Instance access:** use `env.ENERGY_INTEL_SEARCH.get("entity-search")`, because the design uses a non-default namespace.
- **D1:** remains the authoritative entity store and exact lookup source.
- **Workflows:** do not introduce a linking workflow in this cutover. Future linking gets its own Workflow binding and durable steps.
- **Alchemy:** entity-search namespace, instance, custom metadata, Worker bindings, and future Workflow bindings should be derived from `packages/ontology-store` provisioning metadata, not hand-synced across config files.
- **Wrangler:** while Wrangler remains live, add/remove bindings there too and keep `compatibility_date` current when touching Worker deploy config.

Current-state correction:

- AI Search retrieval is not wired on `main` yet.
- The live `EntitySearchService` is D1/FTS5-shaped today.
- `EntitySemanticRecall` is placeholder-shaped and must not be treated as production semantic recall.
- The cutover must explicitly add the Cloudflare binding/resource path before any plan step assumes semantic recall exists.

AI Search is a retrieval index only:

- it can return candidate IRIs and evidence chunks
- it does not decide canonical labels, entity state, or type validity
- every result must hydrate from D1/ontology storage before it is returned

Custom metadata must stay global and small. The current five-field budget is:

- `entity_type`
- `iri`
- `topic`
- `authority`
- `time_bucket`

Do not spend AI Search metadata fields on URL or alias probes. Those belong in canonical exact lookup indexes.

Minimum Cloudflare-native observability ships in PR A:

- `REQUEST_METRICS` Analytics Engine binding
- `CF_VERSION_METADATA` version metadata binding
- structured log fields: `searchContractVersion`, `projectionCatalogVersion`, `aiSearchInstance`, `workerVersion`
- search metrics: `search_entities.exact_probe_hit_count{kind=iri|url|hostname|alias}`, `search_entities.hydration_miss_total{entityType}`, `search_entities.fail_closed_total{entityType}`, `search_entities.ai_search_latency_ms`, `search_entities.hydration_latency_ms`
- transient cutover metric: `enrichment.skipped_data_ref_resolution_total`

Future write path:

```text
vision + source-attribution
        |
        v
LinkingWorkflow
        |
        +-- calls search_entities
        +-- applies linking policy
        +-- writes graph edges / link records
```

## Normalization Contract

Exact probes are only useful if query-time normalization matches storage-time normalization.

Use the existing normalizers from `src/platform/Normalize.ts` / `src/resolution/normalize.ts`:

- URL probes normalize scheme and `www` differences before lookup.
- Hostname probes normalize through the same domain helper used for stored hostnames.
- Alias probes normalize through `normalizeAliasLookupValue`.
- Duplicate probes collapse after normalization, not before.
- Invalid probes become typed validation errors for operator/admin calls; internal workflow calls fail with the same domain error.

The service must preserve the original probe in evidence only as display context. Lookup keys use normalized values.

## Ranking Contract

Ranking must be deterministic and testable:

- Exact hits occupy a disjoint score band of at least `1000` above fuzzy/semantic hits.
- Exact probe priority is `iri > url > hostname > alias`.
- Within the fuzzy/semantic tier, use Reciprocal Rank Fusion when combining lexical and semantic recall.
- Hydrated canonical entity IRI is the stable final tie-breaker.
- A candidate that cannot hydrate is not returned and increments the hydration-miss metric.

Do not let raw AI Search scores determine final rank without this deterministic overlay.

## Worker Bundle Hygiene

The Worker can import ontology-store constants, schemas, and value-shaped projection metadata only if those exports are Worker-safe.

Do not import request-time Worker code from ontology-store modules that pull Node-oriented dependencies such as RDF emitters, `n3`, SHACL validation, `shacl-engine`, `buffer`, or stream polyfills.

Add a CI guard for this slice:

- fail if `src/worker`, `src/api`, `src/services`, or `src/mcp` imports ontology-store RDF/SHACL emitters directly
- fail if the Worker bundle introduces Node built-in imports in `src/`
- keep RDF/SHACL validation in local tooling, scripts, tests, or build-time projection steps

## `search_entities` Contract

The exact schema should be finalized during implementation, but the shape should follow this contract.

Request:

```ts
type SearchEntitiesInput = {
  readonly query?: NonEmptyText
  readonly entityTypes?: ReadonlyArray<EntitySearchEntityType>
  readonly filters?: {
    readonly topic?: ReadonlyArray<OntologyConceptSlug>
    readonly authority?: ReadonlyArray<NonEmptyText>
    readonly timeBucket?: ReadonlyArray<NonEmptyText>
    readonly source?: ReadonlyArray<NonEmptyText>
  }
  readonly probes?: {
    readonly iris?: ReadonlyArray<EntitySearchEntityId>
    readonly urls?: ReadonlyArray<EntitySearchUrl>
    readonly hostnames?: ReadonlyArray<EntitySearchHostname>
    readonly aliases?: ReadonlyArray<EntitySearchAliasProbe>
  }
  readonly limit?: SearchLimit
}
```

Validation rules:

- At least one of `query` or `probes` must be present.
- `limit` defaults to `20` and is bounded to `1..50`.
- `entityTypes` must be drawn from the projection-ready entity catalog, not arbitrary strings.
- URL and hostname probes are normalized before lookup.
- Duplicate probes collapse before lookup.
- Hostname semantics must be explicit: exact host, registrable domain, and URL-prefix are different match reasons.

Response:

```ts
type SearchEntitiesResult = {
  readonly hits: ReadonlyArray<SearchEntityHit>
  readonly warnings?: ReadonlyArray<{
    readonly entityType: EntitySearchEntityType
    readonly reason: "not-yet-enabled"
  }>
}

type SearchEntityHit = {
    readonly entityType: EntitySearchEntityType
    readonly iri: EntitySearchEntityId
    readonly label: NonEmptyText
    readonly summary?: NonEmptyText
    readonly rank: number
    readonly score: number
    readonly matchReason:
      | "exact-iri"
      | "exact-url"
      | "exact-hostname"
      | "exact-alias"
      | "keyword"
      | "semantic"
      | "hybrid"
    readonly evidence: ReadonlyArray<{
      readonly kind: SearchEntityEvidenceKind
      readonly text: BoundedEvidenceText
      readonly source?: EntitySearchUrl | EntitySearchEntityId | EntitySearchHostname
    }>
}
```

Rules:

- Exact probe hits rank before fuzzy hits.
- Exact IRI hits rank before exact URL/hostname/alias hits.
- AI Search chunks are evidence, not the returned authority.
- Every returned hit must hydrate from canonical storage.
- Unsupported entity types fail closed with warnings for operator/admin/MCP calls and a typed error for internal workflow/RPC calls.
- The public surface should not expose old resolver states like `resolved`, `partial`, or `ambiguous`. Linking workflows can define their own write-state model later.
- The implementation model should split `RecallHit` from `CanonicalEntityHit`. `payloadJson` from a search document must not become the new authority.

## Implementation Sequence

### 1. Inventory enabled entities

Identify which ontology entities are projection-ready right now:

- canonical storage exists
- projection to AI Search exists
- hydration from canonical storage exists
- tests prove round-trip/projection/search behavior

Day-one enabled entities:

- `Agent`
- `Dataset`
- `Distribution`
- `Series`
- `Variable`

Deferred fail-closed entities:

- `Catalog`
- `CatalogRecord`
- `DatasetSeries`
- `DataService`

This should be a declarative catalog, not a hand-maintained switch statement. Prefer deriving it from the ontology runtime catalog/provisioning metadata so the same source drives:

- enabled entity type literals
- projection contracts
- canonical hydrator registration
- exact probe support
- filter schema
- AI Search metadata drift checks
- Alchemy custom metadata
- Worker binding expectations
- test fixtures

The inventory output should be an enabled-entity matrix. For each entity type, record:

- entity type literal
- canonical IRI pattern
- canonical storage/hydrator
- projection function
- AI Search instance/key prefix
- exact probes supported
- filters supported
- tests that prove the entity is safe to expose

### 2. Add `search_entities` service, AI Search, and observability

Create the new service boundary around the ontology graph and retrieval index:

- one search method
- structured exact probes
- typed filters
- AI Search recall with a real Cloudflare binding/resource
- canonical hydration before return
- fail-closed behavior for unsupported entities
- stable result ordering for ties
- explicit evidence source labels
- one Analytics Engine datapoint/log trail per request

The existing `EntitySearchService`, `EntitySearchRepoD1`, and graph-view helpers are the preferred starting seams. Extend or narrow them for `searchEntities`; do not create a second search service that duplicates their role.

Add `EntitySearchRepo.getManyByEntityId(ids)` and use it for hydration. Merge exact-probe and AI Search candidates first, dedupe by entity IRI, then hydrate once with `WHERE entity_id IN (...)`. The existing per-hit `getByEntityId` loop is not acceptable for the new API.

Hydration source of truth:

- D1/canonical repositories own the returned entity payload.
- `PreparedDataLayerRegistry.graph` can supply enrichment context such as publisher labels, variable facets, or adjacent graph facts.
- Do not mix graph-derived display context with the canonical row payload without decoding both through the domain schemas.

The old data-layer search code can be reused or drained where helpful, but the new contract should not inherit the old data-layer-only shape.

Decide what happens to `SEARCH_DB` in this step:

- delete it with the old data-layer search path, or
- keep it temporarily as an internal exact/lexical fallback behind `EntitySearchIndex`

Do not let `SEARCH_DB` remain a hidden second public search contract.

For the operator-facing tool, missing required search storage or AI Search binding should fail clearly at startup/request boundary. Do not silently return empty semantic recall in production.

### 3. Add operator/MCP/admin surfaces and tests

Expose `search_entities` behind the existing authenticated operator boundary.

Do not expose a public route in this slice.

Preferred first surfaces:

- MCP tool: `search_entities`
- HTTP route: `POST /admin/search/entities`

Both surfaces should share the same domain schemas and call the same service.

Fail-closed behavior:

- operator/MCP/admin: return `{ hits: [], warnings: [{ entityType, reason: "not-yet-enabled" }] }`
- future internal RPC/workflow callers: fail with `EntityTypeNotEnabledError`

### 4. Stop writing resolver results and soak

Remove any automatic `data-ref-resolution` write from enrichment/runtime flow.

After this cutover:

- enrichment still produces `vision`
- enrichment still produces `source-attribution`
- enrichment does not produce resolver results
- linking waits for the future `LinkingWorkflow`

This also removes the old feature flag path:

- delete `ENABLE_DATA_REF_RESOLUTION`
- remove `enableDataRefResolution` from runtime config
- remove `ResolverClient` from `EnrichmentRunWorkflow`
- remove `buildStage1Input` usage from enrichment runtime code
- remove the repository side effect that turns `data-ref-resolution` payloads into `data_ref_candidate_citations`

Deploy this state to staging before the deletion sweep. Smoke criteria:

- one curated post produces only `vision` and `source-attribution`
- `enrichment.skipped_data_ref_resolution_total` increments during the cutover window
- one exact-IRI probe round-trips through `search_entities`
- one deferred entity type returns the fail-closed warning

### 5. Drain old read surfaces

Cut readers after the writer stop has soaked so old resolver results cannot leak through the product.

Remove `data-ref-resolution` from:

- public/enrichment read APIs
- MCP enrichment formatting and output schemas
- pipeline status counts
- data-ref candidate query services
- chart repair paths that depend on resolver-result payloads
- tests that assert old resolver results remain readable

After this step, only `vision`, `source-attribution`, and any still-supported non-resolver enrichment kinds should be readable.

### 6. Add migration and delete resolver code together

Because old resolved results have no product value, the deletion PR should include a migration that deletes or drops resolver-only storage.

Expected migration actions:

- delete `post_enrichments` rows where `enrichment_type = 'data-ref-resolution'`
- add migration 27 to drop resolver-only citation/alignment tables created by earlier data-ref migrations if no surviving non-resolver consumer remains
- remove resolver-only query code after the migration exists

Do not leave old rows readable by keeping compatibility decoders.

Delete old resolver-result surfaces instead of keeping historical compatibility:

- `data-ref-resolution` enrichment schema and decode helpers
- citation builder for resolver results
- old MCP tools such as exact data-ref resolution and candidate lookup where they exist only to serve the resolver/data-ref model
- display/query paths that expose old resolved results
- tests that assert old resolver payloads remain readable
- D1 repository hooks that maintain data-ref candidate citations
- D1 query services that expose data-ref candidate citations
- database rows/tables dedicated only to old resolver results, via the explicit migration

Keep `vision` and `source-attribution` historical reads if still needed by existing product flows.

### 7. Remove resolver bindings and deploy resources

Remove the old resolver stack once runtime calls are gone:

- resolver Worker config and deploy target
- `RESOLVER` service bindings
- resolver env binding types
- resolver Worker entrypoint and fetch handler
- resolver client
- resolver router
- resolver service
- resolver-specific route/RPC/client tests
- Alchemy resolver Worker and service bindings, if the cutover branch includes Alchemy

Service-binding removal order matters:

1. remove runtime calls to `RESOLVER`
2. remove `RESOLVER` bindings from agent/feed and ingest/filter Worker config
3. regenerate Worker env types
4. deploy agent/feed and ingest/filter without the binding
5. remove `wrangler.resolver.toml` or Alchemy resolver resource from the active deploy source
6. delete or intentionally leave unmanaged the live `skygest-resolver` Workers, with that choice documented

### 8. Classify leftover resolution code

Do a file-by-file inventory of `src/resolution/` before deletion.

Expected deletion targets:

- `Stage1Resolver`
- `resolveBundle`
- resolver response/bundle payload schemas
- resolver-specific tests

Possible keep/reshape targets:

- pure extraction or normalization helpers that can become exact-probe builders
- graph traversal helpers that are still useful for canonical lookup

Do not delete useful graph/extraction primitives only because they sit under an old folder. Move them behind the new `EntitySearchService.searchEntities` boundary first.

### 9. Rebase API and observability unification onto the new API

After the deletion/search cutover is green, revisit the unified Worker API + Cloudflare observability plan:

- compose around `search_entities`, not `/v1/resolve/*`
- add broader request metrics, Tail Worker, and Logpush only after the destination decision exists
- expose docs only for the intended operator/internal surfaces
- avoid carrying resolver routes into OpenAPI/docs

### 10. Defer ontology-store runtime retrieval helpers

Do not add `packages/ontology-store` request-time hydration helpers such as `getEntityByIri` or `getEntityWithGraphContext` in this slice unless implementation proves there is no clean Worker-side service path.

Keep this slice focused on deletion plus the read API. A typed ontology-store retrieval API can be a focused follow-up PR.

## Explicit Non-Goals

- No compatibility wrapper for `/v1/resolve/*`.
- No migration from old `data-ref-resolution` rows into the new search contract.
- No automatic post/entity linking in this slice.
- No public search product in this slice.
- No partially modeled ontology entities in search results.
- No long-lived branch that keeps disabled resolver code around.
- No use of deprecated Workers AI AutoRAG accessors.
- No AI Search metadata expansion beyond the shared global field budget for this slice.

## Deletion Targets To Confirm During Implementation

The implementation pass should verify current imports before deletion, but these are expected target areas:

- `wrangler.resolver.toml`
- `RESOLVER` service bindings in Worker config
- resolver binding types in `src/platform/Env.ts`
- `src/resolver-worker/`
- `src/resolver/`
- resolver route/client/worker tests
- `data-ref-resolution` domain schemas in enrichment payloads
- `ENABLE_DATA_REF_RESOLUTION` config and env plumbing
- data-ref MCP tools and output formatting
- resolver-result citation/query/display helpers
- `src/enrichment/DataRefCandidateCitations.ts`
- `src/services/PostEnrichmentReadService.ts` resolver-result exposure
- `src/services/DataRefQueryService.ts`
- `src/services/d1/DataRefCandidateReadRepoD1.ts`
- `src/services/d1/PipelineStatusRepoD1.ts` resolver-result/status counts
- `src/api/Router.ts` enrichment response exposure
- `src/mcp/Fmt.ts` and `src/mcp/OutputSchemas.ts` resolver-result output paths
- resolver-result persistence hooks in D1 repositories
- resolver-only D1 tables/indexes and their tests
- ops deploy commands that still include `wrangler.resolver.toml`
- `scripts/generate-worker-types.ts` hardcoded references to `wrangler.resolver.toml`
- `.github/workflows/ci.yml` resolver staging deploy step and deployment-order comments
- `src/enrichment/Layer.ts` required-binding branches keyed off `ENABLE_DATA_REF_RESOLUTION`
- `src/services/d1/PipelineStatusRepoD1.ts` `dataRefResolution` counter paths
- `src/mcp/Fmt.ts` rendering branches for `data-ref-resolution`
- `src/ops/Cli.ts` operator deploy worker selection for the resolver Worker
- migration 25/26 follow-up cleanup for `data_ref_candidate_citations` and resolver alignment tables
- architecture docs that describe resolver as live: `docs/architecture/system-context.md`, `docs/architecture/seams.md`, `docs/architecture/resolution-trace.md`, `docs/architecture/product-alignment.md`

If a file still contains useful non-resolver logic, move that logic behind the new entity-search or linking boundary before deleting the resolver wrapper.

## Open Design Questions To Lock Before Implementation

1. **AI Search binding ownership:** Does PR A adopt Alchemy now, or add direct Wrangler AI Search bindings first? Recommendation: adopt Alchemy if the branch can absorb deploy-pipeline scope; otherwise keep PR A on Wrangler and make Alchemy the immediate follow-up.
2. **Canonical identifier:** Does the new surface return `https://id.skygest.io/...`, `https://w3id.org/energy-intel/...`, or both with explicit mapping? Recommendation: return the canonical ontology IRI and include legacy IDs only as aliases/evidence if needed.
3. **Exact lookup index:** Where do URL/hostname/alias probes live after data-layer search is drained? Recommendation: canonical D1 lookup tables or graph indexes, not AI Search metadata.
4. **AI Search instance strategy:** One cross-entity instance or per-entity instances? Recommendation: one cross-entity `entity-search` instance for this cutover, unless the enabled-entity matrix proves the metadata/filter budget is not enough.
5. **Route placement:** Should the HTTP surface be `/admin/search/entities`? Recommendation: yes for the first operator/internal route, with MCP `search_entities` as the primary tool surface.
6. **Old storage migration:** Do we drop `data_ref_candidate_citations` or only delete its rows? Recommendation: drop resolver-only tables if no surviving non-resolver consumer remains after code deletion.
7. **Editorial cache:** Should existing editorial `data_refs` frontmatter remain as an inert editorial cache until linking exists? Recommendation: leave external/editorial files alone in this cutover unless they actively call resolver APIs.

## Acceptance Criteria

- `search_entities` is the only supported replacement for resolver-style lookup.
- Returned hits are canonical hydrated entities, not raw search chunks.
- Exact probes work through the same search surface and outrank fuzzy retrieval.
- Unsupported entity types fail closed.
- No code path writes `data-ref-resolution`.
- Old resolver results are not exposed through API, MCP, UI, or read services.
- Resolver Worker, service bindings, client, routes, and tests are removed.
- Enrichment still supports `vision` and `source-attribution`.
- The future linking workflow is explicitly deferred and not faked through search.
- `ENABLE_DATA_REF_RESOLUTION` is gone.
- AI Search is accessed through the namespace binding and hidden behind an Effect service.
- Projection-ready entity support is catalog-driven and tested.
- Day-one enabled entity support is limited to `Agent`, `Dataset`, `Distribution`, `Series`, and `Variable`.
- `Catalog`, `CatalogRecord`, `DatasetSeries`, and `DataService` fail closed.
- No runtime return path uses data-layer `payloadJson` as authoritative entity data.
- No returned or logged `search_entities` state uses resolver words like `resolved`, `partial`, or `ambiguous`.
- Search logs include contract/projection/index/deploy version metadata.
- Minimum Analytics Engine datapoints exist for exact-probe hits, hydration misses, fail-closed events, AI Search latency, hydration latency, and skipped data-ref resolution during cutover.
- Hydration uses batched canonical lookup instead of per-hit D1 reads.
- Worker bundle does not import ontology-store RDF/SHACL emitters or Node built-ins through the search path.
- Typecheck and relevant tests pass.

## Verification Plan

Implementation should prove the cutover with:

- domain schema tests for `SearchEntitiesInput` / `SearchEntitiesResult`
- focused unit tests for request decoding, exact probes, ranking precedence, and fail-closed entity types
- service tests that prove AI Search recall hydrates canonical entities before returning
- tests for metadata/projection catalog drift
- MCP/admin route tests for `search_entities`
- tests proving enrichment no longer writes `data-ref-resolution`
- migration tests or D1 smoke checks proving old resolver-only rows/tables are removed as intended
- deletion checks for resolver routes, bindings, and old MCP resolver tools
- deletion searches for `data-ref-resolution`, `RESOLVER`, `/v1/resolve`, `resolve_data_ref`, `find_candidates_by_data_ref`, and `data_ref_candidate_citations`
- negative searches for `wrangler.resolver.toml` in active typegen, CI, and deploy scripts
- CI bundle-hygiene guard for Node built-ins and request-time imports of ontology-store RDF/SHACL tooling
- migration 27 absent-table assertions after the D1 cleanup
- `wrangler deploy --dry-run` for active Worker configs without `RESOLVER`
- staging smoke test: curated post produces only `vision` and `source-attribution`, exact-IRI probe returns a canonical hit, deferred entity type returns fail-closed warning
- `bun run typecheck`
- relevant `bun run test ...` suites, expanding to the full suite if shared contracts move
