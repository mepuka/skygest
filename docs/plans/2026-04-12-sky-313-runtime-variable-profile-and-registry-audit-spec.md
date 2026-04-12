# SKY-313: Runtime Variable Profile + Registry Readiness Specification

**Status:** Design locked for the next implementation slice.

**Companion:** This document is the companion specification for [2026-04-12-sky-313-resolution-algebra-phase-1.md](./2026-04-12-sky-313-resolution-algebra-phase-1.md). The phase-1 plan defines the kernel direction. This document defines the runtime variable profile, the registry-readiness model, and the clean next slice that moves ontology decisions into the TypeScript layer.

## Purpose

The goal of this specification is to capture the findings from the design interview, the ontology review, and the runtime audit in one place so implementation can proceed against a stable contract.

This document focuses on four things:

1. the ontology layers that matter to the resolver
2. the current runtime drift against those layers
3. the decisions now locked for the TypeScript runtime
4. the clean implementation slice that should land next

## Source Citations

- `[O1]` `../../../ontology_skill/docs/plans/2026-04-12-skygest-data-model-design.md:65-167`
- `[O2]` `../../../ontology_skill/ontologies/skygest-energy-vocab/docs/use-cases-dcat-extension.yaml:4-80`
- `[O3]` `../../../ontology_skill/ontologies/skygest-energy-vocab/docs/competency-questions-dcat-extension.yaml:143-180`
- `[O4]` `../../../ontology_skill/ontologies/skygest-energy-vocab/docs/competency-questions-dcat-extension.yaml:258-266`
- `[O5]` `../../../ontology_skill/ontologies/skygest-energy-vocab/docs/competency-questions-dcat-extension.yaml:350-358`
- `[O6]` `../../../ontology_skill/ontologies/skygest-energy-vocab/scripts/generate_types_from_shacl.py:24-40,94-140,150-190`
- `[R1]` `src/domain/data-layer/variable.ts:10-60`
- `[R2]` `src/domain/data-layer/catalog.ts:141-190`
- `[R3]` `src/domain/partialVariableAlgebra.ts:15-59`
- `[R4]` `src/resolution/facetVocabulary/index.ts:74-102,168-203`
- `[R5]` `src/resolution/facetVocabulary/vocabularyFacets.ts:27-63`
- `[R6]` `src/resolution/dataLayerRegistry.ts:35-70,367-390,533-610`

## Executive Summary

The ontology and the runtime are currently aligned in intent but not yet aligned in representation.

The ontology side already says that:

- an `EnergyVariable` is composed from seven semantic dimensions, including `policyInstrument` `[O1]`
- the resolver should use both semantic composition and structural traversal (`Variable -> Dataset -> Agent`) `[O1] [O2]`
- the required pair is `measuredProperty` plus `statisticType`, with the other five semantic dimensions optional `[O4]`
- the structural chain depends on `sevocab:hasVariable` and `dct:publisher` `[O3] [O5]`

The runtime still drifts from that model in a few important ways:

- the data-layer `Variable` still hard-codes closed enum members and still uses `basis` instead of `policyInstrument` `[R1]`
- the algebra previously hard-coded a six-facet kernel profile and its required facet list separately from the vocabulary layer `[R3]`
- the vocabulary layer already exposes seven facets, including `policyInstrument`, which means the runtime currently disagrees with itself `[R4] [R5]`
- `Dataset` stores publisher information, but there is still no dataset-owned variable-membership edge in the runtime schema `[R2]`
- the registry preparation path is still broad and binary; it does not yet produce a kernel-ready subset or typed readiness findings `[R6]`
- a SHACL-to-TypeScript generator already exists in the ontology repo, but today it only prints previews and manifests instead of writing a checked-in runtime artifact `[O6]`

The next slice should fix those mismatches first. It should not jump straight to full binding or a full replacement eval harness.

## Ontology Layers and Runtime Mapping

### 1. Vocabulary Layer

The vocabulary layer is the SKOS layer that defines canonical values and surface forms for the semantic dimensions. In practice, this is where the resolver gets:

- canonical facet values
- alternative labels and normalized surface forms
- collision checks inside each scheme

The runtime should continue to treat surface-form matching as a vocabulary concern. The resolver should not invent canonical values on its own. `[O1] [R4] [R5]`

**Runtime mapping**

- Keep vocabulary JSON as checked-in runtime input.
- Keep surface-form lookup services in `src/resolution/facetVocabulary/`.
- Move canonical-value truth into one explicit runtime profile module instead of scattering hand-maintained literals.

### 2. Variable Semantics Layer

The variable semantics layer is the `EnergyVariable` model plus the `qb:DataStructureDefinition` that declares its dimensions. The ontology design doc is explicit that the variable is seven-dimensional and that the kernel should use that dimensional structure directly. `[O1]`

The seven active semantic dimensions for runtime v1 are:

- `measuredProperty`
- `domainObject`
- `technologyOrFuel`
- `statisticType`
- `aggregation`
- `unitFamily`
- `policyInstrument`

The required-vs-optional rule is also already explicit in the competency questions:

- required: `measuredProperty`, `statisticType`
- optional: `domainObject`, `technologyOrFuel`, `aggregation`, `unitFamily`, `policyInstrument` `[O4]`

**Runtime mapping**

- The runtime variable profile should adopt all seven dimensions now.
- `policyInstrument` is first-class in v1.
- `basis` should be removed from the active runtime variable contract.
- Stored variables should use canonical vocabulary values for all seven semantic dimensions.
- Attached reporting context such as place, market, sector, frequency, and time remains separate from variable identity.

### 3. Structural DCAT Layer

The ontology does not ask the runtime to model all of DCAT. It asks the runtime to model the part of the structure that the resolver needs in order to disambiguate real candidates. The key use cases and competency questions all point to the same structural spine:

- a dataset has variables
- a dataset has a publisher
- the kernel can traverse from variable to dataset to agent to reduce ties `[O2] [O3] [O5]`

**Runtime mapping**

- Version 1 should model this spine with high fidelity.
- The canonical stored edge should be dataset-owned membership: `Dataset -> variableIds`.
- The reverse `Variable -> Dataset` map should be derived at registry-load time.
- `Distribution` and `DataService` remain useful provenance entities, but they are not part of the minimum bind-time disambiguation spine for this slice.

## Current Runtime Drift

### Hard-Coding Inventory

| Thing | Should come from | Currently in | Impact |
| --- | --- | --- | --- |
| `FACET_KEYS` | EnergyVariable structure / SHACL-backed profile | `src/domain/partialVariableAlgebra.ts` `[R3]` | High drift risk |
| `REQUIRED_FACET_KEYS` | Required-vs-optional ontology rule | `src/domain/partialVariableAlgebra.ts` `[R3]` | Medium drift risk |
| `StatisticTypeMembers` | SHACL / scheme canonical set | `src/domain/data-layer/variable.ts` `[R1]` | Blocker |
| `AggregationMembers` | SHACL / scheme canonical set | `src/domain/data-layer/variable.ts` `[R1]` | Blocker |
| `UnitFamilyMembers` | SHACL / scheme canonical set | `src/domain/data-layer/variable.ts` `[R1]` | Blocker |
| Open semantic facet values | Vocabulary canonical sets | `src/domain/data-layer/variable.ts` `[R1]` | Correctness risk |
| Vocabulary facet list | Runtime variable profile | `src/resolution/facetVocabulary/vocabularyFacets.ts` `[R5]` | Currently separate truth source |
| Variable membership edge | `sevocab:hasVariable` | Missing from runtime dataset schema `[R2]` | Blocker |
| Kernel-ready registry subset | Runtime readiness artifact | Missing from registry prepare path `[R6]` | Blocker |
| Stored-value validation | Profile canonical sets + vocabulary JSON | Missing from registry load `[R6]` | Correctness blocker |

### Real Failure Modes

1. Closed-enum drift
   If the ontology adds a new closed value, the vocabulary export can change while the TypeScript literals stay stale. That makes the runtime disagree with the ontology until someone updates code by hand. `[O6] [R1]`

2. Structural chain unrepresented
   The ontology assumes `Dataset -> Variable` and `Dataset -> Agent`. The runtime currently only represents the publisher side. Without dataset-owned variable membership, structural disambiguation cannot be modeled directly. `[O2] [O3] [R2]`

3. Stored-value drift
   The runtime currently accepts open strings for several semantic dimensions. That means a checked-in variable can carry a typo or a non-canonical label and still load. The vocabulary layer only validates free-text matching, not stored registry truth. `[R1] [R4] [R6]`

## Locked Design Decisions

### Resolver Direction

- This work serves the new resolution kernel, not backward compatibility with the old Stage 2 gate behavior.
- The kernel remains interpret-first and bind-second.
- Ambiguity remains first-class and is not collapsed by confidence alone.

### Runtime Variable Profile

- The runtime profile is now seven-dimensional.
- `policyInstrument` is part of the active profile in v1.
- `basis` is stale model language and should be removed from touched runtime surfaces.
- The required pair remains `measuredProperty` plus `statisticType`.
- Stored variables should use canonical values, not free-form synonyms, for all seven semantic dimensions.

### Structural Model

- The runtime should model the structural spine with high fidelity, but it does not need to model the entire DCAT ontology in this slice.
- `Dataset -> variableIds` is the canonical stored relationship.
- `Dataset -> publisherAgentId` remains the publisher edge.
- Reverse maps such as `Variable -> Dataset` and `Agent -> Datasets -> Variables` are derived at registry-load time.

### Readiness Model

- Keep one broad checked-in registry.
- Derive a smaller `kernel-ready` subset for binding.
- Readiness is tracked at two levels:
  - dataset-level structural readiness
  - variable-level semantic readiness
- Core profile violations are hard blockers.
- Secondary provenance gaps are advisory findings.
- The audit should produce a typed readiness artifact, not just a pass/fail log.

### Source-of-Truth Rules

- Closed sets and canonical facet metadata should live in one explicit runtime profile module.
- Structural modeling remains a hand-authored TypeScript artifact for now.
- Ontology-driven generation is still desirable, but it is a later hardening step rather than a prerequisite for this slice.

## Discussion Issues Resolved

### Issue 1: Should the runtime stay seven-facet now?

Yes. The ontology design and the runtime vocabulary already point to seven semantic dimensions. Keeping the runtime below that would preserve drift in the most important place. `[O1] [R3] [R4]`

### Issue 2: Should `basis` and `policyInstrument` coexist for compatibility?

No. That would create a two-language model and force every later layer to translate between them. The runtime should adopt `policyInstrument` directly. `[O1] [R1] [R4]`

### Issue 3: Should the runtime model all of DCAT before binding?

No. The slice should model the structural core the resolver actually needs: dataset-owned variable membership plus publisher linkage. `[O2] [O3] [O5] [R2]`

### Issue 4: Should the registry become all-or-nothing?

No. The checked-in data layer is broader than the binding subset. The audit should preserve broad coverage while carving out a smaller kernel-ready slice. `[R6]`

### Issue 5: Should the dormant SHACL generator block this slice?

No. The current slice should use one honest hand-maintained runtime profile module now, then wire the dormant SHACL generator as a later hardening step once the ontology artifacts are part of the app-side workflow. `[O6]`

### Issue 6: Is centralizing the profile enough by itself?

No. A shared profile module reduces metadata drift, but it does not validate the values already stored in checked-in variables. Registry-load validation still needs to check those stored values against the canonical sets. `[O6] [R1] [R6]`

## TypeScript Runtime Profile

The runtime should introduce one explicit profile artifact that the algebra layer, the data-layer schemas, the registry audit, and the binder can all read from.

This profile should define:

- the seven active semantic dimensions
- the required pair
- the canonical closed sets for `statisticType`, `aggregation`, and `unitFamily`
- the canonical value sets for `measuredProperty`, `domainObject`, `technologyOrFuel`, and `policyInstrument`
- the structural readiness rules for the minimum DCAT spine

### Recommended artifact split

**Shared profile artifact**

- `src/domain/profile/energyVariableProfile.ts`

This file should centralize the runtime facet contract for now. It should export:

- `FACET_KEYS`
- `REQUIRED_FACET_KEYS`
- `StatisticTypeMembers`
- `AggregationMembers`
- `UnitFamilyMembers`
- `MeasuredPropertyCanonicals`
- `DomainObjectCanonicals`
- `TechnologyOrFuelCanonicals`
- `PolicyInstrumentCanonicals`

**Hand-authored runtime rules**

- `src/domain/runtimeVariableProfile.ts`

This file should define:

- how the shared semantic metadata is used in the app
- the dataset-owned structural edge rules
- readiness classification rules
- which failures are blocking vs advisory

The point of the split is simple:

- one explicit profile module for the shared semantic contract
- hand-authored runtime rules for product/runtime policy
- future generator wiring can replace the profile module inputs later without changing the rest of the app contract

## Registry Audit Contract

The next slice should replace the current binary prepare path with a richer readiness artifact.

### Current limitation

Today `prepareDataLayerRegistry` either succeeds with one broad prepared registry or fails with diagnostics. It does not expose a smaller kernel-ready subset or readiness classifications that later steps can consume directly. `[R6]`

### Required audit output

The new audit result should contain:

- the broad checked-in registry
- the kernel-ready subset
- blocking issues
- advisory findings
- enough per-dataset and per-variable detail to explain exclusions

### Minimum readiness rules

**Dataset-level hard blockers**

- missing variable membership
- missing publisher edge
- broken references in the structural spine

**Variable-level hard blockers**

- unknown semantic facet names or stale model fields
- unknown canonical values for any populated semantic facet
- use of `basis` in the active variable contract

**Advisory findings**

- missing distribution links
- missing data-service links
- other secondary provenance gaps that do not break v1 binding

## Clean Implementation Slice

This is the next slice that should land before deeper bind work.

### Step 1: Establish the runtime profile module

**Goal:** stop hand-maintaining closed facet metadata.

**Work**

- Introduce one explicit profile module in `skygest-cloudflare` for the runtime facet contract.
- Move the closed enum members, canonical open-vocabulary value sets, facet keys, and required facet keys into that profile module.
- Add a clear header stating that the module is hand-maintained and not generated in-repo yet.

**Outcome**

- one explicit profile module becomes the source of truth for closed enum members, canonical open-vocabulary value sets, facet keys, and required facet keys

### Step 2: Replace hand-written facet metadata in the runtime

**Goal:** make the runtime consume the shared profile module instead of duplicating facet metadata.

**Work**

- Update `src/domain/data-layer/variable.ts` to import the profile closed sets. `[R1]`
- Update `src/domain/partialVariableAlgebra.ts` to import `FACET_KEYS` and `REQUIRED_FACET_KEYS` from the profile module. `[R3]`
- Update `src/resolution/facetVocabulary/vocabularyFacets.ts` and related vocabulary code so it uses the same profile language. `[R4] [R5]`
- Replace `basis` with `policyInstrument` anywhere the active runtime variable contract is touched. `[R1] [R4]`

**Outcome**

- the runtime stops carrying separate hand-maintained truth sources for core semantic metadata

### Step 3: Add the structural spine to the data-layer model

**Goal:** make structural disambiguation representable in the runtime.

**Work**

- Add dataset-owned variable membership to `Dataset`.
- Keep publisher linkage on `Dataset`.
- Derive reverse lookup indexes at registry-load time.

**Outcome**

- the runtime can model `Variable -> Dataset -> Agent` traversal without duplicating source-of-truth edges `[O2] [O3] [O5]`

### Step 4: Introduce the registry-readiness artifact

**Goal:** separate broad checked-in truth from bindable truth.

**Work**

- Extend the registry-prepare path so it emits a typed readiness artifact instead of only a binary prepared registry result. `[R6]`
- Derive a kernel-ready subset from that audit.
- Track dataset-level and variable-level readiness separately.

**Outcome**

- later binder work can consume the kernel-ready subset directly

### Step 5: Validate stored variable values against canonical sets

**Goal:** catch seed-data drift at load time instead of at bind time.

**Work**

- Validate each populated semantic facet value against the profile canonical sets.
- Add a typed audit issue for unknown or non-canonical stored values.
- Exclude such variables from the kernel-ready subset while preserving them in the broad registry.

**Outcome**

- checked-in typos and stale values become immediate, explainable audit findings

### Step 6: Add parity and readiness tests

**Goal:** prove the new contract is real.

**Work**

- add parity tests proving the profile module and runtime imports stay aligned
- add registry-audit tests covering:
  - missing dataset variable membership
  - missing publisher
  - unknown semantic facet value
  - mixed datasets where some variables are ready and some are not
- keep the current checked-in registry load test, but expand it to assert readiness behavior

**Outcome**

- the slice has a concrete, repeatable correctness boundary

## Acceptance Criteria for This Slice

This slice is done when all of the following are true:

- the runtime no longer hand-maintains closed enum members or facet keys in multiple places
- the active runtime variable profile is seven-dimensional and uses `policyInstrument`
- `Dataset -> variableIds` exists as the canonical stored membership edge
- registry load produces:
  - a broad registry
  - a kernel-ready subset
  - typed blocking issues
  - typed advisory findings
- stored variable semantic values are validated against profile canonical sets
- tests prove parity between profile metadata and runtime use

## Explicitly Out of Scope for This Slice

- full interpret/bind implementation
- the full replacement eval harness
- ontology-driven generation of the entire structural graph
- refactoring the runtime to class-based schemas only for structural equality convenience

Those may follow, but they do not block this slice.

## Follow-Up Work After This Slice

Once this slice lands, the next implementation work should be:

1. interpretation over the now-stable seven-facet runtime profile
2. binding over the kernel-ready registry subset
3. outcome assembly against the new kernel contract
4. the thinner new kernel eval harness, then later the fuller replacement harness

## Why This Is the Right Slice

This slice is the smallest one that removes the highest-value sources of drift:

- semantic metadata drift
- structural graph drift
- silent stored-value drift

It also creates the right boundary for the rest of the kernel work:

- ontology-derived semantics become explicit in TypeScript
- runtime policy stays explicit and hand-authored where it should
- binding can target a clean subset instead of a noisy broad registry

That is the point where the resolver stops approximating the ontology model and starts using it directly.
