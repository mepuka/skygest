# SKY-362 PR 2 — Ontology Store Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Land the full `packages/ontology-store/` loop — EmitSpec codegen, N3.js + shacl-engine services, forward + reverse mapping, alias emitter, SHACL shapes — with a six-phase round-trip test that proves all 7,387 cold-start entities survive emit → validate → serialize → parse → distill → parity.

**Architecture:** Application-profile graph seam per [2026-04-15-sky-362-ontology-store-design.md](2026-04-15-sky-362-ontology-store-design.md). Build-time codegen produces `packages/ontology-store/generated/emit-spec.json` with explicit `forward` and `reverse` sections per class. `mapping/forward.ts` and `mapping/reverse.ts` read the EmitSpec only; no ManifestWalker at runtime. `Service/RdfStore.ts` wraps `N3.Store` with `targetGraph?: IRI`. `Service/Shacl.ts` wraps `shacl-engine`. One flat `shapes/dcat-instances.ttl`. One phase-visible test file.

**Tech Stack:** Effect 4 (`@effect/*-beta.43`), N3.js 1.26+, shacl-engine 1.1+, `@effect/vitest`, Bun, tsgo. Package `@skygest/ontology-store` already stubbed on main by PR 1 (#128).

**Branch:** `sky-362/catalog-round-trip` off main at `c6716b08`.

---

## Context

### Domain model state (verified 2026-04-15 post-deep-read)

The round-1 assumption that the `references/data-layer-spine/manifest.json` covers all DCAT classes is **wrong**. Only **4 of 9** classes are in the manifest:

| Class | In manifest? | Generated `*OntologyFields`? | Inline DcatClass/DcatProperty annotations |
|---|---|---|---|
| Agent | ✓ | `AgentOntologyFields` | class: `foaf:Agent` |
| Catalog | ✗ | — | class: `dcat:Catalog`, fields annotated inline |
| CatalogRecord | ✗ | — | class: `dcat:CatalogRecord`, **primaryTopic bug** inline |
| DataService | ✗ | — | class: `dcat:DataService`, fields annotated inline |
| DatasetSeries | ✗ | — | class: `dcat:DatasetSeries`, fields annotated inline |
| Dataset | ✓ | `DatasetOntologyFields` | class: `dcat:Dataset` |
| Distribution | ✗ | — | class: `dcat:Distribution`, fields annotated inline |
| Variable | ✓ | `VariableOntologyFields` | — (only `SchemaOrgType`, `SdmxConcept`) |
| Series | ✓ | `SeriesOntologyFields` | — (only `SdmxConcept`) |

The 5 non-manifest classes have **correct** inline annotations on both class and field level (except CatalogRecord's `primaryTopicType` bug). `graph-ontology-mapping.ts` declares all 11 inter-class edge kinds with ontology IRIs already.

**The design doc's pre-work checklist was written assuming the manifest covered all 9 classes.** It does not. This changes how we approach the EmitSpec generator.

### Key decision: EmitSpec source strategy — Path D (Schema AST only)

**Chosen: the EmitSpec generator walks the runtime Effect Schema ASTs directly. The data-layer-spine manifest is NOT consulted.**

The earlier drafts of this plan considered two alternatives:

- **Path A — expand the manifest to cover all 9 classes.** Hand-author ~250 lines of manifest JSON for Catalog / CatalogRecord / DataService / DatasetSeries / Distribution, regenerate `dataLayerSpine.ts` to produce 5 new `*OntologyFields` modules, refactor `catalog.ts` to spread those modules, bump `manifestVersion` to 2, extend `SpineClassKey` and `SpineFieldType` with new discriminators. Semantically the cleanest — one source of structural mapping — but a structural refactor of load-bearing domain schemas with real regression risk and meaningful downstream blast radius on `scripts/generate-data-layer-spine.ts`, `src/domain/dataLayerSpineManifest.ts`, and every test that decodes cold-start JSON through the refactored wrappers.

- **Path B — fork the source: manifest for 4 classes, Schema AST for 5.** Simpler than Path A but creates a permanent build-time fork. Rejected as structurally incoherent: if we treat one source as authoritative, it needs to be authoritative for everything.

- **Path D — Schema AST only (chosen).** The runtime Effect Schemas in `src/domain/data-layer/*.ts` already carry every piece of mapping information the generator needs: class-level `DcatClass` / `SchemaOrgType` symbols, per-field `DcatProperty` symbols, branded-string brand names for IRI detection, `isOptional` / `isArrays` for cardinality. The generator walks the ASTs directly via Effect 4's `SchemaAST` module — no forked sources, no manifest expansion, no `catalog.ts` refactor. The `references/data-layer-spine/manifest.json` stays scoped to the 4 classes that already drive `dataLayerSpine.ts` codegen; nothing changes.

**Why Path D is not "splitting sources":** the manifest's job is to drive `dataLayerSpine.ts` codegen for ontology-owned field fragments. It is a **codegen seed**, not a structural mapping source of truth. The EmitSpec generator is a DIFFERENT codegen step for a DIFFERENT output, and it can legitimately use a different source (the Schemas themselves). The runtime source of truth — `generated/emit-spec.json` — is one file, produced by one generator, consumed by one runtime. The "one source of truth" invariant is about the runtime consumer shape, not about the build-time input.

### Pre-work checklist — updated scope (Path D)

Items 1-5 from the design doc's pre-work checklist, mapped to the actual small, surgical changes required under Path D:

| Item | Design doc text | Actual fix under Path D |
|---|---|---|
| 1 | CatalogRecord primaryTopic bug | **Task 2:** move the inline `.annotate({ [DcatProperty]: "foaf:primaryTopic" })` in `catalog.ts` from `primaryTopicType` (the string discriminant, wrong) to `primaryTopicId` (the IRI-valued field, correct). One small edit + an AST regression test. |
| 2 | `alternateNames` → `skos:altLabel` | **Task 1:** edit the Agent entry in `references/data-layer-spine/manifest.json` to set `ontologyIri: "http://www.w3.org/2004/02/skos/core#altLabel"`. Regenerate `dataLayerSpine.ts`. Single-line manifest change. |
| 3 | Value-to-IRI policy for concept-valued fields | **Task 5b:** declared in `emit-spec.json` per-field via `FIELD_FORWARD_OVERRIDES` with `lossy: "deferred-to-iri"` markers. Lives inside the EmitSpec generator. |
| 4 | `Series.datasetId` SHACL cardinality | **Task 12:** lives in `shapes/dcat-instances.ttl` — `sh:maxCount 1` but no `sh:minCount`, so Series without a datasetId still pass validation in milestone 1. |
| 5 | `alternateNames` vs `display-alias` precedence | **Task 5b:** declared in `emit-spec.json` reverse section as `PredicateWithPrecedence { predicate: skos:altLabel, precedence: "alternateNames-before-display-alias", conflictResolution: "preferFirst" }`. Lives in the EmitSpec generator's `REVERSE_POLICY` table. |

Items 1–2 land as surgical pre-work commits at the head of the branch. Items 3–5 land inside the EmitSpec generator (Task 5). No structural refactor of `catalog.ts`.

---
## Task 1: `alternateNames` → `skos:altLabel` manifest fix

**Landed:** commit `f58ebb3b`.

Pre-work checklist item 2. One-field manifest edit: the Agent entry's `alternateNames` went from `ontologyIri: null` to `ontologyIri: "http://www.w3.org/2004/02/skos/core#altLabel"`. Regenerated `src/domain/generated/dataLayerSpine.ts` via `bun run gen:data-layer-spine`. Diff: 1 line in `manifest.json`, 1 line in the generated file (the annotation attached to `AgentOntologyFields.alternateNames`).

The `alternateNames` vs `display-alias` precedence policy — what wins on distill when both forward fields write `skos:altLabel` literals — lives in the EmitSpec reverse section declared later (Task 5). This commit is just the ontology IRI binding on the forward side.

---

## Task 2: CatalogRecord `primaryTopic` annotation move

**Landed:** commit `fe9df8c2`.

Pre-work checklist item 1. The `.annotate({ [DcatProperty]: "foaf:primaryTopic" })` call was attached to `primaryTopicType` (a string discriminant) instead of `primaryTopicId` (the IRI-valued field). Any RDF emitter reading DcatProperty annotations would push the literal string `"dataset"` as the predicate value instead of the target entity IRI. Fix: move the annotation to `primaryTopicId`; strip `primaryTopicType` back to just a description annotation.

**Regression test:** `tests/data-layer-catalog.test.ts` now walks `CatalogRecord.ast.propertySignatures`, finds `primaryTopicId` and `primaryTopicType`, and asserts:

- `primaryTopicId.type.annotations[DcatProperty] === "http://xmlns.com/foaf/0.1/primaryTopic"`
- `primaryTopicType.type.annotations[DcatProperty] === undefined`

The test traverses Effect 4's `Objects` AST (`_tag: "Objects"`, not `"TypeLiteral"` — that was Effect 3 nomenclature). Pins the annotation shape so future drift fails loud.

---

## Task 3: Add `n3` + `shacl-engine` dependencies

**Files:**
- Modify: `packages/ontology-store/package.json` (add `n3`, `shacl-engine` as dependencies)
- Modify: `bun.lock` (regenerated by `bun install`)

**Step 1: Pick exact versions**

Target: `n3` ≥ 1.26, `shacl-engine` ≥ 1.1 per design doc. Check latest compatible versions via `bun info n3` and `bun info shacl-engine` before pinning.

**Step 2: Add to package manifest**

Edit `packages/ontology-store/package.json`:

```json
{
  "name": "@skygest/ontology-store",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "n3": "^1.26.0",
    "shacl-engine": "^1.1.0"
  },
  "peerDependencies": {
    "effect": "4.0.0-beta.43"
  }
}
```

**Step 3: Install + verify**

Run: `bun install`

Expected: `bun.lock` updates with the new packages hoisted at root (Bun workspaces). `bun install --frozen-lockfile` from a subsequent run stays green.

**Step 4: Smoke-test imports**

Add a temporary throwaway script `packages/ontology-store/src/_smoke.ts` that imports `N3.Store` and calls `shacl-engine`'s top-level export, logs `typeof`. Run with `bun run packages/ontology-store/src/_smoke.ts` and verify no runtime errors. **Delete the file before commit.**

**Step 5: Typecheck**

Run: `bun run typecheck`

Expected: clean. If `shacl-engine` has missing types, add a `packages/ontology-store/src/types/shacl-engine.d.ts` declaration file (the effect-ontology reference has one at `/Users/pooks/Dev/effect-ontology/packages/@core-v2/src/types/shacl-engine.d.ts` — copy as starting point).

**Step 6: Commit**

```bash
git add packages/ontology-store/package.json bun.lock
# Plus any shacl-engine.d.ts declaration file if added
git commit -m "SKY-362: add n3 + shacl-engine dependencies to @skygest/ontology-store

First code-bearing deps for the ontology-store package. Both are
application-profile graph infrastructure:
- n3: quad store + Turtle/N-Triples parse/serialize
- shacl-engine: SHACL validation, pure JS

No consumer code yet; adds the substrate for Tasks 4+.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `Domain/Rdf.ts` + `Domain/Shacl.ts` — branded types + tagged errors

**Files:**
- Create: `packages/ontology-store/src/Domain/Rdf.ts`
- Create: `packages/ontology-store/src/Domain/Shacl.ts`
- Create: `packages/ontology-store/tests/Domain/Rdf.test.ts`
- Create: `packages/ontology-store/tests/Domain/Shacl.test.ts`

**Step 1: Write failing tests first**

`tests/Domain/Rdf.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import { IRI, RdfError } from "../../src/Domain/Rdf";

describe("IRI branded type", () => {
  it("accepts HTTP URLs", () => {
    const result = Schema.decodeUnknownSync(IRI)("https://example.org/x");
    expect(result).toBe("https://example.org/x");
  });

  it("rejects empty strings", () => {
    expect(() => Schema.decodeUnknownSync(IRI)("")).toThrow();
  });
});

describe("RdfError", () => {
  it("constructs with message + optional cause", () => {
    const err = new RdfError({ message: "parse failed", cause: "bad quad" });
    expect(err._tag).toBe("RdfError");
    expect(err.message).toBe("parse failed");
  });
});
```

`tests/Domain/Shacl.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest";
import { ShaclViolation, ShaclValidationReport, ShaclValidationError } from "../../src/Domain/Shacl";
import { Schema } from "effect";

describe("ShaclValidationReport", () => {
  it("carries conforms flag + violations", () => {
    const report = Schema.decodeUnknownSync(ShaclValidationReport)({
      conforms: false,
      violations: [{
        focusNode: "https://id.skygest.io/agent/ag_01",
        sourceShape: "sky-sh:AgentShape",
        sourceConstraint: "sh:minCount",
        severity: "Violation",
        message: "foaf:name missing"
      }]
    });
    expect(report.conforms).toBe(false);
    expect(report.violations).toHaveLength(1);
  });
});

describe("ShaclValidationError", () => {
  it("constructs from a failed report", () => {
    const err = new ShaclValidationError({
      report: {
        conforms: false,
        violations: []
      }
    });
    expect(err._tag).toBe("ShaclValidationError");
  });
});
```

**Step 2: Run the tests — expect FAIL**

Run: `bun run test packages/ontology-store/tests/Domain/`

Expected: FAIL (files don't exist yet).

**Step 3: Implement `Domain/Rdf.ts`**

```ts
import { Schema } from "effect";

export const IRI = Schema.String.pipe(
  Schema.filter((s) => s.length > 0, { message: () => "IRI cannot be empty" }),
  Schema.brand("IRI")
);
export type IRI = Schema.Schema.Type<typeof IRI>;

export class RdfError extends Schema.TaggedError<RdfError>()("RdfError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
```

**Step 4: Implement `Domain/Shacl.ts`**

```ts
import { Schema } from "effect";

export const ShaclSeverity = Schema.Literals(["Violation", "Warning", "Info"]);
export type ShaclSeverity = Schema.Schema.Type<typeof ShaclSeverity>;

export const ShaclViolation = Schema.Struct({
  focusNode: Schema.String,
  sourceShape: Schema.String,
  sourceConstraint: Schema.String,
  severity: ShaclSeverity,
  message: Schema.String,
  path: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String)
});
export type ShaclViolation = Schema.Schema.Type<typeof ShaclViolation>;

export const ShaclValidationReport = Schema.Struct({
  conforms: Schema.Boolean,
  violations: Schema.Array(ShaclViolation)
});
export type ShaclValidationReport = Schema.Schema.Type<typeof ShaclValidationReport>;

export class ShapesLoadError extends Schema.TaggedError<ShapesLoadError>()("ShapesLoadError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class ShaclValidationError extends Schema.TaggedError<ShaclValidationError>()(
  "ShaclValidationError",
  {
    report: ShaclValidationReport
  }
) {}
```

**Note:** Effect 4 `Schema.TaggedError` signature needs verification against `src/services/d1/*` house style before finalizing. If the syntax differs, adjust both files. Run `effect-solutions show error-handling` first.

**Step 5: Run the tests — expect PASS**

Run: `bun run test packages/ontology-store/tests/Domain/`

Expected: PASS.

**Step 6: Commit**

```bash
git add packages/ontology-store/src/Domain packages/ontology-store/tests/Domain
git commit -m "SKY-362: add Domain/Rdf.ts + Domain/Shacl.ts

Branded IRI type, RdfError, and SHACL report/violation schemas with
tagged errors for shapes-load and validation failures. Substrate for
the Service layer in the next commit.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: EmitSpec substrate — schemas, generator, committed artifact

Split across two commits for review surface:

### Task 5a — `Domain/EmitSpec.ts` schemas

**Landed:** commit `6fd0ae71`.

Types-first foundation. Every shape the generator produces exists as an Effect Schema first so the committed JSON is validated on decode at runtime by `mapping/forward.ts` and `mapping/reverse.ts` in later commits.

Declared types:

- `LiteralPrimitive` — `string | number | boolean`
- `XsdDatatype` — the six xsd datatypes the forward mapper may attach (`xsd:string`, `xsd:dateTime`, `xsd:date`, `xsd:integer`, `xsd:decimal`, `xsd:boolean`) — added in Task 5c after the review pass, originally omitted
- `ValueKind` — tagged union: `Literal { primitive, xsdDatatype }`, `Iri`, `EnumLiteral { values[] }`
- `Cardinality` — `single | single-optional | many`
- `DistillFrom` — tagged union: `SubjectIri`, `Predicate { predicate }`, `PredicateWithPrecedence { predicate, precedence, conflictResolution }`, `InverseEdge { forwardOwnerClassIri, forwardPredicate }`, `Default { defaultValue }` (the `InverseEdge` variant was added in the Task 5c review pass)
- `ForwardField` — `{ runtimeName, predicate, valueKind?, cardinality, skipEmit?, lossy? }`
- `ReverseField` — `{ runtimeName, distillFrom, cardinality, lossy? }`
- `SubjectSelector` — `TypedSubject { classIri }` (milestone 1 uses class-IRI rdf:type matching exclusively)
- `ClassEmitSpec` — `{ primaryClassIri, additionalClassIris[], forward, reverse }`
- `EmitSpec` — `{ version, generatedFrom, classes }` with `classes` as an **explicit 9-key Struct** (tightened in Task 5c from `Schema.Record(Schema.String, ClassEmitSpec)` so adding or removing a class fails decode loudly)

28 tests cover schema decode for each type variant.

### Task 5b — `scripts/generate-emit-spec.ts` + committed `generated/emit-spec.json`

**Landed:** commit `acaa33f3`.

Schema AST walker that produces the committed EmitSpec artifact at `packages/ontology-store/generated/emit-spec.json`. Runs via `bun run gen:emit-spec`. Reads all 9 DCAT runtime Schemas from `src/domain/data-layer/*`, extracts class-level `DcatClass` + per-field `DcatProperty` annotations, classifies each field's value kind via AST introspection, and merges hand-authored `REVERSE_POLICY` + `FIELD_FORWARD_OVERRIDES` overrides to produce the reverse-side distill rules and forward-side policy markers.

Key infrastructure:

- `getAnnotations` — single-line wrapper around `SchemaAST.resolve()`. The earlier draft of this helper had to merge Base + last-check annotations because `CatalogRecord` was authored with `.annotate({...}).pipe(Schema.check(...))` (annotations land on Base, `resolve()` reads last-check and misses them). Flipping the annotation order in Task 5c eliminated the need for the merge.
- `classifyField` — walks a property-signature type AST to produce `{ valueKind, cardinality }`. Branches on `_tag`: `Arrays` → recurse into `rest[0]` with cardinality=many; `Union`-of-`Literal` → `EnumLiteral`; `Literal` → single-value `EnumLiteral`; `String` / `Number` / `Boolean` → primitive `Literal` with `xsdDatatype` inferred from the AST's own `XsdDatatype` marker (for `DateLike`, `IsoTimestamp`) or the primitive type (`xsd:decimal`, `xsd:boolean`, `xsd:string`). `String` with an IRI brand or the `WebUrlMarker` annotation → `Iri`.
- `isWebUrlAst` — detects `WebUrl` via the `WebUrlMarker` symbol annotation on the filter. Swapped in during Task 5c from the original run-function-identity approach (which was robust against the current Effect 4 but fragile against future filter composition).
- `PRIMARY_CLASS_IRI_FALLBACK` — `Variable` and `Series` legitimately have no `DcatClass` annotation (they are sevocab / SDMX classes, not DCAT). The generator falls back to hardcoded sevocab IRIs (`https://skygest.dev/vocab/energy/EnergyVariable`, `https://skygest.dev/vocab/energy/Series`). **Design doc open question #1 (`skygest-internal:` governance) is explicitly deferred** — see the decision comment at this constant in the generator.
- `REVERSE_POLICY` — per-class hand-authored distill overrides. Runtime-local fields (`_tag`, `id`, `createdAt`, `updatedAt`, `aliases`, closed enums like `kind` and `accessRights`) are declared as `Default` reverses. `alternateNames` uses `PredicateWithPrecedence` on `skos:altLabel`. `Dataset.variableIds` uses `Default {"<derive-from-series>"}` with `lossy: "derived-from-series"`. Three inverse-edge fields (`CatalogRecord.catalogId` via `dcterms:isPartOf`, `Dataset.dataServiceIds` via `dcat:servesDataset`, `Distribution.datasetId` via `dcat:distribution`) use the new `InverseEdge` distill variant (Task 5c).
- `FIELD_FORWARD_OVERRIDES` — per-`(class, field)` forward overrides. Forces `CatalogRecord.primaryTopicId` → `Iri` (the field is typed `Schema.String` because the primary topic kind is disambiguated by a sibling discriminant). Marks `Dataset.themes`, `DatasetSeries.cadence`, and seven Variable open-string facets with `lossy: "deferred-to-iri"` because concept-valued field values need an IRI resolution policy deferred to a future milestone.

Output: all 9 classes in `generated/emit-spec.json`, each with a forward section and a reverse section. ~2000-3000 lines of committed JSON. `bun run gen:emit-spec` regenerates the artifact; PR diffs surface spec changes for review. `generatedFrom` carries a sha256 prefix of the source files (Task 5c) so the committed artifact's staleness is visible in PR review.

28 integration tests in `tests/generated/emit-spec.test.ts` decode the file against the `EmitSpec` schema, pin specific fields per class, assert `generatedFrom` matches the expected pattern, and regenerate in-process to catch any drift between the generator and the committed JSON (Task 5c).

### Task 5c — post-review cleanup pass (eight commits)

A comprehensive code review after Task 5b landed surfaced 17 findings — two phase 5/6 correctness blockers, several high-leverage simplifications, and a handful of DX and documentation gaps. The 9 most impactful findings landed as 8 commits (`0069d9d9` through `912bd64c`):

| SHA | Finding | Change |
|---|---|---|
| `0069d9d9` | #5 | Flip `CatalogRecord` `.annotate()` / `.pipe(check)` order so annotations land where `SchemaAST.resolve()` reads them. Deletes ~40 lines of Base+last-check merge helper in the generator. Also fixes `tests/data-layer-fixtures.test.ts` Fixture 10 `ann()` helper to use `SchemaAST.resolve()` instead of raw `.ast.annotations` (which broke when the order flipped). |
| `a7b1ab18` | #3 | Add `xsdDatatype` to `ValueKind.Literal`. Annotate `DateLike` (`xsd:date`) and `IsoTimestamp` (`xsd:dateTime`) in `src/domain/types.ts` with a new `XsdDatatype` symbol marker. Generator reads the marker to propagate the datatype into the emit spec. Phase 3 SHACL `sh:datatype` validation is now possible. |
| `7990c915` | #1 (phase 5/6 blocker) | Add `InverseEdge` `DistillFrom` variant. Fix `Distribution.datasetId`, `Dataset.dataServiceIds`, and `CatalogRecord.catalogId` which were wrongly marked as `Default { null }` runtime-local fields — injecting null into a required branded string would decode-fail in phase 5. `catalogId` takes a direct `dcterms:isPartOf` annotation on the field (DCAT has no canonical `CatalogRecord → Catalog` predicate); the other two use `InverseEdge` distill. |
| `f02cc8f7` | #2 | Remove the dead `Dataset.variableIds.forward.lossy: "derived-from-series"` marker. The projection-parity comparator reads its ignore list from `reverse.fields[].lossy`, not forward. The forward marker was unused. |
| `63a4eba4` | #6, #7, #10 | `SdmxConcept` annotation projection policy: chose option 3 (defer, documented only) over minting sevocab-local SDMX IRIs. Documented the decision in `src/domain/data-layer/annotations.ts`. Added a decision comment block at `PRIMARY_CLASS_IRI_FALLBACK` citing open question #1. Threaded `className.fieldName` context into `classifyField` thrown errors for easier failure localization. |
| `651c77a7` | #4 | Swap WebUrl detection from run-function identity to a `WebUrlMarker` symbol annotation on the filter. More robust against future filter composition; `emit-spec.json` byte-identical before/after. |
| `54e27920` | #17 | Tighten `EmitSpec.classes` from `Schema.Record(Schema.String, ClassEmitSpec)` to an explicit 9-key `Schema.Struct({Agent, Catalog, ..., Series})`. Any added or removed class fails decode loudly. Dead `CLASS_ORDER` constant removed. |
| `912bd64c` | #11, #13 | Pin sha256 prefix of generator source files in `generatedFrom`. Add in-test drift check: imports `generateEmitSpec`, runs it in-process, string-compares against the committed JSON, fails loudly with "run `bun run gen:emit-spec` and commit the diff." |

Test count delta: +17 tests (1420 → 1437). Typecheck green. Branch ready for Task 6 after this pass.

### Deferred review findings (nice-to-have)

- **#4 (old)** WebUrl → `Schema.brand("WebUrl")` — rejected in favor of the annotation-marker approach (cleaner, no adapter-side churn on 5 files).
- **#8, #9** `REVERSE_POLICY` / `FIELD_FORWARD_OVERRIDES` DRY refactors — reviewed and rejected as a losing trade (current form is grep-friendly; the DRY opportunity is tiny).
- **#12** `Variable` field-order inconsistency (TimestampedAliasedFields spread first) — cosmetic, follow-up.
- **#14** `cause: Schema.optionalKey(Schema.String)` vs house-style structured context fields on `Domain/Rdf.ts` / `Domain/Shacl.ts` — minor drift, can be aligned in a future cleanup.
- **#15** Stronger IRI pattern check (scheme prefix) — defense-in-depth only.
- **#16** `ShaclViolation.value` term-shape preservation — not milestone 1.

Each is a ~5-minute future fix. None blocks Task 6.


## Task 6: `Service/RdfStore.ts` — Effect 4 wrap of `N3.Store`

**Files:**
- Create: `packages/ontology-store/src/Service/RdfStore.ts`
- Create: `packages/ontology-store/tests/Service/RdfStore.test.ts`

**Step 1: Mirror `src/services/d1/*` house style**

Read one of the D1 services (e.g. `src/services/d1/D1AgentsRepo.ts`) for the exact Effect 4 `ServiceMap.Service` + `Layer.effect` pattern. Also run `effect-solutions show services-and-layers`.

**Step 2: Write failing tests**

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { RdfStoreService } from "../../src/Service/RdfStore";

describe("RdfStoreService", () => {
  it("creates an empty store and reports size 0", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;
        const size = yield* service.size(store);
        expect(size).toBe(0);
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("parses Turtle and round-trips to Turtle with stable quad count", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* RdfStoreService;
        const store = yield* service.makeStore;
        yield* service.parseTurtle(store, `
          @prefix foaf: <http://xmlns.com/foaf/0.1/> .
          <https://example.org/a> a foaf:Agent ; foaf:name "Alice" .
        `);
        const size = yield* service.size(store);
        expect(size).toBe(2);

        const out = yield* service.toTurtle(store);
        expect(out).toContain("foaf:Agent");
        expect(out).toContain("Alice");
      }).pipe(Effect.provide(RdfStoreService.Default), Effect.scoped)
    ));

  it("writes quads into a named graph when targetGraph is provided", () =>
    // ...
    Effect.succeed(undefined)
  );
});
```

**Step 3: Run failing tests**

Run: `bun run test packages/ontology-store/tests/Service/RdfStore.test.ts`

Expected: FAIL.

**Step 4: Implement `RdfStore.ts`**

Follow the design doc §"Service surfaces" pseudocode, adapted to Effect 4. Key details:
- `makeStore: Effect<RdfStore, never, Scope>` uses `Effect.acquireRelease` for scoped cleanup
- `parseTurtle` uses `new N3.Parser({ format: "text/turtle" })` — **strict parse**, explicit format
- `toTurtle` uses `new N3.Writer({ prefixes })`
- All errors map into `RdfError` via `Effect.tryPromise` / `Effect.try` with a catch function
- `targetGraph?: IRI` param on every mutation writes a DefaultGraph or a NamedNode

**Step 5: Iterate until tests pass**

**Step 6: Commit**

```bash
git add packages/ontology-store/src/Service/RdfStore.ts packages/ontology-store/tests/Service/RdfStore.test.ts
git commit -m "SKY-362: add Service/RdfStore.ts — Effect 4 wrap of N3.Store

Scoped resource wrapper around n3.Store with typed Effect error channel
(RdfError). Exposes makeStore, addQuads, parseTurtle, toTurtle, size.
Every mutation takes an optional targetGraph IRI so the per-source
named-graph routing hook is in place from day one even though
milestone 1 writes only to the default graph.

Parser uses strict text/turtle format; no silent RDF 1.2 inference.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `Service/Shacl.ts` — Effect 4 wrap of `shacl-engine`

**Files:**
- Create: `packages/ontology-store/src/Service/Shacl.ts`
- Create: `packages/ontology-store/tests/Service/Shacl.test.ts`

Same TDD structure as Task 6. Test assertions:
- `loadShapes` parses a small Turtle shapes fixture and returns a store
- `validate` against a passing fixture returns `conforms: true, violations: []`
- `validate` against a failing fixture returns `conforms: false` with at least one populated `ShaclViolation`

Implementation notes:
- `shacl-engine` exposes a `Validator` class — wrap in `Effect.gen` with `yield* RdfStoreService` for the data store
- Map the engine's report structure into `ShaclValidationReport` via a small adapter
- Error channel: `ShaclValidationError` only on engine failure (not on `conforms: false` — that's a non-exceptional result)

Commit message analogous to Task 6.

---

## Task 8: `aliasEmitter.ts` — alias whitelist policy

**Files:**
- Create: `packages/ontology-store/src/aliasEmitter.ts`
- Create: `packages/ontology-store/tests/aliasEmitter.test.ts`

**Step 1: Declare the whitelist**

Per the AEMO worked example + domain map: schemes that emit cleanly to `skos:*Match`:
- `wikidata` → `https://www.wikidata.org/entity/{value}` → `skos:exactMatch`
- `doi` → `https://doi.org/{value}` → `skos:exactMatch`
- `ror` → `https://ror.org/{value}` → `skos:exactMatch`
- `url` → `{value}` → `skos:exactMatch` (when URL is the canonical external identity)

Schemes that skip emission in milestone 1 (publisher-specific IDs without stable URI space):
- `eia-route`, `eia-series`, `eia-bulk-id`, `entsoe-psr`, `entsoe-eic`, `entsoe-document-type`, `ember-route`, `energy-charts-endpoint`, `gridstatus-dataset-id`, `odre-dataset-id`, `eurostat-code`, `europa-dataset-id`, `iea-shortname`, `ipcc`, `iso3166`, `ires-siec`, `oeo`, `other`

Schemes with special handling:
- `display-alias` → `skos:altLabel` (language-tagged literal, not a mapping)
- `methodologyVariant` relation → not in milestone 1 (skip with warning log)

**Step 2: TDD the emitter**

Write tests asserting:
- `wikidata` alias with exactMatch → exactly one `skos:exactMatch` triple
- `ror` alias → `skos:exactMatch` against `https://ror.org/{value}` URI
- `display-alias` → `skos:altLabel` literal, not a mapping
- `eia-series` → zero triples emitted (warning logged)
- `methodologyVariant` relation → zero triples emitted

**Step 3: Implement, iterate, commit**

Commit message references the scheme whitelist and notes that non-whitelisted schemes are logged rather than silently dropped.

---

## Task 9: `mapping/forward.ts` — TDD via phase 2 of the round-trip test

**Files:**
- Create: `packages/ontology-store/src/mapping/forward.ts`
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts` (create file; implement phase 2 first; phases 1, 3, 4, 5, 6 land in Tasks 11-15 + 17-18)

**Step 1: Create the round-trip test file skeleton**

```ts
import { describe, expect, it, beforeAll } from "@effect/vitest";
import { Effect, Layer } from "effect";
// ...

describe("cold-start catalog round-trip", () => {
  // phases filled in progressively across Tasks 9, 11, 13, 14, 15, 16
});
```

**Step 2: Write phase 2 test (emit produces expected quad shape)**

```ts
it("phase 2: emit produces expected quad shape", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const rdf = yield* RdfStoreService;
      const store = yield* rdf.makeStore;

      // Load all 66 agents from .generated/cold-start/catalog/agents/
      const agents = yield* loadAgentsFromColdStart();
      for (const agent of agents) {
        yield* emitAgent(store, agent);
      }

      // Assert: per-class rdf:type triple count
      const typeQuads = yield* rdf.query(store, {
        predicate: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        object: "http://xmlns.com/foaf/0.1/Agent"
      });
      expect(typeQuads.length).toBe(66);

      // Assert: no literal where IRI was expected
      // For primaryTopicId: object must be NamedNode, not Literal
      // ...
    }).pipe(Effect.provide(RdfStoreLive), Effect.scoped)
  )
);
```

**Step 3: Run — expect FAIL**

**Step 4: Implement `mapping/forward.ts`**

Read `emit-spec.json:classes.<K>.forward`, for each field on an entity instance produce zero-or-more `N3.Quad` objects. Use the `valueKind` tag to drive encoder choice. Call `aliasEmitter` for the `aliases` field.

**Step 5: Iterate until phase 2 passes for Agent**

Then extend to Dataset (second class). Then iterate until all 9 classes pass phase 2.

**Step 6: Commit**

```bash
git add packages/ontology-store/src/mapping/forward.ts packages/ontology-store/tests/catalog-round-trip.test.ts
git commit -m "SKY-362: add mapping/forward.ts + phase 2 of round-trip test

forward.ts reads emit-spec.json:classes.<K>.forward and emits N3 Quads
for each field of each entity instance. Phase 2 of the round-trip test
drives TDD: load all 7,387 cold-start entities, emit, assert the
quad-shape contract holds (rdf:type count per class, no literals where
IRIs were expected, alias emission whitelist respected).

Phases 1, 3, 4, 5, 6 follow in subsequent commits.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: `mapping/reverse.ts` — TDD via phase 5 of the round-trip test

**Files:**
- Create: `packages/ontology-store/src/mapping/reverse.ts`
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts` (add phase 5)

Same TDD structure as Task 9 but driving the distill side. Test assertions:
- Phase 5: distilled entity counts match loaded counts per kind
- Every distilled entity has a well-formed branded id (verifies SubjectIri kind)
- `alternateNames` reverse picks the right attribution when both forward fields wrote literals

Implementation walks `emit-spec.json:classes.<K>.reverse.subjectSelector` to find subjects, then projects each field through its `distillFrom` kind.

Commit and move on.

---

## Task 11: `emit.ts` + `distill.ts` thin orchestrators

**Files:**
- Create: `packages/ontology-store/src/emit.ts`
- Create: `packages/ontology-store/src/distill.ts`
- Modify: `packages/ontology-store/src/index.ts` (export public API)

**Step 1: Define the orchestrator signatures**

```ts
// emit.ts
export const emit = (
  entity: unknown,  // discriminated by _tag
  store: RdfStore
): Effect.Effect<void, RdfError, RdfStoreService>

// distill.ts
export const distill = (
  store: RdfStore
): Effect.Effect<ReadonlyArray<DomainEntity>, RdfError, RdfStoreService>
```

**Step 2: Thin orchestration**

Both files are <50 lines. `emit` dispatches on `entity._tag`, calls the per-class forward mapping function from `mapping/forward.ts`, then calls `aliasEmitter` for the alias field. `distill` walks subjects via the reverse section of `emit-spec.json`, calls per-class reverse mapping, then `Schema.decodeUnknown` to produce the domain type.

**Step 3: Lift the index.ts public API**

Replace the stub with:

```ts
export { RdfStoreService } from "./Service/RdfStore";
export { ShaclService } from "./Service/Shacl";
export { emit } from "./emit";
export { distill } from "./distill";
export { IRI, RdfError } from "./Domain/Rdf";
export { ShaclValidationReport, ShaclViolation } from "./Domain/Shacl";
```

**Step 4: Commit**

---

## Task 12: `shapes/dcat-instances.ttl` — hand-authored SHACL shapes

**Files:**
- Create: `packages/ontology-store/shapes/dcat-instances.ttl`

**Step 1: Author the shapes file**

Hand-author per the design doc §"SHACL mode defaults":
- `sh:targetClass` targeting, never `sh:targetNode`
- No `sh:closed`
- No SPARQL targets
- `sh:Violation` severity default
- `sh:message` on every constraint
- Referential integrity via `sh:class`, not `sh:nodeKind sh:IRI`

One shape per class (Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries, Variable, Series). Example shape at design doc's AEMO annex.

**Key constraints to include** (from round-1 research + design doc):
- Agent: `foaf:name` minCount 1, maxCount 1
- Catalog: `dcterms:title` minCount 1; `dcterms:publisher` sh:class foaf:Agent
- CatalogRecord: `foaf:primaryTopic` sh:minCount 1 (after Task 2 fix)
- Dataset: `dcterms:title` minCount 1; `dcat:distribution` sh:class dcat:Distribution (at least 1? — decide based on cold-start coverage; may need to soften)
- Distribution: `dcat:accessURL` or `dcat:downloadURL` — but milestone 1 doesn't use `sh:or`, so require at least one via a per-field shape instead
- DataService: `dcat:endpointURL` minCount 1
- DatasetSeries: `dcterms:accrualPeriodicity` sh:in Cadence literals
- Variable: `rdfs:label` minCount 1
- Series: `sevocab:implementsVariable` minCount 1, maxCount 1; `sevocab:publishedInDataset` **max** 1 but **no** minCount (per pre-work checklist item 4)

**Step 2: Quick-validate shapes syntax**

Use `Service/Shacl.ts.loadShapes()` in a tiny test to ensure the Turtle parses.

**Step 3: Commit**

```bash
git commit -m "SKY-362: hand-author dcat-instances.ttl SHACL shapes

Flat, one-file shapes covering all 9 DCAT instance classes. Follows
the locked SHACL mode defaults: sh:targetClass targeting, no sh:closed,
no SPARQL targets, sh:Violation severity, sh:message on every
constraint, sh:class for referential integrity.

Series.publishedInDataset is sh:maxCount 1 without sh:minCount — the
locked cold-start data is sparse on datasetId and would go red
immediately otherwise. SKY-317 tightens this later.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Round-trip test — Phase 1 (load)

**Files:**
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts`

Add phase 1: walk `.generated/cold-start/catalog/*` + `.generated/cold-start/variables/` + `.generated/cold-start/series/`, decode each file with its domain schema, count per kind, assert counts match the expected 66/60/1792/12/81/1790/3530/26/30.

Phase 1 failing means the loader or schemas have drifted — not a mapping bug. This is the first assertion that runs.

Commit.

---

## Task 14: Round-trip test — Phase 3 (SHACL)

**Files:**
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts`

Add phase 3: after phase 2 emits all quads, load shapes via `ShaclService.loadShapes`, call `ShaclService.validate`. Assert `report.conforms === true`. On failure, group violations by `sourceShape` and dump the first 5 per shape via `console.log` so the failure is debuggable.

This is the phase most likely to go red first. Each red violation is either:
- A schema drift (entity invalid per shape)
- A shape bug (constraint too strict)
- A forward mapping bug (predicate emitted wrong)

Fix each one in early subsequent commits before moving to phase 4.

Commit (even if red; documents the state).

---

## Task 15: Round-trip test — Phase 4 (serialize + reparse)

**Files:**
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts`

Add phase 4: serialize store to Turtle via `RdfStoreService.toTurtle`, parse back into a fresh store via `RdfStoreService.parseTurtle`, assert:
- Quad count identical
- Set-equality on the quad multiset (order may drift for bags)

Phase 4 failures indicate N3.js parser/writer bugs or exotic literal escaping. Usually rare; if red, pin the minimal failing quad and open an upstream issue.

Commit.

---

## Task 16: Round-trip test — Phase 5 (distill)

**Files:**
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts`

Add phase 5: call `distill(store)`, assert distilled entity counts match loaded counts, assert every distilled entity has a valid branded id (pins the `SubjectIri` reverse kind), assert at least one known alias survives.

Driven by Task 10's `mapping/reverse.ts`. If phase 5 is red while phases 1-4 are green, the bug is in the reverse section of `emit-spec.json` or in `mapping/reverse.ts`.

Commit.

---

## Task 17: Round-trip test — Phase 6 (projection parity)

**Files:**
- Modify: `packages/ontology-store/tests/catalog-round-trip.test.ts`
- Create: `packages/ontology-store/src/testing/projection-parity.ts` (or similar — the comparator)

Add phase 6: for each loaded entity, find the matching distilled entity by id, run a projection-parity comparator that:
- Ignores fields marked `lossy: "runtime-local"` in `emit-spec.json:classes.<K>.reverse.fields[]`
- Treats fields marked `cardinality: "many"` as set-valued (sorted-equal, not order-equal)
- Asserts every other field is deep-equal

The comparator's ignore list is pulled from the EmitSpec, **not** hardcoded. That's the key lossy-boundary-made-visible assertion.

This is the final assertion. If it passes, the milestone-1 primary acceptance is met.

Commit.

---

## Task 18+: Fixes surfaced by the round-trip

Whatever real drift the full catalog exposes lands as commits 18, 19, ... on this branch. Likely categories:

- Field type mismatches between manifest and schema (e.g. a field declared `optional: false` in manifest but `optionalKey` in schema)
- Referential integrity violations in cold-start (a `distributionIds` array pointing at a non-existent Distribution ID — real fix goes in the cold-start JSON, via a small migration script)
- Alias pattern violations (a publisher-specific ID that doesn't match its scheme's `sh:pattern`)
- Enum values not in the `Schema.Literals` union (e.g. a `Cadence` value that's a typo)
- Branded ID regex mismatches after round-trip (rare — the subject IRIs round-trip as-is)

Each fix is one small commit. PR 2 is bounded by "phases green," not line count.

---

## Contingency: softer fallback acceptance

If `shacl-engine` blows up on the full catalog with full referential-integrity shapes, per design doc §"Acceptance criteria":

1. Phases 1, 2, 4, 5, 6 stay green on the full catalog
2. Phase 3 goes green on a **core structural subset** of the shapes (cardinality + type + subject-selection) against the full catalog
3. Full referential-integrity checks get scoped to a smaller slice documented in the ticket
4. Gap captured as a follow-up ticket

Do not plan toward the fallback; only invoke it if shacl-engine empirically fails at real scale.

---

## Risks

1. **Effect 4 AST annotation API drift.** Tests in Task 2 and Task 5 read annotations via `SchemaAST.getAnnotation` or similar; the exact API may differ from Effect 3 references. Mitigation: run one small test as the first step of each affected task to verify the API shape before writing more code.
2. **shacl-engine Node/browser interop.** `shacl-engine` may pull in Node-only modules. Since the package is build-time-only (not bundled into the Worker), this is fine — but if any script under `src/` starts importing from `@skygest/ontology-store`, the Worker bundle may break. Mitigation: the `scripts/generate-emit-spec.ts` imports from `src/domain/data-layer/*` (pure), not from the package itself. Keep this boundary.
3. **Cold-start JSON drift from schema.** Loading 7,387 files through `Schema.decodeUnknown` may surface decode errors that were hidden by the registry's lax loader. Mitigation: Task 13 (phase 1) surfaces these immediately — fix each with a targeted commit or cold-start migration.
4. **`shacl-engine` performance on 50-100K quads.** Round-1 research flagged this as the upper edge of in-memory tractability. Mitigation: the softer fallback acceptance covers this contingency explicitly.
5. **Generator reading Schema ASTs at build time pulls in all of `src/domain/data-layer/`.** Increases compile time for the generator script and may surface typecheck issues that the test config currently hides. Mitigation: the script is not type-checked by any tsconfig currently — it runs via Bun directly. Acceptable for a build tool.

---

## Open questions to settle in early tasks

1. **Effect 4 `Schema.TaggedError` exact syntax.** Verify against `src/domain/errors.ts` or similar before Task 4.
2. **Vitest project config propagation.** The package's `vitest.config.ts` has its own `name`; when the root runner invokes both, does the test file watcher work correctly? Not a blocker for one-shot runs, but worth confirming early.
3. **Concept-valued field IRI policy — themes, cadence, variable facets.** Design doc offers two kinds: `EnumMapping` with literal-to-IRI table, or `Literal` with `lossy: "deferred-to-iri"`. For milestone 1, default to **`Literal` + `deferred-to-iri`** for all concept-valued open strings. `Cadence` is a closed enum and gets `EnumMapping` with the 6 canonical IRIs (`dcterms:accrualPeriodicity` value map: `annual → <freq/annual>`, etc. — TBD which vocab; `sevocab:cadence-annual` is a placeholder).
4. **Dataset.variableIds derivation.** Design doc says derived fields are emitted on forward (current schema does this) and distilled via Series edges on reverse. The reverse side needs access to the Series set at distill time — either pre-load Series before distilling Datasets, or iterate subjects in a topo order. Decide in Task 10.

---

## Success criteria

- [ ] All 17+ commits land on `sky-362/catalog-round-trip` branch
- [ ] `bun run typecheck` green
- [ ] `bun run test` green, including all 6 phases of the round-trip test against the full 7,387-entity catalog
- [ ] `packages/ontology-store/generated/emit-spec.json` committed and regenerable via `bun run gen:emit-spec`
- [ ] PR opened against main with reference to this plan + the design doc
- [ ] Primary acceptance (all phases green, full catalog) OR softer fallback documented in the PR body with follow-up ticket link
