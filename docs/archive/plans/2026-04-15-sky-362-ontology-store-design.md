---
status: design-locked
created: 2026-04-15
revised: 2026-04-15 (post design interview + GPT-5 Pro review round 2)
ticket: SKY-362
parent: SKY-213
subsumes: SKY-229
related:
  - docs/architecture/triplestore-rdf-design.md (research findings, round 1)
  - docs/research/sky-362-plan-review.md (review findings, round 2)
  - docs/plans/2026-04-14-unified-triple-store-export-design.md
  - docs/plans/2026-04-14-ontology-from-prompt-layer-design.md
  - docs/plans/2026-04-15-git-backed-snapshots-spec.md
  - docs/plans/2026-04-15-sky-361-362-execution-plan.md
  - /Users/pooks/Dev/effect-ontology (reference implementation, Effect 3)
---

# SKY-362 — Ontology store package design (locked)

## Status

**Locked 2026-04-15** after a design interview that resolved eleven decision branches, then revised the same day after a second GPT-5 Pro review pass that landed one hard correction: **distill is explicit policy, not mechanical inversion of emit.** That correction and four smaller ones are folded into the sections below. Implementation may begin once the ticket is updated and SKY-229 is closed as subsumed.

Document layout: mental model, architectural boundaries, package layout, library choices, service surfaces, SHACL mode defaults, EmitSpec with explicit forward and reverse sections, distill-as-policy section, milestone one scope including pre-work mapping-fix checklist and softer fallback, open questions, and an AEMO worked-example annex.

## Mental model (trunk decision)

`packages/ontology-store/` is an **application-profile graph seam**, not a generic ontology store.

That framing is load-bearing. The seam emits a specific, closed set of DCAT classes into an N3.js triple store, validates them against a hand-authored SHACL shapes file, and distills them back into Effect Schema domain types. It does not promise to round-trip arbitrary RDF. It does not pretend to be a general-purpose triple store. It is the bounded, versioned, lossy seam between one TypeScript domain model and one SKOS vocabulary plus DCAT application profile.

The round-1 research pass (`docs/architecture/triplestore-rdf-design.md`) was unambiguous on this: production RDF systems (Jena, RDF4J, GraphDB, Stardog) keep graph-native APIs at the center and put typed objects at the edge. LDkit and LDO are the TypeScript-side analogues. None of them promise bit-level symmetry. The ones that tried are the ones that grew into 5,000-line mapping engines chasing impossible round-trip guarantees. We explicitly avoid that trap by treating the `EmitSpec` as a versioned API contract with explicit forward and reverse sections and explicit lossy boundaries.

Concretely: if a future feature tempts us to generalize this package — "make it read any OWL ontology," "make it support arbitrary RDF classes," "make it a full SPARQL surface" — we stop, re-read this section, and either fork a new package or delete the feature request.

## Architectural boundaries

Three distinct repositories, three distinct concerns:

```
┌──────────────────────┐    authoring      ┌─────────────────────────────┐      runtime       ┌──────────────────────┐
│  ontology_skill      │ ─────────────────▶│  skygest-ontology-snapshots │ ─────────────────▶│  skygest-cloudflare  │
│  (design workbench)  │                   │  (versioned source of truth)│                    │  (enforcement)       │
│                      │                   │                             │                    │                      │
│  Python + ROBOT      │                   │  ontology.ttl               │                    │  packages/           │
│  SKOS vocabularies   │                   │  ontology.nt                │                    │   ontology-store/    │
│  Vocabulary shapes   │                   │  shapes (vocab)             │                    │  TS + Effect 4       │
│  (already authored)  │                   │  manifest.json              │                    │  N3.js + shacl-engine│
└──────────────────────┘                   └─────────────────────────────┘                    └──────────────────────┘
```

### Scope clarification on shapes — two layers, two files

The existing `ontology_skill/ontologies/skygest-energy-vocab/shapes/skygest-energy-vocab-shapes.ttl` (371 lines) validates **SKOS vocabulary well-formedness** (TBox). It already exists. We do not touch it.

The DCAT instance layer has **no SHACL shapes authored today**. That's SKY-362's shape work: a new, flat, hand-authored `packages/ontology-store/shapes/dcat-instances.ttl` covering cardinality, value types, referential integrity, and alias scheme patterns for the ABox.

| File | Location | Layer | Validates |
|---|---|---|---|
| `skygest-energy-vocab-shapes.ttl` | `ontology_skill/` (existing) | TBox / vocabulary | SKOS concept well-formedness |
| `dcat-instances.ttl` | `packages/ontology-store/shapes/` (new) | ABox / instances | DCAT cardinality, referential integrity |

Both files load together at validation time.

**`publish-snapshot.sh` does not exist** and must not be referenced in plans. Instance shapes live in the package until there is a concrete reason to promote them.

## Package layout (file-count discipline, reviewed)

> **Hard rule:** minimize file count. ONE of each artifact type. No per-class shape splits. No per-concern shape modules. No modular composition via `sh:node`. Split in follow-up tickets when a file actually becomes unmanageable, not prophylactically.

```
skygest-cloudflare/
├── scripts/
│   └── generate-emit-spec.ts             # build-time only; ONLY reader of manifest.json
└── packages/ontology-store/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    ├── shapes/
    │   └── dcat-instances.ttl            # ONE flat shapes file for all DCAT classes
    ├── generated/
    │   └── emit-spec.json                # committed, regenerated by scripts/generate-emit-spec.ts
    ├── src/
    │   ├── Domain/
    │   │   ├── Rdf.ts                    # branded IRI, Quad + RdfError
    │   │   └── Shacl.ts                  # ShaclValidationReport, ShaclViolation, errors
    │   ├── Service/
    │   │   ├── RdfStore.ts               # Effect 4 wrapping N3.Store, targetGraph? param
    │   │   └── Shacl.ts                  # Effect 4 wrapping shacl-engine
    │   ├── mapping/
    │   │   ├── forward.ts                # (was emit/entityToQuads.ts)
    │   │   └── reverse.ts                # (was distill/quadsToEntity.ts)
    │   ├── emit.ts                       # thin orchestrator: forward mapping + aliasEmitter + store writes
    │   ├── distill.ts                    # thin orchestrator: class index + reverse mapping + Schema.decode
    │   ├── aliasEmitter.ts               # ExternalIdentifier[] → skos:*Match + whitelist policy
    │   └── index.ts
    └── tests/
        └── catalog-round-trip.test.ts    # ONE test, phase-visible (see test section below)
```

### Deleted from the earlier layout (review findings)

- **`src/emit/ManifestWalker.ts` is gone.** The manifest is read exactly once, by `scripts/generate-emit-spec.ts`, at build time. Runtime consumes only `generated/emit-spec.json`. This enforces the "one runtime mapping source of truth" invariant from the review.
- **`src/Service/Reasoner.ts` is gone.** A no-op stub costs Layer wiring, error types, imports, and a branch in every service test. Re-add when a real reasoner consumer lands.
- **`emit/` and `distill/` directories are flattened into `mapping/forward.ts` + `mapping/reverse.ts`** with `src/emit.ts` and `src/distill.ts` as thin orchestrators. This naming makes the directional split explicit and avoids the "distill is an inversion of emit" framing the review flagged as the core abstraction mistake.

### Non-obvious absences

- No `SnapshotLoader.ts`. Milestone one reads shapes from `packages/ontology-store/shapes/dcat-instances.ttl` directly.
- No `valueEncoders.ts`. Inline in `mapping/forward.ts` until it hurts.
- No per-class emitters or distillers. One flat pair of mapping modules.
- No `ProvenanceService.ts`. PROV-O deferred.
- No fixture directory. The test loads `.generated/cold-start/catalog/` directly.
- No `Reasoner.ts`. Deleted from milestone 1.
- No runtime `ManifestWalker.ts`. Build-time only.

## Library choices (locked)

| Library | Version | Role |
|---|---|---|
| N3.js | 1.26+ | Quad store, Turtle + N-Triples parse/serialize |
| shacl-engine | 1.1+ | SHACL validation |
| Effect 4 | `@effect/*-beta.43` | Service wrapping, error channels, schema decoding |

**N3.js strict parse from day one.** Always pass an explicit `format` argument to `N3.Parser`. N3's default is permissive and mixes syntaxes; in a round-trip test whose job is to surface our own mistakes, permissiveness hides bugs. Pin the version carefully because N3.js has had RDF 1.2-related behavior shifts.

Deferred indefinitely:
- Oxigraph / SPARQL runtime
- Persistent quad store (quadstore, Jena, Stardog sidecar)
- pySHACL reference validator (round-1 recommended it; deferred because JS-only runtime is worth more than reference-validator insurance, not because the insurance is worthless)
- Any RDFS / OWL reasoner (no Reasoner service exists in milestone 1; added when a real reasoning consumer lands)

## Effect 4 adaptation note

The reference implementation at `/Users/pooks/Dev/effect-ontology/packages/@core-v2/` is on **Effect 3**. Every pattern copied from that repo must be adapted to **Effect 4** semantics before use.

- Service definition: `ServiceMap.Service` + `Layer.effect` two-step from `src/services/d1/*`, not the Effect 3 `Effect.Service` class
- Schema module: `effect/Schema` (core), not `@effect/schema`
- Scoped resource: verify `Effect.acquireRelease` signature in the current beta
- Layer construction: verify `Layer.provideMerge`, `Layer.effect`, `Layer.scoped` signatures

Rule: before writing any production code, run `effect-solutions show services-and-layers` and mirror the house style from `src/services/d1/*`. The `effect-ontology` code is architectural inspiration only.

## Service surfaces (Effect 4 pseudocode)

```ts
// Domain/Rdf.ts
export const IRI = Schema.String.pipe(Schema.brand("IRI"))
export type IRI = typeof IRI.Type

export class RdfError extends Schema.TaggedError("RdfError")({
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

// Service/RdfStore.ts
export class RdfStoreService extends ServiceMap.Service<RdfStoreService>()(
  "RdfStoreService",
  {
    makeStore: Effect.Effect<RdfStore, never, Scope.Scope>
    addQuads: (store: RdfStore, quads: ReadonlyArray<N3.Quad>, targetGraph?: IRI) => Effect.Effect<void, RdfError>
    parseTurtle: (store: RdfStore, turtle: string, targetGraph?: IRI) => Effect.Effect<void, RdfError>
    toTurtle: (store: RdfStore, prefixes?: Record<string, string>) => Effect.Effect<string, RdfError>
    size: (store: RdfStore) => Effect.Effect<number, never>
  }
) {}
```

`targetGraph?: IRI` on every mutation is the forward-looking hook: milestone one writes to the default graph; the per-source named-graph routing is added later without an API break.

```ts
// Service/Shacl.ts
export class ShaclService extends ServiceMap.Service<ShaclService>()(
  "ShaclService",
  {
    loadShapes: (shapesTurtle: string) => Effect.Effect<RdfStore, ShapesLoadError, Scope.Scope>
    validate: (data: RdfStore, shapes: RdfStore) => Effect.Effect<typeof ShaclValidationReport.Type, ShaclValidationError>
  }
) {}
```

Every shape in `dcat-instances.ttl` defaults to `sh:Violation`. No Warning/Info ratcheting until external ingest lands.

## SHACL mode defaults (new, from review)

Choices that were left implicit in the earlier draft. Lock them now so we're not rediscovering them during PR 2:

- **`sh:targetClass` as the default targeting mechanism.** Reserve `sh:targetNode` for singletons and explicit test nodes.
- **No SPARQL targets (`sh:SPARQLTarget`) in milestone 1.** They make shapes expensive and debugging opaque. Add later if a specific use case forces them.
- **No `sh:closed true` on main entity shapes.** Closed shapes reject any non-enumerated predicate, which is exactly the wrong default for a graph seam we expect to enrich over time (reasoner-inferred triples, crosswalk triples, future OEO bindings). If a specific shape needs closure, opt in per-shape.
- **`sh:Violation` as default severity.** `Info` and `Warning` exist in the spec but we don't partition by severity yet.
- **Every shape has an `sh:message`.** No silent constraints. The message is the debugging interface when the round-trip test goes red.
- **No `sh:or` / `sh:xone` / `sh:not` in milestone 1** unless a concrete DCAT requirement forces it. Boolean shape combinators multiply the mental model without paying back.
- **Referential integrity via `sh:class`**, not `sh:nodeKind sh:IRI` + external lookup. Let `shacl-engine` do the cross-entity check.

## EmitSpec — forward + reverse, both explicit (revised from review)

The EmitSpec is the central data structure. The round-2 review landed one hard correction here: **reverse projection cannot be inferred from forward mapping.** Subject selection, quad grouping, collision resolution, default injection, and reconstruction of fields that were never predicates (like `id` from the subject IRI) are all policy decisions that must be declared. The EmitSpec therefore has two explicit sections per class: `forward` (emit-side) and `reverse` (distill-side).

- **Derived** from `references/data-layer-spine/manifest.json` + the symbol-keyed annotations in `src/domain/data-layer/annotations.ts`
- **Generated** at build time via `scripts/generate-emit-spec.ts`
- **Committed** as `packages/ontology-store/generated/emit-spec.json` so PR diffs surface spec changes
- **The ONLY runtime mapping source of truth.** `ManifestWalker` does not exist in `src/`. `src/mapping/forward.ts` and `src/mapping/reverse.ts` import only `generated/emit-spec.json`.

### Shape of the generated file

```json
{
  "version": "0.1.0",
  "generatedFrom": "references/data-layer-spine/manifest.json@<sha>",
  "classes": {
    "Dataset": {
      "primaryClassIri": "http://www.w3.org/ns/dcat#Dataset",
      "additionalClassIris": ["https://schema.org/Dataset"],

      "forward": {
        "fields": [
          {
            "runtimeName": "title",
            "predicate": "http://purl.org/dc/terms/title",
            "valueKind": { "_tag": "Literal" },
            "cardinality": "single"
          },
          {
            "runtimeName": "distributionIds",
            "predicate": "http://www.w3.org/ns/dcat#distribution",
            "valueKind": { "_tag": "IRI" },
            "cardinality": "many"
          },
          {
            "runtimeName": "accessRights",
            "predicate": null,
            "skipEmit": true
          }
        ]
      },

      "reverse": {
        "subjectSelector": {
          "_tag": "TypedSubject",
          "classIri": "http://www.w3.org/ns/dcat#Dataset"
        },
        "fields": [
          {
            "runtimeName": "id",
            "distillFrom": { "_tag": "SubjectIri" }
          },
          {
            "runtimeName": "title",
            "distillFrom": { "_tag": "Predicate", "predicate": "http://purl.org/dc/terms/title" }
          },
          {
            "runtimeName": "distributionIds",
            "distillFrom": { "_tag": "Predicate", "predicate": "http://www.w3.org/ns/dcat#distribution" },
            "cardinality": "many"
          },
          {
            "runtimeName": "accessRights",
            "distillFrom": { "_tag": "Default", "defaultValue": null },
            "lossy": "runtime-local"
          },
          {
            "runtimeName": "createdAt",
            "distillFrom": { "_tag": "Default", "defaultValue": "<inject>" },
            "lossy": "runtime-local"
          }
        ]
      }
    },

    "Agent": {
      "primaryClassIri": "http://xmlns.com/foaf/0.1/Agent",
      "additionalClassIris": ["https://skygest.dev/vocab/energy/EnergyAgent"],
      "forward": { "...": "..." },
      "reverse": {
        "subjectSelector": { "_tag": "TypedSubject", "classIri": "http://xmlns.com/foaf/0.1/Agent" },
        "fields": [
          {
            "runtimeName": "alternateNames",
            "distillFrom": {
              "_tag": "PredicateWithPrecedence",
              "predicate": "http://www.w3.org/2004/02/skos/core#altLabel",
              "precedence": "alternateNames-before-display-alias",
              "conflictResolution": "preferLanguageTaggedPlain"
            },
            "cardinality": "many"
          }
        ]
      }
    }
  }
}
```

### Reverse-side field policies

Four `distillFrom` kinds cover every case we know about:

1. **`SubjectIri`** — the runtime field value is the subject IRI itself. For `id` fields. Non-lossy.
2. **`Predicate { predicate }`** — pull all objects of this predicate for the subject. Cardinality follows the forward side.
3. **`PredicateWithPrecedence { predicate, precedence, conflictResolution }`** — pull objects of a predicate that multiple forward fields might have written. `precedence` names which forward field wins attribution on distill. Used for `skos:altLabel` (attributed to `alternateNames`, not `display-alias`, when both could have produced the literal).
4. **`Default { defaultValue }`** — the field has no predicate to pull from; inject a default on distill. For runtime-local fields (`createdAt`, `updatedAt`, `accessRights`) and for fields that are derivable but not emitted (see "Derived relationship policy" below).

Every `reverse.field` entry carries `lossy?: "runtime-local" | "set-order" | false` so the projection-parity comparator reads its ignore-list from the same artifact the mapping modules use.

### Derived relationship policy (new, from review)

The review flagged one real modelling question I had skipped: `Dataset.variableIds` is a denormalized convenience derived from `Series.datasetId` + `Series.variableId`. Under the review's framing, we must declare explicitly whether derived edges are emitted, validated, distilled, or ignored when both asserted and derivable forms exist.

**Policy for milestone 1:**

- **Derived fields are emitted** (forward) as `sevocab:hasVariable` triples on `Dataset`, because that's what `dataLayerSpine.ts` currently generates.
- **Derived fields are NOT validated by SHACL** as referential-integrity constraints, because doing so would make the Series-less half of the catalog immediately red.
- **Derived fields are distilled via `Default { "<derive-from-series>" }`** on the reverse side — the reverse mapping reads `Series.datasetId` + `Series.variableId` and reconstructs `Dataset.variableIds` from that relation, rather than reading `sevocab:hasVariable` predicates off the Dataset subject. This keeps the reverse direction aligned with the domain model's actual source of truth.
- **When Series data is missing** (a real problem per the manifest, which notes `Series.datasetId` is mostly absent in checked-in data), the derived field distills as an empty array, not as undefined.

This policy is declared in the EmitSpec, not scattered across the mapping code.

## Distill is explicit policy, not mechanical inversion

The round-2 review's core finding, restated here so it can't be missed: distill is not "run emit backward." It is a separate set of decisions about:

- **Subject selection:** which quads are roots that get projected back? (Decided by `reverse.subjectSelector` per class.)
- **Quad grouping:** given a subject, which quads belong to which runtime field? (Decided by the forward predicate, with `PredicateWithPrecedence` handling collisions.)
- **Collision resolution:** when two forward fields could have written the same predicate (e.g. `alternateNames` and `display-alias` both → `skos:altLabel`), which one does the distilled literal attribute to? (Decided by explicit `precedence` + `conflictResolution`.)
- **Default injection:** runtime-local fields that never emit must be reconstructed with a default value or left undefined. (Decided by `Default { defaultValue }`.)
- **Reconstruction of non-predicate fields:** `id` comes from the subject IRI, not from any predicate. (`SubjectIri` kind.)

`src/mapping/forward.ts` reads `emit-spec.json:classes.<K>.forward`. `src/mapping/reverse.ts` reads `emit-spec.json:classes.<K>.reverse`. They share the class IRIs and primary type, nothing else. There is no code in either module that "inverts" the other.

The lossy-boundary policy now also lives in the reverse section: the test's projection-parity comparator pulls its ignore list from `emit-spec.json:classes.<K>.reverse.fields[].lossy`, not from an allow-list baked into the test.

## Graph ownership (locked, mostly deferred)

Per-source named graphs are the ownership unit. `targetGraph?: IRI` API parameter exists on every mutation; routing logic deferred to a follow-up. Milestone one writes to the default graph.

PROV-O activity modelling, archive/tombstone graphs, per-run overlays all explicitly deferred. The review added one note worth remembering: once per-source graph routing turns on, SHACL behavior across named graphs is non-obvious (GraphDB docs discuss per-data-graph evaluation semantics). That's a "reopen when routing lands" concern, not a milestone-1 concern.

## Drift protocol (minimal)

Ontology version bumps handled via coordinated upgrades, not dual-form support. When a predicate renames: bump `ontology-snapshot.lock.json`, regenerate `dataLayerSpine.ts`, regenerate `emit-spec.json`, run the round-trip catalog test, fix what breaks in the same PR, ship. No N+1/N+2 migration window.

## Milestone 1 — The full cold-start catalog end-to-end

**Scope:** load the entire `.generated/cold-start/catalog/` (Agent, Catalog, CatalogRecord, DataService, DatasetSeries, Dataset, Distribution) plus `variables/` and `series/` into N3, validate against `dcat-instances.ttl`, serialize, re-parse, distill, assert projection parity.

**Catalog size (measured 2026-04-15):**

| Entity kind | Count |
|---|---|
| Agent | 66 |
| Catalog | 60 |
| CatalogRecord | 1,792 |
| DataService | 12 |
| DatasetSeries | 81 |
| Dataset | 1,790 |
| Distribution | 3,530 |
| Variable | 26 |
| Series | 30 |
| **Total** | **7,387** |

~50–100K triples at 5–15 per entity. Upper edge of in-memory N3.js + shacl-engine tractability per round-1 research. Deliberate: loading the full catalog is simultaneously correctness test AND real-scale stress test.

### Pre-work mapping-fix checklist (MUST land before emit code)

From the review. These are mapping bugs visible today; fixing them BEFORE writing the emit code is dramatically cheaper than debugging them through SHACL and round-trip failures.

- [ ] **`CatalogRecord.primaryTopicType` / `primaryTopicId` collapse into a single `foaf:primaryTopic <IRI>` emission.** The current manifest annotates `primaryTopicType` with `foaf:primaryTopic`, which would push the literal string `"dataset"` as the predicate value instead of the Dataset IRI. Fix in `references/data-layer-spine/manifest.json` and regenerate `dataLayerSpine.ts`. The emitter should read `primaryTopicId` as the `foaf:primaryTopic` object and ignore `primaryTopicType` as a type discriminant only.
- [ ] **`alternateNames` ↔ `display-alias` precedence on `skos:altLabel` declared in `emit-spec.json` reverse section.** Both forward fields can emit `skos:altLabel` literals. The reverse side attributes them to `alternateNames` by default; `display-alias` only fills `alternateNames` if the literal is not already present from `alternateNames`.
- [ ] **Value-to-IRI policy for concept-valued fields declared per field in the EmitSpec.** Fields like `Dataset.themes`, `DatasetSeries.cadence`, and Variable/Series facets are currently runtime strings. For milestone 1: either the EmitSpec declares a `valueKind: { _tag: "EnumMapping", values: {...} }` with a literal-to-IRI map (for closed enums) OR the EmitSpec declares `valueKind: { _tag: "Literal" }` with `lossy: "deferred-to-iri"` (for open-string facets whose IRI policy is not settled). No silent assumption that "this string should map to something."
- [ ] **`Series.datasetId` is often absent in checked-in data.** The DCAT instance shape for Series must NOT require `datasetId` as `sh:minCount 1` in milestone 1, or the validation goes red immediately. Add as a SHACL warning in a later milestone.
- [ ] **`alternateNames` gets a `skos:altLabel` ontologyIri mapping in `references/data-layer-spine/manifest.json`** (currently `ontologyIri: null`).

These fix small domain-layer drift AND declare mapping policy. They land as an early commit in PR 2, before the emit code.

### PR 1 — Skeleton + monorepo hoist

- `packages/ontology-store/package.json`, `tsconfig.json`, `vitest.config.ts`
- Root `package.json` gets `"workspaces": ["packages/*"]`
- Root `tsconfig.json` / `tsconfig.test.json` / `vitest.config.ts` expanded
- One trivial unit test importing from the package
- **Zero RDF code.** Proves the monorepo hoist, nothing more.

### PR 2 — The whole loop

One PR. Contents:

- **Pre-work mapping fixes** (checklist above — first commit in the branch)
- `scripts/generate-emit-spec.ts` — build-time tool, the only reader of `manifest.json`, emits `generated/emit-spec.json` with both `forward` and `reverse` sections per class
- `Domain/Rdf.ts`, `Domain/Shacl.ts` — branded IRI, tagged errors
- `Service/RdfStore.ts` — Effect 4 wrapping `N3.Store`, `targetGraph?` param, strict parse
- `Service/Shacl.ts` — Effect 4 wrapping `shacl-engine`
- `mapping/forward.ts`, `mapping/reverse.ts` — both import only `generated/emit-spec.json`
- `aliasEmitter.ts` — alias whitelist policy, emits `skos:*Match` for identifier-semantic schemes only
- `emit.ts`, `distill.ts` — thin orchestrators
- `generated/emit-spec.json` — committed, regenerated by the script
- `shapes/dcat-instances.ttl` — hand-authored, flat, covers all DCAT classes per SHACL mode defaults above
- `tests/catalog-round-trip.test.ts` — phase-visible, described below

**NOT in PR 2:** `src/emit/ManifestWalker.ts`, `src/Service/Reasoner.ts`. Both deleted from milestone 1.

### Phase-visible round-trip test (expanded from review)

One file, but with explicit phase boundaries so when the test goes red, the failing phase is obvious. Each phase asserts discrete, nameable properties:

```ts
describe("cold-start catalog round-trip", () => {
  it("phase 1: load catalog", () => {
    // Assert entity counts by kind match the on-disk JSON files.
    // If this fails, it's a loader bug, not a mapping bug.
  })

  it("phase 2: emit produces expected quad shape", () => {
    // Assert per-class quad count by class IRI (Agent → N triples, Dataset → M triples, etc.)
    // Assert every subject has exactly one primaryClassIri rdf:type triple.
    // Assert no literal values where IRIs were expected (catches the CatalogRecord.primaryTopicType class of bug).
    // If this fails, it's a forward-mapping bug.
  })

  it("phase 3: SHACL validates", () => {
    // Assert ShaclValidationReport.conforms === true.
    // On failure, dump grouped violations by sourceShape to make the failure debuggable.
    // If this fails, it's either a shape bug, a referential-integrity bug in the catalog, or a forward-mapping bug.
  })

  it("phase 4: serialize → reparse is quad-stable", () => {
    // Assert quad count is identical across serialize/reparse.
    // Assert set-equality on the quad multiset (order allowed to drift).
    // If this fails, it's an N3.js round-trip bug or a weird literal escaping edge.
  })

  it("phase 5: distill produces expected runtime shape", () => {
    // Assert distilled entity counts match loaded counts.
    // Assert every distilled entity has a well-formed branded id (SubjectIri policy working).
    // If this fails, it's a reverse-mapping bug or a subject-selection bug.
  })

  it("phase 6: projection parity", () => {
    // For every source entity, assert projection parity against the distilled entity
    // with the lossy-field ignore list sourced from emit-spec.json:classes.<K>.reverse.fields[].lossy.
    // If this fails, it's a lossy-boundary policy bug or a collision-resolution bug.
  })
})
```

"One test file" does not mean "one opaque failure." It means the failures are localized to a phase and the phase name tells you which layer is broken.

### Acceptance criteria (primary + fallback)

**Primary acceptance:** all six phases green on the full cold-start catalog. This is the bar we shoot for.

**Softer fallback (contingency only):** if `shacl-engine` actually falls over on the full catalog with full referential-integrity shapes — not preemptively, only if it empirically blows up during PR 2 implementation — the fallback criterion is:

1. Phases 1, 2, 4, 5, 6 green on the full catalog (the mechanical loop works)
2. Phase 3 (SHACL) green against the full catalog for a **core structural subset** of the shapes (cardinality + type + subject-selection) but with full referential-integrity checks scoped to a smaller slice
3. The gap is documented in the ticket and becomes a follow-up

**Rule:** we do not build toward the fallback. We build toward the primary acceptance. The fallback exists to unblock if the primary turns out to be infeasible at real scale, not to be the plan.

### Expected side effect: domain-layer fixes in the same PR

PR 2 will very likely surface small bugs in `references/data-layer-spine/manifest.json`, `src/domain/data-layer/catalog.ts`, `variable.ts`, and `alias.ts`. Likely categories:

- Fields with `generation: "generated"` and `ontologyIri: null` (other than the ones already flagged in the pre-work checklist)
- Enum values that don't resolve to IRIs
- Referential integrity violations where a `distributionIds` array points at a non-existent Distribution
- Alias scheme values that violate `sh:pattern` for their scheme
- Branded ID regex mismatches after round-trip

Fixes land in the same PR in early commits. PR 2 is bounded by "phases green," not by line count.

### Review-flagged likely pain points beyond AEMO

Not blockers, but things to watch for when running the full catalog:

1. **Alias/external-ID normalization varies by publisher.** EIA, ENTSO-E, NESO, ODRÉ, Ember, and Energy Charts each stress alias semantics differently. The whitelist + pattern rules in `alias.ts` and `aliasEmitter.ts` will get exercised beyond anything the AEMO walkthrough proved.
2. **Concept-valued runtime strings.** `themes`, cadence-like fields, Variable/Series facets are strings today. The pre-work checklist forces a policy choice per field; some of those choices may need to be "defer to follow-up, emit as literal."
3. **`Series.datasetId` mostly absent.** Shape must not require it. Distill-side derived relationship policy handles the empty case gracefully.

## Open questions (including missed topics from round 2)

Questions the interview and the reviews did not settle. Revisit when a downstream consumer forces the decision, not before.

1. **`skygest-internal:` IRI governance.** Fallback IRI path when no upstream ontology term exists. (Reopened when SKY-348 OEO binding forces it.)
2. **`methodologyVariant` alias round-trip fidelity.** Sub-property of `skos:mappingRelation` or collapse to `skos:closeMatch`? (Reopened when a real `methodologyVariant` alias appears in cold-start.)
3. **Observation modelling.** `qb:Observation` vs `schema:Observation` vs both? (Reopened when observations come into scope.)
4. **SHACL depth.** Sharpen the SHACL-vs-Schema boundary by writing real shapes. (Reopened as we author `dcat-instances.ttl`.)
5. **Reverse-projection collision policy (round-2 miss).** The EmitSpec now has `PredicateWithPrecedence`, but the general policy for "multiple forward fields could plausibly fill the same runtime field" will need more cases as we discover them. Revisit after PR 2.
6. **Derived-relationship policy beyond `hasVariable` (round-2 miss).** The milestone-1 policy handles `Dataset.variableIds`. Other denormalized convenience fields may need the same treatment. Scan `dataLayerSpine.ts` during PR 2 for additional cases.
7. **Named-graph validation semantics (round-2 miss).** Once per-source graph routing turns on, SHACL behavior across named graphs becomes non-obvious. GraphDB docs flag per-data-graph evaluation semantics as a real gotcha. Not a milestone-1 concern.

## What is explicitly NOT in milestone 1

- Distill parity with bit-level exactness (projection parity only, lossy ignore list from EmitSpec reverse section)
- Named graph routing
- PROV-O activity modelling, archive graphs, tombstones
- JSON-LD context generation
- RDFS / OWL reasoning (no Reasoner service exists)
- pySHACL reference validator
- Snapshot-repo-hosted shapes
- Ingest of resolved post/chart bundles as RDF
- SPARQL surface
- Persistent quad store
- Staged SHACL strictness (Warning/Info ratcheting)
- Shape modularization by concern or profile
- `publish-snapshot.sh` / any new CI tooling
- Runtime reads from `references/data-layer-spine/manifest.json` (build-time only, via `scripts/generate-emit-spec.ts`)

Each has a "reopen when X" trigger. None are rejected on principle.

---

## Annex — AEMO walkthrough (worked example)

Original annex from the design interview, unchanged. Concrete walkthrough of Agent + Dataset through the full pipeline so future readers see a real example.

### Input — Agent

```json
{
  "_tag": "Agent",
  "id": "https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V",
  "kind": "organization",
  "name": "Australian Energy Market Operator",
  "alternateNames": ["AEMO"],
  "homepage": "http://www.aemo.com.au/",
  "aliases": [
    { "scheme": "wikidata", "value": "Q4034595", "relation": "exactMatch" },
    { "scheme": "url", "value": "http://www.aemo.com.au/", "relation": "exactMatch" }
  ]
}
```

### Input — Dataset

```json
{
  "_tag": "Dataset",
  "id": "https://id.skygest.io/dataset/ds_01KNQTFC3YN0W4AWMXYCSMM7E0",
  "title": "AEMO National Electricity Market Data",
  "description": "Australian NEM dispatch, pricing, generation, and demand data.",
  "publisherAgentId": "https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V",
  "landingPage": "https://aemo.com.au/.../data-nem",
  "keywords": ["NEM", "dispatch", "generation", "demand", "Australia"],
  "themes": ["electricity", "grid operations"],
  "distributionIds": [
    "https://id.skygest.io/distribution/dist_01KNQTFC3Y9QK77R7JNR9DZWTJ",
    "https://id.skygest.io/distribution/dist_01KNQTFC3YJQXV61WAMHV9890F"
  ],
  "accessRights": "public",
  "aliases": []
}
```

### Emitted quads (Turtle form)

```turtle
@prefix dcat:    <http://www.w3.org/ns/dcat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix foaf:    <http://xmlns.com/foaf/0.1/> .
@prefix schema:  <https://schema.org/> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix sevocab: <https://skygest.dev/vocab/energy/> .
@prefix wd:      <https://www.wikidata.org/entity/> .

# Agent
<https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V>
    a               foaf:Agent, sevocab:EnergyAgent ;
    foaf:name       "Australian Energy Market Operator" ;
    foaf:homepage   <http://www.aemo.com.au/> ;
    skos:altLabel   "AEMO"@en ;
    skos:exactMatch wd:Q4034595 .

# Dataset
<https://id.skygest.io/dataset/ds_01KNQTFC3YN0W4AWMXYCSMM7E0>
    a                   dcat:Dataset, schema:Dataset ;
    dcterms:title       "AEMO National Electricity Market Data" ;
    dcterms:description "Australian NEM dispatch, pricing, generation, and demand data." ;
    dcterms:publisher   <https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V> ;
    dcat:landingPage    <https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem> ;
    dcat:keyword        "NEM", "dispatch", "generation", "demand", "Australia" ;
    dcat:theme          "electricity", "grid operations" ;
    dcat:distribution   <https://id.skygest.io/distribution/dist_01KNQTFC3Y9QK77R7JNR9DZWTJ>,
                        <https://id.skygest.io/distribution/dist_01KNQTFC3YJQXV61WAMHV9890F> .
```

### What dropped (lossy boundary made visible)

| Field | Reason |
|---|---|
| `Agent.kind: "organization"` | handWritten, no ontologyIri |
| `Agent.aliases[1]` (`scheme: "url"`) | alias emitter skips `url` scheme |
| `Dataset.accessRights: "public"` | runtime-local, `reverse.distillFrom: Default` |
| `Dataset.aliases: []` | empty set |
| `createdAt`, `updatedAt` | runtime-local, `reverse.lossy: "runtime-local"` |
| `_tag`, `id` | `_tag` handWritten; `id` distilled from subject IRI via `SubjectIri` |

### SHACL shape sketch (one of several in `dcat-instances.ttl`)

```turtle
@prefix sh:      <http://www.w3.org/ns/shacl#> .
@prefix dcat:    <http://www.w3.org/ns/dcat#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix foaf:    <http://xmlns.com/foaf/0.1/> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .
@prefix sky-sh:  <https://skygest.io/shapes/dcat/> .

sky-sh:DatasetShape a sh:NodeShape ;
    sh:targetClass dcat:Dataset ;
    sh:property [
        sh:path dcterms:title ;
        sh:datatype xsd:string ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:message "Every Dataset must have exactly one dcterms:title"
    ] ;
    sh:property [
        sh:path dcat:distribution ;
        sh:class dcat:Distribution ;
        sh:minCount 1 ;
        sh:message "Every Dataset must have at least one Distribution in the graph"
    ] ;
    sh:property [
        sh:path dcterms:publisher ;
        sh:class foaf:Agent ;
        sh:maxCount 1 ;
        sh:message "Dataset publisher must be a foaf:Agent in the graph"
    ] .
```

Note: not `sh:closed`. Not using `sh:SPARQLTarget`. Targets by `sh:targetClass`. Every property has an `sh:message`. Matches the SHACL mode defaults section.

### Distill back to domain type

The round-trip parity test re-parses the serialized Turtle into a fresh N3 store, then uses `emit-spec.json:classes.Dataset.reverse` to project each subject:

```ts
{
  _tag: "Dataset",
  id: "https://id.skygest.io/dataset/ds_01KNQTFC3YN0W4AWMXYCSMM7E0", // from SubjectIri
  title: "AEMO National Electricity Market Data",                   // from Predicate dcterms:title
  description: "Australian NEM dispatch, pricing, generation, and demand data.",
  publisherAgentId: "https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V",
  landingPage: "https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem",
  keywords: ["Australia", "NEM", "demand", "dispatch", "generation"],  // set-order may drift
  themes: ["electricity", "grid operations"],
  distributionIds: [
    "https://id.skygest.io/distribution/dist_01KNQTFC3Y9QK77R7JNR9DZWTJ",
    "https://id.skygest.io/distribution/dist_01KNQTFC3YJQXV61WAMHV9890F"
  ],
  aliases: [],
  // Default-injected (runtime-local, declared in reverse section):
  accessRights: undefined,
  createdAt: <injected>,
  updatedAt: <injected>
}
```

### Projection parity

```ts
assertProjectionParity(source, distilled, {
  ignoredFields: emitSpec.classes.Dataset.reverse.fields
    .filter(f => f.lossy === "runtime-local")
    .map(f => f.runtimeName),
  setValuedFields: emitSpec.classes.Dataset.reverse.fields
    .filter(f => f.cardinality === "many")
    .map(f => f.runtimeName),
})
```

For AEMO: ignored fields are `accessRights`, `createdAt`, `updatedAt`; set-valued fields are `keywords`, `themes`, `distributionIds`, `aliases`. Parity passes.

### What the walkthrough proved

- Full pipeline works end-to-end for one entity pair with real data
- Referential integrity requires the whole catalog loaded before validation
- Alias scheme semantics need the fixes listed in the pre-work checklist
- `alternateNames` gets a proper `skos:altLabel` mapping
- Primary class IRI drives subject selection on distill
- Projection parity is a deterministic assertion against a spec-sourced ignore list

All fixes in scope for PR 2.

## Acceptance for THIS design doc

- [x] Trunk reframe stated and defended
- [x] Three-repo architectural boundary diagrammed
- [x] Shape layer distinction (vocab vs instance) called out
- [x] File-count discipline stated as hard rule
- [x] Package layout reflects review: no runtime ManifestWalker, no Reasoner, mapping/ flattening
- [x] Service pseudocode shows Effect 4 idioms with `targetGraph?` hook
- [x] SHACL mode defaults locked (targeting, no `sh:closed`, no SPARQL targets, severity)
- [x] EmitSpec has explicit forward + reverse sections with policy kinds
- [x] Distill-as-policy section states the hard finding from review round 2
- [x] Derived relationship policy declared for `hasVariable`
- [x] Pre-work mapping-fix checklist present (MUST land before emit code)
- [x] Phase-visible round-trip test shape specified
- [x] Primary + softer fallback acceptance criteria
- [x] Pain-point fixes from AEMO walkthrough enumerated
- [x] Round-2 reviewer's pain-point extrapolations (alias normalization, concept-valued strings, Series.datasetId) flagged
- [x] Missed research topics from round 2 added to open questions
- [x] AEMO annex updated to reference forward/reverse policy explicitly
- [x] `publish-snapshot.sh` scrubbed

## Not in scope for this doc

- Implementation code. Nothing in `packages/ontology-store/` exists yet.
- Ingest of post/chart bundles as RDF.
- Move of shapes from package to snapshot repo.
- OEO coverage measurement.
- RDF Data Cube observation modelling.
