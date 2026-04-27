# Ontology Store Migration Inventory

**Status:** Pre-consolidation snapshot. Authored 2026-04-27 as Task 1 of the energy-intel Expert vertical slice (`docs/plans/2026-04-27-energy-intel-expert-slice-impl-plan.md`).

**Purpose:** Categorize every file under `packages/ontology-store/` so Task 2 (`refactor(ontology-store): remove DCAT-only EmitSpec content`) can run `git rm` against the `REPLACE` and `DELETE` rows without further analysis.

**Source of truth:** `docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md` (the abstraction) and `docs/plans/2026-04-27-energy-intel-expert-vertical-slice-design.md` (the slice scope). DCAT-specific machinery is being removed in favor of per-entity hand-written modules + TTL-driven codegen. The package skeleton (N3.js, SHACL harness, scripts dir, shapes dir, tests dir, package.json) survives.

**Categories:**
- **KEEP** — Survives unchanged. Reused by the new energy-intel pipeline.
- **TRIM** — Stays but loses dead code (none flagged in this slice — `Reasoner.ts` was already removed).
- **REPLACE** — Deleted in Task 2; logical successor exists in the new pipeline (per-entity module, codegen output, expert SHACL shape, etc.).
- **DELETE** — Deleted outright in Task 2; no successor.

## Inventory

| Path | Category | LOC | Reason | Replacement (if any) |
|------|----------|----:|--------|----------------------|
| `package.json` | KEEP | 23 | Package manifest skeleton. Dependencies (`@rdfjs/data-model`, `@rdfjs/dataset`, `n3`, `shacl-engine`, `effect`) all survive into the energy-intel pipeline. | — |
| `tsconfig.json` | KEEP | 8 | Build config. Survives unchanged. | — |
| `tsconfig.test.json` | TRIM | 13 | Survives, but the `../../scripts/generate-emit-spec.ts` include path on line 10 must be removed when that script is deleted in Task 2. | — |
| `vitest.config.ts` | KEEP | 9 | Test runner config. Reused by all surviving + new tests. | — |
| `shapes/dcat-instances.ttl` | REPLACE | 212 | DCAT-only SHACL shapes (Agent, Catalog, Dataset, Distribution, …) for the legacy 9-class application profile. Entire energy-intel slice targets `ei:Expert` instead. | `shapes/expert.ttl` (Phase D, hand-written). |
| `generated/emit-spec.json` | REPLACE | 2031 | Committed output of `scripts/generate-emit-spec.ts` — the JSON spec interpreter's input. Entire JSON-spec interpreter pattern is being removed. | `src/generated/agent.ts` (TTL-driven Effect codegen, Phase C/D). |
| `src/index.ts` | TRIM | 9 | Barrel re-exports. Phase A/Task 2 strips deleted exports (`distill`, `emit`); KEEPs (`IRI`, `RdfError`, `ShaclValidationReport`, `ShaclViolation`, `RdfStoreService`, `ShaclService`) survive. | — |
| `src/Domain/Rdf.ts` | KEEP | 42 | `IRI` brand + `RdfError` tagged error + `mapRdfError` mapper. Reused as-is by all new mapping modules (per architecture doc §1, §2). | — |
| `src/Domain/Shacl.ts` | KEEP | 74 | `ShaclSeverity`, `ShaclViolation`, `ShaclValidationReport` schemas + `ShapesLoadError`, `ShaclValidationError` tagged errors. Reused as-is by the SHACL harness. | — |
| `src/Domain/EmitSpec.ts` | REPLACE | 282 | Entire DCAT JSON spec interpreter schema (`ValueKind`, `Cardinality`, `ForwardField`, `ReverseField`, `ClassEmitSpec`, `EmitSpec`). Architecture doc §1: "no JSON spec interpreter, no runtime walker". | Pure types in generated `src/generated/agent.ts` + hand-written `src/agent/expert.ts` (Phase D). |
| `src/Service/RdfStore.ts` | KEEP | 163 | N3-backed `RdfStoreService` (`makeStore`, `addQuads`, `query`, `parseTurtle`, `toTurtle`). Architecture doc §1 stage 4 RDF round-trip uses this directly; round-trip phase test scaffold also depends on it. | — |
| `src/Service/Shacl.ts` | KEEP | 241 | `ShaclService.loadShapes` + `validate` over `shacl-engine`. Architecture doc §2: "SHACL is build-time + test-only". This is the harness. | — |
| `src/aliasEmitter.ts` | REPLACE | 132 | Emits SKOS alias triples from `ExternalIdentifier` (DCAT data-layer alias scheme). The energy-intel agent module has no `aliases` field; alias emission is no longer a cross-cutting concern. | Per-entity `toTriples` in `src/agent/expert.ts` (Phase D). |
| `src/distill.ts` | REPLACE | 1 | One-line re-export of `distillEntities` from `src/mapping/reverse.ts`. Disappears with the JSON-spec interpreter. | `expertFromTriples` in `src/agent/expert.ts` (Phase D). |
| `src/emit.ts` | REPLACE | 28 | `Effect.fn` wrapper that decodes a `DataLayerRegistryEntity` and runs `emitEntityQuads` from the JSON-spec walker. Disappears with the interpreter. | `expertToTriples` in `src/agent/expert.ts` (Phase D). |
| `src/loadedEmitSpec.ts` | REPLACE | 6 | `Schema.decodeUnknownSync(EmitSpec)(emitSpecJson)` — the single load-site for the committed JSON spec. Disappears with the JSON-spec interpreter. | — (no successor; codegen output is imported as TS, not loaded as JSON.) |
| `src/stableJson.ts` | DELETE | 23 | Stable JSON stringification helper, only consumed by `src/testing/projection-parity.ts`. Not used by any surviving file. | — |
| `src/mapping/forward.ts` | REPLACE | 131 | Walks the `EmitSpec.classes[*].forward.fields` array to emit RDF quads from a runtime entity. Architecture doc §1: "no runtime walker". | Per-entity `expertToTriples` (Phase D). |
| `src/mapping/reverse.ts` | REPLACE | 391 | Policy-driven distill driven by the JSON spec — subject selection, default injection, lossy-field handling. Disappears with the interpreter. | Per-entity `expertFromTriples` co-located with `Expert` schema (Phase D). |
| `src/testing/projection-parity.ts` | DELETE | 79 | Forward-vs-reverse parity diff helper, parameterized by `EmitSpec.classes[*].reverse.fields`. Coupled to the JSON spec; no successor needed — round-trip test asserts `decode(encode(x)) === x` directly. | — |
| `src/types/shacl-runtime.d.ts` | KEEP* | 80 | Ambient module declarations for `@rdfjs/data-model`, `@rdfjs/dataset`, `shacl-engine` (no upstream `@types`). **Required by the surviving `src/Service/Shacl.ts`.** Plan lists `src/types/` under DELETE; recommend keeping this single file because deleting it breaks the SHACL harness. **See "Ambiguous files" below.** | — |
| `tests/Domain/Rdf.test.ts` | KEEP | 43 | Tests `IRI`, `RdfError`, `mapRdfError` — all surviving. | — |
| `tests/Domain/Shacl.test.ts` | KEEP | 102 | Tests `ShaclSeverity`, `ShaclViolation`, `ShaclValidationReport`, `ShapesLoadError`, `ShaclValidationError` — all surviving. | — |
| `tests/Domain/EmitSpec.test.ts` | REPLACE | 385 | Tests `LiteralPrimitive`, `ValueKind`, `ForwardField`, `ReverseField`, `EmitSpec` — every schema exported by `src/Domain/EmitSpec.ts`. Disappears with that file. | — (no direct successor; per-entity tests cover the new shape.) |
| `tests/Service/RdfStore.test.ts` | KEEP | 105 | Tests `RdfStoreService` Turtle round-trip — survives unchanged. | — |
| `tests/Service/Shacl.test.ts` | KEEP | 132 | Tests `ShaclService.loadShapes` + `validate` against an inline FOAF fixture (no DCAT-specific dependency). Survives. | — |
| `tests/aliasEmitter.test.ts` | REPLACE | 183 | Tests `emitAliases` log-skip behavior. Disappears with `src/aliasEmitter.ts`. | — |
| `tests/catalog-round-trip.test.ts` | REPLACE | 379 | Six-phase round-trip test (load seed → forward emit → SHACL validate → reverse distill → projection parity → re-emit) over the DCAT cold-start catalog. Architecture doc lists this *pattern* under KEEP; the *file* is DCAT-specific and gets replaced by `tests/expert-round-trip.test.ts` (Phase D). | `tests/expert-round-trip.test.ts` (six-phase, hand-written, agent ontology). |
| `tests/generated/emit-spec.test.ts` | REPLACE | 390 | Locks the contract between the JSON-spec generator and the committed `generated/emit-spec.json`. Disappears with the JSON spec. | — (codegen drift gate runs in CI per architecture doc §1 stage 2; no per-test contract lock needed.) |
| `tests/package.test.ts` | TRIM | 80 | Smoke test of barrel exports (`distill`, `emit`, `IRI`, `RdfError`, `RdfStoreService`, `ShaclService`, `ShaclValidationReport`, `ShaclViolation`). Task 2 must remove the `distill` and `emit` assertions; the rest stays. | — |
| `tests/shapes/dcat-instances.test.ts` | REPLACE | 28 | Smoke test that `dcat-instances.ttl` parses through `ShaclService.loadShapes`. Disappears with that shape file. | `tests/expert-round-trip.test.ts` exercises the same load path against `shapes/expert.ttl` (Phase D). |

\* See "Ambiguous files" below for the `src/types/shacl-runtime.d.ts` decision rationale.

## Aggregate Counts

| Category | File count | LOC |
|----------|-----------:|----:|
| KEEP | 12 | 1022 |
| TRIM | 3 | 102 |
| REPLACE | 14 | 4579 |
| DELETE | 2 | 102 |
| **Total** | **31** | **5805** |

**Net delta from Task 2 (`REPLACE` + `DELETE`):** **16 files, 4681 LOC removed.** Some of that LOC re-emerges as generated code in `src/generated/agent.ts` plus ~5 small hand-written files per entity (Phase D); the per-PR delta still goes meaningfully negative once the slice lands.

Note: counts include 5 non-`.ts` artifacts (`shapes/dcat-instances.ttl`, `generated/emit-spec.json`, `package.json`, `tsconfig.json`, `tsconfig.test.json`) categorized per the task brief alongside the 26 TypeScript files (`vitest.config.ts` is `.ts`).

## Ambiguous Files

**`src/types/shacl-runtime.d.ts`** — Phase A task spec lists `src/types/` under **DELETE**, but this is the single file in that directory and it is *required* by the surviving `src/Service/Shacl.ts` (`Validator` class + result types) and the indirect `@rdfjs/data-model` / `@rdfjs/dataset` imports. Deleting it removes the surviving SHACL harness's type information and breaks the typecheck. **Recommendation: KEEP this file**, drop `src/types/` from the Task 2 `git rm -r` list. If the task author intended the `.d.ts` to die, the SHACL harness must die with it (contradicting the architecture doc §2 which keeps SHACL as a build-time / test-only debugging affordance).

**Action item for Task 2:** treat the `git rm -r packages/ontology-store/src/types/` line in the plan as needing a per-file decision; only delete it if an explicit plan addendum says so. Otherwise keep this file and note the deviation in the Task 2 commit message.

## Files Not Listed Here

The following surface-area items are intentionally excluded:

- `node_modules/` — not committed; managed by `bun install`.
- `tests/__snapshots__/` (none currently exist).
- `.gitignore` — not present in the package; root-level `.gitignore` covers this directory.
- Repo-root `scripts/generate-emit-spec.ts` — lives at `<repo>/scripts/`, not under `packages/ontology-store/`. Task 2 deletes it as part of the same commit; categorized in the parent plan, not here.
