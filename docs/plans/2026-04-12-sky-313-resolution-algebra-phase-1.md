# SKY-313: Resolution Kernel Foundations — Algebra Utilities + Outcome Contract

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

> **Design lock update (2026-04-12):** This plan was re-read against `SKY-313`, `SKY-314`, `SKY-239`, the latest checked-in eval runs, the April 12 ontology notes, and a design interview in this thread. It should no longer be read as a "wire a hard resolvability gate into `Stage2.ts`" plan. The implementation target is now a new resolution kernel with a new public outcome contract.

**Goal:** Extract the reusable algebra utilities (`join`, `subsumes`, `specificity`, mismatch/match helpers) as pure functions and use them as the foundation of a new resolution kernel that consumes structured evidence bundles and returns one authoritative outcome per bundle. This phase is not constrained by backward compatibility with the current Stage 2 gate behavior or the current eval buckets.

**Architecture:** The kernel should be treated as a standalone resolver, not as a minor Stage 2 patch. A thin deterministic front door may still do cheap exact lookups and collect context, but the kernel itself should:

1. consume a structured evidence bundle per asset or post context
2. interpret that bundle into one or more structured hypotheses
3. bind those hypotheses to registry entities when possible
4. emit one top-level outcome with explicit status, shared context, and zero or more item-level resolutions

Stage 3, if it exists at all, is downstream help, not the decision-maker. The current `Stage1 -> Stage2 -> Stage3` semantics are not load-bearing for this plan.

**Tech Stack:** Effect 4 (`Result`, `Predicate`, `Array`, `Order`), Effect Schema domain models, `@effect/vitest`, and `fast-check` under Bun. In this repo, the pure algebra layer should use data modules and combinators from `"effect"` but should not import `Effect`, `Layer`, or `ServiceMap`.

**Research basis:** See `ontology_skill/docs/research/2026-04-12-resolution-algebra.md`, `ontology_skill/docs/research/2026-04-12-text-ops-and-evidence-combination.md`, `ontology_skill/docs/research/2026-04-12-resolution-trace-examples.md`, `ontology_skill/docs/research/2026-04-12-scoring-segmentation-feedback.md`, and `ontology_skill/docs/research/2026-04-12-effect-algebra-mapping.md`.

---

## Status

**Not ready to implement as originally written.** The old gate-centric framing conflicts with the current codebase shape and the latest checked-in eval expectations. The algebra extraction work is still useful, but the hard `measuredProperty + statisticType` gate and the "near-zero-risk precision win" framing are no longer the source of truth.

This document now captures the locked product and design decisions plus a rewritten implementation sequence. The remaining work is product-detail review, not discovering the architecture from scratch.

## Locked decisions

- The implementation target is a **new resolution kernel**, not a backwards-compatible Stage 2 patch.
- The kernel contract is **one structured evidence bundle in, one authoritative outcome out**.
- The kernel outcome status set is:
  - `Resolved`
  - `Ambiguous`
  - `Underspecified`
  - `Conflicted`
  - `OutOfRegistry`
  - `NoMatch`
- Ambiguity is **first-class**. Confidence may rank hypotheses, but it must not auto-collapse an ambiguous case into resolved.
- Conflict is modeled as an **outcome state**, not as a normal facet value carried inside the base partial state.
- The kernel should support **multiple plausible interpretations** inside one outcome when the evidence does not rule rivals out.
- The kernel should support **multi-variable bundles**. For resolved multi-series cases, the preferred shape is **factored**:
  - a shared block for common meaning and shared evidence
  - per-item variants for what changes by series
- The kernel should support **compound surface forms** that project into multiple semantic dimensions at once.
- The kernel should be modeled internally as **interpret first, bind second**.
- The core semantic identity facet set for version 1 is:
  - `measuredProperty`
  - `domainObject`
  - `technologyOrFuel`
  - `statisticType`
  - `aggregation`
  - `unitFamily`
- Reporting context such as place, market, sector, frequency, and time is **attached context**, not part of the core variable identity in version 1.
- Backward compatibility with the current Stage 2 eval buckets is **not** a primary constraint. A new eval set should be written to match the new kernel outputs.

## Provisional assumptions for next pass

- Attached context should likely be represented as a structured sidecar on the outcome, with obvious named fields plus a leftovers bucket.
- The exact replacement eval metrics can be refined after the first kernel fixtures are written.
- Temporary adapters may still use `Stage1` and `Stage2` names at the boundary, but those names should not shape the kernel contract.

## Definitions

- **Evidence bundle** = the structured chart or post evidence the kernel consumes as one unit
- **Hypothesis** = one structured interpretation assembled from a bundle before registry binding
- **Partial assignment** = a partial hypothesis over the six core semantic identity dimensions where `undefined` represents ⊥
- **Facet key** = one of the six core semantic identity dimensions: `measuredProperty`, `domainObject`, `technologyOrFuel`, `statisticType`, `aggregation`, `unitFamily`
- **Compound surface form** = one lexical entry that projects into more than one semantic dimension
- **⊥ (bottom)** = `undefined`, the unspecified value for a semantic dimension
- **Join** = combine two partial assignments dimension-wise; disagreements should surface as competing hypotheses or conflict outcomes, not as silent overwrite
- **Subsumes** = `general ≤ specific`, meaning every non-⊥ dimension in `general` matches `specific`
- **Specificity** = count of non-⊥ semantic dimensions
- **Resolved** = the bundle narrows to one coherent interpretation with no live rivals after interpretation and binding

## Effect mapping refinements

- The algebra module should live in `src/domain/partialVariableAlgebra.ts`, not under `src/resolution/`, because it is a pure data module over domain types.
- The algebra layer should use this boundary rule:
  - if a function only touches `PartialVariableShape` values or other pure domain data, it belongs in the algebra module
  - if a function reads from registry lookups, vocabulary services, or mutable resolver state, it belongs in the resolver layer
- In this repo, use `Result` for partial algebra operations that can fail with typed data, instead of copying `Either`-based snippets from advisory notes.
- The lattice bottom element is the empty partial `{}`, not `Option.none()`.
- Predicate composition should use `Predicate` helpers where it makes the code clearer, especially for refinements and reusable filters, but the pure candidate-filter pipeline itself should stay a plain `pipe(..., Array.filter, Array.map, Array.sort)` transformation.
- `Effect.gen` starts at the resolver and service boundary. It should not appear inside the pure algebra module.
- Algebraic soundness for this phase means the law suite passes under generated inputs. Handwritten unit tests are necessary but not sufficient.

## Phase overview

1. Phase 1 — pure algebra and kernel domain contract
2. Phase 2 — structured evidence bundles and compound lexical projection
3. Phase 3 — interpretation engine
4. Phase 4 — registry binding and outcome assembly
5. Phase 5 — resolver integration
6. Phase 6 — replacement eval harness

Each phase should end with `bun run typecheck` and the relevant focused tests passing before moving on.

## Phase 1 — Pure algebra and kernel domain contract

**Goal:** Lock the pure math layer and the top-level kernel types before any resolver orchestration work starts.

**Files:**

- Create: `src/domain/partialVariableAlgebra.ts`
- Create: `src/domain/resolutionKernel.ts`
- Modify: `src/domain/errors.ts`
- Create: `tests/partialVariableAlgebra.test.ts`
- Create: `tests/partialVariableAlgebra.property.test.ts`
- Create: `tests/resolution-kernel-domain.test.ts`

**Work:**

1. Define the six locked semantic identity facets in `FACET_KEYS`.
2. Add typed conflict data for failed joins in `src/domain/errors.ts`.
3. Implement the pure algebra helpers:
   - `joinPartials`
   - `subsumes`
   - `specificity`
   - `matched`
   - `mismatched`
   - `subsumptionRatio`
4. Define the kernel domain schemas:
   - `ResolutionEvidenceBundle`
   - `ResolutionHypothesis`
   - `AttachedContext`
   - `BoundResolutionItem`
   - `ResolutionOutcome`
5. Make the outcome union encode the locked statuses:
   - `Resolved`
   - `Ambiguous`
   - `Underspecified`
   - `Conflicted`
   - `OutOfRegistry`
   - `NoMatch`

**Acceptance criteria:**

- The algebra module compiles as a pure domain module.
- Kernel schemas round-trip under Effect Schema tests.
- The phase exposes no stage-specific jargon in the public kernel types.

## Phase 2 — Structured evidence bundles and compound lexical projection

**Goal:** Convert current inputs into the structured bundle shape the kernel expects, and support one lexical entry projecting into multiple semantic dimensions.

**Files:**

- Create: `src/domain/compoundSurfaceForm.ts`
- Create: `src/resolution/facetVocabulary/CompoundSurfaceForm.ts`
- Create: `src/resolution/kernel/BundleAdapter.ts`
- Modify: `src/resolution/facetVocabulary/index.ts`
- Create: `tests/compound-surface-form.test.ts`
- Create: `tests/resolution-bundle-adapter.test.ts`

**Work:**

1. Define a compound lexical-entry schema that projects one surface form into a partial semantic assignment.
2. Add lookup support for compound entries alongside the existing per-facet lookups.
3. Build a bundle adapter that folds current inputs into one `ResolutionEvidenceBundle`, including:
   - post text
   - chart title
   - axis labels
   - series labels
   - key findings
   - source and publisher hints
4. Preserve the locked precedence rule in the bundle semantics:
   - series labels strongest
   - axis labels next
   - title after that
   - key findings and post text as supporting context

**Acceptance criteria:**

- One bundle object can be built deterministically from the current resolver inputs.
- Compound surface forms can fill multiple semantic dimensions in one step.
- Bundle adapter tests prove shared evidence and per-item evidence are both preserved.

## Phase 3 — Interpretation engine

**Goal:** Turn one structured evidence bundle into one or more structured hypotheses without touching the registry yet.

**Files:**

- Create: `src/resolution/kernel/Interpret.ts`
- Create: `tests/resolution-interpret.test.ts`

**Work:**

1. Implement a pure interpretation pass:
   - project lexical matches into partial assignments
   - join compatible evidence
   - preserve incompatible evidence as competing hypotheses or conflict signals
2. Support multi-variable bundles by producing factored interpretations with:
   - shared semantic content
   - per-item varying content
3. Do not collapse ambiguity just because one hypothesis looks stronger.
4. Carry attached context separately from the core semantic identity.

**Acceptance criteria:**

- Interpretation runs as a pure transformation over a bundle plus lookup data.
- Multi-series examples produce shared-plus-varying hypotheses instead of duplicated flat blobs.
- Ambiguous and conflicted cases remain explicit after interpretation.

## Phase 4 — Registry binding and outcome assembly

**Goal:** Bind interpreted hypotheses to registry entities when possible and assemble one authoritative outcome.

**Files:**

- Create: `src/resolution/kernel/Bind.ts`
- Create: `src/resolution/kernel/AssembleOutcome.ts`
- Create: `tests/resolution-bind.test.ts`
- Create: `tests/resolution-outcome.test.ts`

**Work:**

1. Bind hypotheses against registry variables using the pure algebra helpers.
2. Use `subsumes`, `matched`, `mismatched`, and `subsumptionRatio` for ranking and explanation.
3. Allow optional narrowing by already-known structural context such as agent or dataset hints, but do not require a single winner when evidence does not justify one.
4. Assemble one outcome per bundle:
   - `Resolved` when one coherent interpretation survives
   - `Ambiguous` when multiple live interpretations remain
   - `Underspecified` when the bundle conveys something real but not enough
   - `Conflicted` when the evidence cannot be reconciled
   - `OutOfRegistry` when a coherent interpretation survives but no registry binding exists
   - `NoMatch` when no meaningful interpretation survives

**Acceptance criteria:**

- Binding is a pure pipeline over hypotheses and registry data.
- Confidence ranks candidates but never silently erases ambiguity.
- The assembled outcome matches the locked contract exactly once per bundle.

## Phase 5 — Resolver integration

**Goal:** Consume the pure kernel from the existing resolver boundary without reintroducing stage-driven semantics.

**Files:**

- Create: `src/resolution/ResolutionKernel.ts`
- Modify: `src/resolution/Stage2Resolver.ts`
- Create: `tests/resolution-kernel.integration.test.ts`

**Work:**

1. Wrap the pure kernel in an effectful service boundary.
2. Keep `Effect.gen` at the service and orchestration layer only.
3. If existing `Stage1` or `Stage2` names must remain temporarily, use them as adapters only.
4. Add one narrow integration test proving:
   - pure algebra stays pure
   - the resolver can supply lookup services and bundle input
   - the kernel outcome survives the boundary unchanged

**Acceptance criteria:**

- The resolver integration test passes without mocking the algebra itself.
- The service boundary is thin and does not duplicate kernel logic.
- Old stage semantics do not leak back into the kernel contract.

## Phase 6 — Replacement eval harness

**Goal:** Score the new kernel against its own contract, not the legacy Stage 2 buckets.

**Files:**

- Create: `eval/resolution-kernel/run-eval.ts`
- Create: `eval/resolution-kernel/fixtures/`
- Create: `eval/resolution-kernel/README.md`

**Work:**

1. Define a new eval fixture format that can express:
   - one top-level outcome per bundle
   - multi-item resolved outcomes
   - ambiguity
   - conflict
   - out-of-registry cases
2. Score the right things for the new kernel:
   - outcome status accuracy
   - binding accuracy for resolved items
   - ambiguity preservation
   - out-of-registry detection
3. Stop treating the old Stage 2 `wrong-new-match` bucket as the main optimization target.

**Acceptance criteria:**

- The eval harness can score every locked outcome status.
- At least one multi-variable case and one out-of-registry case are in the checked-in fixture set.
- The report is reproducible under Bun from repo state alone.

## Algebraic soundness gate

This is the minimum proof burden for the pure algebra layer. The plan is not complete until the law suite passes.

**Property suite requirements:**

- join commutativity
- join associativity
- empty partial identity
- subsumption reflexivity
- subsumption transitivity
- specificity monotonicity under successful join
- successful join result is subsumed by both inputs
- `subsumes(a, b)` iff `mismatched(a, b).length === 0`
- if `subsumes(a, b)`, then `specificity(a) <= specificity(b)`

**Generator rules:**

- Generate partials by independently choosing each of the six core facets as either `undefined` or one of a small set of real canonical values.
- Keep value sets intentionally small so conflict paths are exercised often.
- Normalize away `undefined` keys before structural equality checks.

**Repo-specific notes:**

- Use `@effect/vitest` in test examples.
- `fast-check` is already available in this repo; do not add a package-install task unless that changes.
- Prefer `Result`-based examples over advisory snippets that assume a different import shape.

## File inventory

| File | Action | Purpose |
| --- | --- | --- |
| `src/domain/partialVariableAlgebra.ts` | Create | Pure algebra helpers and facet constants |
| `src/domain/resolutionKernel.ts` | Create | Public kernel domain types and outcome contract |
| `src/domain/compoundSurfaceForm.ts` | Create | Compound lexical-entry schema |
| `src/resolution/facetVocabulary/CompoundSurfaceForm.ts` | Create | Compound lexical lookup support |
| `src/resolution/kernel/BundleAdapter.ts` | Create | Adapter from current resolver inputs to structured bundle |
| `src/resolution/kernel/Interpret.ts` | Create | Pure interpretation pass |
| `src/resolution/kernel/Bind.ts` | Create | Pure binding pipeline against registry data |
| `src/resolution/kernel/AssembleOutcome.ts` | Create | One-outcome assembly logic |
| `src/resolution/ResolutionKernel.ts` | Create | Thin effectful service wrapper |
| `tests/partialVariableAlgebra.test.ts` | Create | Unit tests for algebra helpers |
| `tests/partialVariableAlgebra.property.test.ts` | Create | Property-based law suite |
| `tests/resolution-kernel-domain.test.ts` | Create | Schema round-trip and contract tests |
| `tests/resolution-bundle-adapter.test.ts` | Create | Structured bundle tests |
| `tests/resolution-interpret.test.ts` | Create | Hypothesis-generation tests |
| `tests/resolution-bind.test.ts` | Create | Registry binding tests |
| `tests/resolution-outcome.test.ts` | Create | Outcome assembly tests |
| `tests/resolution-kernel.integration.test.ts` | Create | Resolver-boundary integration test |
| `eval/resolution-kernel/run-eval.ts` | Create | New eval runner for kernel statuses |

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Old gate assumptions leak back into implementation | Treat the locked outcome contract as the source of truth and do not revive the hard `resolvable()` gate as the primary decision rule. |
| The pure/effect boundary gets blurred again | Keep algebra and outcome modeling in `src/domain/`; keep service wiring in the resolver layer only. |
| Ambiguity gets collapsed too early by ranking | Confidence may order hypotheses, but it must not convert `Ambiguous` into `Resolved` by itself. |
| Bundle adapters lose important structure from charts | Test shared evidence, per-series evidence, and attached context explicitly before binding work starts. |
| The new eval harness accidentally reuses legacy assumptions | Write fixtures directly against the locked statuses and multi-item outcome shape. |
