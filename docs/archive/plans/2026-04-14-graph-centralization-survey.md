# Graph Centralization Survey — 2026-04-14

## 1. Methodology and scope

This survey examined the codebase to identify additional relationship/graph reconstruction opportunities beyond the three known duplicate layers documented in the spec.

**Architectural docs read:**
- `docs/architecture/seams.md` — high-risk data seams in the current resolver era; establishes that `DataLayerRegistry` is now a critical first-class seam
- `docs/architecture/skygest-resolution-improvement-plan.md` (partial) — resolver quality gating and relationship authority
- Spec preamble sections on drift risk and implementation status

**Search corpus:** 
- Core data-layer and resolution code: `src/resolution/*`, `src/data-layer/*`, `src/search/*`, `src/ingest/*`
- Consumer code: `src/resolution/kernel/Bind.ts`, `src/resolution/Stage1.ts`, `src/search/buildEntitySearchBundlePlan.ts`
- DCAT adapters: 8 adapter `buildCandidateNodes.ts` files across providers
- Harness: `src/ingest/dcat-harness/loadCatalogIndex.ts`
- Audit: `scripts/analysis/entity-search-audit/run-audit.ts`
- Test fixtures: `tests/cold-start-ingest-*.test.ts` 
- Services: `src/services/DataLayerRegistry.ts`, `src/services/d1/*`

**Hypotheses tested:** H1–H12 and 3 open-discovery directions.

## 2. Executive summary

The spec's status section (lines 96–115) is up-to-date: the three original duplicates have been partially consolidated. This survey confirms:

| Target | Location | Severity | Effort | Status |
|--------|----------|----------|--------|--------|
| Audit script relationship rebuild | `scripts/analysis/entity-search-audit/run-audit.ts:243–276` | High | S | Known, spec ready at [C5] |
| Ingest harness node/edge vocabulary split | `src/ingest/dcat-harness/IngestNode.ts`, `IngestEdge.ts`, `buildGraph.ts` | High | M | Known, spec ready at [C1]/[C2]/[C3] |
| Catalog index relationship maps | `src/ingest/dcat-harness/loadCatalogIndex.ts:318–413` | Medium | S | Ingest-time only; not a runtime drift surface |
| Graph-backed lookup derivation split | `src/resolution/dataLayerRegistry.ts:786–848` | Medium | S | Already partly migrated to graph; minor cleanup remains |
| Harness-specific entity types in ingest pipeline | `src/ingest/dcat-adapters/*/buildCandidateNodes.ts` | Low | M | Adapter-internal; no new seam beyond known [C13] |

**No new high-severity drift surfaces found beyond what the spec already names.** The core relationships are already consolidated via `buildDataLayerGraph(...)` and `prepared.graph`. The three named targets remain the primary consolidation work.

## 3. Confirmed duplicate graph / relationship layers

### Already named in spec ([C1], [C5], plus [C4] already migrated)

The spec already documents these three. This survey confirms their current state:

1. **Ingest graph** (`src/ingest/dcat-harness/buildGraph.ts`)
   - Separate `IngestNode` and `IngestEdge` types; `Graph.directed<IngestNode, IngestEdge>`
   - Missing `Variable` and `Series` node kinds
   - Missing `has-variable`, `measures`, `sources-from` edges
   - Spec status: identified for migration at [C1]–[C3]

2. **Audit script `SearchGraph`** (`scripts/analysis/entity-search-audit/run-audit.ts:91–99`)
   - Local type: 7 maps (`agentsById`, `datasetsById`, `variablesById`, `datasetsByVariableId`, `distributionsByDatasetId`, `seriesByDatasetId`, `seriesByVariableId`)
   - Builder at lines 243–276: imperatively reconstructs all 7 maps from entity array
   - Still runs separately from `projectEntitySearchDocs(prepared)` at line 415
   - Spec status: identified for migration at [C5]

3. **Search projection** — **ALREADY MIGRATED** (per spec line 69–72)
   - Previously owned local `SearchGraph`; now uses `prepared.graph` and traversal helpers
   - `src/search/projectEntitySearchDocs.ts` now calls `successorNodesByKindsAndTag(prepared.graph, ...)` at lines 185, 210, etc.
   - Spec status: completed at [C4]

### No additional first-class relationship layers discovered

Beyond these three, no new top-level graph duplication. However, some related patterns exist:

## 4. Hypothesis results

**H1: Resolver kernel rebuilds relationships** — Refuted.
- `src/resolution/kernel/Bind.ts` calls `lookup.findVariablesByAgentId(...)` and `lookup.findVariablesByDatasetId(...)` (lines 110, 123)
- These are backed by `DataLayerRegistryLookup`, which is already graph-derived (see analysis below)
- No independent relationship walking; uses prepared lookup seam

**H2: Stage 1 resolver walks graph joins** — Refuted for data-layer relationships.
- `src/resolution/Stage1.ts:260` calls `lookup.findDistributionByUrl(...)`
- Exact-lookup seam only; no multi-hop graph walking
- Spec non-goal #1 confirms exact lookups remain stable

**H3: Bundle resolution joins search candidates to data-layer** — Confirmed but limited.
- `src/search/buildEntitySearchBundlePlan.ts:26–90`: `getMatchedDatasets`, `getMatchedVariables`, `getMatchedAgents`
- Uses `lookup.findByCanonicalUri(...)` and `lookup.findVariablesByDatasetId(match.datasetId)` (line 58)
- Also backed by prepared registry; no new graph duplicated
- Spec target at [C9]: "keep as a graph-backed lookup consumer"

**H4: `buildEntitySearchBundlePlan` maintains relationship state** — Refuted.
- Single-direction lookup only; no bidirectional or multi-hop graph walking
- Already a consumer of prepared lookup; no independent state

**H5: D1 repositories rebuild relationship indexes** — Refuted.
- `src/services/d1/EnrichmentRunsRepoD1.ts`, `IngestRunsRepoD1.ts`: no relationship maps
- These are event log repos, not data-layer relationship stores

**H6: DCAT adapters maintain per-adapter relationship graphs** — Confirmed but intentional.
- Example: `src/ingest/dcat-adapters/data-europa/buildCandidateNodes.ts:690`
  - `datasetSeriesIdBySourceKey = new Map<string, DatasetSeries["id"]>()`
  - Maintains parent/child-like relationship: source URL → series ID (lines 692–705)
  - Purpose: identify existing series during ingest to merge candidates
- Also in `src/ingest/dcat-adapters/eia-tree/index.ts`: child-route traversal for hierarchy (lines 1014–1051)
- **Spec guidance [C13]**: "Preserve as an ingest consumer; do not let it regain graph ownership during migration"
- **Severity: Low** — these are ephemeral ingest-time maps; they guide entity merging but don't persist as a second graph contract
- Each adapter rebuilds for extraction purposes only; no runtime consumption

**H7: Enrichment pipeline rebuilds entity-linkage graphs** — Refuted.
- `src/enrichment/DataRefCandidateCitations.ts` uses a `Map<string, PreparedDataRefCandidateCitation>` (line 62, 201)
- This is a citation index (for a single enrichment run), not a persistent data-layer relationship graph
- No graph-shaped problem; transient state for one enrichment job

**H8: Ingest pipeline (outside harness) touches data-layer relationships** — Refuted.
- Bluesky post ingest and polling: only append events; no relationship queries
- No data-layer entity graph involved

**H9: MCP tools expose or rebuild catalog relationships** — Refuted.
- No MCP code found touching relationship reconstruction
- Editorial seam `SKY-241`, `SKY-242`, `SKY-243`, `SKY-244` (per `docs/architecture/seams.md:69–72`) are still planned, not implemented

**H10: Tests build fixture graphs** — Confirmed but expected.
- `tests/cold-start-ingest-*.test.ts` files build `CatalogIndex` with `agentsById: new Map([...])` pattern
- These are test fixtures for the harness, not the runtime
- Each adapter test seeds a lightweight index for its own test
- Example: `tests/cold-start-ingest-energy-institute.test.ts:139–156`
  - Builds `seededIndex(): CatalogIndex` with 7 maps
  - Purpose: simulate an ingest harness state for test validation
- **Severity: Low** — these are test-only, not runtime; no shared graph contract exists yet to replace them

**H11: Editorial/curation flows rebuild relationships** — Refuted.
- No relationship-graph code found in `src/curation/*`, `src/story/*`, `src/editorial/*`
- Editorial picks and thread assembly use post URIs, not data-layer entity graphs

**H12: Eval harness builds its own joins** — Not fully explored.
- `eval/resolution-kernel/*` noted in seams.md as a first-class architectural seam
- Does not appear to rebuild data-layer relationships; used for resolver quality measurement
- Spec non-goal #2 confirms this is outside scope

## 5. Open discovery findings

Beyond H1–H12:

### O1: Ingest harness `CatalogIndex` maintains a parallel indexing layer during entity loading

**Location:** `src/ingest/dcat-harness/loadCatalogIndex.ts:310–413`

**What it does:** 
- Builds 12+ lookup maps while loading entities from disk (lines 318–336)
- Maps include `agentsById`, `datasetFileSlugById`, `distributionsByDatasetIdKind`, `catalogRecordsByCatalogAndPrimaryTopic`, etc.
- Example: line 325 `distributionsByDatasetIdKind = new Map<string, Distribution>()`
- Mirrors relationship logic that the prepared registry later reconstructs

**Why it's a relationship problem:**
- These maps are logically similar to the prepared registry's relationship lookups
- Built by replaying entity fields (e.g., `distribution.datasetId` at line 381)
- Not a drift surface today (ingest is checked-in; registry is validated at runtime) but represents a second parallel relationship indexing strategy

**How the unified graph would subsume it:**
- After the harness migrates to shared node/edge types, `CatalogIndex` could derive these maps from the in-progress harness graph instead of building them independently
- Or: the harness could build the shared graph incrementally as it loads, then use it to populate the final index

**Severity:** Medium | **Effort:** S | **Spec touch:** Yes — part of [C1]/[C2]/[C3] harness migration, not a separate target

**Already on spec's radar?** Yes, implicitly under [C1] (ingest graph ownership).

---

### O2: Prepared registry relationship lookup derivation still uses raw field replays in parallel with graph traversal

**Location:** `src/resolution/dataLayerRegistry.ts:786–848`

**What it does:**
- Lines 786–794: derive `sortedDatasetsByAgentId` using `successorsByKinds(graph, agent.id, ["publishes"])`
- But also maintains exact lookups like `agentByLabel`, `datasetByTitle` (lines 856–873)
- The relationship maps (lines 861–864) are now graph-derived, but the derivation is still interleaved with exact-lookup building

**Why it's a centralization opportunity:**
- Spec line 109–114 already flags this: "Common graph-backed relationship views are still assembled partly in `buildPreparedRegistry(...)` and partly as repeated edge-kind reads in consumer code... it is still a repeated 'named relationship view' problem"
- The registry now correctly uses the graph for relationships (via `successorsByKinds`, `predecessorsByKinds`)
- But the repetition is still there: if projection or any other consumer wants `datasetsByAgentId`, it still has to either call the lookup or recompute from graph traversal

**How the unified graph would further consolidate it:**
- Spec recommendation 3 (line 127–140): "Add domain-level graph view helpers for the repeated patterns"
- Move all named relationship views (`datasetsByAgentId`, `variablesByDatasetId`, etc.) to a dedicated `DataLayerGraphViews.ts` module
- Registry calls these helpers to populate its lookup tables; consumers call the same helpers or use the registry's exposed versions
- This avoids repeated `successorsByKinds(graph, x, ["publishes"])` calls scattered across code

**Severity:** Medium | **Effort:** S | **Spec touch:** Yes — recommendation 3 at lines 127–140; recommendation 4 at lines 141–145

**Already on spec's radar?** Yes, explicitly as "lower-severity remaining consolidation opportunity" at lines 109–114.

---

### O3: Test fixtures in ingest cold-start tests build lightweight relationship maps without using a shared graph fixture builder

**Location:** Multiple `tests/cold-start-ingest-*.test.ts` files

**Example:** `tests/cold-start-ingest-energy-institute.test.ts:139–156`
```ts
const seededIndex = (): CatalogIndex => ({
  datasetsByMergeKey: new Map(),
  datasetFileSlugById: new Map([[REVIEW_DATASET.id, "ei-statistical-review-dataset"]]),
  datasetSeriesById: new Map([[REVIEW_SERIES.id, REVIEW_SERIES]]),
  // ... 7 more maps
});
```

**Files affected:**
- `tests/cold-start-ingest-energy-institute.test.ts`
- `tests/cold-start-ingest-odre.test.ts`
- `tests/cold-start-ingest-energy-charts.test.ts`
- `tests/cold-start-ingest-neso.test.ts`
- `tests/cold-start-ingest-gridstatus.test.ts`
- `tests/cold-start-ingest-entsoe.test.ts`
- `tests/cold-start-ingest-data-europa.test.ts`
- `tests/cold-start-ingest-eia.test.ts`
- `tests/cold-start-ingest-ember.test.ts`

**Why it's a relationship problem:**
- Each test manually seeds the `CatalogIndex` with hardcoded maps
- If the harness graph types or the relationship edge model changes, all 9+ test fixtures must be updated manually
- No test-level graph fixture builder exists; tests roll their own

**How the unified graph would subsume it:**
- Create a test-fixture builder: `TestDataLayerGraphFixture` or similar
- Provide a helper to seed a `CatalogIndex` from entity arrays + graph, not from manual maps
- Tests that need a specific harness state can construct it declaratively

**Severity:** Low | **Effort:** M | **Spec touch:** No explicit mention, but implicit under ingest harness consolidation [C1]–[C3]

**Already on spec's radar?** Not explicitly. This is a test-level consolidation opportunity that emerges once the harness graph types stabilize.

## 6. Architectural guidance from docs/architecture/

**`seams.md` (lines 24, 83–88):**
> "Every real resolution depends on this lookup contract" ([`DataLayerRegistry`])
> "The runtime registry is now the real source of truth" for entity data
> "`@skygest/DataLayerRegistry` lookup contract... Stage 1, the kernel, and future lookup tools all depend on this one prepared registry surface"

**Implication for graph consolidation:**
- The prepared registry is already the authoritative seam (line 24)
- Graph should be built once inside that seam (spec, line 238–243) ✓ Already done at lines 67–68 of spec status
- No runtime code should rebuild relationship maps outside that seam
- The audit script still does (O2 above); ingest harness still has a separate graph vocabulary

**`skygest-resolution-improvement-plan.md` (implied from context):**
- Resolver quality depends on graph completeness (spec, line 165–167)
- Provenance edges should be explicit, not projected (spec, lines 494–502)
- Series provenance is a structural join problem, not just scoring (spec, line 326)

## 7. Recommendations to add to the spec

No new commits or targets beyond what the spec already names. However, three smaller additions could sharpen the consolidation roadmap:

### Recommendation 1: Clarify test-fixture consolidation timing

**Spec section:** Add to "Recommended next consolidation steps" (line 116+)

**Text to add:**
> 5. Create a test-fixture builder for seeded `CatalogIndex` to avoid manual relationship-map construction in cold-start ingest tests. This is a lower-priority quality-of-life improvement but reduces test brittleness during harness migration.

**Rests on:** O3

---

### Recommendation 2: Explicitly name the `CatalogIndex` indexing layer as a migration concern

**Spec section:** Expand "Hidden drift points" (line 703)

**Text to add:**
> 6. `loadCatalogIndex(...)` in `src/ingest/dcat-harness/loadCatalogIndex.ts` currently builds 12+ relationship maps during entity loading. These should migrate to use graph-backed derivation after [C1]–[C3] port the harness onto the shared graph contract.

**Rests on:** O1

---

### Recommendation 3: Defer named relationship view factoring to a follow-up phase

**Spec section:** Clarify scope in "Non-goals" (line 295)

**Text to add (or as a note in "Recommended next consolidation steps"):**
> Note: recommendation 3 (named relationship view helpers) can be deferred until consumer migration is underway. The current state (lines 109–114, "repeated named relationship view problem") is no longer a drift risk, only a code-duplication issue. Prioritize [C1] and [C5] first; add `DataLayerGraphViews.ts` and refactor `buildPreparedRegistry` after audit migration completes.

**Rests on:** O2

## 8. Non-targets

Places where relationship logic *might* exist but does not require consolidation:

1. **Enrichment run citation indexes** (`src/enrichment/DataRefCandidateCitations.ts`)
   - Transient per-run data; not a persistent entity relationship graph
   - No consolidation needed

2. **EIA tree adapter child-route hierarchy** (`src/ingest/dcat-adapters/eia-tree/index.ts:1014–1051`)
   - Ingest-time parent/child tracking for a single provider's API hierarchy
   - Spec already permits this at [C13]: "Preserve as an ingest consumer"
   - Not a second graph contract; part of normal ingest extraction

3. **DCAT adapter merge-key and series-reference maps** (all 8 `buildCandidateNodes.ts` files)
   - Same rationale as EIA tree: extraction aids, not a runtime entity graph
   - Spec permits at [C13]

4. **Effect layer service bindings and D1 repos**
   - `src/services/DataLayerRegistry.ts` is a service boundary, not a second relationship layer
   - D1 repos (`EnrichmentRunsRepoD1`, `IngestRunsRepoD1`) are event logs, not data-layer relationship indexes

5. **Editorial curation, post enrichment, MCP services**
   - No relationship-graph reconstruction found in these domains
   - Future seams planned at [SKY-241]–[SKY-244] but not yet implemented

## 9. Appendix

### Grep / colgrep queries used

```bash
find src -name "*.ts" | xargs grep -l "Map<string.*\[\]>"
grep -n "agentsById\|datasetsById\|variablesByDatasetId" scripts/analysis/entity-search-audit/run-audit.ts
grep -n "buildGraph\|SearchGraph" src/search/projectEntitySearchDocs.ts
grep -n "successorsByKinds\|predecessorsByKinds" src/resolution/dataLayerRegistry.ts
find src/ingest/dcat-adapters -name "buildCandidateNodes.ts" | xargs grep -n "Map<string"
grep -rn "CatalogIndex" src/ingest/dcat-harness/loadCatalogIndex.ts
```

### Full file list surveyed

**Resolution and registry:**
- `src/resolution/dataLayerRegistry.ts` (1,007 lines)
- `src/resolution/kernel/Bind.ts` (partial: relationship narrowing at lines 104–130)
- `src/resolution/Stage1.ts` (partial: line 260, exact-lookup seam)
- `src/services/DataLayerRegistry.ts` (71 lines)
- `src/data-layer/DataLayerGraph.ts`, `DataLayerGraphTraversal.ts` (existing infrastructure)

**Search and projection:**
- `src/search/projectEntitySearchDocs.ts` (280+ lines; uses graph traversal helpers)
- `src/search/buildEntitySearchBundlePlan.ts` (200+ lines; uses lookup seam)

**Ingest:**
- `src/ingest/dcat-harness/loadCatalogIndex.ts` (527 lines; builds CatalogIndex)
- `src/ingest/dcat-harness/buildGraph.ts` (referenced in spec; exists)
- 8× `src/ingest/dcat-adapters/*/buildCandidateNodes.ts` (4,403 lines total)

**Audit and testing:**
- `scripts/analysis/entity-search-audit/run-audit.ts` (1,000+ lines; SearchGraph and buildGraph at lines 91–276)
- `tests/cold-start-ingest-*.test.ts` ×9 (sampled energy-institute; all follow same pattern)

**Non-targets verified:**
- `src/enrichment/DataRefCandidateCitations.ts`
- `src/services/d1/EnrichmentRunsRepoD1.ts`, `IngestRunsRepoD1.ts`
- No relevant code in `src/curation/*`, `src/editorial/*`, `src/mcp/*`
