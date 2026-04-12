# SKY-239 Slice 2d — Stage 2 Facet Decomposition Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Ship the Stage 2 structured facet decomposition resolver — a pure Effect-native kernel that extends Stage 1's output with facet-decoded Variable candidates, fuzzy dataset/agent matches, and a locked `Stage3Input` escalation contract, backed by data-driven vocabulary tables populated from energy/units ontologies.

**Architecture:** Stage 2 follows the Stage 1 pattern: a pure function (`runStage2`) dispatching over `Stage1Residual` via `Match.valueTags`, reading from an in-memory `FacetVocabulary` service and an external ontology-derived set of `SurfaceFormEntry<Canonical>` tables. Each of the four Stage-2-attacked facets (`statisticType`, `aggregation`, `unitFamily`, `technologyOrFuel`) plus `frequency` ships as a typed JSON file under `references/vocabulary/`, decoded via Effect Schema at registry build time. Populator pipeline uses `Schema.transformOrFail` to convert OEO/UCUM/IEA inputs into `SurfaceFormEntry` rows. A new `Stage2Evidence` union is additively merged into the existing Stage 1 match structs, and escalations leave as fully-projected `Stage3Input` records designed for LLM prompt projection.

**Tech Stack:** Effect 4 (`Schema`, `Effect.gen`, `Option`, `Match.valueTags`, `Schema.transformOrFail`, `Schema.TaggedError`), Bun + `@effect/vitest`, Cloudflare Workers runtime, pure-function kernel pattern inherited from `src/resolution/Stage1.ts`.

---

## Provenance

- Ticket: SKY-239 (Slice 2d — Stage 2 Facet Decomposition)
- Design doc (canonical, read first): `docs/plans/2026-04-11-sky-239-stage-2-facet-decomposition-design-interview.md`
- Predecessor slice (Stage 1): `docs/plans/2026-04-09-sky-235-stage-1-deterministic-resolver-design-interview.md`
- Architecture parent: Linear — "Resolution flow architecture — locked decisions (April 9, 2026)"
- Ontology parent: Linear — "Data intelligence layer design session — locked decisions (April 8, 2026)"
- Locked decisions: SD-Q1..Q14 + H-S2-1 cooperation principle (`Stage 2 advises, Stage 3 decides`)

## Status

**Plan ready for execution.** All 14 SD-Q decisions locked. Stage 1 is shipped. Stage 3 (Slice 6 / SKY-240) is blocked on Stage 2's output contract produced by this plan.

## Review Refinements (2026-04-11 follow-up)

This plan was re-read against SKY-235, SKY-237, SKY-238, SKY-239, SKY-240, the April 8 / April 9 design docs, and the current resolver code before execution. The implementation shape remains sound, but four refinements are now part of the plan:

1. **Explicit series resolution is deferred in this slice.** Slice 2d should preserve the seam for `Series` and `fixedDims`, but it should not widen the shared match union or spend critical-path time on `SeriesMatch`.
2. **Shared evidence and match-contract code must live in a neutral module.** Do not make `stage1Resolution.ts` import `stage2Resolution.ts` and hope the runtime cycle works.
3. **Slice 2d owns the resolver boundary changes needed to make Stage 2 real.** Replacing the `Stage2Output` placeholder, persisting real `stage2` payloads, and queueing `Stage3Input[]` to the Workflow are in-scope here.
4. **Threshold tuning is blocked on harness validation.** Phase 5 may ship a comparative report without retuning thresholds, but it may not claim the thresholds are trustworthy until the harness semantics are validated.

---

## Non-Negotiable Constraints (applies to every task)

1. **Effect-native in `src/`.** No `async function`, no `try/catch`, no `new Promise`, no Node built-ins (`node:fs`, `node:path`, `node:crypto`, etc.). Use `Effect.gen` + `yield*`. Reference: `CLAUDE.md` §"Effect-Native Code".
2. **Schema-first.** Every new type lands in `src/domain/` (or a parameterized module under `src/resolution/facetVocabulary/` when it's a generic schema combinator, per SD-Q2). No inline schemas in services.
3. **`Schema.parseJson`, never manual `JSON.parse`.** Use helpers in `src/platform/Json.ts` where they exist.
4. **`Schema.TaggedError` for every failure.** Populator errors, vocabulary decode failures, ontology parse failures — all typed. No plain `Error`.
5. **Branded IDs.** Reuse `VariableId`, `DistributionId`, `DatasetId`, `AgentId` from `src/domain/data-layer/ids.ts`.
6. **Search before writing helpers.** Before adding any utility, grep `src/platform/`, `src/resolution/`, `src/services/d1/`. `normalizeLookupText` already exists in `src/resolution/normalize.ts` — reuse it.
7. **Test every public function.** `bun run test` uses `@effect/vitest`. Follow the shape in `tests/stage1-kernel.test.ts`.
8. **Scripts may touch Node.** `scripts/seed-vocabulary.ts` is the only Node-touching wrapper. Everything it calls into under `src/resolution/facetVocabulary/` must be pure Effect.
9. **H-S2-1 is load-bearing.** Every Stage 2 output that crosses the Stage 3 boundary must be inspectable — no opaque blobs, `notes` field required on `agent-curated` and `eval-feedback` provenance rows.
10. **Commit after each task.** Follow TDD: failing test → minimal implementation → passing test → commit.

---

## Phase Overview and Handoff Criteria

| Phase | Scope | Hand-off Criteria |
| --- | --- | --- |
| 1 | Domain schemas + Stage 1 contract integration | `src/domain/stage2Resolution.ts` exists, neutral shared match/evidence modules shipped, all new schemas decode round-trip in tests, `bun run typecheck` + `bun run test` green |
| 2 | Effect-native vocabulary populator | `scripts/seed-vocabulary.ts` emits all five `references/vocabulary/*.json` files, each decodes cleanly under the Phase 1 schemas, `references/external/` populated with source ontology snapshots |
| 3 | `FacetVocabulary` service + five parsers | `FacetVocabulary` Effect service ships, each `parse*` function returns `Option<Canonical>` and is covered by positive + negative tests, composable via `Layer.effect` |
| 4 | Stage 2 kernel + lane dispatch | `runStage2` pure function ships, every residual tag has a lane, resolver response / enrichment / Workflow boundaries carry real Stage 2 payloads, integration test shows Stage 1 + Stage 2 decomposing a real cold-start candidate |
| 5 | Eval harness extension | Stage 1 + Stage 2 eval report reproducible, validation gate for harness semantics complete, new miss buckets land, at least one post previously in `deferred-to-stage2` is upgraded in the report |

Each phase ends with: `bun run typecheck` clean, `bun run test` green, plan committed in small atomic commits.

---

## Phase 1 — Domain Schemas and Stage 1 Contract Integration

**Goal of phase:** Lock the type shapes Stage 2 will produce so the kernel, the vocabulary modules, and the eval harness all compile against the same contract. No runtime logic yet.

### Task 2d-1.1 — Create `SurfaceFormEntry<Canonical>` parameterized schema

**SD-Q2.** `SurfaceFormEntry` is the single canonical row shape reused by every facet vocabulary.

**Files:**
- Create: `src/resolution/facetVocabulary/SurfaceFormEntry.ts`
- Test: `tests/facet-vocabulary-surface-form-entry.test.ts`

**Dependencies:** none.

**Step 1 — Failing test.** Write a vitest test that:
- Decodes a `SurfaceFormEntry<StatisticType>`-shaped JSON blob with `provenance: "cold-start-corpus"` and no `notes`.
- Decodes one with `provenance: "agent-curated"` and a `notes` field.
- Expects decode failure when `provenance: "agent-curated"` has no `notes` (schema-level enforcement per SD-Q2 §6).
- Expects decode failure when `provenance: "eval-feedback"` has no `notes`.

**Step 2 — Run** `bun run test tests/facet-vocabulary-surface-form-entry.test.ts` — expect FAIL.

**Step 3 — Implement.**
- Export a factory `makeSurfaceFormEntry<Canonical>(canonical: Schema.Schema<Canonical, string>)` returning a `Schema.Struct` with fields `surfaceForm`, `normalizedSurfaceForm`, `canonical`, `provenance`, `notes` (optional), `addedAt`, `source` (optional).
- Provenance literal union: `Schema.Literals(["cold-start-corpus","hand-curated","oeo-derived","ucum-derived","agent-curated","eval-feedback"])`.
- Enforce the notes-required constraint via `Schema.filter` or `Schema.refine` at the struct level: if `provenance ∈ {agent-curated, eval-feedback}`, `notes` must be non-empty string.
- Export a small `buildVocabularyIndex<Canonical>(entries): ReadonlyMap<string /* normalizedSurfaceForm */, Canonical>` helper.

**Acceptance criteria:**
- `makeSurfaceFormEntry` exists with the above signature.
- All four test cases pass.
- `buildVocabularyIndex` rejects duplicate `normalizedSurfaceForm` keys with different `canonical` values (collision is a typed error — see Task 2d-1.7 for the error module).

**Notes:** This module is under `src/resolution/` not `src/domain/` because it's a generic schema combinator parameterized by the canonical type. The per-facet Effect Schema specializations live in `src/resolution/facetVocabulary/{facet}.ts` (Phase 3). Row schemas under `references/vocabulary/` are data, not code (per H-S2-1 §1).

**Step 4 — Run test** — expect PASS.
**Step 5 — Commit** `feat(SKY-239): add SurfaceFormEntry parameterized schema`.

---

### Task 2d-1.2 — Add Stage 2 errors to the domain error module

**SD-Q2 §1,6 / H-S2-1.** Every populator and loader failure needs a typed error; no plain `Error`.

**Files:**
- Modify: `src/domain/errors.ts`
- Test: extend `tests/data-layer-errors.test.ts` if present, else add `tests/stage2-errors.test.ts`

**Dependencies:** 2d-1.1.

**Step 1 — Failing test.** Instantiate each new error class via `new OntologyDecodeError({...})` etc., yield it from `Effect.gen`, assert the `_tag` and that it's catchable via `Effect.catchTag`.

**Step 3 — Implement.** Add these `Schema.TaggedError` classes (search `src/domain/errors.ts` for the existing pattern; follow it):
- `OntologyDecodeError` — fields: `source: string`, `path: string`, `message: string`.
- `VocabularyLoadError` — fields: `facet: string`, `path: string`, `issues: ReadonlyArray<string>`.
- `VocabularyCollisionError` — fields: `facet: string`, `normalizedSurfaceForm: string`, `canonicalA: string`, `canonicalB: string`.
- `FacetDecompositionError` — fields: `postUri: string`, `reason: string` (for truly exceptional Stage 2 internal errors; vocabulary misses are *not* errors per H-S2-1 §5).

**Acceptance criteria:**
- All four classes are `Schema.TaggedError`-derived.
- Each is yieldable from `Effect.gen` without `Effect.fail(...)` wrapping (per project memory `feedback_yieldable_errors.md`).
- Test file compiles and passes.

**Notes:** Vocabulary coverage gaps are NOT errors — they're `Option.none()` returns from parsers. The errors above are reserved for structural or loader-level failures.

**Step 5 — Commit** `feat(SKY-239): add Stage 2 tagged errors for populator and loader`.

---

### Task 2d-1.3 — Create `src/domain/stage2Resolution.ts` skeleton: `Stage2Evidence` union

**SD-Q13.** New file mirrors `src/domain/stage1Resolution.ts` shape discipline.

**Files:**
- Create: `src/domain/stage2Resolution.ts`
- Test: `tests/stage2-resolution.test.ts`

**Dependencies:** 2d-1.1.

**Step 1 — Failing test.** For each of the four evidence variants below, build an instance, encode it via `Schema.encodeSync(Stage2Evidence)`, decode the result, and assert structural equality and `_tag` presence.

**Step 3 — Implement.** Define four `Schema.TaggedStruct` variants:

- `FacetDecompositionEvidence`:
  - `_tag: "FacetDecompositionEvidence"`
  - `signal: Schema.Literal("facet-decomposition")`
  - `rank: Stage1Rank` (import from stage1Resolution)
  - `matchedFacets: Schema.Array(Schema.String)` — facet field names that matched
  - `partialShape: PartialVariableShape` (forward-reference — Task 2d-1.4 defines; use `Schema.suspend` if circular)
  - `matchedSurfaceForms: Schema.Array(SurfaceFormEntryAny)` — see note below

- `FuzzyDatasetTitleEvidence`:
  - `_tag`, `signal: Schema.Literal("fuzzy-dataset-title")`, `rank`, `candidateTitle: Schema.String`, `score: Schema.Number` (0..1 Jaccard), `threshold: Schema.Number`

- `FuzzyAgentLabelEvidence`:
  - `_tag`, `signal: Schema.Literal("fuzzy-agent-label")`, `rank`, `candidateLabel: Schema.String`, `score`, `threshold`

- `FuzzyTitleEvidence` (reserved for Variable/Dataset chart-title fuzzy paths surfaced by SD-Q9 — keep the variant for completeness even if Phase 4 only wires the agent + dataset lanes):
  - `_tag`, `signal: Schema.Literal("fuzzy-title")`, `rank`, `candidateLabel`, `score`, `threshold`

Then:
```ts
export const Stage2Evidence = Schema.Union([
  FacetDecompositionEvidence,
  FuzzyDatasetTitleEvidence,
  FuzzyAgentLabelEvidence,
  FuzzyTitleEvidence
]);
```

For `matchedSurfaceForms`, define and export a `SurfaceFormEntryAny` that is `Schema.Union([SurfaceFormEntry<StatisticType>, SurfaceFormEntry<Aggregation>, SurfaceFormEntry<UnitFamily>, SurfaceFormEntry<Schema.String /* tech */>, SurfaceFormEntry<Schema.String /* frequency */>])`. The per-facet schemas are defined in Phase 3 — for Phase 1, stub with `Schema.Unknown` and add a TODO pointing at Task 2d-3.2. Reconcile once Phase 3 lands (Task 2d-3.7).

**Acceptance criteria:**
- `Stage2Evidence` decodes + encodes round-trip in test.
- `Match.valueTags(stage2Evidence)` would compile against the four variants (write a trivial exhaustiveness check in test).

**Notes:** Keep the file structure tight — one section per concern, mirrors `stage1Resolution.ts`. Use `Schema.suspend` for any circular reference.

**Step 5 — Commit** `feat(SKY-239): add Stage2Evidence union skeleton`.

---

### Task 2d-1.4 — Add `PartialVariableShape` and `CandidateEntry` to `stage2Resolution.ts`

**SD-Q5, SD-Q14.** The partial Variable shape and the candidate entry surface are what Stage 3 reads.

**Files:**
- Modify: `src/domain/stage2Resolution.ts`
- Extend: `tests/stage2-resolution.test.ts`

**Dependencies:** 2d-1.3.

**Step 1 — Failing test.** Build an instance of `PartialVariableShape` with three of the seven facets set and `fixedDims.frequency = "annual"`. Build a `CandidateEntry` with rank 1 and two matched facets. Round-trip decode/encode.

**Step 3 — Implement.**
- `PartialVariableShape = Schema.Struct({...})` — same fields as `Variable` from `src/domain/data-layer/variable.ts` but every field `optionalKey`, plus `fixedDims: Schema.optionalKey(FixedDims)`. Import `StatisticType`, `Aggregation`, `UnitFamily`, `FixedDims` from `src/domain/data-layer/variable.ts`; do NOT redefine. `technologyOrFuel` stays `Schema.optionalKey(Schema.String)` (SD-Q3).
- `CandidateEntry = Schema.Struct({ entityId: Schema.String, label: Schema.String, grain: Stage1MatchGrain, matchedFacets: Schema.Array(Schema.String), rank: Stage1Rank })`.

**Acceptance criteria:**
- Both schemas decode/encode round-trip.
- `PartialVariableShape` reuses existing enum schemas — no re-declaration of `StatisticType` etc.
- Test asserts that a decoded `PartialVariableShape` with all 7 fields + fixedDims is structurally assignable to a `Partial<Variable>` via a type-level assertion.

**Notes:** `matchedFacets` is a list of facet field names as strings because the set is open-ended (future facets will appear). This is the simplest Stage-3-projectable shape — avoid overengineering with a `Schema.Literals(["statisticType","aggregation",...])` constraint; Stage 3 just reads these.

**Step 5 — Commit** `feat(SKY-239): add PartialVariableShape and CandidateEntry`.

---

### Task 2d-1.5 — Add `Stage3Input` struct to `stage2Resolution.ts`

**SD-Q14.** The contract between Stage 2 and Stage 3. Designed for LLM prompt projection.

**Files:**
- Modify: `src/domain/stage2Resolution.ts`
- Extend: `tests/stage2-resolution.test.ts`

**Dependencies:** 2d-1.4.

**Step 1 — Failing test.** Build a `Stage3Input` instance with `stage2Lane: "facet-decomposition"`, a populated `partialDecomposition`, three `candidateSet` entries, two `matchedSurfaceForms`, one `unmatchedSurfaceForm`. Round-trip decode. Verify `originalResidual` field accepts every `Stage1Residual` variant (test with `DeferredToStage2Residual` and `UnmatchedUrlResidual`).

**Step 3 — Implement.**
```ts
export const Stage2Lane = Schema.Literals([
  "facet-decomposition",
  "fuzzy-dataset-title",
  "fuzzy-agent-label",
  "tie-breaker",
  "no-op"
]);

export const Stage3Input = Schema.TaggedStruct("Stage3Input", {
  postUri: PostUri,
  originalResidual: Stage1Residual,
  stage2Lane: Stage2Lane,
  partialDecomposition: Schema.optionalKey(PartialVariableShape),
  candidateSet: Schema.Array(CandidateEntry),
  matchedSurfaceForms: Schema.Array(SurfaceFormEntryAny),
  unmatchedSurfaceForms: Schema.Array(Schema.String),
  reason: Schema.String
});
```

Import `PostUri` from `src/domain/types.ts` and `Stage1Residual` from `src/domain/stage1Resolution.ts`.

**Acceptance criteria:**
- `Stage3Input` decodes + encodes with every `Stage1Residual` variant.
- `stage2Lane` covers all five lanes from SD-Q9.
- `matchedSurfaceForms` and `unmatchedSurfaceForms` are always arrays (never optional), `partialDecomposition` is optional.

**Notes:** The `formatForLlm(input: Stage3Input): string` projection function is NOT in scope — that ships in Slice 6 (SKY-240). Stage 2's job is locking the schema. If during Phase 4 the kernel needs a field the schema lacks, surface it as a schema gap and revise.

**Step 5 — Commit** `feat(SKY-239): add Stage3Input contract struct`.

---

### Task 2d-1.6 — Extract shared `MatchEvidence` union and broaden `stage1Resolution.ts` match structs

**SD-Q13.** Match grain stays the discriminator; stage origin is a property of the evidence. A single match can carry Stage 1 AND Stage 2 evidence side by side.

**Files:**
- Modify: `src/domain/stage1Resolution.ts`
- Modify: `src/domain/stage2Resolution.ts`
- Extend: `tests/stage2-resolution.test.ts` and `tests/stage1-kernel.test.ts` (assertions only — no Stage 1 behaviour change)

**Dependencies:** 2d-1.3, 2d-1.5.

**Step 1 — Failing test.** Build a `VariableMatch` whose `evidence` field contains ONE `VariableAliasEvidence` (Stage 1) AND ONE `FacetDecompositionEvidence` (Stage 2). Round-trip decode. Assert the array length is 2 and the two `_tag`s are different.

**Step 3 — Implement.**
- Extract the shared evidence-bearing match contract into a neutral module (for example `src/domain/matchEvidence.ts`, plus any companion file needed for shared match-shape helpers). The exact file split is an implementation choice, but `stage1Resolution.ts` must not import `stage2Resolution.ts`.
- Define `MatchEvidence` in that neutral module as the union of Stage 1 and Stage 2 evidence variants using whatever `Schema.Union` form compiles cleanly against Effect 4.
- In `src/domain/stage1Resolution.ts`, modify `DistributionMatch`, `DatasetMatch`, `AgentMatch`, and `VariableMatch` so that `evidence: Schema.Array(MatchEvidence)` instead of `Schema.Array(Stage1Evidence)`.
- In `src/domain/stage2Resolution.ts`, import the shared `MatchEvidence` union from the neutral module rather than re-declaring it locally.

**Acceptance criteria:**
- Existing Stage 1 tests in `tests/stage1-kernel.test.ts`, `tests/stage1-resolver.test.ts`, `tests/stage1-eval.test.ts` still pass unchanged (Stage 1 only ever produces `Stage1Evidence`, which is a subtype of `MatchEvidence`).
- New test decoding a match with mixed Stage 1 + Stage 2 evidence passes.
- `bun run typecheck` shows no runtime import cycle between the Stage 1 and Stage 2 domain files.
- `bun run typecheck` green.

**Notes:** This is the load-bearing contract edit. Do NOT rename or remove the Stage 1 match structs. Do NOT touch `Stage1Match` union or `Stage1Residual` union in this task. Only the `evidence` field on the four existing match structs changes here. This slice does not add `SeriesMatch`.

**Step 5 — Commit** `feat(SKY-239): unify MatchEvidence across Stage 1 and Stage 2`.

---

### Task 2d-1.7 — Add `Stage2Result` shape to `stage2Resolution.ts`

**SD-Q5, SD-Q9, SD-Q14.** Composes with Stage 1's result. One struct, two concerns: the Stage 2 matches to merge back + the new residuals escalated to Stage 3.

**Files:**
- Modify: `src/domain/stage2Resolution.ts`
- Extend: `tests/stage2-resolution.test.ts`

**Dependencies:** 2d-1.5, 2d-1.6.

**Step 1 — Failing test.** Build a `Stage2Result` carrying one new `VariableMatch` (with `FacetDecompositionEvidence`) and one `Stage3Input` escalation. Round-trip decode.

**Step 3 — Implement.**
```ts
export const Stage2Result = Schema.Struct({
  matches: Schema.Array(Stage1Match),   // NEW matches Stage 2 produced (same union as Stage 1 consumes)
  corroborations: Schema.Array(Schema.Struct({
    matchKey: Schema.Struct({ grain: Stage1MatchGrain, entityId: Schema.String }),
    evidence: Schema.Array(Stage2Evidence)
  })),                                   // evidence to merge into existing same-grain Stage 1 matches
  escalations: Schema.Array(Stage3Input)
}).annotate({
  description: "Stage 2 output: new matches, corroborations to merge with Stage 1 matches, and Stage 3 escalations"
});
```

**Acceptance criteria:**
- Three orthogonal output channels per SD-Q9 (new match, corroborate existing, escalate).
- Round-trip decode test passes.
- Phase 4 kernel will merge `matches` and `corroborations` back into the Stage 1 result at the call site.

**Notes:** The merge logic (Stage 1 result + Stage 2 result → combined result) is a Phase 4 kernel concern, not a schema concern. Keep `Stage2Result` as pure data.

**Step 5 — Commit** `feat(SKY-239): add Stage2Result composition shape`.

---

### Task 2d-1.7a — Lock resolver / enrichment / Workflow boundary types before Phase 4 wiring

**Why this exists.** The repo already has a live resolver response shape, a persisted `data-ref-resolution` enrichment shape, and a Stage 3 Workflow stub. Slice 2d has to replace the current placeholders and raw-residual handoff with the real Stage 2 contracts before the kernel can be considered integrated.

**Files:**
- Modify: `src/domain/resolutionShared.ts`
- Modify: `src/domain/resolution.ts`
- Modify: `src/domain/enrichment.ts`
- Extend: `tests/resolver-client.test.ts`
- Extend: `tests/resolver-service.test.ts`
- Extend: `tests/enrichment-run-workflow.test.ts`

**Dependencies:** 2d-1.5, 2d-1.7.

**Step 1 — Failing test.**
- Add a test that decodes a resolver response carrying a non-empty `stage2` payload shaped like `Stage2Result`.
- Add a test that decodes Workflow params carrying `Stage3Input[]` rather than raw `Stage1Residual[]`.

**Step 3 — Implement.**
- Replace the empty `Stage2Output` placeholder in `src/domain/resolutionShared.ts` with the real Stage 2 payload shape (either `Stage2Result` directly or a thin alias/wrapper around it).
- Update `ResolvePostResponse` and `DataRefResolutionEnrichment` so the `stage2` field is the real typed Stage 2 payload.
- Update `DataRefResolverRunParams` so the Workflow handoff is `Stage3Input[]` rather than raw `Stage1Residual[]`. Keep the contract name stable if convenient; the important part is the payload shape, not the field spelling.

**Acceptance criteria:**
- Resolver response schema, persisted enrichment schema, and Workflow params all decode with real Stage 2 / Stage 3 handoff types.
- Existing resolver client tests still pass after the type widening.

**Step 5 — Commit** `feat(SKY-239): lock resolver boundary schemas for stage2`.

---

### Task 2d-1.8 — Track `SurfaceFormEntryAny` reconciliation after Phase 3 specializations

**Tracking task.** No code changes yet — flag the current `Schema.Unknown` temporary schema in `Stage2Evidence.matchedSurfaceForms` for revisiting after Phase 3.

**Files:**
- Add TODO comment in `src/domain/stage2Resolution.ts`

**Dependencies:** 2d-1.3.

**Acceptance criteria:** a `// TODO(2d-3.7): replace SurfaceFormEntryAny Schema.Unknown with Phase 3 union` comment is present. Task 2d-3.7 closes the loop.

**Step 5 — Commit** (amend or standalone) `docs(SKY-239): flag SurfaceFormEntryAny reconciliation`.

---

### Phase 1 Handoff Verification

Run and verify green:
```bash
bun run typecheck
bun run test tests/facet-vocabulary-surface-form-entry.test.ts tests/stage2-resolution.test.ts tests/stage1-kernel.test.ts tests/stage1-eval.test.ts tests/stage1-resolver.test.ts
```

All Stage 1 tests must still be green (zero behaviour change). Stage 2 tests compile against the locked schemas.

---

## Phase 2 — Effect-Native Vocabulary Populator

**Goal of phase:** Ship the first-class populator pipeline (SD-Q2 §1–6). Pass 1 (deterministic ontology ingest) only — Pass 2 (agent-curated review) is a follow-up workflow, not a code task. Output: five validated JSON files under `references/vocabulary/`.

### Task 2d-2.1 — Create `references/external/` and check in source ontology snapshots

**SD-Q2 §4.** Source files live in the repo so the populator is reproducible and CI can run it.

**Files:**
- Create: `references/external/oeo/` — place OEO OWL or Turtle snapshot here (download the latest OEO release from `https://github.com/openenergy-platform/ontology` and pin a version)
- Create: `references/external/ucum/` — UCUM essence XML (`https://unitsofmeasure.org/ucum-essence.xml`)
- Create: `references/external/iea-balance/` (optional for this slice — follow-up only if needed by later slices)
- Create: `references/external/README.md` with provenance URLs, versions, download instructions

**Dependencies:** none.

**Acceptance criteria:**
- OEO and UCUM source files are checked into the repo for this slice.
- `README.md` lists source URLs and pinned versions.
- The checked-in files are the exact inputs used by the populator; do not add fetch-script fallback work in this slice.

**Step 5 — Commit** `chore(SKY-239): add external ontology source snapshots for populator`.

---

### Task 2d-2.2 — Define typed external ontology input schemas

**SD-Q2 §1.** Source ontologies are decoded into typed intermediate shapes BEFORE being transformed into `SurfaceFormEntry` rows.

**Files:**
- Create: `src/resolution/facetVocabulary/oeo/OeoConcept.ts`
- Create: `src/resolution/facetVocabulary/ucum/UcumUnit.ts`
- Test: `tests/facet-vocabulary-oeo-schema.test.ts`
- Test: `tests/facet-vocabulary-ucum-schema.test.ts`

**Dependencies:** 2d-1.1, 2d-1.2.

**Step 1 — Failing tests.** For each module, decode a small in-memory fixture object matching the expected shape, assert required fields, assert decode-fails on missing required fields.

**Step 3 — Implement.**

**OEO concept shape** (structural; RDF parsing happens in Task 2d-2.4):
```ts
export const OeoConcept = Schema.Struct({
  iri: Schema.String,        // e.g., "http://openenergy-platform.org/ontology/oeo/OEO_00010255"
  oeoId: Schema.String,      // e.g., "OEO_00010255"
  prefLabel: Schema.String,
  altLabels: Schema.Array(Schema.String),
  parentIris: Schema.Array(Schema.String),
  definition: Schema.optionalKey(Schema.String)
});
```

**UCUM unit shape:**
```ts
export const UcumUnit = Schema.Struct({
  code: Schema.String,       // e.g., "W", "J", "MW.h"
  codeCaseInsensitive: Schema.optionalKey(Schema.String),
  printSymbol: Schema.optionalKey(Schema.String),
  names: Schema.Array(Schema.String),
  dim: Schema.optionalKey(Schema.String),  // dimension string, e.g., "M.L2.T-3"
  family: Schema.optionalKey(Schema.String) // inferred grouping, filled by populator heuristic
});
```

**Acceptance criteria:**
- Both schemas exported, test fixtures decode.
- Decode failures emit `ParseError` that is convertible to `OntologyDecodeError` (Task 2d-1.2).
- Files live under `src/resolution/facetVocabulary/` — no `node:*` imports.

**Notes:** These schemas describe the *intermediate* decoded-ontology form. The raw OEO is RDF/Turtle/OWL; raw UCUM is XML. Turning those wire formats into these typed shapes is the adapter's job in Tasks 2d-2.4 and 2d-2.5. Keep the schemas minimal — only fields the transforms need.

**Step 5 — Commit** `feat(SKY-239): define typed OEO and UCUM input schemas`.

---

### Task 2d-2.3 — Implement `Schema.transformOrFail` from `OeoConcept` to `SurfaceFormEntry<string>` (technologyOrFuel)

**SD-Q2 §1, SD-Q3.** The core Pass-1 transformation discipline.

**Files:**
- Create: `src/resolution/facetVocabulary/oeo/toTechnologyOrFuel.ts`
- Test: `tests/facet-vocabulary-oeo-technology-transform.test.ts`

**Dependencies:** 2d-2.2, 2d-1.1.

**Step 1 — Failing test.** Given an `OeoConcept` with `prefLabel: "wind turbine"`, `altLabels: ["wind power plant"]`, `oeoId: "OEO_00010255"`, run the transform and assert:
- Output is a non-empty array of `SurfaceFormEntry<string>`.
- Each row has `provenance: "oeo-derived"`, `source: "OEO_00010255"`, `canonical: "wind"` (or the chosen canonical — see note).
- `normalizedSurfaceForm` is the result of `normalizeLookupText(surfaceForm)`.
- Decode failure for an `OeoConcept` whose `prefLabel` is empty.

**Step 3 — Implement.**
- Use `Schema.transformOrFail(OeoConcept, Schema.Array(SurfaceFormEntry<string>), { decode, encode })`.
- `decode` maps one concept → one or more `SurfaceFormEntry` rows (one per label, one per altLabel).
- `encode` is one-way — fail with `ParseError` if called (this is a source-to-row projection, not round-trip).
- The canonical value is a curated slug (e.g., `wind`, `solar_pv`, `natural_gas`). Phase 3 Task 2d-3.5 ships the canonical-slug mapping table. For this task, accept a `canonicalSlug: string` argument from the caller (populator script) so the transform is pure.
- Use `DateTime.formatIso(DateTime.unsafeNow())` for `addedAt`. Import from `effect`'s `DateTime` module, NOT `new Date()`.

**Acceptance criteria:**
- Transform produces one row per label/altLabel.
- Empty labels fail decode with typed `ParseError`.
- No `node:*` imports.
- No `JSON.parse`, no `try/catch`.

**Notes:** The canonical-slug list is data, not code — Phase 3 Task 2d-3.5 populates it. For this task, the populator caller owns canonical assignment. Don't hardcode the mapping inside the transform.

**Step 5 — Commit** `feat(SKY-239): implement OEO→technologyOrFuel transform`.

---

### Task 2d-2.4 — OEO RDF reader (Bun-side Node-allowed)

**SD-Q2 §4.** The only Node-touching wrapper for the OEO path.

**Files:**
- Create: `scripts/facet-vocabulary/read-oeo.ts`
- Test: none at this level (tests happen against the Effect-native transform layer)

**Dependencies:** 2d-2.2, 2d-2.3.

**Step 3 — Implement.**
- Bun script that reads the OEO OWL/Turtle snapshot from `references/external/oeo/`.
- Use a minimal RDF library (e.g., `n3` or `rdflib`) added as a dev dependency via `bun add -d n3`.
- Walk the subclass hierarchy under the `energy carrier` and `energy conversion technology` root concepts.
- Emit an array of `OeoConcept`-shaped plain objects (`{ iri, oeoId, prefLabel, altLabels, parentIris, definition }`).
- Output: a single JSON file at `references/external/oeo/derived/concepts.json` that is consumed by the Effect-native transform in the next task.
- Node-side try/catch is allowed here — this file is under `scripts/`.

**Acceptance criteria:**
- Running `bun scripts/facet-vocabulary/read-oeo.ts` produces `references/external/oeo/derived/concepts.json` with ≥ 50 concepts.
- Output file decodes cleanly against `Schema.Array(OeoConcept)` (next task will verify).

**Notes:** Two-stage pattern: Bun script does the wire-format parse (RDF → typed JSON), then the Effect-native transform ingests the typed JSON. This keeps `src/` free of Node imports. Predecessor for this seam: `scripts/catalog-harvest/harvest-doe-dcat.ts` which does the same split.

**Step 5 — Commit** `feat(SKY-239): add OEO RDF reader script`.

---

### Task 2d-2.5 — UCUM XML reader (Bun-side) → UcumUnit JSON

**SD-Q2 §4, SD-Q4.** Same pattern as 2d-2.4.

**Files:**
- Create: `scripts/facet-vocabulary/read-ucum.ts`

**Dependencies:** 2d-2.2.

**Step 3 — Implement.**
- Bun script reads `references/external/ucum/ucum-essence.xml`.
- Use `@xmldom/xmldom` or similar (add via `bun add -d`) — keep the dependency minimal.
- Walk UCUM base-units + prefixes + derived units. For each, emit a `UcumUnit` plain object.
- Heuristic inference of `family` field: if dimension is `M.L2.T-3` → `power`; `M.L2.T-2` → `energy`; currency codes → `currency`; otherwise `other`. Implement the heuristic in Task 2d-2.7 — for this task, leave `family` unfilled.
- Output: `references/external/ucum/derived/units.json`.

**Acceptance criteria:**
- Running `bun scripts/facet-vocabulary/read-ucum.ts` produces `units.json` with all UCUM base units + common SI-prefixed derivatives (≥ 100 entries).
- Output decodes against `Schema.Array(UcumUnit)`.

**Step 5 — Commit** `feat(SKY-239): add UCUM XML reader script`.

---

### Task 2d-2.6 — Implement `Schema.transformOrFail` from `UcumUnit` → `SurfaceFormEntry<UnitFamily>`

**SD-Q2 §1, SD-Q4.**

**Files:**
- Create: `src/resolution/facetVocabulary/ucum/toUnitFamily.ts`
- Test: `tests/facet-vocabulary-ucum-unit-family-transform.test.ts`

**Dependencies:** 2d-2.2, 2d-2.5, 2d-1.1.

**Step 1 — Failing test.** Given a `UcumUnit` with `code: "W"`, `family: "power"`, `names: ["watt"]`, the transform produces `SurfaceFormEntry<"power">` rows with `provenance: "ucum-derived"` and `source: "W"`.

**Step 3 — Implement.**
- `Schema.transformOrFail(UcumUnit, Schema.Array(SurfaceFormEntry<UnitFamily>), { decode, encode })`.
- `decode` emits rows for `code`, every entry in `names`, `printSymbol` (if present), and `codeCaseInsensitive` (if present). Each row has the same `canonical: family`.
- Skip units where `family` is `"other"` (these aren't useful as deterministic matches; they'll come in via agent curation in Pass 2, out of scope here).
- Import `UnitFamily` from `src/domain/data-layer/variable.ts`.

**Acceptance criteria:**
- Test with 3 fixture units (one power, one energy, one currency) produces 3+ `SurfaceFormEntry<UnitFamily>` rows each.
- `UcumUnit` with unrecognized family is filtered, not errored.

**Notes:** The heuristic "dimension → UnitFamily" mapping belongs here. Hardcode the small dimension-to-family table as a const record in this file — it's the UCUM adapter's responsibility.

**Step 5 — Commit** `feat(SKY-239): implement UCUM→UnitFamily transform`.

---

### Task 2d-2.7 — Hand-curated `statisticType` and `aggregation` seed rows

**SD-Q1, SD-Q2 §5.** OEO coverage for these is thin. Seed the initial tables by hand with `provenance: "hand-curated"`.

**Files:**
- Create: `src/resolution/facetVocabulary/seeds/statisticType.ts`
- Create: `src/resolution/facetVocabulary/seeds/aggregation.ts`
- Test: `tests/facet-vocabulary-hand-curated-seeds.test.ts`

**Dependencies:** 2d-1.1.

**Step 1 — Failing test.** Import both seed arrays and assert:
- Every row decodes against the respective `SurfaceFormEntry<StatisticType>` / `SurfaceFormEntry<Aggregation>` schema.
- Coverage: `statisticType` seed contains at least 3 rows per canonical enum value (stock, flow, price, share, count). Rows exist for common surface forms: "installed capacity" → `stock`, "generation" → `flow`, "price" → `price`, "share" → `share`, "count" → `count`.
- `aggregation` seed has at least 2 rows per canonical value (point, end_of_period, sum, average, max, min, settlement).

**Step 3 — Implement.**
- Both files export a `const` array of plain objects. These arrays are the authoritative hand-curated seed.
- Canonical values come from the existing `StatisticType` and `Aggregation` enums in `src/domain/data-layer/variable.ts` — import them to keep type-safety.
- Add a brief one-line `notes` on each row explaining the surface-form-to-canonical intuition (optional, but helpful for Pass 2 review).

**Acceptance criteria:**
- Both seed files compile, decode under Phase 1 schemas, and pass coverage assertions in test.
- `statisticType` has ≥ 15 rows; `aggregation` has ≥ 14 rows.

**Notes:** These are Pass-1 seeds. Pass 2 (agent-curated) grows them from corpus scans. Do not block on perfect coverage — the eval harness (Phase 5) will tell you where you're missing.

**Step 5 — Commit** `feat(SKY-239): seed hand-curated statisticType and aggregation rows`.

---

### Task 2d-2.8 — Hand-curated `frequency` seed rows

**SD-Q7.**

**Files:**
- Create: `src/resolution/facetVocabulary/seeds/frequency.ts`
- Extend: `tests/facet-vocabulary-hand-curated-seeds.test.ts`

**Dependencies:** 2d-1.1.

**Step 3 — Implement.** Canonical set: `hourly | daily | weekly | monthly | quarterly | annual`. Seed at least 3 surface forms per canonical (e.g., `hourly`: `["hourly", "per hour", "1h"]`; `annual`: `["annual", "yearly", "per year", "annually"]`).

**Acceptance criteria:** 18+ rows; every canonical value has ≥ 3 rows; decodes cleanly.

**Step 5 — Commit** `feat(SKY-239): seed hand-curated frequency rows`.

---

### Task 2d-2.9 — Canonical `technologyOrFuel` slug table

**SD-Q3.** The curated canonical list for technology/fuel. Referenced by the OEO transform (Task 2d-2.3) when mapping OEO concepts to our slugs.

**Files:**
- Create: `src/resolution/facetVocabulary/seeds/technologyOrFuelCanonical.ts`
- Test: extend `tests/facet-vocabulary-hand-curated-seeds.test.ts`

**Dependencies:** 2d-1.1.

**Step 3 — Implement.**
- Export a `const canonicalTechnologyOrFuel: ReadonlyArray<{ slug: string; oeoIds: ReadonlyArray<string>; alternateLabels: ReadonlyArray<string> }>` with ≥ 15 entries covering: wind, offshore_wind, onshore_wind, solar_pv, solar_thermal, hydro, nuclear, coal, natural_gas, oil, biomass, geothermal, battery_storage, green_hydrogen, grid_hydrogen.
- Each entry maps OEO concept IDs to a canonical skygest slug.

**Acceptance criteria:**
- ≥ 15 entries.
- Every `oeoIds` reference is a valid OEO concept ID format (`OEO_\d+`).
- The test file imports this table and checks that it matches the OEO transform's caller contract from Task 2d-2.3.

**Step 5 — Commit** `feat(SKY-239): add canonical technologyOrFuel slug table`.

---

### Task 2d-2.10 — `scripts/seed-vocabulary.ts` orchestrator

**SD-Q2 §4.** The only Node-touching entry point for the populator. Composes the Effect-native transforms and writes the five output files.

**Files:**
- Create: `scripts/seed-vocabulary.ts`
- Test: `tests/facet-vocabulary-populator-integration.test.ts` (invokes the populator's pure Effect-native core, NOT the Bun wrapper)

**Dependencies:** 2d-2.3, 2d-2.6, 2d-2.7, 2d-2.8, 2d-2.9.

**Step 1 — Failing test.** The integration test imports a pure Effect program that:
1. Takes in-memory arrays of `OeoConcept[]` and `UcumUnit[]` as inputs.
2. Runs the OEO→technologyOrFuel transform with the canonical slug table.
3. Runs the UCUM→UnitFamily transform.
4. Merges with the hand-curated seeds for the other three facets.
5. Returns a map `{ statisticType, aggregation, unitFamily, technologyOrFuel, frequency }` of `ReadonlyArray<SurfaceFormEntry<...>>`.

Assert all five arrays are non-empty and the total row count is ≥ 150.

**Step 3 — Implement.**
- Create `src/resolution/facetVocabulary/populator/buildVocabularyBundle.ts` (pure Effect module) that runs the five transforms and returns the bundle. No Node imports.
- Create `scripts/seed-vocabulary.ts` (Bun wrapper) that:
  1. Reads `references/external/oeo/derived/concepts.json` and `references/external/ucum/derived/units.json` via `node:fs`.
  2. Decodes them via `Schema.decodeUnknownSync(Schema.Array(OeoConcept))` etc.
  3. Calls the pure `buildVocabularyBundle` Effect and runs via `Effect.runSync` (or `runPromise` if async transforms exist).
  4. For each of the five facets, serializes the array and writes it to `references/vocabulary/{facet-slug}.json` via `node:fs`.
  5. Logs counts per facet.
- `scripts/seed-vocabulary.ts` may use `node:fs`, `node:path`, and `try/catch` — it is under `scripts/`.

**Acceptance criteria:**
- Integration test passes against in-memory inputs.
- Running `bun scripts/seed-vocabulary.ts` (after tasks 2d-2.4 and 2d-2.5 have generated the `references/external/*/derived/*.json` intermediate files) emits five files in `references/vocabulary/`:
  - `statistic-type.json`
  - `aggregation.json`
  - `unit-family.json`
  - `technology-or-fuel.json`
  - `frequency.json`
- Each file decodes cleanly against its Phase 3 per-facet schema (verified in Phase 3 via tests).

**Notes:** The Bun wrapper is allowed to be ~40 lines of "read file, decode, call Effect, write file" boilerplate. The actual logic is in the Effect-native `buildVocabularyBundle` module which is 100% testable.

**Step 5 — Commit** `feat(SKY-239): add seed-vocabulary orchestrator`.

---

### Task 2d-2.11 — Run the populator end-to-end and check in generated vocabulary files

**Files:**
- Commit generated: `references/vocabulary/{statistic-type,aggregation,unit-family,technology-or-fuel,frequency}.json`

**Dependencies:** 2d-2.10.

**Steps:**
1. Run `bun scripts/facet-vocabulary/read-oeo.ts` (requires 2d-2.4 + OEO snapshot).
2. Run `bun scripts/facet-vocabulary/read-ucum.ts` (requires 2d-2.5 + UCUM snapshot).
3. Run `bun scripts/seed-vocabulary.ts`.
4. Inspect `references/vocabulary/*.json` — each should be a decoded-compatible array.
5. Commit the generated files.

**Acceptance criteria:**
- All 5 files exist and are non-empty.
- Total row counts: `statistic-type ≥ 15`, `aggregation ≥ 14`, `unit-family ≥ 30` (UCUM-derived), `technology-or-fuel ≥ 25` (OEO + canonical), `frequency ≥ 18`.

**Notes:** If any file falls short, revisit the upstream transform and adjust heuristics. Do NOT fill gaps by hand-editing `references/vocabulary/*.json` — that file is generated output. Add rows to the seeds or OEO canonical table upstream and regenerate.

**Step 5 — Commit** `data(SKY-239): check in Pass 1 populator output for facet vocabularies`.

---

### Phase 2 Handoff Verification

```bash
bun run typecheck
bun run test tests/facet-vocabulary-oeo-schema.test.ts tests/facet-vocabulary-ucum-schema.test.ts tests/facet-vocabulary-oeo-technology-transform.test.ts tests/facet-vocabulary-ucum-unit-family-transform.test.ts tests/facet-vocabulary-hand-curated-seeds.test.ts tests/facet-vocabulary-populator-integration.test.ts
bun scripts/seed-vocabulary.ts  # rerunnable; emits idempotent output
```

All green. Five vocabulary files committed.

---

## Phase 3 — `FacetVocabulary` Service and Parsers

**Goal of phase:** Make the populated vocabulary files accessible to the Stage 2 kernel via a typed Effect service with constant-time lookups per facet.

### Task 2d-3.1 — Per-facet `SurfaceFormEntry` specializations

**SD-Q2.**

**Files:**
- Create: `src/resolution/facetVocabulary/statisticType.ts` (schema specialization only, parser follows in 2d-3.4)
- Create: `src/resolution/facetVocabulary/aggregation.ts`
- Create: `src/resolution/facetVocabulary/unitFamily.ts`
- Create: `src/resolution/facetVocabulary/technologyOrFuel.ts`
- Create: `src/resolution/facetVocabulary/frequency.ts`
- Test: `tests/facet-vocabulary-specializations.test.ts`

**Dependencies:** 2d-1.1, 2d-2.11.

**Step 1 — Failing test.** For each facet module, import the exported schema and decode the corresponding `references/vocabulary/{facet}.json` file at test time. Assert successful decode and ≥ 1 entry.

**Step 3 — Implement.** Each file exports, at minimum:
```ts
export const StatisticTypeSurfaceForm = makeSurfaceFormEntry(StatisticType);
export const StatisticTypeVocabulary = Schema.Array(StatisticTypeSurfaceForm);
```
(and analogously for the other four). For `technologyOrFuel` and `frequency`, the canonical type is `Schema.String` (per SD-Q3, SD-Q7).

**Acceptance criteria:**
- Five schemas exported.
- Each decodes the matching JSON file via `Schema.decodeUnknownEffect` in test.
- All five test assertions pass.

**Notes:** Tests read files via `FileSystem` from `@effect/platform`, NOT `node:fs`. Follow the pattern in `tests/checked-in-data-layer-registry.test.ts`.

**Step 5 — Commit** `feat(SKY-239): add per-facet SurfaceFormEntry specializations`.

---

### Task 2d-3.2 — Replace `SurfaceFormEntryAny` placeholder in `stage2Resolution.ts`

**Closes 2d-1.8.**

**Files:**
- Modify: `src/domain/stage2Resolution.ts`

**Dependencies:** 2d-3.1.

**Step 3 — Implement.** Replace the `Schema.Unknown` placeholder in `SurfaceFormEntryAny` with:
```ts
export const SurfaceFormEntryAny = Schema.Union([
  StatisticTypeSurfaceForm,
  AggregationSurfaceForm,
  UnitFamilySurfaceForm,
  TechnologyOrFuelSurfaceForm,
  FrequencySurfaceForm
]);
```

**Acceptance criteria:**
- `bun run typecheck` green.
- All Phase 1 tests still pass.
- The TODO comment from Task 2d-1.8 is removed.

**Step 5 — Commit** `feat(SKY-239): finalize SurfaceFormEntryAny against per-facet schemas`.

---

### Task 2d-3.3 — `loadVocabularyFile` helper

**SD-Q2.** Generic loader that any facet module can call.

**Files:**
- Create: `src/resolution/facetVocabulary/loadVocabularyFile.ts`
- Test: `tests/facet-vocabulary-loader.test.ts`

**Dependencies:** 2d-1.1, 2d-1.2, 2d-3.1.

**Step 1 — Failing test.** Call `loadVocabularyFile(path, StatisticTypeVocabulary)` against a fixture JSON string in-memory, assert Effect succeeds with an array. Assert decode failure emits `VocabularyLoadError` tagged error.

**Step 3 — Implement.**
```ts
export const loadVocabularyFile = <A>(
  path: string,
  schema: Schema.Schema<ReadonlyArray<A>, unknown>
): Effect.Effect<ReadonlyArray<A>, VocabularyLoadError, FileSystem.FileSystem>
```
- Uses `FileSystem.readFileString(path)` from `@effect/platform`.
- Uses `Schema.parseJson(schema)` to decode. NO manual `JSON.parse`.
- Maps decode errors to `VocabularyLoadError` via `Effect.mapError`.
- Returns `ReadonlyArray<A>` on success.

**Acceptance criteria:**
- Function signature matches above.
- Uses Effect platform `FileSystem`, not `node:fs`.
- Uses `Schema.parseJson`, not `JSON.parse`.
- Error path covered by test.

**Notes:** Grep `src/platform/Json.ts` first — if a `parseJsonFile` helper already exists, reuse it and just wrap the error mapping.

**Step 5 — Commit** `feat(SKY-239): add loadVocabularyFile helper`.

---

### Task 2d-3.4 — Per-facet `parse*` functions

**SD-Q2.** Pure `parse*(text: string): Option<Canonical>` — each is a thin wrapper around the loaded vocabulary's normalized lookup map.

**Files:**
- Modify each of: `statisticType.ts`, `aggregation.ts`, `unitFamily.ts`, `technologyOrFuel.ts`, `frequency.ts`
- Test: `tests/facet-vocabulary-parsers.test.ts`

**Dependencies:** 2d-3.1, 2d-3.3.

**Step 1 — Failing test.** For each parser, assert:
- Positive: at least 3 surface forms from the vocabulary resolve to the expected canonical.
- Case/whitespace insensitivity: uppercased and whitespace-collapsed forms still resolve.
- Negative: `parseStatisticType("completely unrelated text")` returns `Option.none()`.
- `parseUnitFamily("MW")` resolves to `"power"`.
- `parseFrequency("annually")` resolves to `"annual"`.

**Step 3 — Implement.** Each module exports:
```ts
// statisticType.ts
export const parseStatisticType = (
  index: ReadonlyMap<string, StatisticType>,
  text: string
): Option.Option<StatisticType> =>
  Option.fromNullishOr(index.get(normalizeLookupText(text)));
```
and a constructor:
```ts
export const buildStatisticTypeIndex = (
  entries: ReadonlyArray<Schema.Schema.Type<typeof StatisticTypeSurfaceForm>>
): ReadonlyMap<string, StatisticType> => buildVocabularyIndex(entries);
```

Mirror for all five facets. Reuse `normalizeLookupText` from `src/resolution/normalize.ts`. Reuse `buildVocabularyIndex` from `SurfaceFormEntry.ts`.

**Acceptance criteria:**
- Five pure functions with `(index, text) => Option<Canonical>` signature.
- All positive and negative assertions pass.
- No Effect dependency inside `parse*` — pure synchronous lookup.

**Step 5 — Commit** `feat(SKY-239): add facet parse functions`.

---

### Task 2d-3.5 — `FacetVocabulary` Effect service

**SD-Q2.** Wraps all five parsers into one service, mirroring `DataLayerRegistry`.

**Files:**
- Create: `src/resolution/facetVocabulary/index.ts`
- Test: `tests/facet-vocabulary-service.test.ts`

**Dependencies:** 2d-3.4.

**Step 1 — Failing test.** Build a `Layer.effect` that loads all five vocabulary files via `loadVocabularyFile`, wire it into a test program that calls `yield* facetVocabulary.parseStatisticType("installed capacity")` and asserts the result. Use the `FileSystem` layer from `@effect/platform-bun` (or the node-file-system layer, per existing test fixtures).

**Step 3 — Implement.**
- `export class FacetVocabulary extends ServiceMap.Service<FacetVocabulary, FacetVocabularyShape>("FacetVocabulary") {}` (follow the existing `ServiceMap.Service` pattern in `src/services/`).
- `FacetVocabularyShape` fields: `parseStatisticType`, `parseAggregation`, `parseUnitFamily`, `parseTechnologyOrFuel`, `parseFrequency`, each `(text: string) => Option.Option<...>`.
- Provide a `Layer.effect(FacetVocabulary, Effect.gen(function*() { ... }))` that loads all five files from `references/vocabulary/*.json`, builds the five indexes, and returns the wrapped service.
- Failure mode: propagates `VocabularyLoadError` through the layer.

**Acceptance criteria:**
- Service compiles with `ServiceMap.Service` pattern.
- Layer loads all five files at startup (fail-fast on decode error).
- Test program resolves `parseStatisticType("installed capacity") === Option.some("stock")` (or whatever the seed says).

**Notes:** Path constants (`references/vocabulary/statistic-type.json` etc.) live at the top of the `index.ts` file as `const`s. If the same paths appear elsewhere in the codebase (Phase 5 eval harness), extract a small `src/resolution/facetVocabulary/paths.ts` to avoid duplication.

**Step 5 — Commit** `feat(SKY-239): add FacetVocabulary Effect service`.

---

### Task 2d-3.6 — Integration: `FacetVocabulary` + Phase 2 output decode

**Files:**
- Extend: `tests/facet-vocabulary-service.test.ts`

**Dependencies:** 2d-3.5, 2d-2.11.

**Step 1 — Failing test.** Load the *actual* `references/vocabulary/*.json` files via the layer and run every parser against at least one known surface form per canonical value. This is the "end-to-end through the vocabulary" assertion.

**Acceptance criteria:** every canonical value of `StatisticType`, `Aggregation`, `UnitFamily` has at least one surface form in the committed vocabulary that the parser resolves.

**Notes:** If this test fails, the populator output is inadequate — go back to Phase 2 and extend seeds, don't hand-edit the vocabulary files.

**Step 5 — Commit** `test(SKY-239): verify FacetVocabulary resolves real seeded surface forms`.

---

### Phase 3 Handoff Verification

```bash
bun run typecheck
bun run test tests/facet-vocabulary-specializations.test.ts tests/facet-vocabulary-loader.test.ts tests/facet-vocabulary-parsers.test.ts tests/facet-vocabulary-service.test.ts
```

All green. `FacetVocabulary` service is ready for the Stage 2 kernel.

---

## Phase 4 — Stage 2 Kernel and Lane Dispatch

**Goal of phase:** Ship `runStage2` — a pure function that consumes a `Stage1Result`, reads a `DataLayerRegistryLookup` and a `FacetVocabulary`, and produces a `Stage2Result`. Dispatches over `Stage1Residual` via `Match.valueTags`.

### Task 2d-4.1 — `src/resolution/fuzzyMatch.ts` — token-set Jaccard

**SD-Q8.**

**Files:**
- Create: `src/resolution/fuzzyMatch.ts`
- Test: `tests/fuzzyMatch.test.ts`

**Dependencies:** none (reuses `normalizeLookupText`).

**Step 1 — Failing test.**
- `jaccardTokenSet("Energy Information Administration", "EIA Energy Information") === ?` — compute expected.
- Identical strings → 1.0.
- Disjoint strings → 0.0.
- Empty input → 0.0.
- Whitespace and case-insensitive.

**Step 3 — Implement.**
```ts
export const jaccardTokenSet = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeLookupText(left).split(/\s+/).filter(t => t.length > 0));
  const rightTokens = new Set(normalizeLookupText(right).split(/\s+/).filter(t => t.length > 0));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter(t => rightTokens.has(t)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
};

export const FUZZY_CANDIDATE_THRESHOLD = 0.6;
export const FUZZY_CONFIDENT_THRESHOLD = 0.85;
```

**Acceptance criteria:**
- Pure function, no Effect dependencies.
- Reuses `normalizeLookupText`.
- All five test cases pass.
- Thresholds exported as constants (SD-Q8 locked values).

**Step 5 — Commit** `feat(SKY-239): add token-set Jaccard fuzzy matcher`.

---

### Task 2d-4.2 — Stage 2 facet-decomposition lane (Pass 1: Variable)

**SD-Q1, SD-Q5, SD-Q6, SD-Q9, H-S2-1.** The main lane. Decomposes `DeferredToStage2Residual` text into `PartialVariableShape` + candidate Variable set + `Stage3Input` when ambiguous.

**Files:**
- Create: `src/resolution/Stage2.ts` (begin here; other lanes land in 2d-4.3–2d-4.5)
- Test: `tests/stage2-kernel-facet-decomposition.test.ts`

**Dependencies:** 2d-1.7, 2d-3.5.

**Step 1 — Failing test.** Build a synthetic `Stage1Result` with one `DeferredToStage2Residual` whose text is `"installed wind capacity, annual"`. Provide a `DataLayerRegistryLookup` seeded with the `installed-wind-capacity.json` Variable (from `references/cold-start/variables/`). Provide the `FacetVocabulary` layer loaded from real seeds. Call `runStage2(stage1Result, postContext, lookup, facetVocabulary)`.

Assert:
- Result has one new `VariableMatch` for `installed-wind-capacity`.
- The match's evidence contains one `FacetDecompositionEvidence` with at least 2 matched facets (`statisticType=stock`, `unitFamily=power`, `technologyOrFuel=wind`, `aggregation=end_of_period` — any subset that the vocabulary catches).
- Zero escalations for this case (the four-facet filter uniquely identifies one Variable).

**Step 3 — Implement.**
- `runStage2(stage1Result, postContext, lookup, facetVocabulary): Stage2Result` — pure function, no Effect (the `FacetVocabulary` service is passed in pre-resolved, same pattern as `DataLayerRegistryLookup` in Stage 1).
- Dispatches over `stage1Result.residuals` via `Match.valueTags`. For Phase 4.2, only the `DeferredToStage2Residual` branch produces output; other tags are stubs returning no-op until 2d-4.3–2d-4.5.
- For `DeferredToStage2Residual`:
  1. Parse each of the four Stage-2 facets against `residual.text` via `facetVocabulary.parse*`.
  2. Build a `PartialVariableShape` from the `Option.some` results.
  3. Over all Variables in `lookup.entities` (filter `_tag === "Variable"`), compute facet-match score: `|{ facet : partial[facet] === variable[facet] }|`.
  4. Sort by score descending; take the top rank.
  5. If top rank has exactly 1 Variable, emit a `VariableMatch` with `FacetDecompositionEvidence { rank: 1, matchedFacets: [...], partialShape, matchedSurfaceForms: [...] }`.
  6. If top rank has N > 1 Variables, emit a `Stage3Input` with `stage2Lane: "facet-decomposition"`, `partialDecomposition: partial`, `candidateSet: [...topN]`, `matchedSurfaceForms`, `unmatchedSurfaceForms`, `reason: "N candidates tied on M matched facets"`.
  7. If no Variable has score ≥ 1, emit a `Stage3Input` with empty `candidateSet`, `reason: "facet vocabulary recognized no fields in text"`.
- Track matched and unmatched surface forms for H-S2-1 `Stage3Input.matchedSurfaceForms` / `unmatchedSurfaceForms`.

**Acceptance criteria:**
- Test case produces the expected single `VariableMatch`.
- A second test case with ambiguous text (two Variables match the same facets) produces an escalation with `candidateSet.length === 2`.
- A third test case with totally unrecognized text produces a `Stage3Input` with `reason` mentioning "recognized no fields" and empty candidate set.

**Notes:**
- DO NOT implement tie-breaking in Stage 2 (SD-Q6).
- DO NOT attempt the three deferred facets (`measuredProperty`, `domainObject`, `basis`) — they remain empty on the partial shape.
- `postContext` parameter is needed so the kernel can access `Stage1PostContext.postUri` for `Stage3Input.postUri`. Pass it alongside `stage1Result`.
- Use `Match.valueTags` from Effect for the residual dispatch — follow Stage 1's `buildMatch` switch style for now; refactor to `Match.valueTags` during this task.

**Step 5 — Commit** `feat(SKY-239): implement Stage 2 facet decomposition lane`.

---

### Task 2d-4.3 — Preserve the Series seam without explicit series resolution

**SD-Q7, scoped down for Slice 2d execution.** The design leaves room for a second pass over `fixedDims`, but this slice does not emit `SeriesMatch` or widen the shared Stage 1 / Stage 2 match union.

**Files:**
- Modify: `src/resolution/Stage2.ts`
- Extend: `tests/stage2-kernel-facet-decomposition.test.ts`

**Dependencies:** 2d-4.2.

**Step 1 — Failing test.** Extend the facet-decomposition test case with a post containing `"installed wind capacity in Germany, annual"`. Run Stage 2 and assert:
- It still resolves or narrows the `Variable` correctly.
- It may populate `partialDecomposition.fixedDims` and/or escalation context for Stage 3.
- It does **not** emit a new match type beyond the existing shared match union for this slice.

**Step 3 — Implement.**
- In `Stage2.ts`: after Pass 1 emits a `VariableMatch`, run Pass 2:
  1. Parse `frequency` from the residual text via `facetVocabulary.parseFrequency`.
  2. For `place`, `market`, `sector` — open-string; attempt exact-match against `Series.fixedDims.{field}` values in the registry. (No vocabulary, per SD-Q7.)
  3. If these hints are cheap and reliable to extract, carry them forward in `partialDecomposition.fixedDims` and/or `Stage3Input` so Slice 6 can use them later.
  4. Do **not** widen `Stage1Match`, do **not** emit `SeriesMatch`, and do **not** add series-specific scoring logic in this slice.

**Acceptance criteria:**
- The test case proves the series seam is preserved without widening the shared match contract.
- `partialDecomposition.fixedDims` remains available for future use when it is cheap to populate.
- No Stage 1 contract changes and no new match variants land in this slice.

**Notes:** This task is intentionally lighter than the earlier draft. The point is to keep the future seam visible while protecting the critical path for the main Stage 2 loop.

**Step 5 — Commit** `feat(SKY-239): preserve fixed-dims seam without explicit series resolution`.

---

### Task 2d-4.4 — Fuzzy lanes: `UnmatchedDatasetTitleResidual` and `UnmatchedTextResidual`

**SD-Q9.** Two lanes, both thin — apply `jaccardTokenSet` against `Dataset.title/aliases` and `Agent.name/alternateNames` indexes respectively.

**Files:**
- Modify: `src/resolution/Stage2.ts`
- Test: `tests/stage2-kernel-fuzzy-lanes.test.ts`

**Dependencies:** 2d-4.1, 2d-4.2.

**Step 1 — Failing test.**
- `UnmatchedDatasetTitleResidual` with `datasetName: "EIA Emmisions Data"` (typo) against a Dataset titled `"EIA Emissions Data"` → expect a `DatasetMatch` with `FuzzyDatasetTitleEvidence` and score > 0.85.
- `UnmatchedTextResidual` with text `"U.S. Energy Info Admin"` against an Agent `"Energy Information Administration"` with alternate `"EIA"` → expect an `AgentMatch` with `FuzzyAgentLabelEvidence` and score > 0.6 (candidate) but < 0.85 (not confident). Confirm the match still lands when above the candidate threshold.
- Negative: Fuzzy score below 0.6 produces no match and no escalation (the residual just passes through unchanged to `Stage3Input` with `stage2Lane: "fuzzy-*"` and empty candidate set).

**Step 3 — Implement.**
- For `UnmatchedDatasetTitleResidual`: iterate every `Dataset` in the registry, compute `jaccardTokenSet(residual.datasetName, dataset.title)`, collect the max-score candidate. If ≥ threshold, emit a `DatasetMatch`; else emit a `Stage3Input` with `stage2Lane: "fuzzy-dataset-title"`, empty candidates, the original residual, and unmatched text.
- For `UnmatchedTextResidual`: iterate every `Agent`, compute max score across `agent.name` + `agent.alternateNames`, same logic.
- Each lane is independent — no interleaving with facet decomposition (SD-Q9).

**Acceptance criteria:**
- Both lanes produce matches on positive cases.
- Below-threshold cases produce escalations.
- Test cases pass.

**Notes:** Stage 1's existing `findAgentByLabel` index is an exact-match map; fuzzy needs to iterate. Iteration over the full Agent/Dataset registry is fine for cold-start scale (≤ 200 Datasets, ≤ 500 Agents). If eval shows this is slow, add a token-shingle index later — not now.

**Step 5 — Commit** `feat(SKY-239): implement Stage 2 fuzzy dataset and agent lanes`.

---

### Task 2d-4.5 — Tie-breaker lane + `UnmatchedUrlResidual` no-op passthrough

**SD-Q6, SD-Q9, SD-Q14.**

**Files:**
- Modify: `src/resolution/Stage2.ts`
- Test: `tests/stage2-kernel-residuals.test.ts`

**Dependencies:** 2d-4.2.

**Step 1 — Failing test.**
- `AmbiguousCandidatesResidual` with 3 tied Dataset candidates → Stage 2 emits a `Stage3Input` with `stage2Lane: "tie-breaker"`, `candidateSet` containing all 3, `reason: "3 candidates tied at rank 1"`.
- `UnmatchedUrlResidual` → Stage 2 emits a `Stage3Input` with `stage2Lane: "no-op"`, empty `candidateSet`, empty `matchedSurfaceForms`, empty `unmatchedSurfaceForms`, `reason: "stage 2 has no action for unmatched URLs"`.

**Step 3 — Implement.**
- Tie-breaker: take the existing `AmbiguousCandidatesResidual.candidates` array and project into `CandidateEntry[]`. Do not attempt to pick a winner — Stage 2 has no tie-breaking policy (SD-Q6).
- URL passthrough: literally emit a minimal `Stage3Input` with all empty fields except `originalResidual`, `postUri`, `stage2Lane: "no-op"`, and a static reason string.

**Acceptance criteria:**
- Both residual kinds produce exactly one `Stage3Input` escalation per input residual.
- `candidateSet` for tie-breaker preserves rank ordering from the original residual.

**Step 5 — Commit** `feat(SKY-239): add tie-breaker and URL no-op lanes`.

---

### Task 2d-4.6 — Stage 2 result composition helper

**SD-Q13.** Merges a `Stage1Result` + `Stage2Result` into a combined result that downstream consumers (Phase 5 eval, Slice 6) read.

**Files:**
- Modify: `src/resolution/Stage2.ts`
- Test: `tests/stage2-composition.test.ts`

**Dependencies:** 2d-4.2, 2d-4.3, 2d-4.4, 2d-4.5.

**Step 1 — Failing test.**
- Build a `Stage1Result` with 1 `DatasetMatch` and 1 `DeferredToStage2Residual`.
- Build a `Stage2Result` with 1 new `VariableMatch` (from facet decomp) and 1 corroboration targeting the existing `DatasetMatch`.
- Call `composeResults(stage1Result, stage2Result)`.
- Assert the combined result has 2 matches: the original `DatasetMatch` with 1 additional Stage 2 evidence item appended to its evidence array, and the new `VariableMatch`.
- Assert the `DeferredToStage2Residual` is absent from combined residuals (it was consumed into a Stage 2 match).
- Assert no duplicate entries.

**Step 3 — Implement.**
```ts
export const composeResults = (
  stage1: Stage1Result,
  stage2: Stage2Result
): { matches: ReadonlyArray<Stage1Match>; residuals: ReadonlyArray<Stage1Residual | Stage3Input> } => { ... }
```
- For each `corroboration` in `stage2.corroborations`, find the matching Stage 1 match by `(grain, entityId)` and append `evidence`.
- Concatenate new Stage 2 matches.
- Residuals = Stage 1 residuals that were NOT consumed by Stage 2, plus Stage 2's escalations as `Stage3Input` entries. Track "which Stage 1 residuals were consumed" via a set keyed on residual content hash (reuse `residualKey` from `Stage1.ts` if exportable, else duplicate the small helper).

**Acceptance criteria:**
- Composition is pure.
- No duplicate residuals.
- Corroborated matches carry both Stage 1 and Stage 2 evidence.
- Test coverage of the merge logic passes.

**Step 5 — Commit** `feat(SKY-239): add Stage1 + Stage2 result composition helper`.

---

### Task 2d-4.6a — Resolver service + Workflow wiring for real Stage 2 output

**Why this exists.** The Stage 2 kernel is not enough on its own. Slice 2d must also return the `stage2` payload on the fast path, persist it in `data-ref-resolution`, and queue Stage 3 with `Stage3Input[]` instead of raw Stage 1 residuals.

**Files:**
- Modify: `src/resolver/ResolverService.ts`
- Modify: `src/resolver-worker/DataRefResolverWorkflow.ts`
- Modify: `src/mcp/Fmt.ts`
- Extend: `tests/resolver-service.test.ts`
- Extend: `tests/resolver-client.test.ts`
- Extend: `tests/enrichment-run-workflow.test.ts`

**Dependencies:** 2d-1.7a, 2d-4.5.

**Step 1 — Failing test.**
- Add a resolver-service test that runs Stage 1 + Stage 2 and asserts the fast-path response includes a non-empty `stage2` payload plus `latencyMs.stage2`.
- Add a resolver-service / workflow test that asserts Stage 3 dispatch now receives `Stage3Input[]`, not `Stage1Residual[]`.
- Add an enrichment persistence test that asserts the stored `data-ref-resolution` payload includes the real `stage2` object.

**Step 3 — Implement.**
- In `ResolverService`, run Stage 2 after Stage 1, include `stage2` on the response when non-empty, and record `latencyMs.stage2`.
- Queue the Workflow from `stage2.escalations` instead of `stage1.residuals`.
- Update the Stage 3 stub so it decodes the new Workflow params and keeps its placeholder result logic intact.
- Update the MCP formatter to show Stage 2 counts or fallback text based on the real `stage2` payload instead of assuming the field is empty / absent.

**Acceptance criteria:**
- Resolver fast-path responses decode with real `stage2` payloads.
- Persisted `data-ref-resolution` enrichments decode with real `stage2` payloads.
- Stage 3 Workflow params are typed `Stage3Input[]`.
- Existing fast-path behaviour still works when Stage 2 returns no matches and no escalations.

**Step 5 — Commit** `feat(SKY-239): wire stage2 payloads through resolver and workflow`.

---

### Task 2d-4.7 — End-to-end integration test: Stage 1 + Stage 2 against a real cold-start candidate

**Files:**
- Create: `tests/stage1-plus-stage2-integration.test.ts`

**Dependencies:** 2d-4.6, 2d-2.11.

**Step 1 — Failing test.**
- Load the checked-in data layer registry via the existing Slice 2a helper (see `tests/checked-in-data-layer-registry.test.ts` for the pattern).
- Build a `Stage1Input` from a real cold-start candidate JSON (pick one from `references/cold-start/candidates/` that is known to fall through Stage 1 with a `DeferredToStage2Residual` — if none exist pre-Stage-2, write a synthetic input whose post text clearly decomposes: `"EIA annual installed wind capacity, United States, 2010-2023"`).
- Run `runStage1(input, lookup)` → `stage1Result`.
- Run `runStage2(stage1Result, input.postContext, lookup, facetVocabulary)` → `stage2Result`.
- `composeResults(stage1Result, stage2Result)`.
- Assert the combined result contains at least one Variable or Dataset match that was NOT in the original Stage 1 result.

**Step 3 — Implement.** No new src code — this is a wiring-up test that exercises every Phase 4 task end-to-end against real data.

**Acceptance criteria:**
- Integration test passes.
- Output is stable (add a JSON snapshot if convenient, but don't over-invest — the eval harness in Phase 5 is the load-bearing regression surface).

**Notes:** If this test reveals a gap in the vocabulary or kernel logic, fix at the origin. Do NOT patch the test to make it pass.

**Step 5 — Commit** `test(SKY-239): add end-to-end Stage 1 + Stage 2 integration test`.

---

### Phase 4 Handoff Verification

```bash
bun run typecheck
bun run test tests/fuzzyMatch.test.ts tests/stage2-kernel-facet-decomposition.test.ts tests/stage2-kernel-fuzzy-lanes.test.ts tests/stage2-kernel-residuals.test.ts tests/stage2-composition.test.ts tests/stage1-plus-stage2-integration.test.ts tests/resolver-service.test.ts tests/resolver-client.test.ts tests/enrichment-run-workflow.test.ts
```

All green. Stage 2 kernel is feature-complete.

---

## Phase 5 — Eval Harness Extension

**Goal of phase:** Extend the Slice 2a eval harness so it runs Stage 1 + Stage 2 end-to-end against the SKY-215 ground truth. Produce a comparative report (Stage 1 alone vs Stage 1 + Stage 2). Add Stage-2-specific miss buckets. Treat threshold values as provisional until the validation gate below passes.

### Task 2d-5.0 — Validate harness semantics before any threshold-tuning claim

**Why this exists.** The design doc flagged harness validity as an unresolved concern. Before Phase 5 is allowed to justify vocabulary tuning or fuzzy-threshold changes, the helpers have to prove they are measuring the right things for combined Stage 1 + Stage 2 output.

**Files:**
- Modify: `eval/resolution-stage1/shared.ts`
- Extend: `tests/stage1-eval.test.ts`
- Modify: `eval/resolution-stage1/README.md`

**Dependencies:** 2d-4.6a.

**Step 1 — Failing test.**
- Add a fixture where Stage 1 defers a post with `fixedDims` hints in the text and Stage 2 either resolves the variable or carries those hints into `Stage3Input`.
- Add a fixture where Stage 2 escalates with `Stage3Input` and the helper classifies the miss into the right Stage 2 bucket instead of leaving it in a Stage 1-only bucket.

**Step 3 — Implement.**
- Add a fixture where Stage 2 escalates with `Stage3Input` and the helper classifies the miss into the right Stage 2 bucket instead of leaving it in a Stage 1-only bucket.
- Keep the actual-ref projection focused on the explicit match types this slice really emits; do not widen the helper to pretend Slice 2d now resolves series when it does not.
- Make the Stage 1-only versus combined-result distinction explicit in the helper naming or docs so future agents do not assume the old four-grain logic still covers Slice 2d.
- Update the README to say the 0.6 / 0.85 thresholds are provisional until this validation task passes.

**Acceptance criteria:**
- Helper tests cover Stage 2-resolved, Stage 2-escalated, and fixed-dims-hint cases.
- README states that threshold tuning is blocked until the validation gate passes.
- No Phase 5 task after this one assumes threshold correctness without citing the validation result.

**Step 5 — Commit** `test(SKY-239): validate eval harness semantics for stage2`.

### Task 2d-5.1 — Extend `eval/resolution-stage1/shared.ts` miss buckets

**Files:**
- Modify: `eval/resolution-stage1/shared.ts`
- Test: extend `tests/stage1-eval.test.ts`

**Dependencies:** 2d-5.0.

**Step 3 — Implement.**
- Extend `Stage1MissBucket` → rename to `ResolutionMissBucket` and add:
  - `"stage2-resolved"` — was `deferred-to-stage2`, now Stage 2 succeeded.
  - `"vocabulary-coverage-gap"` — Stage 2 ran facet decomposition, matched zero facets.
  - `"facet-decomposition-tie"` — Stage 2 ran facet decomposition, produced N > 1 tied candidates (escalated to Stage 3).
  - `"fuzzy-below-threshold"` — Stage 2 fuzzy lane scored below 0.6.
  - `"stage2-noop-url"` — Stage 2 passthrough of `UnmatchedUrlResidual`.
- Update `classifyMissBucket` to inspect the combined Stage 1 + Stage 2 result and assign the most specific bucket.

**Acceptance criteria:**
- New buckets appear in exhaustive test coverage.
- Existing Stage 1 tests still pass.
- At least one test case per new bucket.
- `Stage3Input` escalation paths and fixed-dims-hint paths are covered by the helper tests introduced in 2d-5.0.

**Step 5 — Commit** `feat(SKY-239): extend eval miss buckets for Stage 2`.

---

### Task 2d-5.2 — `eval/resolution-stage1/run-eval.ts` runs Stage 1 + Stage 2

**Files:**
- Modify: `eval/resolution-stage1/run-eval.ts`

**Dependencies:** 2d-5.1.

**Step 3 — Implement.**
- After `runStage1`, call `runStage2` with the loaded `FacetVocabulary` layer.
- Call `composeResults`.
- Pass the combined result into `assessEvalResult`.
- The report should include both "Stage 1 alone" and "Stage 1 + Stage 2" columns per-post.

**Acceptance criteria:**
- `bun eval/resolution-stage1/run-eval.ts` runs to completion against `snapshot.jsonl`.
- Report output includes a side-by-side comparison of Stage 1 only vs Stage 1 + Stage 2 metrics (precision, recall, miss bucket counts) per grain.
- At least one post moves from `deferred-to-stage2` → `stage2-resolved`. (If zero posts move, flag the vocabulary as under-seeded — do NOT declare the phase done.)

**Notes:** The `FacetVocabulary` service needs a real `FileSystem` at eval run time — use `BunContext.layer` from `@effect/platform-bun`, following whatever pattern Slice 2a's eval already uses.

**Step 5 — Commit** `feat(SKY-239): run Stage 2 through the eval harness`.

---

### Task 2d-5.3 — Verification: run the eval and produce a committed report

**Files:**
- Create: `eval/resolution-stage1/runs/2026-04-11-stage2-baseline.md` (or whatever date/format the existing `runs/` dir uses — match it)

**Dependencies:** 2d-5.2.

**Steps:**
1. Run `bun eval/resolution-stage1/run-eval.ts > runs/2026-04-11-stage2-baseline.md`.
2. Inspect the report.
3. Commit the report.
4. Flag in Linear (SKY-239 comment) any miss buckets with counts > 10 — those are the follow-up vocabulary improvements.

**Acceptance criteria:**
- Report file committed under `eval/resolution-stage1/runs/`.
- Report shows side-by-side Stage 1 vs Stage 1+2 numbers.
- Zero regressions on already-resolved posts.

**Step 5 — Commit** `eval(SKY-239): baseline Stage 2 eval run`.

---

### Phase 5 Handoff Verification

```bash
bun run typecheck
bun run test
bun eval/resolution-stage1/run-eval.ts  # smoke test
```

All green. Report committed. Stage 2 Slice 2d is ready to merge.

---

## Final Verification Checklist (before PR)

- [ ] `bun run typecheck` clean (no new errors).
- [ ] `bun run test` green, including all new Stage 2 test files.
- [ ] `bun eval/resolution-stage1/run-eval.ts` runs to completion and produces a committed report.
- [ ] `references/vocabulary/*.json` decodes cleanly under the Phase 3 schemas.
- [ ] No new `node:*` imports in `src/`.
- [ ] No new `try/catch` or `new Promise` or `async function` in `src/`.
- [ ] No new `JSON.parse` calls — all JSON goes through `Schema.parseJson`.
- [ ] All new errors are `Schema.TaggedError`.
- [ ] `Stage3Input` contract matches SD-Q14 verbatim.
- [ ] `ResolvePostResponse.stage2` and persisted `data-ref-resolution.stage2` use the real Stage 2 output schema, not the old placeholder.
- [ ] Stage 3 Workflow params carry `Stage3Input[]`, not raw `Stage1Residual[]`.
- [ ] H-S2-1 check: for every `Stage3Input`, `matchedSurfaceForms` + `unmatchedSurfaceForms` + `partialDecomposition` are fully populated and inspectable.
- [ ] Any threshold-tuning claim in the report cites the Phase 5 validation gate; otherwise thresholds are still called provisional.
- [ ] PR body references SKY-239 and links to the design doc.

---

## Remaining Execution Risks

1. **OEO / UCUM snapshot handling.** This plan assumes the source ontology files are checked into the repo. Do not spend time designing fallback fetch logic in this slice; if the files prove awkward in practice, stop and revisit with the user.
2. **Series is intentionally deferred.** The design still leaves room for explicit series resolution later, but this slice should not accidentally widen the shared match union or pay the repo-wide churn cost while the main Stage 2 loop is still being proven.
3. **Fuzzy thresholds.** 0.6 / 0.85 are initial guesses (SD-Q8). Tune only after Phase 5 eval shows the harness is measuring the right thing; that is why Task 2d-5.0 exists.
4. **OEO → canonical slug mapping.** Task 2d-2.9's initial ≥ 15 slugs may be too narrow. Expect Phase 5 eval to surface gaps. Extend seeds upstream — do not hand-edit `references/vocabulary/technology-or-fuel.json`.
5. **Import cycle risk between `stage1Resolution.ts` and `stage2Resolution.ts`.** Do not let the Stage 1 file import the Stage 2 file directly. Extract neutral shared modules up front in Task 2d-1.6.
6. **Populator Pass 2 (agent-curated review) is explicitly out of scope.** The `notes`-required schema refinement in Task 2d-1.1 supports Pass 2 *when* it runs; the review workflow itself is a follow-up slice, not a code task here.
7. **Eval harness measurement validity.** Before trusting Phase 5 threshold-tuning claims, the harness itself needs a validation pass against SKY-215 ground truth. Task 2d-5.0 is the explicit gate; implementation can proceed before it, but tuning claims cannot.
8. **`technologyOrFuel` schema stays open string (SD-Q3).** Stage 2's curated list can drift from Variables' actual `technologyOrFuel` field values — that's the intended feedback signal. Do not tighten the schema to a closed enum, even if Phase 5 shows drift.

---

## Out of Scope (do NOT implement in this plan)

- Stage 3 LLM implementation (Slice 6, SKY-240).
- `formatForLlm(input: Stage3Input): string` projection function.
- Embeddings / Vectorize / Stage 2.5 (SD-Q10, SD-Q11, SD-Q12 — all deferred).
- Resolver Worker deployment changes (Slice 2c).
- New MCP tools.
- Pass 2 of the populator (agent-curated review workflow).
- Open-string FixedDims vocabulary beyond `frequency` (SD-Q7 keeps `place`, `market`, `sector` as open strings).
- Any tie-breaking policy inside Stage 2 (SD-Q6).

---

## References for the Executing Agent

- Locked design: `docs/plans/2026-04-11-sky-239-stage-2-facet-decomposition-design-interview.md` (source of truth)
- Predecessor design (Stage 1): `docs/plans/2026-04-09-sky-235-stage-1-deterministic-resolver-design-interview.md`
- Repo rules: `CLAUDE.md`
- Stage 1 kernel (copy the shape, not the content): `src/resolution/Stage1.ts`
- Stage 1 registry pattern: `src/resolution/dataLayerRegistry.ts`
- Stage 1 normalization helpers (reuse): `src/resolution/normalize.ts`
- Stage 1 domain types (extend): `src/domain/stage1Resolution.ts`
- Variable / FixedDims / enum schemas (reuse): `src/domain/data-layer/variable.ts`
- Branded IDs (reuse): `src/domain/data-layer/ids.ts`
- Populator predecessor pattern: `scripts/catalog-harvest/harvest-doe-dcat.ts`
- Eval harness entry: `eval/resolution-stage1/run-eval.ts`
- Eval helpers: `eval/resolution-stage1/shared.ts`
- Stage 1 kernel test pattern: `tests/stage1-kernel.test.ts`
- Stage 1 eval test pattern: `tests/stage1-eval.test.ts`
- Effect 4 source for API lookups: `.reference/effect/packages/effect/src/`
- Worked Variable example: `references/cold-start/variables/installed-wind-capacity.json`
