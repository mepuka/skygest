# SKY-314: Resolution Kernel — Interpret, Bind, AssembleOutcome

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan slice-by-slice. Each slice ends with `bun run typecheck` + focused tests green before the next slice starts.

**Goal:** Build the three kernel middleware files on top of the Phase 1 foundation — Interpret turns evidence bundles into hypotheses, Bind resolves hypotheses against the registry, AssembleOutcome emits one `ResolutionOutcome` per bundle. Ship as one atomic PR organized as four internal slices.

**Scope context:** This plan covers what the original SKY-313 plan framed as Phase 3 + Phase 4 + Phase 5. The work was originally split into `SKY-314` (multi-variable + Agent narrowing, "Phase 2" in that ticket's wording) and left the Interpret/Bind middleware implicit, with resolver integration deferred to a later Phase 5. This plan supersedes that scoping — all the middleware **and the hard cutover to the new kernel** land together. Stage 2 gets deleted in this PR; there is no coexistence period, no feature flag, and no backwards-compatibility shim. The enrichment record format changes from `Stage2Result` to the new `ResolutionOutcome[]` shape, accepting that existing production enrichment records become unreadable.

**Tech stack:** Effect 4 (`Result`, `Predicate`, `Array`, `Order`, `Match`), Effect Schema domain models, `@effect/vitest` under Bun. Pure algebra layer stays free of `Effect`/`Layer`/`ServiceMap`; effectful orchestration lives in a thin service wrapper.

---

## Status

**Ready to implement.** Design is fully locked via:

1. **Phase 1 shipped** — pure algebra (`partialVariableAlgebra.ts`), outcome contract (`resolutionKernel.ts`), BundleAdapter, 7-facet vocabulary, cold-start vocabulary validation, DCAT chain bidirectional lookups, encoded wire-format snapshots. See commits `e60e8c9a` (foundations), `738d6f31` (post-merge cleanup).
2. **Research synthesis** from five advisory docs in `ontology_skill/docs/research/2026-04-12-*.md`. Every algorithm in this plan maps to a section in one of those docs.
3. **Design interview** conducted 2026-04-12. This document is the compiled output.

---

## Research basis

All five advisories should be read before implementation begins:

- `ontology_skill/docs/research/2026-04-12-resolution-algebra.md` — three-layer lattice, product space, locked operations
- `ontology_skill/docs/research/2026-04-12-text-ops-and-evidence-combination.md` — T1–T4 text pipeline, tiered evidence, Agent narrowing
- `ontology_skill/docs/research/2026-04-12-resolution-trace-examples.md` — five worked examples, regression fixture seeds
- `ontology_skill/docs/research/2026-04-12-scoring-segmentation-feedback.md` — `VariableCandidateScore`, `ResolutionGap`, Cartesian decomposition
- `ontology_skill/docs/research/2026-04-12-effect-algebra-mapping.md` — full `resolveCandidates` pipeline, module boundary rules

The research is the authoritative source for algorithm shapes. This plan cites specific sections when it quotes an advisory.

---

## Locked decisions

### From Phase 1 (shipped code)

- **Seven facets** form the product lattice: `measuredProperty`, `domainObject`, `technologyOrFuel`, `statisticType`, `aggregation`, `unitFamily`, `policyInstrument`
- **Required facets** per `resolvable()`: `measuredProperty` and `statisticType` (both must be non-`⊥`)
- **Pure algebra** — `joinPartials` (returns `Result`), `subsumes`, `specificity`, `matched`, `mismatched`, `subsumptionRatio`, `resolvable: Predicate.Refinement`
- **Outcome tagged union** with six variants: `Resolved | Ambiguous | Underspecified | Conflicted | OutOfRegistry | NoMatch`
- **Evidence precedence order** constant `EVIDENCE_PRECEDENCE`: `series-label > x-axis > y-axis > chart-title > key-finding > post-text > source-line > publisher-hint`
- **BundleAdapter** converts `Stage1Input` → one `ResolutionEvidenceBundle` per asset (plus an optional post-only bundle), schema-decoded at exit
- **DCAT chain** bidirectional lookups: `findDatasetsByVariableId`, `findVariablesByDatasetId` exist on `DataLayerRegistryLookup`

### From research advisories

- **Text ops T1–T4** (canonicalize, boundary-delimited scan, exact-match fast path, canonical projection) are already correctly implemented by `src/resolution/facetVocabulary/normalize.ts` and `SurfaceFormEntry.ts`. **Reuse as-is.** (`text-ops-and-evidence-combination.md` Part 1)
- **Per-facet parallel scan with longest-match-first** — one winner per dimension per scan site. Formal model: `scan(text) = (scan_1(text), ..., scan_7(text))`. (`text-ops-and-evidence-combination.md` Op T2)
- **Projection-then-join decomposition** — walk bundle fields, project text into partial assignments, fold under `joinPartials`. (`resolution-algebra.md` §"Key operations")
- **Multi-topic Cartesian factoring** restricted to `technologyOrFuel` in v1 — use a `matchAll` variant that collects all technology matches across series labels, emits one hypothesis per technology with the rest of the shared partial common. (`scoring-segmentation-feedback.md` §2)
- **Segmentation gated by residual kind** — post-text and key-findings get split on delimiters/conjunctions before projection; chart-title, axis labels, series labels do not. (`scoring-segmentation-feedback.md` §3)
- **`subsumes` is the candidate filter**; `subsumptionRatio` + `matched.length` is the ranker. Filter rule: `mismatched.length === 0`. Tie-break: `variable.label.localeCompare`. (`scoring-segmentation-feedback.md` §1, full TS provided)
- **`resolvable` gate** — reject partials where `measuredProperty === ⊥` or `statisticType === ⊥` before candidate scoring. Use the shipped `Predicate.Refinement`. (`resolution-algebra.md` Op 4)
- **Tiered evidence** with lexicographic precedence (not probabilistic combination): `entailment > strong-heuristic > weak-heuristic`. (`text-ops-and-evidence-combination.md` Part 2)
- **Agent narrowing** — after subsumption filter, if `candidates.length > 1` and Stage 1 resolved an Agent, filter candidates to Variables published by that Agent via composed inverse index `datasetIdsByAgentId ∘ variablesByDatasetId`. (`text-ops-and-evidence-combination.md` Improvement 3)
- **Pure pipeline shape**: `pipe(allVariables, Array.filter(subsumedBy(p)), Array.filter(hasNoMismatch), Array.filter(agentScope), Array.map(scoreCandidate), Array.sort(Order.combine(...)))`. (`effect-algebra-mapping.md` §3)
- **Module boundary rule**: "if a function takes only `PartialVariableShape` arguments, it belongs in the algebra module; if it touches the registry or mutable state, it belongs in the resolver layer." (`effect-algebra-mapping.md` §5)

### From the 2026-04-12 design interview

- **Preservation over collapse.** Every non-`Resolved` outcome variant carries a `ResolutionGap` (or array thereof) as its payload. The kernel never drops information when it can't decide — it emits gaps so the SKY-315 LLM feedback loop can consume them.
- **`BoundResolutionItem` becomes a tagged union** with two variants: `{_tag: "bound", variableId, partial}` and `{_tag: "gap", partial, candidates, reason}`. A `Resolved` outcome requires all items to be `_tag: "bound"`; any `_tag: "gap"` item flips the outcome to `Ambiguous`.
- **Multi-topic mixed case** — when Cartesian decomposition produces N sub-topics and some bind cleanly while others don't, emit a single `Ambiguous` outcome with heterogeneous items. Preserves per-topic state without inventing a new tag.
- **Agent-narrowing fallback** — when Agent narrowing produces zero candidates (the Agent exists but publishes none of the subsumed candidates), emit `OutOfRegistry` with a gap carrying both pre-narrowing facet candidates AND the Agent reference + reason `"agent-scope-empty"`. The LLM pipeline then decides whether the Agent is correct (→ add Variable) or Stage 1 picked the wrong publisher.
- **Single-hop Agent walks only** in v1. Multi-hop traversal via `parentAgentId` is possible but deferred.
- **Compound surface forms deferred** — do not build compound lexical entries speculatively. Wait until Phase 3 implementation surfaces a specific phrase that needs atomic multi-facet projection, then add one.
- **Hard cutover, no backwards compatibility.** Stage 2 (`src/resolution/Stage2.ts` and every `*stage2*` file in `src/domain/` and `tests/`) is deleted wholesale as part of this PR. All production call sites are rewired to the new kernel. The enrichment record format changes from `Stage2Result` to `ResolutionOutcome[]`. Existing production enrichments become unreadable after deploy — accepted, not mitigated.
- **Delivery shape**: one atomic PR, four internal slices (below), each slice leaves the kernel in a working state so rollback is possible per slice during development. The hard cutover lives in slice 4.

---

## Architecture

### The three-stage pipeline

```
Stage1Input
    │
    ▼
BundleAdapter (shipped)
    │
    ▼
ResolutionEvidenceBundle[]
    │
    ▼
Interpret (new)
    │     per-bundle: scan evidence, project facets, join, factor on technologyOrFuel
    │
    ▼
ResolutionHypothesis[]
    │
    ▼
Bind (new)
    │     for each hypothesis: resolvable gate → subsumes filter → Agent narrowing → score
    │
    ▼
BoundHypothesis[] (hypotheses + scored candidate sets)
    │
    ▼
AssembleOutcome (new)
    │     apply outcome decision table, build gaps, emit one ResolutionOutcome
    │
    ▼
ResolutionOutcome (shipped contract, extended payloads)
```

The three stages are pure functions. Only the thin `ResolutionKernel.ts` entry point touches effects (for registry lookup).

### Interpret — bundle to hypotheses

**Input:** one `ResolutionEvidenceBundle`.

**Process:**
1. Walk bundle fields in `EVIDENCE_PRECEDENCE` order (`series-label`, `x-axis`, `y-axis`, `chart-title`, `key-finding`, `post-text`, `source-line`, `publisher-hint`).
2. For each field, apply the appropriate segmentation rule (split `post-text` and `key-finding` on delimiters; scan `series-label`/axis/title as a single token).
3. Run the facetVocabulary matcher against each segment — per-facet parallel scan, longest-match-first, one winner per facet per site.
4. Collect per-site matches into partial assignments.
5. Fold all partials under `joinPartials`. Conflicts on **non-required** facets downgrade the hypothesis's `tier` from `entailment` to `strong-heuristic`; conflicts on **required** facets bubble up to `Conflicted` at the outcome stage.
6. **Cartesian decomposition on `technologyOrFuel`**: if the series labels produce multiple distinct `technologyOrFuel` values, emit one hypothesis per technology, with `sharedPartial` holding everything except `technologyOrFuel` and `items[i].partial` holding the per-item technology.
7. Attach bundle-derived `AttachedContext` (place/market/sector/frequency/time) as a sidecar — never folded into the core partial.

**Output:** `ResolutionHypothesis[]`. Single-topic bundles produce one hypothesis with one item; multi-tech charts produce one hypothesis with N items (factored). Multi-hypothesis output (one bundle, two rival interpretations) is **not** supported in v1 — any join conflict collapses to a single hypothesis with tier downgrade or to `Conflicted`.

### Bind — hypotheses to bound candidates

**Input:** `ResolutionHypothesis[]` + `DataLayerRegistryLookup` + optional `AgentId` from Stage 1.

**Process (per hypothesis):**
1. **`resolvable` gate.** If `resolvable(hypothesis.sharedPartial) === false`, short-circuit with "gap due to missing required facets." No registry lookup.
2. **Subsumption filter.** `allVariables.filter(v => subsumes(hypothesis.sharedPartial, variableToPartial(v)))`. Returns candidates whose facets are compatible with the hypothesis.
3. **Agent narrowing.** If `candidates.length > 1` AND `agentId !== null`:
   - Look up `variablesByAgentId = datasetIdsByAgentId(agentId) flatMap variableIdsByDatasetId`
   - Filter candidates to `v => variablesByAgentId.has(v.id)`
   - If narrowing produces **zero** candidates: short-circuit with "gap due to agent-scope-empty" (carrying both the Agent reference and the pre-narrowing candidates for LLM visibility).
4. **Score** surviving candidates: compute `VariableCandidateScore` per the research TS (in `scoring-segmentation-feedback.md` §1).
5. **Sort** by `matched.length desc`, tie-break by `variable.label.localeCompare`.
6. **Per-item binding** (for factored hypotheses): run steps 1–5 for each item's combined partial (`sharedPartial ⊕ item.partial`). Each item independently produces a bound result or a gap.

**Output:** `BoundHypothesis[]` — each carries the original hypothesis plus either a ranked candidate list, a gap reason, or a per-item mix.

### AssembleOutcome — bound candidates to one ResolutionOutcome per bundle

The outcome decision table, applied per bundle:

| Interpret/Bind result | Outcome tag | Gap payload |
|---|---|---|
| Interpret raised required-facet conflict | `Conflicted` | `hypotheses[]` (candidates for each side) + one `gap` per conflict branch |
| `resolvable(partial) === false` | `Underspecified` | one gap: `{partial, missingRequired, candidates: [variables that would match if missing facets were filled]}` |
| `candidates.length === 0` AND `resolvable(partial) === true` | `OutOfRegistry` | one gap: `{partial, candidates: [], nearestMisses: [top K by mismatched.length asc]}` |
| `candidates.length === 0` AND `resolvable(partial) === false` | `NoMatch` | `{reason}` — terminal |
| `candidates.length === 1` | `Resolved` | `items: [{_tag: "bound", variableId, partial}]`, all items bound |
| `candidates.length > 1` → Agent narrowing → 1 | `Resolved` | same shape, tier downgraded if narrowing was decisive |
| `candidates.length > 1` → Agent narrowing → 0 | `OutOfRegistry` | gap with pre-narrowing candidates + Agent reference + reason `"agent-scope-empty"` |
| `candidates.length > 1` → Agent narrowing → still > 1 (or no Agent) | `Ambiguous` | `hypotheses[]` preserved + `candidates[]` ranked |
| Factored hypothesis: all items bind | `Resolved` | `items[]` all `_tag: "bound"` |
| Factored hypothesis: mixed — some bind, some don't | `Ambiguous` | `items[]` heterogeneous: mix of `_tag: "bound"` and `_tag: "gap"` items |
| Factored hypothesis: no items bind | `OutOfRegistry` or `NoMatch` | bundle-level outcome (per the single-topic rule, applied to the shared partial) |

**Pure function.** No effect, no lookup. Consumes `BoundHypothesis[]`, returns `ResolutionOutcome`.

---

## Contract changes

### `BoundResolutionItem` becomes a tagged union

**Current** (shipped):

```ts
const BoundResolutionItem = Schema.Struct({
  itemKey: Schema.String,
  variableId: VariableId,
  partial: PartialVariableShape
});
```

**New:**

```ts
const BoundItem = Schema.TaggedStruct("bound", {
  itemKey: Schema.String,
  variableId: VariableId,
  partial: PartialVariableShape
});

const GapItem = Schema.TaggedStruct("gap", {
  itemKey: Schema.String,
  partial: PartialVariableShape,
  candidates: Schema.Array(VariableCandidateScore),  // pre-narrowing or nearest-miss
  reason: Schema.Literals([
    "agent-scope-empty",
    "no-candidates",
    "ambiguous-candidates",
    "underspecified"
  ])
});

export const BoundResolutionItem = Schema.Union([BoundItem, GapItem]);
```

**Test fallout:** `tests/resolution-kernel-domain.test.ts` snapshots need `_tag: "bound"` added to each item. Small refactor.

### `ResolutionGap` (new domain schema)

Reuse the research's shape verbatim (`scoring-segmentation-feedback.md` §4). Add it as a new file or co-locate in `resolutionKernel.ts`:

```ts
export const ResolutionGap = Schema.Struct({
  partial: PartialVariableShape,
  missingRequired: Schema.optionalKey(Schema.Array(RequiredFacetKey)),
  candidates: Schema.Array(VariableCandidateScore),
  reason: Schema.Literals([
    "missing-required",
    "no-candidates",
    "agent-scope-empty",
    "ambiguous-candidates",
    "required-facet-conflict"
  ]),
  context: Schema.optionalKey(Schema.Struct({
    agentId: Schema.optionalKey(AgentId),
    attachedContext: Schema.optionalKey(AttachedContext)
  }))
});
```

### Outcome variant payloads gain `gap`/`gaps`

| Variant | Before | After |
|---|---|---|
| `Resolved` | `items: BoundResolutionItem[]` | same shape, `items` is the tagged-union version (all `_tag: "bound"` by contract) |
| `Ambiguous` | `hypotheses`, `confidence`, `tier` | add `gaps: Schema.Array(ResolutionGap)` (one per surviving hypothesis) |
| `Underspecified` | `partial`, `missingRequired` | add `gap: ResolutionGap` (single) |
| `Conflicted` | `hypotheses`, `conflicts` | add `gaps: Schema.Array(ResolutionGap)` (one per conflict branch) |
| `OutOfRegistry` | `hypothesis` (singular), `items` | add `gap: ResolutionGap` (single, with nearest-miss candidates) |
| `NoMatch` | `reason` | unchanged |

---

## Implementation slices

**Ship as one atomic PR**, but organize the work internally so each slice leaves the kernel in a working state. Each slice ends with `bun run typecheck` + focused tests green before the next slice begins.

### Slice 1 — Minimum viable single-topic kernel

**Files created:**
- `src/resolution/kernel/Interpret.ts`
- `src/resolution/kernel/Bind.ts`
- `src/resolution/kernel/AssembleOutcome.ts`
- `src/resolution/kernel/ResolutionKernel.ts` (entry point: `resolveBundle(bundle, lookup) → ResolutionOutcome`)
- `tests/resolution-kernel.test.ts`

**Scope:**
- Interpret handles a single hypothesis per bundle via projection-then-join — no Cartesian decomposition, no multi-topic
- Bind has `resolvable` gate + subsumption filter + `subsumptionRatio` scoring — **no Agent narrowing**
- AssembleOutcome's decision table covers only four tags: `Resolved`, `Underspecified`, `OutOfRegistry`, `NoMatch`. `Ambiguous` and `Conflicted` are placeholders that throw "not-yet-implemented" errors (and no fixtures hit them yet)
- `BoundResolutionItem` stays as the shipped shape; no tagged union yet

**Fixtures (minimum 3):**
1. One chart that resolves cleanly as `Resolved` with `tier: "entailment"` — e.g., an EU generation chart whose series label + title + unit all agree
2. One chart that fails as `Underspecified` — e.g., a chart with a clear `technologyOrFuel` but no `measuredProperty`
3. One chart that fails as `OutOfRegistry` — e.g., a `resolvable` partial whose facets don't match any Variable in the cold-start registry

**Acceptance criteria:**
- `bun run typecheck` green
- `bun run test tests/resolution-kernel.test.ts` green
- Single-topic kernel produces `Resolved` outcomes for at least one real chart from the cold-start dataset
- No changes to `Stage2.ts` or the legacy Stage 2 eval tests

### Slice 2 — Multi-topic Cartesian factoring

**Files modified:**
- `src/resolution/kernel/Interpret.ts` — gains `matchAllTechnologyOrFuel` + Cartesian decomposition
- `src/resolution/kernel/AssembleOutcome.ts` — handles factored hypotheses
- `src/domain/resolutionKernel.ts` — `BoundResolutionItem` becomes tagged union (`BoundItem | GapItem`)
- `tests/resolution-kernel-domain.test.ts` — snapshot fixtures updated with `_tag: "bound"` on items

**Files created:**
- Additional fixtures in `tests/resolution-kernel.test.ts` for multi-series charts

**Scope:**
- Cartesian on `technologyOrFuel` only (other facets stay in shared partial)
- `BoundResolutionItem` tagged union so `items[]` can carry mixed states
- Factored hypotheses produce `Resolved` when all items bind, or flow to slice 4 behavior when mixed (in slice 2, mixed items can still throw "not-yet-implemented" until slice 4)

**Acceptance criteria:**
- Multi-series chart produces `Resolved` outcome with N items (one per technology)
- Fixture: chart with `["Wind", "Solar", "Hydro"]` series labels resolves to three bound items
- Existing single-topic fixtures still pass unchanged

### Slice 3 — Agent narrowing

**Files modified:**
- `src/resolution/dataLayerRegistry.ts` — new inverse index `datasetIdsByAgentId: Map<AgentId, Set<DatasetId>>` built at registry load time
- `src/resolution/dataLayerRegistry.ts` — new lookup `findVariablesByAgentId(agentId): Chunk<VariableId>` composing `datasetIdsByAgentId` with the existing `variablesByDatasetId`
- `src/resolution/kernel/Bind.ts` — Agent narrowing filter step between subsumption and scoring
- `src/resolution/kernel/AssembleOutcome.ts` — `"agent-scope-empty"` → `OutOfRegistry` rule

**Files created:**
- Fixture exercising publisher-specific narrowing (e.g., two Variables match on facets, only one is published by the resolved Agent)
- Fixture for the `"agent-scope-empty"` path (Agent present, facet candidates exist, but Agent publishes none of them)

**Scope:**
- Single-hop Agent walks only (no `parentAgentId` traversal)
- `ProviderId → AgentId` bridge must be resolved here. **Implementation detail to decide during slice:** either ProviderReference gains an `agentId` field, or `DataLayerRegistryLookup` gains a lookup table. Document the decision inline in the slice's commit.

**Acceptance criteria:**
- Fixture: two Variables subsume the partial, Agent narrowing picks one → `Resolved`
- Fixture: two Variables subsume the partial, no Agent → `Ambiguous` (depends on slice 4 for full outcome)
- Fixture: Agent present, narrowing → 0 → `OutOfRegistry` with pre-narrowing candidates preserved
- Registry load time for the cold-start dataset is within 10% of current baseline (index construction cost)

### Slice 4 — Preservation completeness + hard cutover

**Kernel preservation work (files modified):**
- `src/domain/resolutionKernel.ts` — add `ResolutionGap` schema, add `gap`/`gaps` fields to non-`Resolved` outcome variants
- `src/resolution/kernel/Bind.ts` — populate `nearestMisses` (top K candidates sorted by `mismatched.length` ascending, per research `scoring-segmentation-feedback.md` §1)
- `src/resolution/kernel/AssembleOutcome.ts` — full outcome decision table including mixed multi-topic case (`Ambiguous` with heterogeneous items); full `Ambiguous` and `Conflicted` outcome construction
- `tests/resolution-kernel-domain.test.ts` — snapshot fixtures updated for new gap payloads

**Hard cutover — resolver boundary rewiring (files modified):**

The live Stage 2 path runs through `src/resolver/`, not the worker. The worker (`src/worker/filter.ts`) is just request routing and does not call Stage 2 directly. The real rewiring targets are:

- `src/resolver/ResolverService.ts:95-228` — replace the `stage2Resolver = yield* Stage2Resolver` dependency with a kernel service, replace the `stage2Resolver.resolve(stage1Input.postContext, stage1)` call site with a kernel invocation, and update the response shape (`{stage1, stage2, stage3, ...}` → `{stage1, kernel, stage3, ...}`). Note the current code also uses `stage2.escalations` to drive stage 3 dispatch — decide whether the kernel surfaces its own "escalation-worthy outcome" signal (e.g., `Ambiguous` / `Underspecified`) as the replacement trigger, or whether stage 3 dispatch is dropped entirely along with Stage 2 (since stage 3's role was tied to the gate-era escalation model).
- `src/resolver/Layer.ts` — swap the `Stage2Resolver` layer binding for the new kernel service binding
- `src/resolver/Client.ts` — update the response decoder to the new `ResolvePostResponse` shape
- `src/domain/resolution.ts:35-43` — in `ResolvePostResponse`, replace `stage2: Schema.optionalKey(Stage2Result)` with `kernel: Schema.Array(ResolutionOutcome)` (name TBD during implementation); remove the `Stage2Result` import; update `ResolveLatencyMs` to use `kernel` instead of `stage2`
- `src/domain/resolution.ts:58-64` — if stage 3 dispatch survives the cutover, move `Stage3Input` / `DataRefResolverRunParams` off the deleted `stage2*` modules and into a kernel- or workflow-owned schema module; if stage 3 dispatch is dropped, delete the now-dead workflow params surface entirely
- `src/enrichment/EnrichmentRunWorkflow.ts:435-460` — update the `DataRefResolutionEnrichment` decode/persist block that currently forwards `stage2` from the resolver response into enrichment storage. Either forward `kernel` instead, or change the enrichment schema entirely (depends on the `src/domain/enrichment.ts` change below)
- `src/domain/enrichment.ts:~286` — replace the `Stage2Result`-carrying variant of `DataRefResolutionEnrichment` with a variant that stores `ResolutionOutcome[]`
- `src/resolver-worker/DataRefResolverWorkflow.ts:7-49` — if stage 3 dispatch survives, re-point the workflow decode path to the new run-params schema; if stage 3 dispatch is dropped, delete or retire the dead workflow handoff path
- `src/platform/Env.ts:4-47` — update the `RESOLVER_RUN_WORKFLOW` binding type to match the new workflow params shape or remove it if stage 3 dispatch goes away
- `tests/resolution-boundary.test.ts:46` — update the HTTP boundary assertion for the new response shape
- `tests/resolution-boundary.test.ts:20` — update or remove the workflow-params boundary assertion depending on whether stage 3 dispatch survives the cutover
- `tests/resolver-client.test.ts:20` — update client decoder expectations
- `tests/resolver-service.test.ts` — update the service unit tests to expect the new response shape and the kernel dependency (currently tests `stage2.escalations` flow)
- `tests/enrichment-run-workflow.test.ts:395` — update the workflow integration test that currently decodes the `stage2` forwarding path

**Stage 1 handoff rewiring (files modified, not deleted):**

These files are legitimately Stage 1 code (deterministic upstream resolver) but reference Stage 2 at handoff boundaries. After the cutover, their "pass to Stage 2" semantics become "pass to the kernel." Expected touches:

- `src/resolution/Stage1.ts:46, 105-186, 215-241` — rename handoff types and functions, drop any `Stage2*` symbol imports, rewire residual flow to the kernel
- `src/domain/stage1Residual.ts:~61` — the residual type currently references the Stage 2 handoff; rename/adjust so it describes "unresolved items passed downstream" without mentioning Stage 2
- `src/domain/stage1EvalBuild.ts:~4` — drop Stage 2 eval-build references
- `tests/stage1-kernel.test.ts:~206` — drop Stage 2 assertions from the Stage 1 kernel tests
- `src/domain/matchEvidence.ts` — remove the Stage 2 evidence union branch or replace it with the kernel-era evidence schema so Stage 1 match contracts no longer import from deleted `stage2*` files
- `src/domain/errors.ts` — remove the `Stage2Lane` dependency from `FacetDecompositionError` or replace it with a kernel-era lane/schema so the error module does not import from deleted `stage2*` files

**Files deleted (hard cutover) — authoritative list:**

Source:
- `src/resolution/Stage2.ts`
- `src/resolution/Stage2Resolver.ts`
- `src/domain/stage2Core.ts`
- `src/domain/stage2Evidence.ts`
- `src/domain/stage2Lane.ts`
- `src/domain/stage2Resolution.ts`
- `src/domain/stage2Result.ts`

Tests:
- `tests/stage2-resolution.test.ts`
- `tests/stage2-eval.test.ts`
- `tests/stage2-kernel.test.ts`
- `tests/stage2-errors.test.ts`

Eval artifacts:
- `eval/resolution-stage2/` (entire directory)

This list was enumerated from `git ls-files | grep -i stage2` on 2026-04-12. If the tree gains more `stage2*` files before implementation starts, re-run that command and add them to this list.

**Discovery step during implementation:**

Before starting the deletions, run the following commands to confirm the current tree matches the assumptions above:

```bash
git ls-files 'src/**' 'tests/**' | grep -i stage2         # file inventory (expected: the list above)
git grep -l 'Stage2Resolver\|Stage2Result\|Stage2Core\|Stage2Evidence\|Stage2Lane' -- src tests  # symbol usage
```

The first command's output becomes the deletion list. The second command's output becomes the rewiring list (anything not in the first list is a non-deleted file that still needs its Stage 2 references cleaned up).

**Scope:**
- Full preservation-first outcome shapes
- Mixed multi-topic items (bound + gap items in one outcome)
- Nearest-miss candidate ranking in gaps
- Remove the "not-yet-implemented" placeholders from slice 1 — all six outcome tags fully constructible
- **Hard cutover**: delete every file matching `*stage2*` across `src/` and `tests/`, rewire production call sites to the new kernel, update enrichment record format

**Acceptance criteria:**
- Every non-`Resolved` outcome variant's `gap`/`gaps` round-trips through `Schema.decode` + `Schema.encode` via the domain test snapshots
- Fixture: mixed multi-topic chart (e.g., wind + solar bind, hydro doesn't) produces `Ambiguous` with heterogeneous `items[]`
- Fixture: two-rival chart with no Agent → `Ambiguous` with `candidates[]` ranked
- Fixture: required-facet conflict → `Conflicted` with `gaps[]` one per branch
- None of the 11 `*stage2*` files enumerated above still exist in `src/` or `tests/`
- `git grep -l 'Stage2Resolver\|Stage2Result\|Stage2Core\|Stage2Evidence\|Stage2Lane\|stage2Resolution' -- src tests` returns zero matches
- If stage 3 dispatch survives: `src/domain/resolution.ts`, `src/resolver-worker/DataRefResolverWorkflow.ts`, `src/platform/Env.ts`, and `tests/resolution-boundary.test.ts` all compile and pass against the new workflow params shape; if stage 3 dispatch is dropped: those surfaces are removed or no longer reference the old Stage 2 workflow contract
- `bun run typecheck` still green after all Stage 2 files are deleted and call sites rewired — this is the load-bearing signal that the rewiring is complete
- `bun run test` still green with no `*stage2*` test files in the tree
- The worker pipeline produces `ResolutionOutcome[]` enrichment records end-to-end against a real staging post

---

## File inventory

| File | Action | Purpose |
|---|---|---|
| `src/resolution/kernel/Interpret.ts` | Create | Bundle → hypotheses projection-then-join + Cartesian factoring |
| `src/resolution/kernel/Bind.ts` | Create | Hypotheses → bound candidates via resolvable/subsumes/Agent/score |
| `src/resolution/kernel/AssembleOutcome.ts` | Create | Pure outcome decision table |
| `src/resolution/kernel/ResolutionKernel.ts` | Create | Thin entry point wrapping the three stages |
| `src/domain/resolutionKernel.ts` | Modify | Add `ResolutionGap`, update `BoundResolutionItem` to tagged union, add `gap`/`gaps` to non-`Resolved` variants |
| `src/domain/partialVariableAlgebra.ts` | Modify | Add `VariableCandidateScore` + pure scoring helpers (move from research TS) |
| `src/resolution/dataLayerRegistry.ts` | Modify | Add `datasetIdsByAgentId` index + `findVariablesByAgentId` lookup |
| `tests/resolution-kernel.test.ts` | Create | End-to-end fixture tests for the four slices |
| `tests/resolution-kernel-domain.test.ts` | Modify | Update snapshots for tagged-union items + new gap payloads |
| `tests/partialVariableAlgebra.test.ts` | Modify | Unit tests for `VariableCandidateScore` if moved into algebra module |
| `src/resolution/Stage2.ts` | **Delete** | Gate-era resolver entry (slice 4) |
| `src/resolution/Stage2Resolver.ts` | **Delete** | Gate-era resolver service (slice 4) |
| `src/domain/stage2Core.ts` | **Delete** | Stage 2 shape definitions (slice 4) |
| `src/domain/stage2Evidence.ts` | **Delete** | Stage 2 evidence types (slice 4) |
| `src/domain/stage2Lane.ts` | **Delete** | Stage 2 lane types (slice 4) |
| `src/domain/stage2Resolution.ts` | **Delete** | Stage 2 resolution types (slice 4) |
| `src/domain/stage2Result.ts` | **Delete** | Stage 2 result type (slice 4) |
| `tests/stage2-resolution.test.ts` | **Delete** | Stage 2 resolver tests, superseded (slice 4) |
| `tests/stage2-eval.test.ts` | **Delete** | Legacy gate-era eval harness (slice 4) |
| `tests/stage2-kernel.test.ts` | **Delete** | Stage 2 kernel tests (slice 4) |
| `tests/stage2-errors.test.ts` | **Delete** | Stage 2 error tests (slice 4) |
| `eval/resolution-stage2/` | **Delete** | Legacy eval outputs (slice 4) |
| `src/resolver/ResolverService.ts` | **Modify** | Swap `Stage2Resolver` dependency and `stage2Resolver.resolve` call site for the new kernel (slice 4) |
| `src/resolver/Layer.ts` | **Modify** | Swap `Stage2Resolver` layer binding for the kernel service binding (slice 4) |
| `src/resolver/Client.ts` | **Modify** | Update response decoder to the new `ResolvePostResponse` shape (slice 4) |
| `src/domain/resolution.ts` | **Modify** | Replace `stage2: Stage2Result` field in `ResolvePostResponse` with `kernel: ResolutionOutcome[]` (slice 4) |
| `src/domain/enrichment.ts` | **Modify** | Replace `Stage2Result`-carrying variant of `DataRefResolutionEnrichment` with `ResolutionOutcome[]` (slice 4) |
| `src/enrichment/EnrichmentRunWorkflow.ts` | **Modify** | Update the enrichment write path to forward the kernel result shape and align any remaining stage 3 handoff behavior (slice 4) |
| `src/resolver-worker/DataRefResolverWorkflow.ts` | **Modify/Delete** | Align the workflow run-params decoder with the post-cutover stage 3 decision, or remove the dead workflow path if dispatch is dropped (slice 4) |
| `src/platform/Env.ts` | **Modify** | Align `RESOLVER_RUN_WORKFLOW` binding type with the post-cutover workflow params shape, or remove it if dispatch is dropped (slice 4) |
| `src/resolution/Stage1.ts` | **Modify** | Rewire Stage 1 handoff: drop `Stage2*` imports and references, rewire residual flow to the kernel (slice 4) |
| `src/domain/stage1Residual.ts` | **Modify** | Rename/reshape so the residual type no longer mentions Stage 2 (slice 4) |
| `src/domain/matchEvidence.ts` | **Modify** | Remove/replace the Stage 2 evidence union branch so Stage 1 match contracts stop importing deleted `stage2*` files (slice 4) |
| `src/domain/errors.ts` | **Modify** | Remove/replace the `Stage2Lane` dependency so the error module stops importing deleted `stage2*` files (slice 4) |
| `src/domain/stage1EvalBuild.ts` | **Modify** | Drop Stage 2 eval-build references (slice 4) |
| `tests/stage1-kernel.test.ts` | **Modify** | Drop Stage 2 assertions from Stage 1 kernel tests (slice 4) |
| `tests/resolution-boundary.test.ts` | **Modify** | Update the workflow-params and HTTP boundary assertions for the post-cutover resolver/stage 3 shape (slice 4) |
| `tests/resolver-client.test.ts` | **Modify** | Update client decoder expectations (slice 4) |
| `tests/resolver-service.test.ts` | **Modify** | Update service unit tests to expect kernel dependency and new response shape (slice 4) |
| `tests/enrichment-run-workflow.test.ts` | **Modify** | Update workflow integration test that currently decodes `stage2` forwarding path (slice 4) |

---

## Testing approach

- **Inline vitest cases** in `tests/resolution-kernel.test.ts`. No separate harness infrastructure. Matches "make it light" — each test is a hand-authored `(Stage1Input → expected ResolutionOutcome)` case, constructed via builders that round-trip through `Schema.decode`.
- **Adapt one fixture per worked trace** from `ontology_skill/docs/research/2026-04-12-resolution-trace-examples.md` (five examples). These become regression fixtures: if the kernel's behavior drifts from the research reasoning, the test fails.
- **No full eval harness this PR.** The Phase 6 `eval/resolution-kernel/` runner from the original plan is a follow-up ticket after the kernel lands.
- **Property laws unchanged.** The Phase 1 property suite in `tests/partialVariableAlgebra.property.test.ts` stays green throughout.
- **Phase 1 unit tests unchanged.** All existing `tests/partialVariableAlgebra.test.ts` and `tests/resolution-kernel-domain.test.ts` cases continue passing; the only modifications are to snapshots that pick up the tagged-union item shape in slice 2 and the gap payloads in slice 4.

---

## Open design surface to resolve during implementation

These are **real unknowns** that the coding pass will have to answer. Not design decisions — just flagged so they don't become surprises:

1. **`Conflicted` outcome: `hypotheses[]` vs `gaps[]` duplication.** The shipped `Conflicted` already carries `hypotheses[]`. The new gap payload also carries per-branch partial + candidates. Decide at implementation time whether to keep both, or fold `hypotheses[]` into `gaps[i].context`.
2. **`Ambiguous` vs `OutOfRegistry` candidate shape.** Both variants carry "candidates that almost matched." Decide whether they share a common ranked-candidate sub-schema (cleaner, more reusable) or each have their own shape.
3. **`datasetIdsByAgentId` eager vs lazy construction.** Build at registry load time (adds to startup cost, simplifies the lookup) or construct lazily on first use (deferred cost, complicates cache invalidation). Default assumption: eager. Revisit if registry load time regresses.
4. **`ProviderId → AgentId` bridge.** Stage 1's `SourceAttributionMatchResult.provider: ProviderReference` and the data-layer `Agent` are related but not the same namespace. Either add `agentId` to `ProviderReference`, or add a `resolveProviderAgent(providerId): Option<AgentId>` method to `DataLayerRegistryLookup`. Decide during slice 3.

---

## Out of scope for this PR

Explicitly deferred, will become follow-up tickets:

- **CompoundSurfaceForm runtime support** — Phase 2 work from the original plan, demoted to "triggered by concrete need." Add when a specific phrase fails projection-then-join.
- **Multi-hop Agent walks** via `parentAgentId` — single-hop only in v1.
- **LLM feedback loop** — SKY-315 territory. This PR only *emits* gaps for the loop to consume.
- **Full eval harness** — Phase 6 of the original plan. Fixture-driven runner in `eval/resolution-kernel/` is a follow-up ticket.
- **Text segmentation specifics** for post-text (vocabulary-aware conjunction splitting) — research says this is open. Ship a naive version (simple delimiter split) and iterate.
- **Multilingual surface forms** — research explicitly defers.
- **Topic-mention vs statistical-mention disambiguation** — research Cross-Cutting item 3, deferred.

---

## Deleted scope

As part of this PR (hard cutover, slice 4), delete:

**Source files (7):**
- `src/resolution/Stage2.ts`
- `src/resolution/Stage2Resolver.ts`
- `src/domain/stage2Core.ts`
- `src/domain/stage2Evidence.ts`
- `src/domain/stage2Lane.ts`
- `src/domain/stage2Resolution.ts`
- `src/domain/stage2Result.ts`

**Test files (4):**
- `tests/stage2-resolution.test.ts`
- `tests/stage2-eval.test.ts` (544 lines)
- `tests/stage2-kernel.test.ts`
- `tests/stage2-errors.test.ts`

**Eval artifacts:**
- `eval/resolution-stage2/` (entire directory, including `runs/`)

This list is enumerated from `git ls-files | grep -i stage2` on 2026-04-12 and is authoritative; the slice 4 discovery step re-runs the command to catch any drift before implementation begins.

Do **not** delete:
- `src/resolution/facetVocabulary/` and `src/resolution/facetVocabulary/normalize.ts` (reused by the new kernel)
- `src/resolution/dataLayerRegistry.ts` (modified, not deleted)
- `src/resolution/Stage1.ts` (Stage 1 is the deterministic upstream resolver; it stays but its Stage 2 handoff references get rewired)
- `src/domain/stage1Resolution.ts`, `src/domain/stage1Residual.ts`, `src/domain/stage1Match.ts`, `src/domain/stage1Evidence.ts`, `src/domain/stage1Shared.ts`, `src/domain/stage1EvalBuild.ts` (Stage 1 infrastructure, modified not deleted)
- `tests/stage1-kernel.test.ts`, `tests/stage1-*.test.ts` (Stage 1 tests stay; stage2 references within them get cleaned)
- `eval/resolution-stage1/`, `eval/source-attribution/`, `eval/vision/` (unrelated evals)

---

## Algebraic invariants preserved

All Phase 1 property laws must still hold after this PR:

- `joinPartials` commutativity, associativity, bottom-identity
- `subsumes` reflexivity, transitivity
- `specificity` monotonicity under successful join
- Successful join is subsumed by both inputs
- `subsumes ⇒ mismatched.length === 0`
- `subsumes ⇒ specificity(a) ≤ specificity(b)`
- Conflict-path order-invariance (from slice 1 of #96)
- `matched covers general ∧ mismatched=∅ ⇒ subsumes`

---

## Acceptance criteria (whole PR)

- [ ] `bun run typecheck` green (all three tsconfig roots)
- [ ] `bun run test` green — new `resolution-kernel.test.ts` passes, no `*stage2*` test files remain
- [ ] `bun run sync:energy-profile` + `bun run gen:energy-profile` unchanged (no profile drift)
- [ ] At least 5 hand-authored end-to-end fixtures in `tests/resolution-kernel.test.ts`, covering:
  - one `Resolved` (single-topic, `tier: "entailment"`)
  - one `Resolved` (multi-topic factored, all items bound)
  - one `Ambiguous` (multi-topic mixed, heterogeneous items)
  - one `Underspecified` (gap with `missingRequired`)
  - one `OutOfRegistry` (`agent-scope-empty`)
- [ ] At least 1 fixture adapted from `ontology_skill/docs/research/2026-04-12-resolution-trace-examples.md` as a regression fence
- [ ] **Hard cutover — file deletions**: none of the 11 `*stage2*` files enumerated in the deleted scope list exist in `src/` or `tests/` after the slice
- [ ] **Hard cutover — symbol removal**: `git grep -l 'Stage2Resolver\|Stage2Result\|Stage2Core\|Stage2Evidence\|Stage2Lane\|stage2Resolution' -- src tests` returns zero matches (narrower than substring "stage2" to avoid false positives on legitimate Stage 1 `stage2` handoff references that have been rewired)
- [ ] **Production call sites rewired**: `src/resolver/ResolverService.ts` no longer imports `Stage2Resolver`; `src/resolver/Layer.ts` no longer binds it; `src/resolver/Client.ts`, `tests/resolution-boundary.test.ts`, `tests/resolver-client.test.ts`, `tests/resolver-service.test.ts`, and `tests/enrichment-run-workflow.test.ts` all pass against the new response shape
- [ ] **Public contract migrated**: `src/domain/resolution.ts` exports a `ResolvePostResponse` that carries `kernel: ResolutionOutcome[]` (or whatever name is chosen) in place of `stage2: Stage2Result`
- [ ] **Enrichment schema migrated**: `src/domain/enrichment.ts` no longer exports or references `Stage2Result`; `src/enrichment/EnrichmentRunWorkflow.ts` writes the new enrichment shape
- [ ] **Stage 1 handoff cleaned**: `src/resolution/Stage1.ts`, `src/domain/stage1Residual.ts`, `src/domain/stage1EvalBuild.ts`, and `tests/stage1-kernel.test.ts` no longer contain `Stage2*` symbol references (either renamed, rewired to the kernel, or removed)
- [ ] **End-to-end staging verification**: the worker pipeline produces a valid `ResolutionOutcome[]`-carrying enrichment record for a real staging post
- [ ] Phase 1 property laws still green

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `ProviderId → AgentId` bridge turns out to be harder than expected (e.g., multiple Agents per Provider) | Flag at slice 3 start; if non-trivial, deliver slice 3 with a simpler "first Agent wins" heuristic and document the limitation |
| Cold-start registry doesn't have enough Variables to produce interesting `Resolved` fixtures | Slice 1 fixtures use the actual cold-start dataset; if coverage is too thin, add Variables to the cold-start corpus *in a separate PR first* (do not grow cold-start in this PR) |
| Agent narrowing index construction balloons registry load time | Eager-build benchmark during slice 3; fall back to lazy construction if over 10% regression |
| Adding `gap`/`gaps` to outcome variants breaks existing `Match.valueTags` exhaustiveness | Phase 1's `resolution-kernel-domain.test.ts` already exhaustively matches on all six variants; extending payloads doesn't change the tag union, so the test should still pass with minor snapshot updates |
| Research advisories drift from this plan during implementation | Plan is compiled 2026-04-12; if the advisories change, re-sync the relevant "Locked decisions" section before shipping |
| The kernel produces correct outcomes but the cold-start vocabulary's canonicals are too narrow to match real chart labels | This is a vocabulary problem, not a kernel problem. Out of scope for this PR; file a follow-up ticket if fixtures surface it |
| **Hard cutover surfaces unexpected Stage 2 callers** | The slice 4 discovery step runs `git ls-files \| grep -i stage2` (file inventory) AND `git grep -l 'Stage2Resolver\|Stage2Result\|Stage2Core\|Stage2Evidence\|Stage2Lane'` (symbol usage) to enumerate the full rewire surface. `bun run typecheck` is the load-bearing signal — any caller that still references a deleted Stage 2 symbol fails typecheck. Don't ship until typecheck is clean. |
| **Existing production enrichment records become unreadable after deploy** | Accepted by design. Staging smoke test in slice 4 verifies fresh posts get the new enrichment format. Any stale `Stage2Result` rows in staging D1 will not decode — re-enrich or delete them. |
| **Enrichment record format change breaks the curation/review UI** | Slice 4 includes a search for every consumer of the old enrichment shape. If any UI or curation flow reads `Stage2Result`, it also gets rewired. Discovery via `git grep -il stage2result -- src`. |
| **A file matches `*stage2*` but shouldn't be deleted** (e.g., false-positive grep hit) | Slice 4 discovery step is manual review of the grep output, not blind deletion. The plan doc's deletion list is the expected minimum; anything additional requires a judgment call. |

---

## Revision history

- **2026-04-12**: Drafted from design interview after research-doc synthesis. Compiles decisions from Phase 1 foundation + five research advisories + live design session.
