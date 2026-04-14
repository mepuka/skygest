---
status: proposed
created: 2026-04-14
related:
  - docs/architecture/skygest-resolution-improvement-plan.md
  - docs/plans/2026-04-14-entity-search-empirical-analysis.md
  - docs/plans/2026-04-13-typed-entity-search-implementation-plan.md
  - docs/plans/2026-04-10-sky-257-dcat-ingest-harness-factoring.md
tickets:
  - SKY-355
  - SKY-356
  - SKY-346
  - SKY-343
  - SKY-324
  - SKY-329
  - SKY-322
  - SKY-327
  - SKY-354
---

# Data-layer graph unification specification

## TL;DR

Skygest should stop maintaining separate relationship layers for ingest,
runtime lookup, search projection, and audit. The repository already has a real
Effect `Graph.directed(...)` implementation for the ingest harness, but search
and audit rebuild a second and third graph shape as ad-hoc maps. That split is
now a structural liability because the active resolver-quality work depends on
exactly the relationships those duplicate graph layers keep drifting on. [C1]
[C4] [C5] [T1] [T2]

This spec recommends one shared TypeScript graph abstraction for data-layer
entities, built once during prepared-registry load and reused by:

1. ingest graph construction
2. runtime lookup derivation
3. search projection
4. entity-search audit tooling
5. future bundle-resolution graph joins

The shared graph should not live under `src/ingest/dcat-harness/`. That would
make the Worker-side runtime depend on harness-specific code. Instead:

- put graph node and edge types in `src/domain/data-layer/graph.ts`
- put the builder and index maps in `src/data-layer/DataLayerGraph.ts`
- put label-aware traversal helpers in `src/data-layer/DataLayerGraphTraversal.ts`

The first implementation branch should land the shared graph foundation and
registry integration without changing search behavior. Search and audit should
then migrate onto that foundation in a follow-up PR. Series provenance and URL
repair should layer on top of the unified graph, not invent another join model.
[T2] [T4]

---

## Problem statement

The current architecture has three different relationship systems:

1. The ingest harness builds a directed Effect graph over DCAT-ish node kinds in
   `src/ingest/dcat-harness/buildGraph.ts`. [C1]
2. Search projection defines its own `SearchGraph` and manually reconstructs
   parent and child maps in `src/search/projectEntitySearchDocs.ts`. [C4]
3. The empirical audit script defines another `SearchGraph` and another
   `buildGraph(...)` in `scripts/analysis/entity-search-audit/run-audit.ts`. [C5]

At the same time, the measured corpus gaps are exactly relationship gaps:

- 29 of 29 `Series` rows have zero canonical URLs. [D2]
- 1,790 of 1,790 `Dataset` rows and 25 of 25 `Variable` rows have no
  cross-linking ancestry. [D2]
- `SKY-355` explicitly reframes the queue around graph completeness and
  provenance before more resolver tuning. [T1]
- `SKY-356` explicitly calls for restoring series provenance and URL surfaces
  for resolver joins. [T2]

Those facts make the current duplication unacceptable. Every new relationship
repair now has to be threaded through multiple incompatible graph layers, and
every missed migration creates silent drift.

---

## Why this needs to happen now

### 1. The current ingest graph is real, but incomplete for resolver work

The ingest harness already uses `Graph.directed<IngestNode, IngestEdge>(...)`
and adds edges for `publishes`, `contains-record`, `has-series-member`,
`has-distribution`, `primary-topic-of`, and `served-by`. [C1] [C3]

That is useful, but it is not enough for the resolver-quality tickets now in
scope:

- `IngestNode` does not include `Variable` or `Series`. [C2]
- `IngestEdge` has no `has-variable`, no `measures`, and no `sources-from`.
  [C3]
- `CatalogRecord.primaryTopicType` can point to `DataService`, but the current
  ingest graph only emits `primary-topic-of` edges from `Dataset`, not from
  `DataService`. That is already a drift example between validated references
  and graph representation. [C1] [C6]

### 2. Search projection is rebuilding graph semantics by hand

`src/search/projectEntitySearchDocs.ts` defines a local `SearchGraph` type with:

- `agentsById`
- `datasetsById`
- `variablesById`
- `datasetsByVariableId`
- `distributionsByDatasetId`
- `seriesByDatasetId`
- `seriesByVariableId`

and then every projector reaches into those maps directly. [C4]

That code is currently responsible for:

- dataset lineage text
- series URL projection
- variable reverse ancestry
- publisher scoping
- series and distribution parent-child joins

This is not just duplication. It is the live runtime search read model.

### 3. Audit tooling is duplicating the same logic again

The empirical audit script also defines its own `SearchGraph` and its own graph
builder. [C5]

If search projection migrates but audit does not, the audit will stop measuring
the same system the runtime actually uses. That would undermine `SKY-355`,
whose explicit success gate depends on rerunning the audit against the repaired
graph. [T1]

### 4. The registry loader is the correct shared seam

`buildPreparedRegistry(...)` in `src/resolution/dataLayerRegistry.ts` is
already the place where the repo turns checked-in or D1-backed entity sets into
runtime lookup structures. [C6]

`loadPreparedDataLayerRegistry(...)` and `DataLayerRegistry.layerFromEffect(...)`
then expose that prepared structure to the rest of the runtime. [C7]

That makes the prepared registry the right place to attach a shared graph:

- it is built once
- it already validates references
- it already builds derived lookup tables
- both search and resolver code already depend on it

### 5. Effect Graph is sufficient, but it needs a thin wrapper

The Effect graph implementation gives us the right primitives:

- directed graph construction
- adjacency storage
- successor and predecessor traversal via `neighborsDirected(...)` [E1]
- BFS and DFS from explicit start nodes [E2]

But it does not give us label-aware traversal out of the box. BFS and DFS walk
topology only; they do not accept an edge filter. [E2]

That means the correct design is:

- use Effect Graph as the storage and traversal core
- add a small typed wrapper for "walk only edges of kind X"
- hide raw numeric node indexes from most consumers

That is not over-engineering. It is the minimum needed to make the graph safe
and reusable.

---

## Goals

This specification is intended to satisfy the TypeScript-side needs of
`SKY-355` and `SKY-356`, while staying compatible with the longer-term ABox and
bundle-flow work in `SKY-346` and `SKY-343`. [T1] [T2] [T3] [T4]

### Primary goals

1. Define one shared graph abstraction for data-layer relationships.
2. Eliminate duplicate graph-building logic from search projection and audit.
3. Make graph construction deterministic and type-safe.
4. Make graph traversal reusable across ingest, runtime lookup, search, and
   audit.
5. Provide a stable foundation for future provenance edges needed by `SKY-356`.
6. Centralize relationship validation so graph breakage fails loudly.

### Secondary goals

1. Preserve exact-match lookup behavior already built into the prepared
   registry.
2. Keep the new graph independent from harness-specific ingest code.
3. Avoid binding the runtime implementation to raw Effect `NodeIndex` values.
4. Keep the ontology-side ABox direction aligned semantically, without blocking
   this TypeScript-side unification on `SKY-346`.

---

## Non-goals

This spec does not propose:

1. a resolver ranking rewrite
2. a Stage 1 exact-lookup rewrite
3. a full ABox implementation inside the Worker runtime
4. immediate removal of the existing exact lookup tables in
   `buildPreparedRegistry(...)`
5. synthetic "pretend" provenance edges with no way to distinguish inferred
   from explicit structure
6. landing all data repair and all consumer migration in one PR

---

## Architectural decision

### Decision

Adopt a single shared TypeScript graph for data-layer entities, built during
prepared-registry load and reused by ingest, projection, audit, and future
resolver consumers.

### Why this is the right decision

It matches the repo's strategic direction:

- the graph is already treated as a first-class asset in the ingest harness and
  in the broader resolver architecture docs [C1] [D1]
- `SKY-355` explicitly prioritizes graph completeness ahead of more tuning [T1]
- `SKY-356` explicitly frames series provenance restoration as a structural join
  problem, not just a scoring problem [T2]
- `SKY-343` is a consumer ticket and should consume repaired graph surfaces
  rather than inventing a workaround inside the bundle flow [T4]

It also reduces future drift:

- one relationship vocabulary
- one builder
- one traversal helper layer
- one place to add invariants and diagnostics

### What not to do

Do not make runtime code import `src/ingest/dcat-harness/*` directly.

That code is shaped around harness concerns and DCAT ingest flow. The runtime
needs a neutral, reusable graph module. The ingest harness can become a
consumer of the shared graph builder, not the owner of the runtime graph
contract.

---

## Proposed module layout

### 1. Domain graph types

Create `src/domain/data-layer/graph.ts`.

This module should define the shared, typed relationship vocabulary:

- `DataLayerGraphNode`
- `DataLayerGraphNodeKey`
- `DataLayerGraphEdge`
- `DataLayerGraphEdgeKind`
- helpers for stable node-key construction

This placement is intentional. Node and edge shapes are part of the domain
contract and should live under `src/domain/`, consistent with the repo rule
that schemas and shared typed concepts belong there.

### 2. Shared graph builder

Create `src/data-layer/DataLayerGraph.ts`.

This module should:

- build the Effect directed graph
- maintain stable `nodeKey -> NodeIndex` and `NodeIndex -> nodeKey` maps
- expose typed node lookup helpers
- construct edges from validated registry entities
- return a pure, deterministic graph value

Recommended exported shape:

```ts
type DataLayerGraph = {
  readonly raw: Graph.DirectedGraph<DataLayerGraphNode, DataLayerGraphEdge>;
  readonly nodeIndexByKey: ReadonlyMap<DataLayerGraphNodeKey, Graph.NodeIndex>;
  readonly keyByNodeIndex: ReadonlyMap<Graph.NodeIndex, DataLayerGraphNodeKey>;
};
```

### 3. Label-aware traversal helpers

Create `src/data-layer/DataLayerGraphTraversal.ts`.

This module should hide raw graph-index mechanics behind graph-specific helper
functions such as:

- `findNodeByEntityId(...)`
- `successorsByKinds(...)`
- `predecessorsByKinds(...)`
- `reachableByKinds(...)`
- `collectNeighborEntities(...)`
- `collectLineageText(...)`

These helpers should operate on typed node and edge kinds, not on raw numeric
indexes, even if they use indexes internally.

---

## Node model

The shared graph should cover the union of:

- current ingest node kinds
- current runtime search node kinds
- immediate next relationships needed by `SKY-356`

### Phase 1 node coverage

Phase 1 should include:

- `Agent`
- `Catalog`
- `CatalogRecord`
- `DataService`
- `Dataset`
- `DatasetSeries`
- `Distribution`
- `Variable`
- `Series`

This is enough to replace the current ingest graph, the current search graph,
and the current audit graph with one abstraction. [C1] [C2] [C4] [C5] [C8]

### Future node coverage

Do not add `Observation` in the first pass unless a concrete consumer appears.
The shared graph should be able to grow to `Observation`, but that does not
need to block the unification work.

---

## Edge model

### Recommendation

Use object payloads for edges, not bare strings.

The current ingest graph uses bare string labels such as `"publishes"` and
`"has-distribution"`. [C3] That is sufficient for the harness, but it is not
strong enough for the shared runtime graph because the next tickets need to
distinguish explicit, derived, and projected relationship shapes.

Recommended pattern:

```ts
type DataLayerGraphEdge =
  | { readonly kind: "publishes"; readonly origin: "declared" }
  | { readonly kind: "parent-agent"; readonly origin: "declared" }
  | { readonly kind: "contains-record"; readonly origin: "declared" }
  | { readonly kind: "primary-topic-of"; readonly origin: "declared" }
  | { readonly kind: "has-distribution"; readonly origin: "declared" }
  | { readonly kind: "served-by"; readonly origin: "declared" }
  | { readonly kind: "has-series-member"; readonly origin: "declared" }
  | { readonly kind: "has-variable"; readonly origin: "declared" | "derived-from-series" }
  | { readonly kind: "in-dataset"; readonly origin: "declared" }
  | { readonly kind: "measures"; readonly origin: "declared" }
  | { readonly kind: "sources-from"; readonly origin: "declared" | "projected" };
```

### Initial edge set

#### Edges to preserve from the ingest graph

- `publishes`
- `contains-record`
- `primary-topic-of`
- `has-distribution`
- `served-by`
- `has-series-member`

#### Edges to add in Phase 1

- `parent-agent`
- `has-variable`
- `in-dataset`
- `measures`

These are already implicit in the runtime/search layer today and should become
explicit graph relationships. [C4] [C6]

#### Edges reserved for `SKY-356`

- `sources-from`

This edge should not be faked in Phase 1. The safe rule is:

1. if a real series-to-distribution relationship exists, emit it as
   `origin: "declared"`
2. if a projected parent-distribution shape is needed temporarily, either:
   - keep it out of the graph and walk `Series -> Dataset -> Distribution`, or
   - emit it with `origin: "projected"`

The important point is to avoid baking projected provenance in as if it were
asserted provenance.

---

## Build contract

### Input

The shared graph builder should take validated registry entities, not raw
ingest records.

Recommended inputs:

- `DataLayerRegistrySeed`
- `ReadonlyArray<RegistryRecord>`
- `entityById`

That keeps the builder aligned with `buildPreparedRegistry(...)`, which already
collects duplicate-ID issues and validates references before exposing runtime
lookup structures. [C6]

### Output

`PreparedDataLayerRegistry` should grow a public `graph` field.

Recommended change:

```ts
export type PreparedDataLayerRegistry = {
  readonly seed: DataLayerRegistrySeed;
  readonly entities: Chunk.Chunk<DataLayerRegistryEntity>;
  readonly entityById: ReadonlyMap<string, DataLayerRegistryEntity>;
  readonly pathById: ReadonlyMap<string, string>;
  readonly graph: DataLayerGraph;
};
```

This matters because `projectEntitySearchDocs(...)` currently accepts the
public prepared registry type, not the internal lookup-table type. [C4] [C7]

### Error behavior

Graph construction should fail with the same diagnostic style already used by
the prepared registry when:

- a referenced node is missing
- an edge target has the wrong entity kind
- two nodes produce the same graph key
- an invariant that should be guaranteed by validated data is violated

This is one of the most important benefits of the unification work: broken
relationships should fail once, centrally, and visibly.

---

## Traversal contract

### Constraint from Effect Graph

Effect Graph traversal does not natively filter by edge kind. Successor and
predecessor traversal work, but label-aware traversal must be layered on top.
[E1] [E2]

### Shared traversal helpers

The shared helper layer should provide:

1. `successorsByKinds(node, ["has-distribution", "served-by"])`
2. `predecessorsByKinds(node, ["publishes"])`
3. `walkByKinds(start, { outgoing: [...], incoming: [...] })`
4. `collectReachableEntities(start, spec)`
5. `collectSingleDistinctValue(start, spec)`

These helpers should:

- accept typed edge kinds
- operate on domain nodes or entity IDs
- return domain nodes or entities
- keep `NodeIndex` internal
- preserve deterministic ordering for projection output

### Guidance on BFS and DFS

Use bounded, pattern-specific traversal by default.

BFS and DFS are available and useful for explicit lineage walks, but most of
the projection code does not need open-ended graph search. Search projection
should prefer small, named walks such as:

- dataset -> distributions
- dataset -> variables
- series -> variable
- series -> dataset -> publisher
- variable <- datasets

That keeps the graph readable and makes failures easier to explain.

---

## Relationship authority rules

The consolidation only works if the repo becomes explicit about who is allowed
to own relationship semantics.

### Rule 1: the shared graph owns typed relationships

The shared graph should become the only place that owns structural edges such
as:

- agent -> dataset publication
- dataset -> distribution membership
- dataset -> variable ancestry
- series -> variable linkage
- series -> dataset linkage
- future series -> provenance linkage

If a relationship needs to exist at runtime, it should either exist as a graph
edge or be derivable from graph-backed helper functions.

### Rule 2: the prepared registry owns exact-match normalization, not graph semantics

`src/resolution/dataLayerRegistry.ts` should continue to own:

- normalized label lookups
- URL lookups
- hostname lookups
- alias lookups
- collision detection

But it should stop acting as a second owner of relationship topology.

That means exact lookup tables such as `agentByLabel` or `distributionByUrl`
remain registry-owned, while relationship lookups such as:

- `datasetsByVariableId`
- `variablesByDatasetId`
- `variablesByAgentId`

should become graph-backed views instead of independently maintained maps. [C6]
[C9] [C10]

### Rule 3: projection owns text shaping only

Projection code may decide how to turn relationships into `primaryText`,
`lineageText`, or `urlText`, but it should never rebuild graph structure on its
own. [C4]

### Rule 4: ingest adapters own extraction, not runtime graph semantics

Adapters such as the EIA tree ingest may continue to extract source facts and
materialize entity candidates, but they should not define a second long-lived
graph contract for the runtime. [C13]

### Rule 5: audit and diagnostics are pure consumers

Audit code is allowed to measure graph quality and projection quality. It is
not allowed to define its own relationship engine. [C5]

---

## Code-change survey

This is the concrete file-level migration inventory for the first graph
consolidation wave.

| File | Current role | Future role | Action |
| --- | --- | --- | --- |
| `src/domain/data-layer/graph.ts` | Missing | Owner | Add shared node and edge types here. |
| `src/domain/data-layer/index.ts` | Re-export surface | Owner-adjacent | Export the new graph types from the domain barrel. |
| `src/data-layer/DataLayerGraph.ts` | Missing | Owner | Add the shared graph builder, node-key indexing, and graph-backed relationship indexes here. |
| `src/data-layer/DataLayerGraphTraversal.ts` | Missing | Owner | Add label-aware helper walks here so consumers never manipulate `NodeIndex` directly. |
| `src/resolution/dataLayerRegistry.ts` | Mixed owner | Owner | Keep validation and exact lookups here, but move relationship derivation behind the shared graph and expose the graph on prepared registry values. [C6] |
| `src/services/DataLayerRegistry.ts` | Public service boundary | Consumer | Expose the shared graph on `prepared`, while still hiding internal registry-only maps. [C7] |
| `src/ingest/dcat-harness/IngestNode.ts` | Owner | Adapter | Replace harness-local node vocabulary with wrappers or adapters over the shared graph node model. [C2] |
| `src/ingest/dcat-harness/IngestEdge.ts` | Owner | Adapter | Replace harness-local edge vocabulary with the shared edge model or a narrow adapter. [C3] |
| `src/ingest/dcat-harness/buildGraph.ts` | Owner | Consumer or wrapper | Port this file onto the shared graph builder so the harness stops owning the core graph contract. [C1] |
| `src/ingest/dcat-adapters/eia-tree/index.ts` | Consumer | Consumer | Preserve as an ingest consumer; do not let it regain graph ownership during migration. [C13] |
| `src/search/projectEntitySearchDocs.ts` | Owner | Consumer | Delete `SearchGraph` and `buildSearchGraph`; make the projector consume graph helpers only. [C4] |
| `src/search/projectFromDataLayer.ts` | Consumer | Consumer | Keep as a thin composition entry point; no graph logic should live here. [C12] |
| `scripts/analysis/entity-search-audit/run-audit.ts` | Owner | Consumer | Delete the local `SearchGraph` and `buildGraph`; use the shared graph and shared traversal helpers. [C5] |
| `src/search/buildEntitySearchBundlePlan.ts` | Consumer of relationship lookups | Consumer | Keep as a graph-backed lookup consumer; it should not become a graph walker itself. [C9] |
| `src/resolution/kernel/Bind.ts` | Consumer of relationship lookups | Consumer | Keep narrowing logic here, but back `findVariablesByAgentId` and `findVariablesByDatasetId` with graph-derived lookups. [C10] |
| `src/resolution/bundle/resolveDataReference.ts` | Exact-lookup consumer | Consumer | Leave on exact lookup paths for now; do not mix this older resolver into the graph migration scope. [C11] |
| `tests/data-layer-registry.test.ts` | Contract test | Consumer test | Update to assert that the public prepared registry exposes the shared graph while still hiding private lookup tables. [C17] |
| `tests/entity-search-projector.test.ts` | Projection contract test | Consumer test | Keep and expand to assert graph-derived lineage and URL behavior after the migration. [C14] |
| `tests/entity-search-bundle-plan.test.ts` | Consumer test | Consumer test | Keep as a guard that graph-backed lookup behavior still feeds bundle planning correctly. [C15] |
| `tests/entity-search-service.test.ts` | End-to-end consumer test | Consumer test | Keep as a higher-level guard that projection plus search still behave the same through the migration. [C16] |

### Files that should stop owning relationship topology

These are the important deletions or role reductions:

1. `src/search/projectEntitySearchDocs.ts` should lose its local `SearchGraph`
   and `buildSearchGraph(...)`. [C4]
2. `scripts/analysis/entity-search-audit/run-audit.ts` should lose its local
   `SearchGraph` and `buildGraph(...)`. [C5]
3. `src/ingest/dcat-harness/IngestNode.ts` and `IngestEdge.ts` should stop
   being the source of truth for runtime graph vocabulary. [C2] [C3]

### Hidden drift points

These are the migration risks that are easy to miss:

1. `buildPreparedRegistry(...)` currently computes relationship maps directly
   from both `Dataset.variableIds` and `Series.datasetId`, which means the
   registry is already a second relationship engine. [C6]
2. `toPreparedDataLayerRegistryCore(...)` currently strips internal lookup maps
   from the public prepared registry. If the shared graph is not added there,
   downstream consumers will keep rebuilding their own maps. [C6] [C7]
3. `buildEntitySearchBundlePlan(...)` and `Bind.ts` rely on the current lookup
   surface. If graph-backed lookup generation changes behavior, those files can
   regress even if projection itself still works. [C9] [C10]
4. `resolveDataReference.ts` is old but still active code. It should remain a
   lookup consumer and not be half-migrated into a second graph client. [C11]
5. The EIA tree adapter re-exports harness graph types and helpers today, so
   the harness-to-shared-graph migration needs a compatibility plan rather than
   a blind delete. [C13]

---

## Migration mechanics

### 1. Split exact lookups from relationship lookups

The current prepared registry interleaves both in one function. [C6]

The migration should make that split explicit:

1. build and validate entities
2. build the shared graph
3. derive graph-backed relationship indexes from the shared graph
4. build exact normalized lookup tables
5. expose both through the existing registry service boundary

This keeps the registry as the assembly layer without letting it remain a
competing relationship owner.

### 2. Prefer graph-backed indexes over open-ended graph walks in hot code

Not every consumer should run BFS at runtime.

For hot paths, precompute and expose graph-backed indexes such as:

- `datasetsByVariableId`
- `variablesByDatasetId`
- `variablesByAgentId`
- `seriesByDatasetId`
- `seriesByVariableId`
- `distributionsByDatasetId`

The difference from today is not that these views disappear. The difference is
that they are derived from the shared graph rather than defined as an
independent relationship layer. [C4] [C5] [C6]

### 3. Keep exact URL and alias behavior stable during graph migration

The first graph PR should not change:

- `findDistributionByUrl(...)`
- `findDatasetByLandingPage(...)`
- `findAgentByLabel(...)`
- `findDatasetByAlias(...)`
- `findVariableByAlias(...)`

Those are already working exact paths and are not the source of the current
drift problem. [C6] [C11]

### 4. Make the public prepared registry graph-first, not lookup-table-first

The public prepared registry currently exposes only:

- `seed`
- `entities`
- `entityById`
- `pathById`

and deliberately hides private lookup tables. [C6] [C7] [C17]

The shared graph should become part of that public prepared contract. The
lookup tables should remain private implementation details behind
`DataLayerRegistryLookup`.

---

## Commit plan inside the implementation branch

The branch should commit to consolidation incrementally, not as one giant
rewrite.

### Commit 1: shared graph types and builder

Add:

- `src/domain/data-layer/graph.ts`
- `src/data-layer/DataLayerGraph.ts`
- `src/data-layer/DataLayerGraphTraversal.ts`
- `tests/data-layer-graph.test.ts`

Do not change search or audit yet.

### Commit 2: prepared-registry integration

Modify:

- `src/domain/data-layer/index.ts`
- `src/resolution/dataLayerRegistry.ts`
- `src/services/DataLayerRegistry.ts`
- `tests/data-layer-registry.test.ts`
- any D1 or checked-in bootstrap tests that assert the prepared shape

Goal:

- public prepared registry exposes the graph
- private registry lookup tables stay private
- relationship lookups become graph-backed

### Commit 3: ingest harness migration

Modify:

- `src/ingest/dcat-harness/IngestNode.ts`
- `src/ingest/dcat-harness/IngestEdge.ts`
- `src/ingest/dcat-harness/buildGraph.ts`
- `src/ingest/dcat-adapters/eia-tree/index.ts`
- relevant cold-start ingest tests

Goal:

- the harness becomes a consumer of the shared graph contract

### Commit 4: search projection migration

Modify:

- `src/search/projectEntitySearchDocs.ts`
- `src/search/projectFromDataLayer.ts`
- `tests/entity-search-projector.test.ts`
- `tests/entity-search-service.test.ts`

Goal:

- no local `SearchGraph`
- projection uses only graph helpers and graph-backed relationship indexes

### Commit 5: audit migration

Modify:

- `scripts/analysis/entity-search-audit/run-audit.ts`

Goal:

- audit measures the same graph-backed projection path the runtime uses

### Commit 6: consumer cleanup

Review and adjust:

- `src/search/buildEntitySearchBundlePlan.ts`
- `src/resolution/kernel/Bind.ts`
- `tests/entity-search-bundle-plan.test.ts`

Goal:

- ensure lookup consumers remain stable after graph-backed derivation replaces
  direct map ownership

---

## Consumer migration plan

### Consumer 1: ingest harness

`src/ingest/dcat-harness/buildGraph.ts` should become a thin adapter over the
shared builder, or be replaced outright once the shared graph fully covers the
harness use case. [C1]

The goal is to keep harness behavior while removing the harness as the owner of
the graph contract.

### Consumer 2: search projection

`src/search/projectEntitySearchDocs.ts` should stop defining `SearchGraph` and
stop manually building relationship maps. [C4]

The projector should instead:

- read entities from `prepared.graph`
- use label-aware helper functions
- derive text fields by graph walks

This is the most important migration because it removes the live duplicate
runtime graph.

### Consumer 3: audit

`scripts/analysis/entity-search-audit/run-audit.ts` should stop defining its
own `SearchGraph` and should consume the same shared graph as the projector.
[C5]

This migration is required if `SKY-355` is going to use the audit as its
success gate. [T1]

### Consumer 4: future bundle resolution

`SKY-343` should consume the shared graph through the prepared registry and the
shared traversal layer. [T4]

That keeps the bundle flow focused on search intents and evidence handling,
rather than embedding another custom graph join model.

---

## How this relates to `SKY-346`

`SKY-346` is about the ontology-side DCAT ABox and the runtime index. [T3]

That ticket should influence relationship naming and long-term semantic
alignment, but it should not block the TypeScript-side graph unification.

### Decision

The TypeScript shared graph is the runtime execution model.

The ontology-side ABox is the semantic and export model.

They should converge on:

- relationship names
- relationship meaning
- validation expectations

They do not need to be the same code artifact or the same storage layer in this
implementation phase.

This avoids stalling the runtime cleanup behind a broader ontology slice, while
still keeping the two directions aligned.

---

## PR plan

### PR 1: shared graph foundation

Suggested ticket home: `SKY-356`

Suggested branch:

- `sky-356/runtime-graph-foundation`

Scope:

- add shared node and edge types
- add shared graph builder
- add label-aware traversal helpers
- attach `graph` to `PreparedDataLayerRegistry`
- port ingest harness builder onto the shared graph
- add graph unit tests

Do not change search projection behavior in this PR.

### PR 2: search and audit migration

Suggested ticket home: `SKY-356`

Scope:

- rewrite `projectEntitySearchDocs.ts` to use shared graph traversal
- delete local `SearchGraph`
- rewrite `run-audit.ts` to use the shared graph
- preserve or intentionally update search projection expectations
- rerun search projector tests and audit outputs

This is the PR that removes duplicate graph logic from the live runtime path.

### PR 3: provenance edge expansion and validation

Suggested ticket home: `SKY-356`

Scope:

- add `sources-from` where justified
- add validation for provenance-path completeness
- add explicit series provenance coverage reporting
- harden `Series` URL surface generation through graph walks

This is where the unified graph begins directly closing the series provenance
gap called out by `SKY-356`.

### Parallel data tickets

These remain separate workstreams and should not be merged into the graph
foundation PR:

- `SKY-324` registry hygiene [T5]
- `SKY-329` tightening `Series.datasetId` [T6]
- `SKY-322` variable alias backfill [T7]
- `SKY-327` agent matching surface expansion [T8]
- `SKY-354` dataset title normalization decision [T9]

The graph foundation should make those tickets easier to implement and audit,
not absorb them.

---

## Acceptance criteria

This specification is fully implemented when all of the following are true:

1. the prepared registry exposes one shared graph value
2. ingest graph construction uses the shared graph code path
3. search projection no longer defines a local `SearchGraph`
4. the audit script no longer defines a local `SearchGraph`
5. graph traversal helpers support label-aware successor and predecessor walks
6. raw `NodeIndex` values are not required by ordinary runtime consumers
7. graph build failures surface through existing registry diagnostics
8. search projection tests remain green after migration
9. the empirical audit runs against the shared graph-backed projection path
10. series provenance and URL-surface work can add new edges without inventing
    another traversal layer

---

## Risks and mitigations

### Risk: raw index leakage

Effect Graph uses plain numeric indexes. If those leak into runtime code, the
shared graph will become hard to refactor and easy to misuse. [E1] [E2]

Mitigation:

- keep indexes internal to `src/data-layer/DataLayerGraph*.ts`
- expose typed helpers keyed by entity IDs or typed node refs

### Risk: projected provenance becomes indistinguishable from explicit provenance

This is the biggest correctness risk in `SKY-356`.

Mitigation:

- do not emit synthetic provenance edges with no origin marker
- either walk parent dataset/distribution edges directly, or emit projected
  edges with explicit metadata

### Risk: graph and lookup tables diverge again

If search migrates but the audit or future resolver code keeps local map
reconstruction, drift returns.

Mitigation:

- migrate audit in the same wave as search projection
- document the shared graph as the only supported relationship layer

### Risk: scope expands into data repair too early

The graph foundation can become a dumping ground for all relationship repair.

Mitigation:

- keep PR 1 structural
- keep data repair tickets separate
- make provenance edge expansion a later, clearly bounded PR

---

## Open questions

### 1. Should `has-variable` represent only explicit dataset membership or also derived runtime membership?

Recommendation:

- use one edge kind
- carry `origin: "declared" | "derived-from-series"`

That preserves a unified traversal story while keeping data quality visible.

### 2. Should `sources-from` exist before explicit series-to-distribution repair lands?

Recommendation:

- not as an unqualified edge
- either delay it until explicit data exists or mark projected edges clearly

### 3. Should the graph become the source for exact lookup tables too?

Not in the first implementation branch.

The immediate value is unifying shared relationships. Exact-match tables can
continue to be built in parallel until the graph-backed version is proven.

---

## References

### Code

- [C1] `src/ingest/dcat-harness/buildGraph.ts:20-178`
- [C2] `src/ingest/dcat-harness/IngestNode.ts:11-53`
- [C3] `src/ingest/dcat-harness/IngestEdge.ts:1-7`
- [C4] `src/search/projectEntitySearchDocs.ts:28-120, 304-389, 392-482, 484-716`
- [C5] `scripts/analysis/entity-search-audit/run-audit.ts:91-245`
- [C6] `src/resolution/dataLayerRegistry.ts:252-403, 507-700`
- [C7] `src/services/DataLayerRegistry.ts:19-69`
- [C8] `src/domain/data-layer/variable.ts:31-80`
- [C9] `src/search/buildEntitySearchBundlePlan.ts:26-161`
- [C10] `src/resolution/kernel/Bind.ts:104-130`
- [C11] `src/resolution/bundle/resolveDataReference.ts:16-220`
- [C12] `src/search/projectFromDataLayer.ts:1-20`
- [C13] `src/ingest/dcat-adapters/eia-tree/index.ts:1-100`
- [C14] `tests/entity-search-projector.test.ts:150-242`
- [C15] `tests/entity-search-bundle-plan.test.ts:22-26, 152-159`
- [C16] `tests/entity-search-service.test.ts:25-33, 157-164`
- [C17] `tests/data-layer-registry.test.ts:117-157`

### Effect Graph source

- [E1] `.reference/effect/packages/effect/src/Graph.ts:1546-1628`
- [E2] `.reference/effect/packages/effect/src/Graph.ts:3673-3815`

### Repo documents

- [D1] `docs/architecture/skygest-resolution-improvement-plan.md`
- [D2] `docs/plans/2026-04-14-entity-search-empirical-analysis.md:1248-1252`
- [D3] `docs/plans/2026-04-13-typed-entity-search-implementation-plan.md`

### Linear tickets

- [T1] `SKY-355` — <https://linear.app/pure-logic-industrial/issue/SKY-355/data-plane-repair-pass-restore-graph-completeness-before-more-resolver>
- [T2] `SKY-356` — <https://linear.app/pure-logic-industrial/issue/SKY-356/restore-series-provenance-and-url-surfaces-for-resolver-joins>
- [T3] `SKY-346` — <https://linear.app/pure-logic-industrial/issue/SKY-346/populate-dcat-abox-wire-runtime-index-close-semantic-extension-gaps>
- [T4] `SKY-343` — <https://linear.app/pure-logic-industrial/issue/SKY-343/bundle-resolution-flow-on-entitysearch-service>
- [T5] `SKY-324` — <https://linear.app/pure-logic-industrial/issue/SKY-324/clean-registry-hygiene-blockers-before-series-backed-narrowing-ships>
- [T6] `SKY-329` — <https://linear.app/pure-logic-industrial/issue/SKY-329/tighten-seriesdatasetid-from-optional-to-required>
- [T7] `SKY-322` — <https://linear.app/pure-logic-industrial/issue/SKY-322/backfill-variable-aliases-for-series-backed-and-eval-relevant>
- [T8] `SKY-327` — <https://linear.app/pure-logic-industrial/issue/SKY-327/expand-stage-1-agent-matching-surface-beyond-labelhomepage>
- [T9] `SKY-354` — <https://linear.app/pure-logic-industrial/issue/SKY-354/investigate-dataset-title-normalization-during-cold-start-ingest>
