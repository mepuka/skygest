# SKY-362 research context bundle

Generated: 2026-04-15T08:15:33Z
Repo: skygest-cloudflare
Commit: 00a2c4972f53ba2c1ce80462f26f409c5ab23337
Branch: sky-365/adapter-onboarding-runbook

---

## CLAUDE.md (project root — development rules)

```markdown
---
description: Core development rules for the skygest Cloudflare Worker — Effect-native, domain-first, Bun toolchain.
alwaysApply: true
---

# Skygest Development Rules

This is a Cloudflare Worker built with Effect.ts. Every rule below is non-negotiable.

## Toolchain: Bun

- `bun <file>`, `bun run test`, `bun install`, `bunx <pkg>` — never Node, npm, npx, vite, jest.
- Bun loads `.env` automatically — no dotenv.
- Keep every `wrangler*.toml` `compatibility_date` current when touching Worker deploy config.
- Do not enable `compatibility_flags = ["nodejs_compat"]` as a fallback. If Worker code needs a Node built-in, remove that dependency instead so `src/` stays Node-free.

## Architecture

Cloudflare Worker with D1 (SQLite), KV, Workflows, and Durable Objects. Entry point: `src/worker/filter.ts`.

```
src/domain/     → Schemas, branded types, errors (single source of truth)
src/services/   → ServiceMap.Service services + Layer.effect implementations
src/services/d1/→ D1 repository implementations
src/api/        → HttpApi route handlers
src/platform/   → Config, runtime, logging, JSON helpers
src/enrichment/ → Gemini vision pipeline
src/ingest/     → Bluesky ingest pipeline (Workflows + Durable Objects)
```

## Effect-Native Code (see skill: effect-native)

1. **Stay in Effect.** No `async function`, `try-catch`, `new Promise` except at Worker entry points (`src/worker/`). Use `Effect.gen` with `yield*` everywhere else.
2. **Check effect-solutions first.** Run `effect-solutions show <topic>` before implementing any Effect pattern. Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.
3. **Schema.parseJson, not JSON.parse.** Use `Schema.parseJson(TargetSchema)` or helpers in `src/platform/Json.ts`. Never manual `JSON.parse` + decode.
4. **Schema.TaggedErrorClass for all errors.** Define in `src/domain/errors.ts`. No plain `Error` or `throw`.
5. **No duplicate helpers.** Search `src/platform/` and `src/services/d1/` before writing any utility function.
6. **Services follow one pattern:** `ServiceMap.Service` + `Layer.effect` + `Effect.gen` + `yield*` for dependency injection.
7. **Use Effect platform APIs for IO.** Use `FileSystem`, `Path`, `HttpClient`, `DateTime` from Effect — never `node:fs`, `node:path`, `node:crypto`, or other Node built-ins in `src/`. The worker bundle must contain zero Node imports. Node imports are acceptable only in `scripts/` (local Bun tooling) and `tests/` (test infrastructure). For timestamps prefer `DateTime.make` / `DateTime.formatIso` over `new Date()`.

## Domain-First Schemas (see skill: domain-modeling)

1. **Search `src/domain/` before creating any schema.** The domain layer is the single source of truth.
2. **New schemas go in `src/domain/`, not inline** in services, repos, or API handlers.
3. **Derive from existing schemas** using `Schema.extend`, `Schema.pick`, `Schema.omit`, `Schema.compose`.
4. **Use branded types for IDs:** `Did`, `AtUri`, `HttpsUrl`, `TopicSlug`, `OntologyConceptSlug`. Never raw `Schema.String` for identifiers.
5. **Row schemas are the exception** — D1 repos may define local row schemas, but must transform to domain types via helpers.

## Data-Layer Relationships

When producing or consuming DCAT-related entities (`Agent`, `Catalog`, `CatalogRecord`, `DataService`, `Dataset`, `DatasetSeries`, `Distribution`, `Variable`, `Series`), these files are the sources of truth. Reach through them; do not redeclare or rebuild their contents locally.

- **`src/domain/data-layer/`** — node types, edge kinds, ID brands, registry diagnostics, and the ontology mapping at `graph-ontology-mapping.ts`. Shared schemas for DCAT entities live here.
- **`src/data-layer/DataLayerGraph.ts` + `DataLayerGraphTraversal.ts` + `DataLayerGraphViews.ts`** — the shared runtime graph, exposed on `PreparedDataLayerRegistry.graph`. Cross-entity walks and named relationship reads go through these helpers.
- **`docs/plans/2026-04-14-data-layer-graph-unification-spec.md`** — design context and the ontology-parity addendum. Read before adding new node or edge kinds.

## Testing

Use `bun run test` (vitest via @effect/vitest). Test Effect code with `Effect.runPromise` + layer provision.

```ts
import { describe, expect, it } from "@effect/vitest";
```

## Development Workflow

- **Branching:** Trunk-based. Feature branches: `sky-<issue>/<description>`.
- **PRs:** Always to `main`, squash merge. Reference `SKY-XX` in branch name or PR body.
- **CI:** GitHub Actions runs `bun run typecheck` (tsgo via `@typescript/native-preview`) and `bun run test` in parallel jobs. Staging auto-deploys on merge to main after both pass.
- **Linear:** Project key is `SKY`. GitHub integration auto-links via issue ID.

<!-- effect-solutions:start -->
## Effect Reference

Whenever you are designing or um implementing anything of note in uh effect, you should look into the effect reference repo and review this relevant source code to find patterns, right? Find the most appropriate APIs, um you know, explore the different modules um and determine what is the idiomatic effect way to implement this, right? That's a question you should always be asking during your design and planning phases in order to create, right? For all major elements of a program and of this code base, there is almost always an effect solution, right, that will give you a better result and a will cleanly integrate natively into this code base and into the you know you know to the rest of the coding patterns 

Run `effect-solutions list` to see guides. Run `effect-solutions show <topic>...` for patterns.
Search `.reference/effect/` for Effect 4 library source (effect-smol repo, tagged at `effect@4.0.0-beta.43`).
Key source paths: `.reference/effect/packages/effect/src/` for core, `unstable/` subdirectories for platform/ai/sql/cli modules.
<!-- effect-solutions:end -->
```

---

## docs/plans/2026-04-15-sky-362-ontology-store-design.md (PRIMARY design doc)

```markdown
---
status: design
created: 2026-04-15
ticket: SKY-362
parent: SKY-213
related:
  - docs/plans/2026-04-14-unified-triple-store-export-design.md
  - docs/plans/2026-04-14-ontology-from-prompt-layer-design.md
  - docs/plans/2026-04-15-git-backed-snapshots-spec.md
  - docs/plans/2026-04-15-sky-361-362-execution-plan.md
  - /Users/pooks/Dev/effect-ontology (reference implementation, Effect 3)
---

# SKY-362 — Ontology store package design

## Status

**Design in progress.** This document supersedes the portions of `2026-04-14-unified-triple-store-export-design.md` that covered the package-level shape of the ontology store. That earlier doc still stands as the design for the manifest walker, the DCAT schema reference, and the broader "what do we emit" question. This doc focuses on the package itself: how it is organized, how it wraps N3.js under Effect 4, how SHACL validation flows, how the round-trip is tested, and what open questions block implementation.

This is a tracking design, not an implementation plan. Nothing in `src/` or `packages/` changes as a result of this doc landing.

## The problem in one paragraph

Skygest has a DCAT-shaped data catalog modelled in Effect Schema under `src/domain/data-layer/`. It has a hand-curated ontology authored in `ontology_skill` (Python + ROBOT, published to `skygest-ontology-snapshots` as TTL + N-Triples). These two sides never meet at runtime — the TS side validates structurally, the ontology side sits as inert documentation. We want a living ontology store in the middle: an Effect-native, N3.js-backed triple store that ingests DCAT entities, validates them against SHACL shapes published in the snapshot, and distills them back out as typed domain objects. That seam unlocks SHACL-driven canonicalization, OEO binding, reasoner-driven enrichment, and eventually ingest of linked posts and charts.

## Architectural boundaries

Three distinct repositories, three distinct concerns:

```
┌──────────────────────┐     authoring     ┌─────────────────────────────┐     runtime     ┌──────────────────────┐
│  ontology_skill      │ ───────────────▶  │  skygest-ontology-snapshots │ ──────────────▶ │  skygest-cloudflare  │
│  (design workbench)  │                   │  (versioned source of truth)│                 │  (enforcement)       │
│                      │                   │                             │                 │                      │
│  Python + ROBOT      │                   │  ontology.ttl               │                 │  packages/           │
│  SKOS vocabs         │                   │  ontology.nt                │                 │   ontology-store/    │
│  Drafts shapes.ttl   │                   │  shapes.ttl  ← NEW          │                 │  TS + Effect 4       │
│                      │                   │  manifest.json              │                 │  N3.js + shacl-engine│
└──────────────────────┘                   └─────────────────────────────┘                 └──────────────────────┘
```

**Key framing decision (2026-04-15 correction):** SHACL shapes are a runtime concern. They belong in `skygest-ontology-snapshots` alongside the ontology, not in `ontology_skill`. `ontology_skill` may draft them — it is still the authoring workbench — but the authoritative, versioned, runtime-consumed source is the snapshot repo. Treat shapes the same way we already treat `ontology.ttl`: drafted upstream, published downstream, consumed at runtime.

## Package layout

```
packages/ontology-store/
├── package.json              # @skygest/ontology-store, workspace member
├── tsconfig.json             # extends root tsconfig
├── vitest.config.ts          # extends root vitest config
├── src/
│   ├── Domain/
│   │   ├── Rdf.ts            # branded IRI, BlankNode, Literal, Quad
│   │   ├── Shacl.ts          # ShaclValidationReport, ShaclViolation schemas
│   │   └── Errors.ts         # RdfError, ShapesLoadError, ShaclValidationError, ReasonerError
│   ├── Service/
│   │   ├── RdfStore.ts       # Effect 4 service wrapping N3.Store
│   │   ├── Shacl.ts          # Effect 4 service wrapping shacl-engine
│   │   ├── Reasoner.ts       # no-op stub day 1, RDFS forward-chain later
│   │   └── SnapshotLoader.ts # reads .generated/ontology/ from disk
│   ├── emit/
│   │   ├── ManifestWalker.ts # walks dataLayerSpine.manifest.json
│   │   ├── entityToQuads.ts  # pure transformer (one entity → N quads)
│   │   ├── valueEncoders.ts  # TS value → RDF term (literal, IRI, typed literal)
│   │   └── aliasEmitter.ts   # ExternalIdentifier[] → skos:*Match triples
│   ├── distill/
│   │   ├── quadsToEntity.ts  # inverse of entityToQuads for a given class IRI
│   │   ├── classIndex.ts     # group quads by rdf:type for fast distillation
│   │   └── schemaDecoder.ts  # Schema.decode over the projected shape
│   └── index.ts              # public API surface
└── tests/
    ├── fixtures/
    │   ├── happy-path/       # valid domain entities covering all kinds
    │   └── malformed/        # deliberate SHACL violations
    ├── manifest-walker.test.ts
    ├── emit.test.ts
    ├── shacl.test.ts
    ├── distill.test.ts
    └── round-trip-parity.test.ts
```

No circular imports between `emit/` and `distill/`. Both depend on `Domain/`, `Service/`, and the manifest walker. `Service/` depends only on `Domain/`.

## Library choices (committed)

| Library | Version | Role | Rationale |
|---|---|---|---|
| **N3.js** | 1.26+ | Quad store, Turtle + N-Triples parsing and serialization | JS standard for RDF; already validated in effect-ontology; tiny dependency; no WASM |
| **shacl-engine** | 1.1+ | SHACL validation | Works directly over N3.Store; returns structured violation reports |
| **Effect 4** | @effect/*-beta.43 | Service wrapping, error channels, schema decoding | Matches skygest-cloudflare toolchain; not Effect 3 (the effect-ontology version) |

Deferred:

- **Oxigraph** — SPARQL execution via WASM. Not needed until a concrete consumer wants SPARQL. If we defer indefinitely, the typed accessor API (`findByClass`, `findByIri`, `walkSubClassOf`) is enough.
- **N3.js reasoner** — built-in to the N3.js package; costs nothing to keep the option open. Exposed as a no-op stub on day one.

## Effect 4 adaptation notes

The effect-ontology reference implementation is on **Effect 3** (`effect@^3.x`). skygest-cloudflare is on **Effect 4** (`@effect/*-beta.43`). Patterns must be adapted; do not copy-paste.

Key differences that affect the ontology-store package (verify against `effect-solutions show services-and-layers` and `effect-solutions show error-handling` before writing production code):

| Concern | Effect 3 (effect-ontology) | Effect 4 (skygest-cloudflare) |
|---|---|---|
| Service definition | `class Foo extends Effect.Service<Foo>()("Foo", { scoped: ... })` | `ServiceMap.Service` + `Layer.effect` (two-step) |
| Layer composition | `Layer.provideMerge(Foo.Default)` | `Layer.merge`, `Layer.provide`, `Layer.provideMerge` (signatures changed) |
| Schema module | `@effect/schema` | `effect/Schema` (moved into core) |
| Tagged errors | `Schema.TaggedError` | Same API, but imports moved |
| Resource lifetimes | `Effect.acquireRelease` | Same name; check signature |
| Scoped effects | `Effect.scoped` + `scoped:` service field | Same concept; check syntax |

**Rule for this package:** before writing any service class, run `effect-solutions show services-and-layers` and use the Effect 4 idiomatic pattern from the current codebase as the canonical example. `src/services/d1/*` is the house style — match it. The effect-ontology code is architectural inspiration only.

## Service surfaces (Effect 4 pseudocode)

### RdfStore service

```ts
// Domain/Rdf.ts
export class RdfError extends Schema.TaggedError("RdfError")({
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export const IRI = Schema.String.pipe(Schema.brand("IRI"))
export type IRI = typeof IRI.Type

export interface RdfStore {
  readonly _tag: "RdfStore"
  readonly inner: N3.Store  // opaque; never leaked to consumers
}

// Service/RdfStore.ts
export class RdfStoreService extends ServiceMap.Service<RdfStoreService>()(
  "RdfStoreService",
  {
    makeStore: Effect.Effect<RdfStore, never, Scope.Scope>
    addQuads: (store: RdfStore, quads: ReadonlyArray<N3.Quad>) => Effect.Effect<void, RdfError>
    parseTurtle: (store: RdfStore, turtle: string) => Effect.Effect<void, RdfError>
    toTurtle: (store: RdfStore, prefixes?: Record<string, string>) => Effect.Effect<string, RdfError>
    size: (store: RdfStore) => Effect.Effect<number, never>
  }
) {}

export const RdfStoreLayer = Layer.effect(RdfStoreService, /* ... */)
```

`makeStore` uses `Effect.acquireRelease` under the hood so the store is cleaned up when its Scope exits. Consumers never see the raw `N3.Store`.

### Shacl service

```ts
// Domain/Shacl.ts
export const ShaclViolation = Schema.Struct({
  severity: Schema.Literal("Violation", "Warning", "Info"),
  focusNode: IRI,
  sourceShape: Schema.optional(IRI),
  resultPath: Schema.optional(IRI),
  message: Schema.String,
})

export const ShaclValidationReport = Schema.Struct({
  conforms: Schema.Boolean,
  violations: Schema.Array(ShaclViolation),
})

export class ShaclValidationError extends Schema.TaggedError("ShaclValidationError")({
  report: ShaclValidationReport,
}) {}

export class ShapesLoadError extends Schema.TaggedError("ShapesLoadError")({
  path: Schema.String,
  cause: Schema.Unknown,
}) {}

// Service/Shacl.ts
export class ShaclService extends ServiceMap.Service<ShaclService>()(
  "ShaclService",
  {
    loadShapes: (shapesTurtle: string) => Effect.Effect<RdfStore, ShapesLoadError, Scope.Scope>
    validate: (data: RdfStore, shapes: RdfStore) => Effect.Effect<typeof ShaclValidationReport.Type, ShaclValidationError>
  }
) {}
```

`validate` returns a `ShaclValidationReport` directly on the happy path; a non-conforming report is promoted to a `ShaclValidationError` in the error channel (callers decide whether to treat violations as hard failures or soft warnings via `Effect.catchTag`).

### Reasoner service

```ts
// Service/Reasoner.ts
export class ReasonerService extends ServiceMap.Service<ReasonerService>()(
  "ReasonerService",
  {
    /** No-op stub on day one. Later: RDFS forward-chaining via N3.js built-in. */
    reason: (store: RdfStore, rules: "rdfs" | "none") => Effect.Effect<void, ReasonerError>
  }
) {}
```

Day-one implementation returns `Effect.void`. The API is stable so day-two adoption is non-breaking.

## Manifest-driven emission

The manifest walker reads `references/data-layer-spine/manifest.json` and emits a per-class `EmitSpec`:

```ts
// emit/ManifestWalker.ts
export interface EmitSpec {
  readonly className: string                // "Dataset"
  readonly classIri: IRI                    // http://www.w3.org/ns/dcat#Dataset
  readonly fields: ReadonlyArray<FieldSpec>
}

export interface FieldSpec {
  readonly runtimeName: string              // "title"
  readonly predicate: IRI                   // dcterms:title
  readonly valueKind:
    | { _tag: "Literal"; datatype?: IRI }
    | { _tag: "IRI" }
    | { _tag: "EnumMapping"; values: ReadonlyMap<string, IRI> }
    | { _tag: "AliasSet" }                  // ExternalIdentifier[] → skos:*Match triples
  readonly cardinality: "single" | "many"
}
```

`entityToQuads(entity, emitSpec)` walks the spec and emits `(subjectIri, predicate, object)` triples. Enum fields carry their value-to-IRI map inline. Alias fields dispatch to `aliasEmitter.ts` which knows that `scheme: "wikidata" + value: "Q12345"` becomes `<entity> skos:exactMatch <https://www.wikidata.org/entity/Q12345>`.

**Why a pre-computed EmitSpec instead of walking the manifest per entity:** the manifest is loaded once at service init; entities are emitted in a hot loop. Pre-computing the spec lifts the parsing cost out of the inner loop.

## Distill direction

`distill/` is the inverse: given a re-parsed N3 store, extract all quads with `<subject> rdf:type <classIri>`, group them by subject, reshape into a `Record<string, unknown>` matching the TS schema shape, and run `Schema.decode(TargetSchema)` to get a typed domain object back.

Two-step pipeline:

1. **classIndex.ts** builds a per-class quad index — `Map<subjectIri, Array<quad>>` — over the store.
2. **schemaDecoder.ts** takes a `(classIri, TargetSchema)` pair and produces `Array<Effect<SchemaType, DecodeError>>`, one per subject in the class. The decoder knows which predicates map to which schema fields (inverted from the emit spec).

The decoder is NOT a hand-rolled parser. It's a thin projection layer on top of the same `EmitSpec` used for emission, then `Schema.decode` handles branded IDs and refinements.

## SHACL scope — what belongs in shapes vs schema

Not every constraint needs SHACL. Effect Schema already enforces:

- Types (string, number, boolean)
- Branded IDs (with pattern refinements)
- Simple refinements (minLength, maxLength, pattern)
- Cardinality within a single record (optional, arrays)

SHACL adds the value when the constraint is:

- **Cross-entity** — "every Dataset must have at least one Distribution" requires joining two entities; Schema cannot express it.
- **Controlled-vocabulary** — "Dataset.accrualPeriodicity must be a member of the published cadence SKOS scheme" requires vocabulary lookup; Schema cannot check the vocabulary without hardcoding it.
- **Referential-integrity** — "Series.datasetId must point at an existing Dataset in the graph" requires store-level awareness; Schema cannot check cross-references.
- **Alias-resolution** — "Aliases with scheme wikidata must have URIs matching the Wikidata pattern" is expressible in Schema with pain; SHACL does it cleanly with `sh:pattern`.

**Rule of thumb:** keep Schema doing per-record type and shape checks. Lift into SHACL the constraints that require a graph-level view. Document each shape with a `rdfs:comment` explaining why it lives in SHACL and not in Schema.

## Snapshot fetch and versioning

Unchanged from the SKY-361/362 execution plan:

- `scripts/fetch-ontology-snapshot.ts` wraps `scripts/fetch-git-snapshot.ts` (SKY-364).
- `ontology-snapshot.lock.json` pins `{ repo, ref, commit, snapshotPath, manifestHash }`.
- `postinstall` runs the fetch; placeholder lock is a no-op so `bun install --frozen-lockfile` stays green on branches that do not need the snapshot.
- The snapshot repo publishes `snapshots/<version>/{ontology.ttl, ontology.nt, shapes.ttl, classes.json, properties.json, manifest.json}`.
- Tag is primary (humans reason in semver); commit SHA is authoritative.

The only change from earlier drafts is that **`shapes.ttl` is now a first-class artifact in every snapshot directory.** The `publish-snapshot.sh` wrapper in `ontology_skill` copies it alongside the ontology TTL.

## Distill-and-emit parity test — detailed shape

```ts
// tests/round-trip-parity.test.ts
describe("round-trip parity", () => {
  it("emits, validates, serializes, re-parses, and distills back to the same domain projection", () =>
    Effect.gen(function* () {
      // 1. Load a representative slice — one of each entity kind, not the whole catalog
      const source = yield* loadRepresentativeSlice
      
      // 2. Emit into a fresh N3 store
      const store1 = yield* RdfStoreService.makeStore
      yield* emitEntities(store1, source)  // uses manifest walker
      
      // 3. Validate against published SHACL shapes
      const shapes = yield* loadShapesFromSnapshot
      const report = yield* ShaclService.validate(store1, shapes).pipe(
        Effect.catchTag("ShaclValidationError", (err) => 
          Effect.die(`SHACL violations on happy path: ${JSON.stringify(err.report.violations)}`)
        )
      )
      expect(report.conforms).toBe(true)
      
      // 4. Serialize to Turtle
      const turtle = yield* RdfStoreService.toTurtle(store1, SKYGEST_PREFIXES)
      
      // 5. Re-parse into a fresh store
      const store2 = yield* RdfStoreService.makeStore
      yield* RdfStoreService.parseTurtle(store2, turtle)
      
      // 6. Distill each entity class back to domain types
      const distilled = yield* distillAll(store2, DOMAIN_CLASSES)
      
      // 7. Assert projection-level parity
      for (const [kind, originals] of Object.entries(source)) {
        const roundTripped = distilled[kind]
        assertProjectionParity(originals, roundTripped, {
          ignoredFields: ["createdAt", "updatedAt"],      // runtime-local
          setValuedFields: ["keywords", "themes", "aliases"],  // order may drift
          computedFields: [],                             // whitelist populated as we learn
        })
      }
    }).pipe(
      Effect.provide(TestLayer),
      Effect.runPromise
    )
  )
  
  it("raises a SHACL violation on a deliberately malformed fixture", () =>
    Effect.gen(function* () {
      const bad = loadMalformedFixture  // e.g. Dataset with empty title
      const store = yield* RdfStoreService.makeStore
      yield* emitEntities(store, bad)
      const shapes = yield* loadShapesFromSnapshot
      const result = yield* ShaclService.validate(store, shapes).pipe(Effect.either)
      expect(result._tag).toBe("Left")
      expect(result.left._tag).toBe("ShaclValidationError")
      expect(result.left.report.violations.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(TestLayer), Effect.runPromise)
  )
})
```

**The `assertProjectionParity` helper is the important part.** It compares source and round-tripped entities field-by-field, using the explicit ignore-list and set-valued-field list from the test. Parity is asserted at the projection level — same IDs, same predicates, same literal values. Field ordering, whitespace, and runtime-local metadata are allowed to drift.

## Production-pattern unknowns

These questions block design completion. The research prompt below is scoped to get answers for them:

1. How do production ontology systems handle the "TS schema vs RDF graph" impedance mismatch in general? What is the usual test shape for domain-graph round-trips?
2. Is SHACL actually the right enforcement layer, or do most production systems use custom validators + referential integrity checks?
3. How do production systems handle versioning drift between TS schemas and ontology versions? What breaks first when an ontology release renames a predicate?
4. What's the memory footprint of a few tens of thousands of quads in N3.js in Node? Is an in-memory store the right call, or should we be considering a persistent quad store (quadstore, LevelGraph) from day one?
5. Is the manifest-walker approach (hand-curated ontologyIri per field) the right abstraction, or do production systems rely on more automated mappings (e.g. JSON-LD contexts, R2RML, RML)?
6. How do production systems lay out the design → publish → enforce boundary between an ontology authoring tool and a runtime validator? Where do shapes actually live in other projects?

Answers to these questions will determine whether `packages/ontology-store/` is a ~1000-line package or a ~5000-line package. Do not start implementation before the research pass returns.

## Open questions (internal, not for research pass)

Same as the ticket — repeated here for the design doc's self-containment:

1. **Effect 4 adaptation surface.** Which effect-ontology patterns translate cleanly and which need rethinking?
2. **skygest-internal IRI governance.** When a domain value has no upstream ontology term, what's the fallback IRI path and who owns minting?
3. **Alias round-trip fidelity.** `methodologyVariant` extension: sub-property or collapse to `skos:closeMatch`?
4. **Observation modelling.** Future — `qb:Observation` vs `schema:Observation`?
5. **Reasoner materialization vs query-time** — once reasoning lands.
6. **SPARQL surface** — default no, unless a consumer forces it.
7. **SHACL depth** — sharpen the SHACL-vs-Schema boundary with real shape examples.

## Acceptance for THIS design doc

- [x] States the architectural boundary between `ontology_skill`, `skygest-ontology-snapshots`, and this package
- [x] Names the load-bearing decision that shapes are a runtime concern and live in the snapshot repo
- [x] Commits to N3.js + shacl-engine + Effect 4
- [x] Flags Effect 3 → 4 adaptation as a non-trivial surface
- [x] Sketches the package layout, the three Effect 4 services, and the emit/distill pipeline shapes
- [x] Defines projection-level parity as the round-trip bar, not structural equality
- [x] Lists the production-pattern unknowns that block implementation
- [x] States explicitly that implementation is blocked on the research pass returning

## Not in scope for this doc

- Implementation code. Nothing in `packages/ontology-store/` exists yet.
- Ingest of resolved post and chart bundles. That's the next ticket after this lands.
- KV seeding convergence. Legacy tech debt, separate concern.
- OEO coverage measurement. Tracked under SKY-348.
- RDF Data Cube observation modelling. Future.
```

---

## docs/plans/2026-04-14-unified-triple-store-export-design.md (earlier context, Section 1 inlined schema reference)

```markdown
# 2026-04-14 — Unified triple-store export design (brainstorm checkpoint)

## Status

**Working brainstorm, not an implementation plan.** The document is deliberately self-contained: the schemas it discusses are inlined (Schema reference section) so the reader can reason about shapes without opening the TypeScript source. Paused before Section 2 (the annotation layer). The ontology-skill toolchain has been reviewed; findings and corrections are incorporated. Section 2 (annotation + resolution layer) is still deferred — it needs to be drafted through the `/ontology-requirements` and `/ontology-conceptualizer` sub-skills in the ontology_skill workspace rather than designed in isolation on the skygest-cloudflare side.

## Scope

Stand up the first-pass infrastructure for exporting resolved posts **and** the DCAT data layer from the TypeScript / D1 runtime into a **local** triple store where reasoning, SHACL validation, and OEO binding can happen offline.

- One-way flow only. No roundtrip from reasoner back to runtime state.
- Manual trigger, not event-driven streaming. Cloudflare Workflows / Queues / Durable Objects for graph writes are out of scope for this pass.
- The DCAT side and the post side are **one workstream**, not two. They share infrastructure (RDF emitter, namespace conventions, build triggers) and both land in the same triple store against the same TBox.
- Cold-start DCAT is the first exportable dataset (smallest, most contained, forces the shared-infrastructure decisions early). Posts come in once DCAT is flowing.

The goal is a working one-way pipeline from operational state → graph, not a full CQRS topology. The full topology is captured in Appendix A for reference; the first build is deliberately a small fraction of it.

## Context

### Reference architecture

Inlined in Appendix A. A CQRS-style multi-service blueprint with a Firehose Ingestor → Resolution/Matchmaker → Semantic Graph Writer → API/Reader topology, plus an event bus materializing reasoned subgraphs back into a flattened search index. **This is the north star, not the first build.** The first cut keeps the triple store offline and treats the ontology layer as a derived artifact rather than the runtime source of truth.

### Linear ticket landscape

Concurrent tracks that feed this design:

| Track | Tickets | Blueprint role |
|---|---|---|
| DCAT catalog + cold-start adapters | SKY-213, SKY-216, SKY-218, SKY-339 (done) | ABox — domain data |
| Typed entity search on D1 + FTS5 | SKY-342, **SKY-350 (current branch)**, SKY-351, SKY-345 | Matchmaker read index |
| OEO binding from prompt layer | **SKY-348** (`2026-04-14-ontology-from-prompt-layer-design.md`) | Semantic grounding |
| Catalog → RDF adapter + ext. reasoner | **SKY-349** | Graph writer — export only |
| CF-native resolution workflows | SKY-224 (parked) | Event-driven materialization |
| MCP resolver tools | SKY-241, SKY-244 (done) | API / read surface |
| Formal OWL/RDF export tooling | SKY-222, SKY-229, SKY-230 | Schema + validation harness |

This plan absorbs SKY-349 as the DCAT-side half of the same workstream. They are not independent deliverables.

### Current runtime state

- **DCAT data layer** — Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries, plus Variable / Series / Observation (VSO). Each minted as `https://id.skygest.io/{kind}/{prefix}_{ULID}` with branded types in `src/domain/data-layer/ids.ts`. D1 repositories in `src/services/d1/`. Cold-start JSON in `references/cold-start/catalog/` (hand-curated, git-diffable, validated by `cold-start-validation.test.ts`).
- **Ingest adapters** — `src/ingest/dcat-adapters/` for EIA, NESO, Energy Institute, ENTSO-E, ODRÉ. These mint DCAT entities from external catalogs at runtime.
- **EnrichedBundle** (`src/domain/enrichedBundle.ts`) = `{ asset: VisionAssetEnrichment, sourceAttribution: SourceAttributionEnrichment | null, postContext: Stage1PostContext }` — one chart asset per bundle. A post with three charts is three bundles, joined only by `postUri`.
- **PostUri** = `at://` | `x://` (platform-native). No Skygest-minted post URI today.
- **DataRefResolutionEnrichment** persists Stage 1 + kernel outcomes (`ResolutionOutcome` tagged union) into D1 `post_enrichments`.
- **PostAnnotationFrontmatter** (`src/domain/narrative/post-annotation.ts`) exists as an editorial markdown-frontmatter shape. **Out of scope** for the graph — it serves the editor layer, not the triple store.
- Chart assets have **no stable first-class identity** beyond array index inside the vision enrichment record. This is a gap; D4 proposes the fix.

### Data-layer manifest as the ontology bridge

**This is the central discovery that reshapes the exporter design.**

`references/data-layer-spine/manifest.json` is a hand-curated + partially code-generated bridge between the sevocab ontology and the TypeScript domain layer. It declares, per class and per field:

```jsonc
{
  "manifestVersion": 1,
  "ontologyIri": "https://skygest.dev/vocab/energy",
  "ontologyVersion": "0.2.0",
  "sourceCommit": "458c5e416c589dff1c2b6e29dc0e4e4529fb5492",
  "inputHash": "sha256:...",
  "classes": {
    "Agent": {
      "runtimeName": "Agent",
      "ontologyIri": "https://skygest.dev/vocab/energy/EnergyAgent",
      "classComment": "A FOAF agent that publishes one or more energy datasets.",
      "fields": [
        { "runtimeName": "_tag", "ontologyIri": null, "generation": "handWritten", ... },
        { "runtimeName": "id", "ontologyIri": null, "generation": "handWritten", ... },
        { "runtimeName": "name", "ontologyIri": "http://xmlns.com/foaf/0.1/name", "generation": "generated", ... },
        { "runtimeName": "homepage", "ontologyIri": "http://xmlns.com/foaf/0.1/homepage", "generation": "generated", ... },
        ...
      ]
    },
    ...
  }
}
```

The manifest drives `bun run gen:data-layer-spine` (`scripts/generate-data-layer-spine.ts`) which emits `src/domain/generated/dataLayerSpine.ts` containing `AgentOntologyFields`, `DatasetOntologyFields`, `VariableOntologyFields`, `SeriesOntologyFields`. The generated modules are then composed with hand-written wrappers (`Agent`, `Dataset`, etc.) in `src/domain/data-layer/catalog.ts` and `variable.ts`.

**Implications for this plan:**

1. The TypeScript → RDF mapping for every ontology-owned field is **already declared** in the manifest. Field IRIs like `foaf:name`, `dcterms:title`, `dcat:distribution`, `prov:wasDerivedFrom`, `skygest.dev/vocab/energy/measuredProperty` are first-class data, not code.
2. The same manifest that drives TS codegen can drive **RDF codegen** — the DCAT-side exporter is fundamentally a manifest-walker. For each class with `ontologyIri`, query D1 for instances, emit `<instance> a <class_iri> ; <field_iri> <field_value>` for each field with `ontologyIri`.
3. The `handWritten` vs `generated` flag is the natural inclusion filter — `generated` fields have ontology identity, `handWritten` fields are runtime-local (the `_tag` discriminant, branded IDs, parent pointers, timestamps from `TimestampedAliasedFields`). The exporter skips `handWritten`-only fields automatically.
4. There is **also** an inline annotation layer on the Effect Schema modules (symbol-keyed `DcatClass`, `DcatProperty`, `SchemaOrgType`, `SdmxConcept`, `SkosMapping`, `DesignDecision` — defined in `src/domain/data-layer/annotations.ts`). These are populated from the manifest at codegen time and are redundant with the manifest data — but they're what you'd read at runtime if you wanted schema-driven export without loading the JSON manifest.

**This changes the SKY-349 story substantially.** SKY-349 was described as "build a catalog → RDF adapter for ingestion, validation, and bidirectional cleaning." The manifest means the adapter is much smaller than it looked — it's a ~300-line walker, not a from-scratch mapping layer.

## Schema reference

This section inlines the schemas the design depends on, in compact pseudo-form. Anchored at file paths for drill-down.

### URI scheme and branded IDs — `src/domain/data-layer/ids.ts`

All DCAT entities use ULID-prefixed URIs in the canonical Skygest instance namespace:

```
https://id.skygest.io/{entityKind}/{prefix}_{ULID}

Agent           ag_…    → https://id.skygest.io/agent/ag_01HXXX…
Catalog         cat_…   → https://id.skygest.io/catalog/cat_01HXXX…
CatalogRecord   cr_…    → https://id.skygest.io/catalog-record/cr_01HXXX…
Dataset         ds_…    → https://id.skygest.io/dataset/ds_01HXXX…
Distribution    dist_…  → https://id.skygest.io/distribution/dist_01HXXX…
DataService     svc_…   → https://id.skygest.io/data-service/svc_01HXXX…
DatasetSeries   dser_…  → https://id.skygest.io/dataset-series/dser_01HXXX…
Variable        var_…   → https://id.skygest.io/variable/var_01HXXX…
Series          ser_…   → https://id.skygest.io/series/ser_01HXXX…
Observation     obs_…   → https://id.skygest.io/observation/obs_01HXXX…
Candidate       cand_…  → https://id.skygest.io/candidate/cand_01HXXX…
```

Every branded ID in `ids.ts` uses a `Schema.String.pipe(Schema.check(Schema.isPattern(...)), Schema.brand(...))` check. Mint helpers (`mintAgentId`, `mintDatasetId`, …) use `ulid()`.

**Post URIs break this pattern.** They are platform-native (`at://did:plc:xxx/app.bsky.feed.post/3kabc` or `x://1234567890`), not minted. D4 below proposes a new hierarchical namespace `https://id.skygest.io/post/{platform}/{did-dots}/{rkey}` to bring posts into the canonical instance namespace while preserving the platform-native form as `dcterms:identifier` and `owl:sameAs`.

### DCAT domain schemas — `src/domain/data-layer/catalog.ts`

All entities share `TimestampedAliasedFields = { createdAt: IsoTimestamp, updatedAt: IsoTimestamp, aliases: Aliases }` unless noted.

#### Agent — `DcatClass: foaf:Agent`

```
Agent {
  _tag: "Agent"
  id: AgentId
  kind: AgentKind   // organization | person | consortium | program | other
  name: string                     @foaf:name
  alternateNames?: string[]        // runtime-local
  homepage?: WebUrl                @foaf:homepage
  parentAgentId?: AgentId          // runtime-local
  createdAt, updatedAt, aliases
}
```

#### Catalog — `DcatClass: dcat:Catalog`

```
Catalog {
  _tag: "Catalog"
  id: CatalogId
  title: string                    @dcterms:title
  description?: string             @dcterms:description
  publisherAgentId: AgentId        @dcterms:publisher
  homepage?: WebUrl                @foaf:homepage
  createdAt, updatedAt, aliases
}
```

#### CatalogRecord — `DcatClass: dcat:CatalogRecord`

Catalog's view of a resource. **Carries only catalog-tracking dates; no `TimestampedAliasedFields`, no aliases.** `primaryTopicId` is validated against `primaryTopicType` (must match `DatasetId` or `DataServiceId` URI pattern).

```
CatalogRecord {
  _tag: "CatalogRecord"
  id: CatalogRecordId
  catalogId: CatalogId
  primaryTopicType: "dataset" | "dataService"   @foaf:primaryTopic
  primaryTopicId: string   // DatasetId | DataServiceId (cross-validated)
  sourceRecordId?: string  // external record ID (e.g., EIA API ID)
  harvestedFrom?: string   // source endpoint
  firstSeen?: DateLike     @dcterms:issued
  lastSeen?: DateLike      @dcterms:modified
  sourceModified?: DateLike
  isAuthoritative?: boolean
  duplicateOf?: CatalogRecordId
}
```

This is the closest thing to adapter-run provenance in the current schemas — `harvestedFrom` + `sourceRecordId` + `firstSeen` / `lastSeen` capture enough to reconstruct "this record came from this external source at this time." But it's attached to the CatalogRecord, not directly to the entity it points at, and it's optional.

#### Dataset — `DcatClass: dcat:Dataset`, `SchemaOrgType: schema:Dataset`

```
Dataset {
  _tag: "Dataset"
  id: DatasetId
  // from DatasetOntologyFields (generated):
  title: string                           @dcterms:title
  description?: string                    @dcterms:description
  creatorAgentId?: AgentId                @dcterms:creator
  wasDerivedFrom?: AgentId[]              @prov:wasDerivedFrom
  publisherAgentId?: AgentId              @dcterms:publisher
  landingPage?: WebUrl                    @dcat:landingPage
  license?: string                        @dcterms:license
  temporal?: string                       @dcterms:temporal
  keywords?: string[]                     @dcat:keyword
  themes?: string[]                       @dcat:theme
  variableIds?: VariableId[]              @sevocab:hasVariable
  distributionIds?: DistributionId[]      @dcat:distribution
  inSeries?: DatasetSeriesId              @dcat:inSeries
  // hand-written:
  accessRights?: AccessRights             // public | restricted | nonPublic | unknown
  dataServiceIds?: DataServiceId[]
  createdAt, updatedAt, aliases
}
```

**`prov:wasDerivedFrom`** is already here — but pointing at `AgentId`, not at an ingest-activity entity. It's the "who is upstream" provenance, not the "which run minted this" provenance.

#### Distribution — `DcatClass: dcat:Distribution`, `SchemaOrgType: schema:DataDownload`

```
Distribution {
  _tag: "Distribution"
  id: DistributionId
  datasetId: DatasetId
  kind: DistributionKind    // download | api-access | landing-page | interactive-web-app | documentation | archive | other
  title?: string            @dcterms:title
  description?: string      @dcterms:description
  accessURL?: WebUrl        @dcat:accessURL
  downloadURL?: WebUrl      @dcat:downloadURL
  mediaType?: string        @dcat:mediaType
  format?: string           @dcterms:format
  byteSize?: number         @dcat:byteSize
  checksum?: string         @spdx:checksum
  accessRights?: AccessRights
  license?: string          @dcterms:license
  accessServiceId?: DataServiceId   @dcat:accessService
  createdAt, updatedAt, aliases
}
```

URL role ambiguity I flagged earlier is **already resolved** — `accessURL` vs `downloadURL` are distinct fields mapping to distinct predicates. Landing pages are captured on `Dataset.landingPage` (`dcat:landingPage`) and on `Catalog.homepage` (`foaf:homepage`).

#### DataService — `DcatClass: dcat:DataService`

```
DataService {
  _tag: "DataService"
  id: DataServiceId
  title: string                    @dcterms:title
  description?: string             @dcterms:description
  publisherAgentId?: AgentId       @dcterms:publisher
  endpointURLs: WebUrl[]           @dcat:endpointURL
  endpointDescription?: WebUrl     @dcat:endpointDescription
  conformsTo?: string              @dcterms:conformsTo
  servesDatasetIds: DatasetId[]    @dcat:servesDataset
  accessRights?, license?
  createdAt, updatedAt, aliases
}
```

#### DatasetSeries — `DcatClass: dcat:DatasetSeries`

**DCAT-level grouping**, distinct from the SDMX-style `Series` below.

```
DatasetSeries {
  _tag: "DatasetSeries"
  id: DatasetSeriesId
  title: string                    @dcterms:title
  description?: string             @dcterms:description
  publisherAgentId?: AgentId       @dcterms:publisher
  cadence: Cadence                 @dcterms:accrualPeriodicity
  //   annual | quarterly | monthly | weekly | daily | irregular
  createdAt, updatedAt, aliases
}
```

### VSO — `src/domain/data-layer/variable.ts`

#### Variable — seven-facet composition

`SchemaOrgType: schema:StatisticalVariable`, `SdmxConcept: Concept`.

```
Variable {
  _tag: "Variable"
  id: VariableId
  // from VariableOntologyFields (generated):
  label: string                    @rdfs:label
  definition?: string              @skos:definition
  measuredProperty?: string        @sevocab:measuredProperty
  domainObject?: string            @sevocab:domainObject
  technologyOrFuel?: string        @sevocab:technologyOrFuel
  statisticType?: StatisticType    @sevocab:statisticType    // generated enum
  aggregation?: Aggregation        @sevocab:aggregation      // generated enum
  unitFamily?: UnitFamily          @sevocab:unitFamily       // generated enum
  policyInstrument?: string        @sevocab:policyInstrument
  createdAt, updatedAt, aliases
}
```

The **field IRIs** (`sevocab:measuredProperty`, etc.) are already declared. What's implicit is the **value → URI mapping** — the string `"wind"` for `technologyOrFuel` needs to become `sevocab:wind` at export time. That value-to-URI map is the narrow remaining gap. For closed enums (`StatisticType`, `Aggregation`, `UnitFamily`) the mapping should be emitted from the same manifest / energy variable profile source; for open strings (`measuredProperty`, `domainObject`, `technologyOrFuel`, `policyInstrument`) the facet value has to resolve against the skygest-energy-vocab concept schemes.

SKY-348 (OEO binding from prompt layer) is pivoting Variables toward OEO IRIs as the primary semantic anchor. When that lands, the `measuredProperty` / `domainObject` / `technologyOrFuel` fields may become redundant or take on a different role — the exporter design should be compatible with both the current facet-based approach and the OEO-bound approach.

#### Series — Variable locked to a reporting context

`SdmxConcept: SeriesKey`.

```
Series {
  _tag: "Series"
  id: SeriesId
  label: string                    @rdfs:label
  variableId: VariableId           @sevocab:implementsVariable
  datasetId?: DatasetId            @sevocab:publishedInDataset
  fixedDims: FixedDims {
    place?, sector?, market?, frequency?, extra?: Record<string, string>
  }
  createdAt, updatedAt, aliases
}
```

#### Observation — `SchemaOrgType: schema:Observation`, `SdmxConcept: Observation`

```
Observation {
  _tag: "Observation"
  id: ObservationId
  seriesId: SeriesId
  time: TimePeriod { start: DateLike, end?: DateLike }
  value: number
  unit: string
  sourceDistributionId: DistributionId
  qualification?: string
}
```

Observations are **out of scope** for first-pass export — we're exporting the Variable / Series / Distribution structure but not the data values. Keeps the graph small and avoids needing QB (RDF Data Cube) modelling.

### Alias system — `src/domain/data-layer/alias.ts`

23 alias schemes cover external identifier systems. This is the **single most underappreciated piece of existing infrastructure** for the RDF export.

```
AliasScheme =
  // Scientific / concept ontologies
  | "oeo" | "ires-siec" | "iea-shortname" | "ipcc"
  // ENTSOE
  | "entsoe-psr" | "entsoe-eic" | "entsoe-document-type"
  // Data provider schemes
  | "eia-route" | "eia-series" | "eia-bulk-id"
  | "energy-charts-endpoint" | "ember-route"
  | "gridstatus-dataset-id" | "odre-dataset-id"
  | "eurostat-code" | "europa-dataset-id"
  // External ID systems
  | "ror" | "wikidata" | "doi"
  // Geographic / display / other
  | "iso3166" | "url" | "display-alias" | "other"

AliasRelation =   // SKOS-aligned; SkosMapping annotation points at skos:mappingRelation
  | "exactMatch"  | "closeMatch" | "broadMatch" | "narrowMatch"
  | "methodologyVariant"   // Skygest extension for gross-vs-net, etc.

ExternalIdentifier {
  scheme: AliasScheme
  value: string
  uri?: string           // explicit external URI if available (wikidata, doi, ror, ...)
  relation: AliasRelation
}

Aliases = ExternalIdentifier[]
  // enforced: (scheme, value) unique per entity
```

**Export implications:**

- Each `ExternalIdentifier` with a non-null `uri` becomes `<entity> skos:{relation} <uri>` (or `dcterms:identifier <value>` if no URI). `skos:exactMatch`, `skos:closeMatch`, `skos:broadMatch`, `skos:narrowMatch` are direct SKOS terms.
- `methodologyVariant` is a Skygest extension — we'd either mint `sevocab:methodologyVariant` as a sub-property of `skos:mappingRelation`, or collapse it to `skos:closeMatch` at export time (lossy).
- The `display-alias` scheme is **not** a mapping — it's a title variant for UI display. Export it as `skos:altLabel` with `@en` language tag.
- Aliases to `wikidata` / `doi` / `ror` give the graph **immediate interop** with the external LOD cloud without any extra work.

### Inline RDF annotations — `src/domain/data-layer/annotations.ts`

Six symbol-keyed annotation keys used throughout the schemas:

```
DcatClass       = Symbol.for("skygest/dcat-class")       // → DCAT class IRI
DcatProperty    = Symbol.for("skygest/dcat-property")    // → predicate IRI
SkosMapping     = Symbol.for("skygest/skos-mapping")     // → skos:mappingRelation IRI
SchemaOrgType   = Symbol.for("skygest/schema-org-type")  // → schema.org class IRI
SdmxConcept     = Symbol.for("skygest/sdmx-concept")     // → SDMX concept name
DesignDecision  = Symbol.for("skygest/design-decision")  // → design-decision ID (e.g., "D5")
```

These are attached via Effect Schema's `.annotate()` method at schema definition time. Example from `catalog.ts`:

```typescript
export const Dataset = Schema.Struct({ ... }).annotate({
  description: "Collection of data published or curated by a single source (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Dataset",
  [SchemaOrgType]: "https://schema.org/Dataset",
  [DesignDecision]: "D5"
});
```

The exporter can introspect these via Effect Schema's AST to drive triple emission — no hand-maintained mapping table needed.

### Post-side schemas

#### PostUri — `src/domain/types.ts`

```
AtUri = String matching /^at:\/\/.+$/ (brand AtUri)
PostUri = String matching /^(at|x):\/\//  (brand PostUri)
  // at:// → Bluesky (AT URI)
  // x://  → Twitter
```

#### Stage1PostContext — `src/domain/stage1Resolution.ts`

Narrow post projection consumed by deterministic Stage 1:

```
Stage1PostContext {
  postUri: PostUri
  text: string
  links: LinkRecord[]
  linkCards: PostLinkCard[]
  threadCoverage: ThreadCoverage
}
```

#### VisionAssetEnrichment — `src/domain/enrichment.ts` (`VisionAssetAnalysisV2`)

One per chart asset. This is where the vision model's output lives — the "did we infer the right unit" data lives here.

```
VisionAssetAnalysisV2 {
  mediaType: MediaType        // image | video
  chartTypes: string[]
  altText: string | null
  altTextProvenance: AltTextProvenance
  xAxis: ChartAxis | null
  yAxis: ChartAxis | null
  series: ChartSeries[]
  sourceLines: VisionSourceLineAttribution[]
  temporalCoverage: TemporalCoverage | null
  keyFindings: string[]
  visibleUrls: string[]
  organizationMentions: VisionOrganizationMention[]
  logoText: string[]
  title: string | null
  modelId: string
  processedAt: number
}
```

`ChartAxis` carries unit, label, data type. `VisionSourceLineAttribution` carries source text + optional datasetName. `VisionOrganizationMention` carries organization name + location (title / subtitle / footer / watermark / body).

#### SourceAttributionEnrichment — `src/domain/sourceMatching.ts` (summary)

Per-asset source attribution output. Key pieces:

```
SourceAttributionResolution = "matched" | "ambiguous" | "unmatched"
SourceAttributionEnrichment {
  resolution: SourceAttributionResolution
  evidence: (SourceLineAliasEvidence | SourceLineDomainEvidence
           | ChartTitleAliasEvidence | LinkDomainEvidence
           | EmbedLinkDomainEvidence | ...)[]
  // evidence variants carry signal name, rank (1-N), asset key, and signal-specific fields
  providerCandidates: SourceAttributionProviderCandidate[]
  ...
}
```

Each evidence variant is a tagged struct with a `signal` literal (e.g., `"source-line-alias"`) and a numeric `rank` (lower = higher-confidence signal). This is a ranked multi-signal attribution pipeline output — in RDF it becomes a set of `prov:Activity` nodes, one per evidence entry, carrying the signal name as a typed property.

#### EnrichedBundle — `src/domain/enrichedBundle.ts`

The unit of resolution.

```
EnrichedBundle {
  asset: VisionAssetEnrichment
  sourceAttribution: SourceAttributionEnrichment | null
  postContext: Stage1PostContext
}
```

A post with three chart assets produces three bundles. The `postContext.postUri` is the join key across bundles from the same post. D3 introduces `EnrichedPost` as the graph-facing envelope that collects all bundles for a post under a single URI.

### Resolution outcomes — `src/domain/resolutionKernel.ts`

#### ResolutionOutcome — tagged union

```
ResolutionOutcome =
  | Resolved      { bundle, sharedPartial, attachedContext, items, agentId?, datasetIds?, confidence?, tier? }
  | Ambiguous     { bundle, hypotheses, items, gaps, confidence?, tier? }
  | Underspecified{ bundle, partial, missingRequired, gap, gaps, confidence?, tier? }
  | Conflicted    { bundle, hypotheses, conflicts, gaps, confidence?, tier? }
  | OutOfRegistry { bundle, hypothesis, items, gap }
  | NoMatch       { bundle, reason? }
```

Each carries the `ResolutionEvidenceBundle` (the structured evidence the kernel consumed) plus outcome-specific payload.

#### ResolutionEvidenceBundle

```
ResolutionEvidenceBundle {
  postUri?: PostUri
  assetKey?: string
  postText: string[]
  chartTitle?: string
  xAxis?: ChartAxis
  yAxis?: ChartAxis
  series: { itemKey, legendLabel, unit? }[]
  keyFindings: string[]
  sourceLines: { sourceText, datasetName? }[]
  publisherHints: { label, confidence? }[]
  temporalCoverage?: TemporalCoverage
}
```

#### Evidence precedence

```
EVIDENCE_PRECEDENCE = [
  "series-label", "x-axis", "y-axis", "chart-title",
  "key-finding", "post-text", "source-line", "publisher-hint"
]

ResolutionEvidenceTier = "entailment" | "strong-heuristic" | "weak-heuristic"
```

#### BoundResolutionItem

```
BoundResolutionItem =
  | { _tag: "bound", itemKey?, semanticPartial, attachedContext, evidence, variableId, label? }
  | { _tag: "gap",   itemKey?, semanticPartial, attachedContext, evidence, candidates, missingRequired?, reason }

ResolutionGapReason =
  | "missing-required" | "no-candidates" | "dataset-scope-empty"
  | "agent-scope-empty" | "ambiguous-candidates" | "required-facet-conflict"
```

**Exporter implications.** The `Resolved` / `Ambiguous` / `Underspecified` / etc. cases each become a `prov:Activity` in the graph, carrying the tier + evidence + bound variable (if any). The annotation layer (Section 2, deferred) wraps this with an `oa:Annotation` linking the chart asset to the bound DCAT entity. The `_tag` discriminant maps to a `sgpost:resolutionStatus` property.

## Decisions locked in

### D1 — Direction of flow

One-way: TS / D1 runtime → local triple store. Reasoning, SHACL validation, OEO binding happen offline. Outputs are reports, not runtime writes. No event bus. Manual trigger for the export. No roundtrip from reasoner back into D1 as state.

### D2 — Annotation grain

**Chart asset (bundle level).** The `oa:hasTarget` of the post↔DCAT annotation points at an individual chart asset, not at the post. Rationale: vision extraction asserts facts per-asset (unit, axis label, series, source lines). "Did we infer the right unit?" is checkable at this grain and at no other. Post-level rollups become SPARQL aggregations over chart-level annotations. Claim-level (sourceline) grain deferred.

### D3 — Canonical envelope = `EnrichedPost`

Add a new domain schema `src/domain/enrichedPost.ts`:

```
EnrichedPost {
  postUri: PostUri             // platform-native at:// or x://
  author: Did
  capturedAt: IsoTimestamp
  bundles: EnrichedBundle[]    // one per chart asset
  sourceAttribution: SourceAttributionEnrichment | null
}
```

**Only posts that have been through resolution flow into the graph.** The envelope carries the raw extraction outputs; the resolution outcome becomes a separate annotation assertion in Section 2 (deferred). Editorial pick records, annotation frontmatter, and curation state **do not** enter the envelope — those stay in the editorial layer. `EnrichedPost` is the graph-facing projection, `PostAnnotationFrontmatter` is the editor-facing projection, and both derive from the same D1 state.

### D4 — Chart asset identity (Scheme 2: post as first-class URI, chart as child)

Chart assets need stable URIs. We elevate **posts** to first-class Skygest URIs and treat chart assets as children:

```
Post:  https://id.skygest.io/post/bluesky/{did-dots}/{rkey}
       https://id.skygest.io/post/twitter/{tweetId}
Chart: https://id.skygest.io/post/bluesky/{did-dots}/{rkey}/chart/{blobCid}
       https://id.skygest.io/post/twitter/{tweetId}/chart/{mediaId}
```

- `did:plc:xxx` rendered as `did.plc.xxx` to dodge colon/URL-safety issues.
- Stable-per-asset key is platform-given: Bluesky `blobCid` (content hash), Twitter `mediaId`. No new minting required for the child segment.
- Platform-native `at://` / `x://` URIs carried on the post node as `dcterms:identifier` and bridged with `owl:sameAs`.
- Child URI structure is extensible: resolution outcomes, sourceline claims, per-bundle annotations all attach naturally under the post namespace.

**Note**: this is a **structural departure from the existing ULID scheme** used for DCAT entities. DCAT entities are minted `https://id.skygest.io/{kind}/{prefix}_{ULID}` with opaque ULIDs. Posts use a hierarchical path scheme with platform-native components. This is a deliberate exception — posts are already canonically identified by their platform URI, and re-minting a ULID for them would create a gratuitous mapping layer.

This is a real commitment — it introduces `PostSkygestUri` and `ChartAssetId` branded types, a minting step, and a back-mapping from platform URIs to Skygest URIs. The payoff is that posts are first-class graph citizens addressed in the same scheme as DCAT entities, and every child resource is URI-prefix-reachable from the post.

### D5 — Namespace split: TBox vs ABox

The ontology-skill review surfaced an idiomatic convention already in use: **vocabulary namespaces and instance namespaces are distinct.**

- **TBox (vocabulary terms, class/property definitions)** — `https://skygest.dev/vocab/{module}/`
  - Existing: `sevocab:` = `https://skygest.dev/vocab/energy/` (skygest-energy-vocab)
  - Existing: `enews:` = `http://example.org/ontology/energy-news#` (energy-news — older placeholder namespace)
  - **New**: `sgpost:` = `https://skygest.dev/vocab/post/` for the post-annotation module
- **ABox (instance URIs)** — `https://id.skygest.io/{kind}/...`
  - Existing: DCAT entities minted as `https://id.skygest.io/{agent|dataset|variable|...}/{ulid}`
  - **New**: posts at `https://id.skygest.io/post/{platform}/{did-dots}/{rkey}`
  - **New**: chart assets at `https://id.skygest.io/post/.../chart/{blobCid}`

This split means the vertex shapes (D6) use **both** namespaces: `sgpost:Post` as the class, `<https://id.skygest.io/post/...>` as the individual.

### D6 — Draft RDF vertex shapes

First-pass triples for the post + chart + vision activity. Section 2 (annotations + resolution layer) deferred.

```turtle
@prefix sgpost:  <https://skygest.dev/vocab/post/> .
@prefix schema:  <http://schema.org/> .
@prefix sioc:    <http://rdfs.org/sioc/ns#> .
@prefix prov:    <http://www.w3.org/ns/prov#> .
@prefix oa:      <http://www.w3.org/ns/oa#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

# Post instance
<https://id.skygest.io/post/bluesky/did.plc.xxx/3kabc>
    a sgpost:Post, schema:SocialMediaPosting, sioc:Post, prov:Entity ;
    dcterms:identifier "at://did:plc:xxx/app.bsky.feed.post/3kabc" ;
    schema:author <https://id.skygest.io/agent/ag_01HXXX...> ;
    schema:datePublished "2026-04-10T14:22:00Z"^^xsd:dateTime ;
    schema:text "..." ;
    sgpost:hasChartAsset <.../3kabc/chart/bafybeib...> .

# Chart asset instance
<https://id.skygest.io/post/bluesky/did.plc.xxx/3kabc/chart/bafybeib...>
    a sgpost:ChartAsset, schema:ImageObject, prov:Entity ;
    dcterms:isPartOf <https://id.skygest.io/post/bluesky/did.plc.xxx/3kabc> ;
    schema:contentUrl "https://cdn.bsky.app/..." ;
    sgpost:chartType "line" ;
    sgpost:title "US crude oil production 2015-2025" ;
    sgpost:xAxisLabel "Year" ;
    sgpost:yAxisUnit "thousand barrels/day" ;
    prov:wasGeneratedBy <.../activity/vision-extract/{runId}> .

# Vision activity
<https://id.skygest.io/post/.../activity/vision-extract/{runId}>
    a prov:Activity, sgpost:VisionExtraction ;
    prov:used <.../model/gemini-2.5-pro> ;
    prov:endedAtTime "..."^^xsd:dateTime .
```

**Design calls:**
1. Multi-typing is cheap — post is simultaneously `sgpost:Post` + `schema:SocialMediaPosting` + `sioc:Post` + `prov:Entity`.
2. Platform URI is `dcterms:identifier`, not the node URI. The Skygest URI is the single canonical key.
3. `sgpost:hasChartAsset` forward, `dcterms:isPartOf` inverse — both asserted so SPARQL walks either direction without inference.
4. Vision extraction is a `prov:Activity`; chart facts (`sgpost:chartType`, `sgpost:xAxisLabel`, `sgpost:yAxisUnit`) are properties *generated by* that activity.
5. Chart facts use `sgpost:` predicates, **not** QUDT / OEO / QB yet. Semantic mapping happens in the annotation layer (Section 2), where chart facts get **linked to** DCAT entities rather than **equated with** ontology terms.
6. **Alignment to `enews:Post` is an open question.** If `sgpost:Post` should be a subclass of (or equivalent to) `enews:Post`, that's an owl:equivalentClass / rdfs:subClassOf declaration in the TBox.

## Ontology-skill review (findings)

### Workspace shape

`/Users/pooks/Dev/ontology_skill` is a **Programmatic Ontology Development workspace**, not a single Claude skill. Entry point is `Justfile` + `pyproject.toml` (uv/Python). Each ontology is a self-contained directory under `/ontologies/{name}/` with a standard layout: main `.ttl`, `imports/`, `shapes/`, `scripts/build.py`, `tests/`, `docs/`, `mappings/`, `catalog-v001.xml`, `release/`.

**Never hand-edit `.ttl` files** — every `.ttl` is regenerated from a conceptual source (CSV or YAML) via `scripts/build.py` using rdflib / OWLAPY. This is a hard convention across the repo.

### Sub-skills available

Eight encapsulated sub-skills live in `.claude/skills/`, each invokable as a slash command:

1. `/ontology-requirements` — elicit competency questions, write an ORSD, design test suites
2. `/ontology-scout` — survey reusable ontologies, ODP patterns, existing imports
3. `/ontology-conceptualizer` — taxonomy design, BFO alignment, anti-pattern review
4. `/ontology-architect` — OWL axioms, ROBOT templates, KGCL patches
5. `/ontology-mapper` — SSSOM mappings, cross-ontology alignment
6. `/ontology-validator` — HermiT reasoning, SHACL checks, CQ execution, ROBOT reports
7. `/sparql-expert` — SPARQL query design, validation, execution
8. `/ontology-curator` — deprecation, versioning, releases

Shared conventions in `.claude/skills/_shared/` and `.claude/skills/CONVENTIONS.md`.

### Build + validation pipeline

```
1. uv run python ontologies/{name}/scripts/build.py         # Conceptual source → TTL
2. python scripts/validate_turtle.py <files>                # Turtle syntax
3. robot merge --catalog catalog-v001.xml --input {name}.ttl
4. robot reason --reasoner HermiT --input merged.ttl        # HermiT closure
5. robot report --profile profile.txt --fail-on ERROR       # Structural checks
6. uv run pytest ontologies/{name}/tests/test_ontology.py   # SPARQL CQs + SHACL
```

Outputs land in `/build/{name}/merged.ttl`, `reasoned-hermit.ttl`, `{name}-report.tsv`. SHACL runs inside pytest via `pyshacl`. A pre-commit hook validates Turtle syntax on every commit. `just check` is CI-equivalent.

### Competency-question format

CQs live in `ontologies/{name}/docs/competency-questions.yaml`:

```yaml
- id: CQ-001
  natural_language: "What energy topics exist in the ontology?"
  type: enumerative | relational | aggregate | constraint
  priority: must_have | should_have | nice_to_have
  sparql: |
    PREFIX enews: <http://example.org/ontology/energy-news#>
    SELECT ?topic ?label WHERE { ... }
  expected_result: non_empty | empty | count_check
  requires_reasoning: true | false
```

Pytest executes them against the merged+reasoned graph.

### Prior art: `enews:Post` already models posts

**`/ontologies/energy-news/` already declares `enews:Post`** as a subclass of `sioc:Post` and `BFO_0000015` (information content entity) with properties `createdAt`, `hasMedia → MediaAttachment`, `hasEmbed → EmbeddedExternalLink`, `isReplyTo`. `MediaAttachment` carries `altText`, `mediaUri`, `mimeType`.

**Prior art to build on, not duplicate.** `sgpost:Post` should be:
- **owl:equivalentClass** `enews:Post` (same thing, different namespace — implies module is a rename)
- **rdfs:subClassOf** `enews:Post` (Skygest post is a specialization — implies additional constraints)
- **disjoint** from `enews:Post` (different use cases — unlikely)

Similarly, `sgpost:ChartAsset` might extend `enews:MediaAttachment`. **First item for the `/ontology-requirements` session.**

### Cross-vocab alignment is declarative (SSSOM), not embedded

SSSOM mappings live in `ontologies/skygest-energy-vocab/mappings/`: `sevocab-to-oeo.sssom.tsv`, `sevocab-to-qudt.sssom.tsv`, `sevocab-to-wikidata.sssom.tsv`. Convention is `{local}-to-{external}.sssom.tsv` with CURIE map header. Mappings use `skos:closeMatch` / `skos:exactMatch` at declared confidence. **Not** materialized into the TBox as `owl:equivalentClass`.

For the post-annotation module: candidate SSSOM files `sgpost-to-as2.sssom.tsv`, `sgpost-to-schema.sssom.tsv`, `sgpost-to-oa.sssom.tsv`.

### Where the post-annotation module lands

**Target directory**: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-post-annotation/`

```
skygest-post-annotation/
├── skygest-post-annotation.ttl              # Main TBox (generated)
├── skygest-post-annotation-reference-individuals.ttl
├── imports/
│   ├── sioc-extract.ttl
│   ├── schema-extract.ttl
│   ├── oa-declarations.ttl
│   └── prov-declarations.ttl
├── shapes/
│   └── skygest-post-annotation-shapes.ttl
├── scripts/
│   ├── build.py                             # Conceptual source → TTL
│   └── run_cq_tests.py
├── tests/
│   ├── conftest.py
│   └── test_ontology.py
├── docs/
│   ├── scope.md                             # ORSD
│   ├── competency-questions.yaml
│   └── bfo-alignment.md
├── mappings/
│   ├── sgpost-to-oa.sssom.tsv
│   ├── sgpost-to-as2.sssom.tsv
│   └── sgpost-to-schema.sssom.tsv
├── catalog-v001.xml
└── release/
    └── skygest-post-annotation.ttl
```

Add `build-skygest-post-annotation` and `validate-skygest-post-annotation` recipes to the root `Justfile`, and include the module in `check`.

### Naming conventions

- **Namespace**: `sgpost:` = `https://skygest.dev/vocab/post/`
- **Class names**: CamelCase (`sgpost:Post`, `sgpost:ChartAsset`, `sgpost:VisionExtraction`)
- **Property names**: camelCase (`sgpost:hasChartAsset`, `sgpost:chartType`, `sgpost:xAxisLabel`, `sgpost:yAxisUnit`)
- **File naming**: kebab-case (`skygest-post-annotation.ttl`)
- **Shape namespace**: append `-shapes` (`sgpost-shapes:PostShape`)

### Non-obvious patterns

1. **Catalog-based module resolution.** `robot merge` uses OASIS XML catalogs, decoupling file paths from IRIs.
2. **SSSOM is declarative, not reified.** No `owl:equivalentClass` in the TBox for cross-vocab mappings.
3. **Pytest is the CQ harness.** SPARQL CQs run as pytest tests; golden answers in YAML.
4. **Python is the source of truth.** Every `.ttl` is machine-generated from a conceptual model (YAML/CSV) via `scripts/build.py`.

## DCAT side — what's in place, what's missing

This is the revised gap analysis after reading the actual schemas. The earlier "five gaps" framing was pessimistic; most of what I thought was missing is in fact already there.

### Already in place

1. **Class IRI mapping.** Every DCAT entity declares its `DcatClass` and (where relevant) `SchemaOrgType` via schema annotations, and the manifest declares the same via `ontologyIri` per class. `Agent → foaf:Agent` (via sevocab:EnergyAgent), `Dataset → dcat:Dataset + schema:Dataset`, `Distribution → dcat:Distribution + schema:DataDownload`, etc.
2. **Property IRI mapping.** Every ontology-owned field declares `DcatProperty`. The manifest additionally carries `ontologyIri` per field, with `generation: "generated" | "handWritten"` as the inclusion filter.
3. **URL role disambiguation.** `Distribution` has distinct `accessURL` (`dcat:accessURL`) and `downloadURL` (`dcat:downloadURL`). `Dataset.landingPage` (`dcat:landingPage`) and `Catalog.homepage` (`foaf:homepage`) are also separate. No flat-packing.
4. **PROV is wired for data lineage.** `Dataset.wasDerivedFrom` (`prov:wasDerivedFrom`) points at `AgentId[]`. This captures "which agent is upstream," which is enough for a first-pass lineage graph.
5. **Alias / SKOS mapping vocabulary.** `ExternalIdentifier` already distinguishes `exactMatch` / `closeMatch` / `broadMatch` / `narrowMatch` per SKOS, and the `uri` field carries the explicit external URI when available. Exporting aliases to `skos:*Match` triples is a 10-line function.
6. **DCAT TBox ownership is clear.** The sevocab ontology imports DCAT structurally (confirmed in the ontology-skill review). The manifest and the TypeScript annotations all point at `http://www.w3.org/ns/dcat#` directly, not at a sevocab-rewritten copy. `robot merge` resolves via the catalog to the sevocab-imported DCAT module at build time.
7. **Branded IDs are RDF-ready.** `https://id.skygest.io/{kind}/{ulid}` URIs are already valid HTTP URIs that can be used directly as RDF subjects without transformation.
8. **Facet property IRIs are mapped.** `measuredProperty` / `technologyOrFuel` / `domainObject` / etc. point at `sevocab:*` predicates via the manifest.

### Still missing (real gaps)

1. **Ingest-run / adapter provenance.** No `IngestActivity` / `AdapterRun` entity exists. When `eia-tree/` mints a Dataset, the fact that it came from a specific adapter run on a specific date is recoverable only by tracing the pipeline — it's not on the entity. RDF needs a `prov:Activity` linked via `prov:wasGeneratedBy` to every adapter-derived entity, distinct from hand-curated cold-start entries. The `CatalogRecord.harvestedFrom` + `firstSeen` + `sourceRecordId` fields get partway there but only for CatalogRecords, and only optionally.

   **Fix**: add an `IngestActivity` schema under `src/domain/data-layer/` with `adapterName`, `runStartedAt`, `runEndedAt`, `sourceCommit`, `inputHash`. Every adapter wraps its writes in an `IngestActivity` context and writes a `generatedEntityIds` list. Export emits `prov:Activity` nodes for each run, `prov:wasGeneratedBy` edges on each entity.

2. **Enum-value → concept-URI mapping.** The **property** IRIs are declared (`sevocab:technologyOrFuel`), but the **value** URIs (`sevocab:wind`, `sevocab:solar`, etc.) are not. Open-string facets (`measuredProperty`, `domainObject`, `technologyOrFuel`, `policyInstrument`) need a lookup against the sevocab concept schemes at export time. Closed enums (`StatisticType`, `Aggregation`, `UnitFamily`) need the same but from the generated `energyVariableProfile` manifest.

   **Fix**: extend the manifest with a `valueVocabulary` pointer per open-string field (e.g., `measuredProperty.valueVocabulary: "https://skygest.dev/vocab/energy/MeasuredPropertyScheme"`). At export time, resolve facet values against the concept scheme's canonical URIs. For closed enums, the manifest already knows the enum members; emit them as pre-minted concept URIs.

3. **`methodologyVariant` relation has no RDF predicate.** `AliasRelation` has a Skygest extension `methodologyVariant` (for gross-vs-net, sectoral-vs-reference, location-vs-market splits). SKOS doesn't model this.

   **Fix**: mint `sevocab:methodologyVariant` as `rdfs:subPropertyOf skos:mappingRelation` in the sevocab TBox. Exporter emits `<a> sevocab:methodologyVariant <b>`. Declarative, no information loss.

4. **Post-side URI minting / back-mapping.** `PostSkygestUri` and `ChartAssetId` branded types don't exist yet. D4 specifies the scheme; no code. Back-mapping table from `at://` / `x://` to Skygest URI doesn't exist either.

   **Fix**: add `src/domain/data-layer/post-ids.ts` (or equivalent) with the branded types, mint helpers, and the platform-URI → Skygest-URI conversion. Table lookup lives in the exporter context, not in D1 — the mapping is deterministic from the platform URI, so no persistent table needed.

5. **Re-ingest dedup semantics vary by adapter.** Cold-start entries are hand-maintained with stable ULIDs. Adapter-derived entries may mint fresh IDs per run, or dedupe via `sourceRecordId`. The policy isn't uniform. SHACL shapes expecting "every Dataset has exactly one `prov:wasGeneratedBy`" will fire unpredictably on re-ingested entities.

   **Fix**: this is out of scope for the first-pass exporter. Document the current per-adapter policy, defer uniform enforcement to a follow-up. First pass exports cold-start only (no adapter provenance concerns) — see "Cold-start-first export path" below.

### SKY-349 becomes a manifest-driven walker

Given what the manifest actually contains, the DCAT exporter is substantially smaller than SKY-349's original framing suggested. Pseudocode:

```typescript
// src/export/rdf/catalogExporter.ts
for each class C in manifest.classes:
  const classIri = C.ontologyIri
  const runtimeRepo = repoFor(C.runtimeName)  // D1DatasetsRepo, D1AgentsRepo, etc.
  for each instance I in runtimeRepo.list():
    emit Triple(I.id, rdf:type, classIri)
    for each field F in C.fields where F.ontologyIri !== null:
      const value = I[F.runtimeName]
      if value is null/undefined: continue
      emit typedTriple(I.id, F.ontologyIri, value, F.type)
    for each alias A in I.aliases:
      emit aliasTriple(I.id, A.scheme, A.value, A.uri, A.relation)
```

- `typedTriple` handles the field-type discriminated union from the manifest (`literal` / `literalArray` / `webUrl` / `brandedId` / `closedEnum` / `isoTimestamp`).
- `aliasTriple` converts `ExternalIdentifier` to `skos:{relation}` or `skos:altLabel` for `display-alias`.
- Classes that aren't in the manifest (e.g., `Observation` — not first-pass) are skipped.

**The RDF emitter lives in `src/export/rdf/` as shared infrastructure used by both the catalog exporter and the post exporter.** Modules:

- `src/export/rdf/prefixes.ts` — centralized prefix table (sevocab, sgpost, dcat, foaf, dcterms, prov, oa, schema, sioc, skos, xsd)
- `src/export/rdf/serializer.ts` — Turtle / N-Triples writers (probably just Turtle)
- `src/export/rdf/manifestWalker.ts` — generic manifest-driven exporter for DCAT classes
- `src/export/rdf/catalogExporter.ts` — wraps `manifestWalker` with repo wiring
- `src/export/rdf/enrichedPostExporter.ts` — post-side exporter (uses `prefixes` and `serializer` but not `manifestWalker`, since posts don't live in the manifest)

### Cold-start-first export path

The first exportable dataset should be **the cold-start JSON catalog**, not the live D1 state. Reasons:

- Cold-start data is stable, hand-curated, git-diffable. No adapter-provenance concerns, no dedup questions, no runtime state dependencies.
- It gives you an end-to-end pipeline (cold-start JSON → Turtle → ROBOT merge → HermiT reason → SHACL pass) on the smallest possible surface.
- It forces the shared-infrastructure decisions (prefixes, serializer, manifest-walker) early, where they're cheapest.
- Validates against the existing `cold-start-validation.test.ts` before any RDF is emitted — so any data issues surface as TypeScript test failures before Turtle does.
- Posts can then build on the same infrastructure once DCAT is flowing.

**Reordered first milestone**: export cold-start DCAT to Turtle, merge with sevocab, validate with HermiT + SHACL. Then add the live D1 path. Then add `EnrichedPost`. Then add the annotation layer.

## Open questions

1. **Vocabulary stack for posts.** Is `schema:SocialMediaPosting` + `sioc:Post` the right multi-typing, or does the ontology-skill toolchain commit to a specific alternative? Should `sgpost:chartType` / `sgpost:xAxisLabel` / `sgpost:yAxisUnit` be first-class `sgpost:` terms with their own SHACL shapes, or reach into QUDT / QB / `schema:Chart`?
2. **Section 2 — the annotation layer.** How `oa:Annotation` bridges chart asset → DCAT entity. What `oa:motivation` for each resolution rung (classifying / linking / identifying). How `AgentSignal` / `DatasetSignal` / `TrailEntry` provenance tags translate to RDF (probably as `prov:Activity` nodes carrying the signal enum value).
3. **SHACL shape scope.** What invariants to validate first pass. Candidates: every chart asset must have a unit; every annotation must have `oa:hasBody` pointing at a DCAT entity; every resolution activity must cite a `prov:Agent`; every Dataset must have a `prov:wasGeneratedBy` link (only enforceable after ingest-activity provenance lands).
4. **Export pipeline topology.** Where the adapter runs (ontology-skill side Python? skygest-cloudflare-side bun script? new CF binding?). How it's triggered. Where the exported `.ttl` / `.nq` artifacts live on disk.
5. **Relationship to SKY-348 (OEO binding).** The prompt-layer OEO extraction work produces scientific IRI bindings for vision facts. Those IRIs should land on chart assets as `oa:hasBody` links in the annotation layer. The relationship between `sgpost:chartType` (raw extraction) and `oa:Annotation → oeo:...` (bound interpretation) needs to be explicit.
6. **Un-resolved bundles.** Whether bundles that have been vision-enriched but not yet resolved should flow into the graph (so SHACL can catch extraction issues on the long tail) or only post-resolution bundles (current D3 lock-in — subject to revisit after first cut).
7. **Ingest-activity schema shape.** What fields an `IngestActivity` entity needs. Proposal in the DCAT gaps section but not locked.
8. **Value-vocabulary manifest extension.** Exact shape of the `valueVocabulary` field on the manifest (gap 2 in the DCAT section).

## Acceptance criteria for first-pass infrastructure

The first pass is "stood up" when all of the following are true:

**Ontology side (ontology_skill repo):**
1. `ontologies/skygest-post-annotation/` module exists with the standard layout.
2. ORSD (`docs/scope.md`) defines scope, in/out-of-scope, and the `sgpost:Post ↔ enews:Post` relationship decision.
3. ≥15 competency questions in `docs/competency-questions.yaml` covering Post, ChartAsset, VisionExtraction, and (stub) Annotation classes.
4. `scripts/build.py` generates `skygest-post-annotation.ttl` deterministically from a YAML conceptual source.
5. `shapes/skygest-post-annotation-shapes.ttl` validates at least: chart asset must have a unit, post must have an author, post must have at least one identifier.
6. SSSOM files for `sgpost-to-oa` and `sgpost-to-schema` with confidence-scored mappings.
7. `just validate-skygest-post-annotation` passes: Turtle syntax OK, HermiT reasons without unsatisfiable classes, SHACL passes, all must-have CQs return expected results.
8. `just check` includes the new module and passes.

**Runtime side (skygest-cloudflare repo):**
9. `src/domain/enrichedPost.ts` defines the `EnrichedPost` schema.
10. `src/domain/data-layer/post-ids.ts` defines `PostSkygestUri` and `ChartAssetId` branded types with mint helpers and a platform-URI converter.
11. `src/export/rdf/` shared infrastructure exists: `prefixes.ts`, `serializer.ts`, `manifestWalker.ts`.
12. `src/export/rdf/catalogExporter.ts` exports **cold-start DCAT** to Turtle. Command: `bun run export:catalog:coldstart`.
13. The exported Turtle merges cleanly with sevocab via ROBOT (no unsatisfiable classes, no SHACL violations against sevocab shapes).
14. At least one SPARQL CQ from the post-annotation CQ set runs successfully against a merged graph containing exported cold-start DCAT + (stubbed) post annotations.
15. Round-trip identity: given a known Skygest chart asset URI, the post URI and platform-native post identifier are recoverable without a database lookup.

**Explicitly not required for first pass:**
- Live D1 DCAT export (cold-start only is enough for the pipeline demo)
- Actual post resolution → RDF flow (post exporter can be stubbed with a sample `EnrichedPost`)
- Annotation layer (Section 2)
- Ingest-activity provenance (fix deferred for adapter-derived entities)
- `methodologyVariant` predicate minting (defer)

## SKY-350 branch interaction

This plan's runtime-side work (`src/domain/enrichedPost.ts`, `src/domain/data-layer/post-ids.ts`, `src/export/rdf/`) should **not** land in the current SKY-350 branch. Reasons:

- SKY-350 is scoped to "anticipatory cleanups before typed entity search Slice 1" — its purpose is to clean the data-layer loader surface for the `EntitySearchRepoD1` projector. It is a small, focused branch that should merge quickly.
- The exporter infrastructure is a new subsystem and adds net-new code paths. Merging it into SKY-350 would bloat the diff, mix concerns, and slow down the entity search slice.
- The ontology-skill side work (scaffolding `skygest-post-annotation`) is separate from skygest-cloudflare entirely and doesn't affect SKY-350's branch.

**Recommendation**: open a new Linear ticket under SKY-213 (the Data Intelligence Layer epic) — working title *"Unified triple-store export — skygest-post-annotation ontology module + shared RDF exporter"* — and treat it as the container for this plan. SKY-349 rolls into that ticket (or becomes a direct child of it). The new ticket gets its own branch when implementation begins, after the ontology-skill ORSD lands.

## Re-entry reading list

When this work resumes in a future session, read these in order before writing any code:

1. **This document** (`docs/plans/2026-04-14-unified-triple-store-export-design.md`) — the full design state.
2. **The data-layer manifest** (`references/data-layer-spine/manifest.json`) — especially the top-level structure + one class's full field list. Confirm the manifest hasn't drifted since 2026-04-13.
3. **`src/domain/data-layer/catalog.ts`** — the DCAT entity schemas, to refresh on inline annotations.
4. **`src/domain/data-layer/variable.ts`** + **`src/domain/data-layer/alias.ts`** — Variable/Series/Observation + the alias system.
5. **`src/domain/data-layer/annotations.ts`** — the six annotation key symbols.
6. **`src/domain/enrichedBundle.ts`** — the current bundle shape (target for the post exporter).
7. **`src/domain/resolutionKernel.ts`** — the `ResolutionOutcome` tagged union (input to the annotation layer in Section 2).
8. **`/Users/pooks/Dev/ontology_skill/ontologies/energy-news/energy-news.ttl`** — the `enews:Post` prior art.
9. **`/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/skygest-energy-vocab.ttl`** — namespace conventions, SKOS concept scheme structure.
10. **`/Users/pooks/Dev/ontology_skill/Justfile`** — the build pipeline entry points.
11. **`/Users/pooks/Dev/ontology_skill/.claude/skills/CONVENTIONS.md`** — shared naming + axiom patterns.
12. **Related plans in `docs/plans/`** — the two 2026-04-13 plans (chart resolution reframe, typed entity search) and `2026-04-14-ontology-from-prompt-layer-design.md`. This plan sits alongside them, not above.

## Next steps

1. ~~Review the ontology-skill toolchain~~ — done.
2. **Open a Linear ticket under SKY-213** to track this workstream end-to-end. Working title: *"Unified triple-store export — skygest-post-annotation ontology module + shared RDF exporter"*. SKY-349 rolls in as a child or is closed in favor of the new ticket.
3. **Decide the `sgpost:Post` ↔ `enews:Post` relationship** before drafting the TBox. First question for the `/ontology-requirements` session.
4. **Open an `/ontology-requirements` session** inside the ontology_skill repo to produce the ORSD for `skygest-post-annotation`.
5. **`/ontology-scout`** — confirm the choice of reused vocabularies (schema.org vs sioc vs ActivityStreams 2, PROV-O, Web Annotation, BFO alignment). Findings doc.
6. **`/ontology-conceptualizer`** — taxonomy (Post → ChartAsset → VisionExtraction → Annotation) with BFO alignment and anti-pattern review.
7. **`/ontology-architect`** — YAML conceptual source + `scripts/build.py`.
8. **`/ontology-mapper`** — SSSOM files (`sgpost-to-oa`, `sgpost-to-schema`, maybe `sgpost-to-as2`).
9. **`/ontology-validator`** — shapes, HermiT, SHACL, CQs passing `just check`.
10. **Runtime side (skygest-cloudflare)** — after the ontology module is validated locally:
    - Scaffold `src/export/rdf/` with `prefixes.ts` + `serializer.ts` + `manifestWalker.ts`
    - Implement `catalogExporter.ts` for cold-start DCAT (first milestone — proves the infrastructure)
    - Add `src/domain/enrichedPost.ts` and `src/domain/data-layer/post-ids.ts`
    - Implement `enrichedPostExporter.ts`
    - Wire an `IngestActivity` schema under `src/domain/data-layer/` and thread it through the ingest adapters (can be sequenced after the first pass)
    - Wire manual trigger via `bun run export:…` scripts

## Not in scope for first pass

- Round-trip reasoner → D1
- Event-driven sync (Cloudflare Workflows, Queues, Durable Objects for graph writes)
- Online triple store (Stardog, Neptune, Oxigraph-in-worker)
- Reified observations / QB (RDF Data Cube) representation of series values
- Claim-level (sourceline) annotation grain
- Editorial pick records and curation state in the graph
- Un-picked / un-resolved posts in the graph (revisit after first cut)
- Live-D1 DCAT export (cold-start only for the first pass)
- Adapter-run provenance uniformity (document current variance, defer enforcement)
- `methodologyVariant` predicate minting (defer)
- `enriched but not resolved` bundles (defer; D3 currently limits graph membership to post-resolution)

---

## Appendix A — Reference CQRS architecture (source)

The design blueprint the user pasted at the start of the conversation, preserved verbatim as the north star for future sessions. This is **not** the first build — see "Scope" and "Decisions locked in" for the actual first-pass scope.

### Service topology

- **Service A — Firehose Ingestor.** Handles raw social-media stream, image extraction, VLM inference. High-concurrency, IO-bound. Stateless extraction only — no linking or entity resolution. Output is a structured JSON payload of what the VLM saw.
- **Service B — Resolution & Matchmaker.** Consumes VLM JSON and matches against the known universe (DCAT / OEO). Queries a read-optimized flat index (Elasticsearch / Typesense / equivalent). Output: candidate URIs with confidence scores. Does not write to the graph.
- **Service C — Semantic Graph Writer (Joiner).** Sole authority for mutating the triple store. Consumes resolved matches and persists them as RDF triples (Web Annotation Data Model — WADM). SHACL validation before commit. Emits transactions to a triplestore (Stardog / Neptune / etc.).
- **Service D — API & Domain Layer (Reader).** Serves the frontend. Decodes data from the search index and the graph via strongly-typed contracts (Effect Schema / similar).

### Joining logic

The "join" does not happen in a relational table. It happens as a persisted assertion in the triplestore, orchestrated by an event bus (Kafka / AWS MSK / equivalent):

1. Service B emits an `EntityResolved` event: `{ postId, targetUri, confidence }`.
2. Service C consumes it, generates WADM triples, executes a SPARQL `INSERT DATA`.
3. Raw post text lives in Postgres (operational DB). The logical link (the join) lives only in the triplestore. The flattened representation lives in Elasticsearch.

### Event-driven sync loop (materialization)

When Service C writes a new link, the triplestore's reasoner may infer new facts. A **Materialization Worker** handles the downstream:

1. Graph CDC — triplestore emits change events, or a SPARQL `CONSTRUCT` poll is triggered by `EntityResolved`.
2. Worker queries the complete reasoned subgraph for the entity.
3. Worker transforms it into flat JSON and UPSERTs into Elasticsearch.
4. Result: the search index always contains the pre-calculated reasoned state.

### Open / closed domain entities in TypeScript

Static types for known ontology classes (generated from SHACL shapes in CI), with a strictly validated escape hatch for dynamic inferences at runtime:

```typescript
const InferredFactSchema = S.Struct({
  predicateUri: S.String,
  objectUri: S.String,
  objectLabel: S.optional(S.String),
  inferenceRule: S.String
});

const DCATDatasetSchema = S.Struct({
  uri: S.String,
  title: S.String,
  publisher: S.String,
  inferredFacts: S.Array(InferredFactSchema)
});
```

When the reasoner infers new triples, the materialization worker pushes them into the ES document. The static UI renders known fields from the typed schema; dynamic inferences render from the `inferredFacts` array without code redeploy.

### Where the first build diverges from the blueprint

- Skygest does not run an online triple store. Reasoning happens locally and offline.
- Skygest does not run an event bus. Triggers are manual.
- The join is not streamed. It's batched via the export script.
- D1 remains the runtime source of truth. The triple store is a derived analysis artifact.
- Elasticsearch is replaced by D1 FTS5 (SKY-342). No materialization worker; no downstream index sync.
- The `InferredFactSchema` pattern (dynamic typed escape hatch) is deferred — it becomes relevant once reasoner outputs flow back into runtime state, which is out of scope for the first pass.

---

## Appendix B — Cross-repo coordination

This plan lives in `/Users/pooks/Dev/skygest-cloudflare/docs/plans/`. The corresponding ontology-side work happens in `/Users/pooks/Dev/ontology_skill/ontologies/skygest-post-annotation/`. To keep the two sides coordinated:

- When the ontology module is scaffolded, create a mirror plan doc on the ontology_skill side — `ontology_skill/docs/plans/2026-04-{date}-skygest-post-annotation-module.md` — that references back to this plan and describes the ontology-side decisions (BFO alignment, axiom design, SHACL shape catalog, CQ list).
- The ontology-side plan is the canonical home for decisions about TBox axioms; this plan is canonical for decisions about runtime schemas + exporter infrastructure. Neither should duplicate the other — they cross-reference.
- When `skygest-post-annotation` passes `just check` on the ontology side, update this plan's status header with the ontology version and the merge/pass confirmation.
- The `references/data-layer-spine/manifest.json` is the **third** coordination artifact. It lives in skygest-cloudflare but is sourced from the ontology. If its `sourceCommit` falls behind the sevocab HEAD, that's a drift signal — mention it in the status header of both plans.

---

## Change log

- **2026-04-14** — Initial brainstorm captured. Locked D1–D6. Reviewed ontology-skill toolchain. Identified `references/data-layer-spine/manifest.json` as the existing ontology bridge. Revised DCAT gap analysis. Added Schema reference section, acceptance criteria, re-entry reading list, SKY-350 branch interaction decision, CQRS blueprint appendix, cross-repo coordination note. Paused pending `/ontology-requirements` session.
```

---

## docs/plans/2026-04-14-ontology-from-prompt-layer-design.md (why we pivoted to OEO)

```markdown
---
status: tracking
created: 2026-04-14
supersedes:
  - facet-shelf vocabulary stitching (measuredProperty × domainObject × technologyOrFuel × statisticType × unitFamily → Variable)
related:
  - docs/plans/2026-03-11-ontology-layer-architecture-proposal.md
  - SKY-213 (parent — newsletter & story intelligence ontology line)
  - SKY-326 (facet narrowing — symptomatic of the wrong approach)
  - SKY-347 (data-europa duplicate distributions — separate)
---

# Ontology from the prompt layer — design tracking

## TL;DR

We have been trying to mint `Variable` rows by *stitching* canonical vocabulary facets together (`measuredProperty × domainObject × technologyOrFuel × statisticType × unitFamily × policyInstrument × aggregation`) and matching the result against chart text. This is a dead end: it pushes scientific reasoning into a string-match shelf instead of doing it in the layer that already has scientific reasoning — the prompt / vision extraction layer.

The replacement: have the extraction layer emit **two distinct things per chart**, and bind directly to **OEO** (Open Energy Ontology) on the canonical side. Variables become a thin index over OEO terms instead of a custom facet bingo.

## What's wrong with facet-shelf stitching

1. **It splits a single semantic act into a shelf of independent guesses.** A chart titled "Installed solar PV capacity, GW (2010–2024)" is one variable. The facet shelf treats it as five independent lookups (`measuredProperty=capacity` AND `domainObject=solar PV` AND `statisticType=stock` AND …) where any single mismatch eliminates the variable entirely. SKY-326 documents the AMBER on this exact failure mode (`facet-narrowing-reach`).
2. **The vocabulary canonicals are our invention.** `MeasuredPropertyCanonicals`, `DomainObjectCanonicals`, etc. in `src/domain/generated/energyVariableProfile` are an in-house enum tree we maintain by hand. They have no anchor in any external ontology, so they cannot be reused, validated, or reasoned over.
3. **We're paying twice for scientific knowledge we already get for free.** The vision/enrichment LLM already knows what "Installed solar PV capacity, GW" measures — it has scientific awareness. We then ask a downstream string-match kernel to *re-derive* that knowledge from a vocabulary shelf, badly.
4. **It doesn't enable reasoning.** Even when the shelf produces a Variable row, the row is a tuple of in-house enum strings. There is no upstream ontology to reason over, no `subClassOf`, no `relatedTo`, no inferences possible.

In short: vocabulary stitching is a *workaround* for not having scientific extraction in the right layer, and the workaround has cost more time than the right thing would have.

## The two things we want to extract per chart

Every chart says two distinct things. Today our prompt collapses them. They should be separate prompt outputs:

### (1) Literal surface form

> What the chart **literally says**, verbatim.

* Title text as rendered ("Installed solar PV capacity")
* Axis labels ("Capacity (GW)")
* Legend entries ("Utility-scale", "Distributed")
* Time range as printed ("2010–2024")
* Unit token as printed ("GW", "TWh/yr", "MtCO₂e")
* Geographic scope as printed ("Global", "United Kingdom", "EU-27")

This feeds:
* Surface-form alias growth (`Variable.aliases` with `scheme: "surface-form"` so the next exact match is free)
* Provenance display (we can show the user the literal label that was on the chart)
* Disambiguation when the same OEO term has multiple common renderings

### (2) Scientific variable being measured

> What the chart **scientifically measures**, expressed in canonical ontology terms.

* `oeoTerm`: the OEO IRI that names this variable (e.g. `OEO_00010258` for *installed solar capacity*)
* `oeoLabel`: the OEO `rdfs:label` (e.g. *"installed solar capacity"*)
* `unit`: a QUDT IRI or unit token (`unit:GW`, `unit:TWh`)
* `domain`: the OEO/SO scope class (e.g. `oeo:wind power plant`, `schema:Country`)
* `statisticType`: stock vs flow vs ratio vs intensity (this *one* axis is fine because it's small and orthogonal)
* `temporalScope`: instant / period / cumulative
* `confidence`: model confidence in the binding (so we can require human review under threshold)

This feeds:
* Direct binding to a `Variable` row keyed by OEO term
* Linkage to the dataset that produced the chart (when known)
* Reasoning capabilities — once a chart is bound to OEO, downstream agents can ask "what other variables are subclasses of `installed renewable capacity`?" or "is this variable a flow or a stock?" without our facet shelf in the loop

The two outputs travel together in the same enrichment record but are independently useful and independently validated.

## Why OEO

[Open Energy Ontology](https://github.com/OpenEnergyPlatform/ontology) is:
* OBO Foundry-aligned, BFO-rooted (real upper ontology), W3C-compliant OWL
* Energy-domain specific — covers generation, capacity, fuels, markets, policy instruments, balancing, storage
* Stable IRIs (`OEO_00010257`, etc.) — already used in *one* of our 25 hand-authored variables (`installed-wind-capacity.json` carries `{ scheme: "oeo", value: "OEO_00010257", relation: "closeMatch" }`)
* Maintained and growing — the [OpenEnergyPlatform](https://openenergyplatform.org/) community curates it
* Importable into Effect Schema as a static enum dump if we want offline validation

Anchoring to OEO gives us the four things the facet shelf cannot:

| Property | Facet shelf | OEO binding |
|---|---|---|
| External anchor | None | Stable IRI |
| Reusable across publishers | No | Yes |
| Reasoning support | No | Yes (subClassOf, relatedTo, partOf) |
| Cross-walks to other vocabularies | No | Yes (OEO has crosswalks to QUDT, ENVO, schema.org) |

OEO is *not* exhaustive. Some metrics our charts care about have no OEO term yet (e.g. *interconnection queue backlog*). For those we need a fallback scheme — provisionally `scheme: "skygest-internal"` with a clear marker that it's a candidate for OEO submission. Tracked separately.

## Architecture sketch (intentionally not an implementation plan)

```
┌─────────────────────┐
│  vision/enrichment  │  ← prompt produces TWO outputs per chart:
│        prompt       │     (1) literal surface form
└──────────┬──────────┘     (2) scientific binding (OEO term + unit + domain)
           │
           │  enriched chart record
           │
           ▼
┌─────────────────────┐
│  OEO binding store  │  ← Variable row keyed by OEO IRI, not facet tuple.
│  (replaces facet    │     aliases grow from observed surface forms.
│   shelf as the      │     reasoning queries hit OEO upstream.
│   variable index)   │
└──────────┬──────────┘
           │
           │  variable.id (= OEO IRI)
           │
           ▼
┌─────────────────────┐
│  dataset binding    │  ← when we know the dataset that produced the chart,
│  (DCAT side)        │     we write dataset.variableIds = [<OEO IRI>].
│                     │     this becomes a *byproduct* of chart resolution,
│                     │     not a precondition for it.
└─────────────────────┘
```

Notable shifts from the current model:

* `Variable.id` becomes the OEO IRI (or a `skygest-internal:` IRI for gaps), not a `var_<ulid>`. This is a real schema change.
* The seven-facet `VariableOntologyFields` shelf in `generated/dataLayerSpine` is **deprecated** for resolution — it can stay as descriptive metadata for human readers, but the resolver does not match against it. `Bind.ts` and `Interpret.ts` get rewritten around OEO IRI lookup.
* `Series` gains `oeoTerm` directly so `(variable, fixedDims)` is `(oeoTerm, fixedDims)`. SDMX semantics survive.
* `variable-adapters/` (proposed in the previous turn) becomes an **OEO-binding adapter** rather than a facet-emitting adapter. For publishers with structured per-metric APIs (EIA, Ember, GridStatus, Eurostat SDMX), the adapter walks the publisher's metric list and asks: "which OEO term is this metric?" — once, at ingest, with model help.
* The chart-resolution kernel (`src/resolution/kernel/`) is rewritten around an OEO-keyed variable lookup. SKY-326 stops being relevant — there is no facet-narrowing step to soften.

## What this replaces

Concretely, in the current codebase:

| Current artifact | Status under the new design |
|---|---|
| `src/domain/data-layer/variable-enums.ts` | Deprecated for resolution; kept only as descriptive metadata if at all |
| `src/domain/generated/energyVariableProfile.ts` (`MeasuredPropertyCanonicals`, etc.) | Deprecated for resolution |
| `src/resolution/facetVocabulary/*` (the entire shelf) | Deprecated; resolver moves to OEO IRI lookup |
| `src/resolution/kernel/Bind.ts` (subsumption-based facet narrowing) | Rewritten around OEO IRI |
| `src/resolution/kernel/Interpret.ts` | Rewritten — interpret stage emits OEO IRI candidate, not facet tuples |
| `scripts/generate-variables.ts` (hand-authored 25 variables) | Replaced by OEO term import + chart-driven alias growth |
| SKY-326 (soften facet narrowing) | Obsoleted — no facet narrowing in the new design |

## What this does *not* replace

* DCAT ingest. The eight DCAT adapters keep doing exactly what they do — ingest `Catalog`, `Dataset`, `Distribution`, `DataService`, `DatasetSeries`, `Agent`, `CatalogRecord`. DCAT is the right standard for *cataloging* and stays.
* The provider registry / agent identity work (SKY-147, SKY-218, SKY-332, SKY-333). Agents are agents regardless of how variables are modeled.
* Surface-form text matching for *non-variable* axes (provider names, dataset titles). Those legitimately need string lookups.

## Open questions (need answers before writing code)

1. **Prompt ergonomics.** What does the two-output prompt actually look like? Is the model reliable enough to emit OEO IRIs directly, or does it emit a free-text scientific description that a second small step maps to the OEO IRI? The second is probably more robust.
2. **OEO coverage.** What fraction of our gold eval set's chart variables actually have an OEO term? Need to measure before committing — if it's 40%, the fallback story matters more than the OEO story.
3. **OEO version pinning.** OEO is actively maintained. We need a snapshot mechanism (probably ship the OWL file in `references/` and regenerate a TS enum from it) so resolution is deterministic across builds.
4. **Migration of existing 25 variables.** How many of them already have a clean OEO mapping? (Spot check: `installed-wind-capacity` → `OEO_00010257` ✅. The rest need to be checked.)
5. **`skygest-internal` term governance.** When a chart variable has no OEO term, who decides the internal IRI shape, and what is the path back to OEO submission?
6. **Reasoning surface.** Where does OEO reasoning actually run — at query time in the resolver, or as an offline materialization step that pre-expands every variable's parents/siblings into the index? Performance trade-off.
7. **Backwards compat.** The existing `Variable.id` shape is `https://id.skygest.io/variable/var_<ulid>`. Switching to `OEO_00010257` IRIs is a breaking schema change. What's the migration story for the 11 series that currently link to var-ulids?

## Decisive scope boundary

This document is a **tracking design**, not an implementation plan. Nothing in the codebase should change as a result of this doc landing. The next concrete step is the OEO-coverage measurement against the gold eval set (open question 2) — that single number determines whether OEO-as-primary is viable or whether we need an OEO-plus-skygest-internal hybrid from day one.

Until that measurement exists, no facet-shelf code should be deleted and no new variable-binding code should be written.

## Acceptance for *this tracking doc*

* [x] Frames vocabulary stitching as a dead end and explains why
* [x] Identifies the two distinct prompt outputs we want
* [x] Names OEO as the canonical binding target and explains the upgrade
* [x] Lists what is replaced and what is *not* replaced
* [x] Lists open questions that block design completion
* [x] Says explicitly that nothing changes in code until the OEO-coverage number lands
```

---

## references/data-layer-spine/manifest.json (the TS↔ontology bridge the manifest walker consumes)

```json
{
  "manifestVersion": 1,
  "sourceCommit": "458c5e416c589dff1c2b6e29dc0e4e4529fb5492",
  "generatedAt": "2026-04-13T12:00:00.000Z",
  "inputHash": "sha256:54280c2f3ec10cf4f6f70602418926839486fa19c5a8d6f4162f8fd4c7fb5627",
  "ontologyIri": "https://skygest.dev/vocab/energy",
  "ontologyVersion": "0.2.0",
  "classes": {
    "Agent": {
      "runtimeName": "Agent",
      "ontologyIri": "https://skygest.dev/vocab/energy/EnergyAgent",
      "classComment": "A FOAF agent that publishes one or more energy datasets. Hand-written wrapper composes AgentOntologyFields with runtime-local id, kind, parentAgentId, and TimestampedAliasedFields.",
      "fields": [
        {
          "runtimeName": "_tag",
          "ontologyIri": null,
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "handWritten",
          "description": "Runtime tag discriminant."
        },
        {
          "runtimeName": "id",
          "ontologyIri": null,
          "type": { "_tag": "brandedId", "ref": "AgentId" },
          "optional": false,
          "generation": "handWritten",
          "description": "Branded AgentId minted with ulid prefix ag_."
        },
        {
          "runtimeName": "kind",
          "ontologyIri": null,
          "type": { "_tag": "closedEnum", "enumName": "AgentKind" },
          "optional": false,
          "generation": "handWritten",
          "description": "Runtime-local closed enum (organization, person, consortium, program, other) — not owned by the sevocab ontology."
        },
        {
          "runtimeName": "name",
          "ontologyIri": "http://xmlns.com/foaf/0.1/name",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "generated"
        },
        {
          "runtimeName": "alternateNames",
          "ontologyIri": null,
          "type": { "_tag": "literalArray", "literalKind": "string" },
          "optional": true,
          "generation": "generated",
          "description": "Runtime-local but emitted into the Agent fragment for symmetry with name."
        },
        {
          "runtimeName": "homepage",
          "ontologyIri": "http://xmlns.com/foaf/0.1/homepage",
          "type": { "_tag": "webUrl" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "parentAgentId",
          "ontologyIri": null,
          "type": { "_tag": "brandedId", "ref": "AgentId" },
          "optional": true,
          "generation": "handWritten",
          "description": "Runtime-local parent agent reference — not modelled on sevocab:EnergyAgent in this slice."
        },
        {
          "runtimeName": "createdAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten",
          "description": "From TimestampedAliasedFields."
        },
        {
          "runtimeName": "updatedAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten",
          "description": "From TimestampedAliasedFields."
        },
        {
          "runtimeName": "aliases",
          "ontologyIri": null,
          "type": { "_tag": "struct", "structName": "Aliases" },
          "optional": false,
          "generation": "handWritten",
          "description": "From TimestampedAliasedFields."
        }
      ]
    },
    "Dataset": {
      "runtimeName": "Dataset",
      "ontologyIri": "https://skygest.dev/vocab/energy/EnergyDataset",
      "classComment": "A DCAT Dataset published by an EnergyAgent. Hand-written wrapper composes DatasetOntologyFields with runtime-local id, accessRights, dataServiceIds, and TimestampedAliasedFields.",
      "fields": [
        {
          "runtimeName": "_tag",
          "ontologyIri": null,
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "handWritten",
          "description": "Runtime tag discriminant."
        },
        {
          "runtimeName": "id",
          "ontologyIri": null,
          "type": { "_tag": "brandedId", "ref": "DatasetId" },
          "optional": false,
          "generation": "handWritten",
          "description": "Branded DatasetId minted with ulid prefix ds_."
        },
        {
          "runtimeName": "title",
          "ontologyIri": "http://purl.org/dc/terms/title",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "generated"
        },
        {
          "runtimeName": "description",
          "ontologyIri": "http://purl.org/dc/terms/description",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "creatorAgentId",
          "ontologyIri": "http://purl.org/dc/terms/creator",
          "type": { "_tag": "brandedId", "ref": "AgentId" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "wasDerivedFrom",
          "ontologyIri": "http://www.w3.org/ns/prov#wasDerivedFrom",
          "type": { "_tag": "brandedIdArray", "ref": "AgentId" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "publisherAgentId",
          "ontologyIri": "http://purl.org/dc/terms/publisher",
          "type": { "_tag": "brandedId", "ref": "AgentId" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "landingPage",
          "ontologyIri": "http://www.w3.org/ns/dcat#landingPage",
          "type": { "_tag": "webUrl" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "accessRights",
          "ontologyIri": null,
          "type": { "_tag": "closedEnum", "enumName": "AccessRights" },
          "optional": true,
          "generation": "handWritten",
          "description": "Runtime-local closed enum (public, restricted, nonPublic, unknown) — not owned by the sevocab ontology."
        },
        {
          "runtimeName": "license",
          "ontologyIri": "http://purl.org/dc/terms/license",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "temporal",
          "ontologyIri": "http://purl.org/dc/terms/temporal",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "keywords",
          "ontologyIri": "http://www.w3.org/ns/dcat#keyword",
          "type": { "_tag": "literalArray", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "themes",
          "ontologyIri": "http://www.w3.org/ns/dcat#theme",
          "type": { "_tag": "literalArray", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "variableIds",
          "ontologyIri": "https://skygest.dev/vocab/energy/hasVariable",
          "type": { "_tag": "brandedIdArray", "ref": "VariableId" },
          "optional": true,
          "generation": "generated",
          "description": "Retained as the higher-level dataset-to-variable view. Structural source of truth is Series.datasetId + Series.variableId after SKY-317.",
          "deferredTightening": "SKY-317 / follow-up: deprecate in favor of Series-derived membership and eventually remove from the schema."
        },
        {
          "runtimeName": "distributionIds",
          "ontologyIri": "http://www.w3.org/ns/dcat#distribution",
          "type": { "_tag": "brandedIdArray", "ref": "DistributionId" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "dataServiceIds",
          "ontologyIri": null,
          "type": { "_tag": "brandedIdArray", "ref": "DataServiceId" },
          "optional": true,
          "generation": "handWritten",
          "description": "Runtime-local DataService reference list — no explicit ontology property in this slice."
        },
        {
          "runtimeName": "inSeries",
          "ontologyIri": "http://www.w3.org/ns/dcat#inSeries",
          "type": { "_tag": "brandedId", "ref": "DatasetSeriesId" },
          "optional": true,
          "generation": "generated",
          "description": "Points to a dcat:DatasetSeries (collection of dataset editions) via DatasetSeriesId (dser_). DISTINCT from sevocab:Series — see the Series class spec below."
        },
        {
          "runtimeName": "createdAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "updatedAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "aliases",
          "ontologyIri": null,
          "type": { "_tag": "struct", "structName": "Aliases" },
          "optional": false,
          "generation": "handWritten"
        }
      ]
    },
    "Variable": {
      "runtimeName": "Variable",
      "ontologyIri": "https://skygest.dev/vocab/energy/EnergyVariable",
      "classComment": "Statistical variable composed of up to seven facet dimensions. Hand-written wrapper composes VariableOntologyFields with runtime-local id and TimestampedAliasedFields.",
      "fields": [
        {
          "runtimeName": "createdAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "updatedAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "aliases",
          "ontologyIri": null,
          "type": { "_tag": "struct", "structName": "Aliases" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "_tag",
          "ontologyIri": null,
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "id",
          "ontologyIri": null,
          "type": { "_tag": "brandedId", "ref": "VariableId" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "label",
          "ontologyIri": "http://www.w3.org/2000/01/rdf-schema#label",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "generated"
        },
        {
          "runtimeName": "definition",
          "ontologyIri": "http://www.w3.org/2004/02/skos/core#definition",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "measuredProperty",
          "ontologyIri": "https://skygest.dev/vocab/energy/measuredProperty",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "domainObject",
          "ontologyIri": "https://skygest.dev/vocab/energy/domainObject",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "technologyOrFuel",
          "ontologyIri": "https://skygest.dev/vocab/energy/technologyOrFuel",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        },
        {
          "runtimeName": "statisticType",
          "ontologyIri": "https://skygest.dev/vocab/energy/statisticType",
          "type": { "_tag": "closedEnum", "enumName": "StatisticType" },
          "optional": true,
          "generation": "generated",
          "description": "Closed enum whose members are sourced from StatisticTypeMembers in src/domain/generated/energyVariableProfile.ts (owned by the existing energy-profile generator)."
        },
        {
          "runtimeName": "aggregation",
          "ontologyIri": "https://skygest.dev/vocab/energy/aggregation",
          "type": { "_tag": "closedEnum", "enumName": "Aggregation" },
          "optional": true,
          "generation": "generated",
          "description": "Closed enum sourced from AggregationMembers in the existing energy-profile generator."
        },
        {
          "runtimeName": "unitFamily",
          "ontologyIri": "https://skygest.dev/vocab/energy/unitFamily",
          "type": { "_tag": "closedEnum", "enumName": "UnitFamily" },
          "optional": true,
          "generation": "generated",
          "description": "Closed enum sourced from UnitFamilyMembers in the existing energy-profile generator."
        },
        {
          "runtimeName": "policyInstrument",
          "ontologyIri": "https://skygest.dev/vocab/energy/policyInstrument",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": true,
          "generation": "generated"
        }
      ]
    },
    "Series": {
      "runtimeName": "Series",
      "ontologyIri": "https://skygest.dev/vocab/energy/Series",
      "classComment": "A concrete published series that implements exactly one EnergyVariable within exactly one EnergyDataset's reporting context. NOT the same as dcat:DatasetSeries — that class names publisher-side dataset groupings (DatasetSeriesId dser_) and is exposed via Dataset.inSeries. sevocab:Series names the Variable-implementing record a dataset exposes (SeriesId ser_). Hand-written wrapper composes SeriesOntologyFields with runtime-local id, fixedDims, and TimestampedAliasedFields.",
      "fields": [
        {
          "runtimeName": "createdAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "updatedAt",
          "ontologyIri": null,
          "type": { "_tag": "isoTimestamp" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "aliases",
          "ontologyIri": null,
          "type": { "_tag": "struct", "structName": "Aliases" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "_tag",
          "ontologyIri": null,
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "id",
          "ontologyIri": null,
          "type": { "_tag": "brandedId", "ref": "SeriesId" },
          "optional": false,
          "generation": "handWritten"
        },
        {
          "runtimeName": "label",
          "ontologyIri": "http://www.w3.org/2000/01/rdf-schema#label",
          "type": { "_tag": "literal", "literalKind": "string" },
          "optional": false,
          "generation": "generated"
        },
        {
          "runtimeName": "variableId",
          "ontologyIri": "https://skygest.dev/vocab/energy/implementsVariable",
          "type": { "_tag": "brandedId", "ref": "VariableId" },
          "optional": false,
          "generation": "generated",
          "description": "Required in v1. Backed by sevocab:implementsVariable (owl:FunctionalProperty). Runtime currently has 1430+ Series rows with this field populated."
        },
        {
          "runtimeName": "datasetId",
          "ontologyIri": "https://skygest.dev/vocab/energy/publishedInDataset",
          "type": { "_tag": "brandedId", "ref": "DatasetId" },
          "optional": true,
          "generation": "generated",
          "description": "Backed by sevocab:publishedInDataset (owl:FunctionalProperty, owl:inverseOf sevocab:hasSeries). Intentionally optional in manifest v1 — 0 of 1430 checked-in Series files currently have this field, so a required-from-day-one migration would fail schema decode.",
          "deferredTightening": "SKY-317 wires the field into the runtime registry and backfills it on eval-relevant publishers; a follow-up ticket will tighten to required once the backfill is complete and registry-prepare treats dangling links as checked-in validation failures."
        },
        {
          "runtimeName": "fixedDims",
          "ontologyIri": null,
          "type": { "_tag": "struct", "structName": "FixedDims" },
          "optional": false,
          "generation": "handWritten",
          "description": "Reporting-context dimensions (place, market, frequency, etc.). Deliberately NOT modelled on sevocab:Series in SKY-316 — fixed-dimension bag semantics are deferred."
        }
      ]
    }
  },
  "derivedRelationships": [
    {
      "ontologyIri": "https://skygest.dev/vocab/energy/hasVariable",
      "runtimeName": "hasVariable",
      "description": "Higher-level dataset-to-variable view. Preserved in the ontology as a denormalized convenience, but SPARQL consumers should traverse hasSeries + implementsVariable explicitly because simple entailment does not compute OWL property chains. The runtime derives variable membership from Series.datasetId + Series.variableId after SKY-317 lands — it does not compute the view via OWL reasoning.",
      "derivedFrom": [
        "https://skygest.dev/vocab/energy/hasSeries",
        "https://skygest.dev/vocab/energy/implementsVariable"
      ]
    }
  ]
}
```

---

## src/domain/data-layer/catalog.ts (DCAT entity schemas)

```typescript
import { Schema } from "effect";
import { DcatClass, DcatProperty, DesignDecision, SchemaOrgType } from "./annotations";
import { DateLike, TimestampedAliasedFields, WebUrl } from "./base";
import {
  AgentOntologyFields,
  DatasetOntologyFields
} from "../generated/dataLayerSpine";
import {
  AgentId,
  CatalogId,
  CatalogRecordId,
  DataServiceId,
  DatasetId,
  DatasetSeriesId,
  DistributionId,
  VariableId
} from "./ids";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const AgentKind = Schema.Literals([
  "organization", "person", "consortium", "program", "other"
]).annotate({ description: "Kind of agent (FOAF-aligned)" });
export type AgentKind = Schema.Schema.Type<typeof AgentKind>;

export const DistributionKind = Schema.Literals([
  "download", "api-access", "landing-page", "interactive-web-app",
  "documentation", "archive", "other"
]).annotate({ description: "Kind of distribution access" });
export type DistributionKind = Schema.Schema.Type<typeof DistributionKind>;

export const AccessRights = Schema.Literals([
  "public", "restricted", "nonPublic", "unknown"
]).annotate({ description: "Access rights classification" });
export type AccessRights = Schema.Schema.Type<typeof AccessRights>;

export const Cadence = Schema.Literals([
  "annual", "quarterly", "monthly", "weekly", "daily", "irregular"
]).annotate({ description: "Publication cadence for dataset series" });
export type Cadence = Schema.Schema.Type<typeof Cadence>;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const Agent = Schema.Struct({
  _tag: Schema.Literal("Agent"),
  id: AgentId,
  kind: AgentKind,
  ...AgentOntologyFields,
  parentAgentId: Schema.optionalKey(AgentId),
  ...TimestampedAliasedFields
}).annotate({
  description: "Agent responsible for publishing or curating resources (D5)",
  [DcatClass]: "http://xmlns.com/foaf/0.1/Agent",
  [DesignDecision]: "D5"
});
export type Agent = Schema.Schema.Type<typeof Agent>;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export const Catalog = Schema.Struct({
  _tag: Schema.Literal("Catalog"),
  id: CatalogId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  }),
  homepage: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Curated collection of metadata about resources (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Catalog",
  [DesignDecision]: "D5"
});
export type Catalog = Schema.Schema.Type<typeof Catalog>;

// ---------------------------------------------------------------------------
// CatalogRecord — NO TimestampedAliasedFields, NO aliases
// ---------------------------------------------------------------------------

const DATASET_ID_PATTERN = /^https:\/\/id\.skygest\.io\/dataset\/ds_[A-Za-z0-9]{10,}$/;
const DATA_SERVICE_ID_PATTERN = /^https:\/\/id\.skygest\.io\/data-service\/svc_[A-Za-z0-9]{10,}$/;

const validatePrimaryTopicId = (record: {
  readonly primaryTopicType: "dataset" | "dataService";
  readonly primaryTopicId: string;
}) => {
  const pattern = record.primaryTopicType === "dataset" ? DATASET_ID_PATTERN : DATA_SERVICE_ID_PATTERN;
  return pattern.test(record.primaryTopicId)
    ? undefined
    : `primaryTopicId must be a valid ${record.primaryTopicType === "dataset" ? "DatasetId" : "DataServiceId"} URI for primaryTopicType "${record.primaryTopicType}"`;
};

export const CatalogRecord = Schema.Struct({
  _tag: Schema.Literal("CatalogRecord"),
  id: CatalogRecordId,
  catalogId: CatalogId,
  primaryTopicType: Schema.Literals(["dataset", "dataService"]).annotate({
    [DcatProperty]: "http://xmlns.com/foaf/0.1/primaryTopic"
  }),
  primaryTopicId: Schema.String.annotate({
    description: "Must match the entity kind indicated by primaryTopicType (DatasetId or DataServiceId)"
  }),
  sourceRecordId: Schema.optionalKey(Schema.String),
  harvestedFrom: Schema.optionalKey(Schema.String),
  firstSeen: Schema.optionalKey(DateLike.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/issued"
  })),
  lastSeen: Schema.optionalKey(DateLike.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/modified"
  })),
  sourceModified: Schema.optionalKey(DateLike),
  isAuthoritative: Schema.optionalKey(Schema.Boolean),
  duplicateOf: Schema.optionalKey(CatalogRecordId)
}).annotate({
  description: "Catalog's view of a resource — carries only catalog-tracking dates, not Skygest-managed timestamps (D5). primaryTopicId is validated against primaryTopicType.",
  [DcatClass]: "http://www.w3.org/ns/dcat#CatalogRecord",
  [DesignDecision]: "D5"
}).pipe(
  Schema.check(Schema.makeFilter(validatePrimaryTopicId))
);
export type CatalogRecord = Schema.Schema.Type<typeof CatalogRecord>;

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export const Dataset = Schema.Struct({
  _tag: Schema.Literal("Dataset"),
  id: DatasetId,
  ...DatasetOntologyFields,
  accessRights: Schema.optionalKey(AccessRights),
  dataServiceIds: Schema.optionalKey(Schema.Array(DataServiceId)),
  ...TimestampedAliasedFields
}).annotate({
  description: "Collection of data published or curated by a single source (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Dataset",
  [SchemaOrgType]: "https://schema.org/Dataset",
  [DesignDecision]: "D5"
});
export type Dataset = Schema.Schema.Type<typeof Dataset>;

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

export const Distribution = Schema.Struct({
  _tag: Schema.Literal("Distribution"),
  id: DistributionId,
  datasetId: DatasetId,
  kind: DistributionKind,
  title: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  })),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  accessURL: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#accessURL"
  })),
  downloadURL: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#downloadURL"
  })),
  mediaType: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#mediaType"
  })),
  format: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/format"
  })),
  byteSize: Schema.optionalKey(Schema.Number.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#byteSize"
  })),
  checksum: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://spdx.org/rdf/terms#checksum"
  })),
  accessRights: Schema.optionalKey(AccessRights),
  license: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/license"
  })),
  accessServiceId: Schema.optionalKey(DataServiceId.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#accessService"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Specific representation of a dataset — download, API, or landing page (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#Distribution",
  [SchemaOrgType]: "https://schema.org/DataDownload",
  [DesignDecision]: "D5"
});
export type Distribution = Schema.Schema.Type<typeof Distribution>;

// ---------------------------------------------------------------------------
// DataService
// ---------------------------------------------------------------------------

export const DataService = Schema.Struct({
  _tag: Schema.Literal("DataService"),
  id: DataServiceId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  })),
  endpointURLs: Schema.Array(WebUrl).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#endpointURL"
  }),
  endpointDescription: Schema.optionalKey(WebUrl.annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#endpointDescription"
  })),
  conformsTo: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/conformsTo"
  })),
  servesDatasetIds: Schema.Array(DatasetId).annotate({
    [DcatProperty]: "http://www.w3.org/ns/dcat#servesDataset"
  }),
  accessRights: Schema.optionalKey(AccessRights),
  license: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/license"
  })),
  ...TimestampedAliasedFields
}).annotate({
  description: "Site or endpoint providing operations on data or related resources (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#DataService",
  [DesignDecision]: "D5"
});
export type DataService = Schema.Schema.Type<typeof DataService>;

// ---------------------------------------------------------------------------
// DatasetSeries
// ---------------------------------------------------------------------------

export const DatasetSeries = Schema.Struct({
  _tag: Schema.Literal("DatasetSeries"),
  id: DatasetSeriesId,
  title: Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/title"
  }),
  description: Schema.optionalKey(Schema.String.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/description"
  })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/publisher"
  })),
  cadence: Cadence.annotate({
    [DcatProperty]: "http://purl.org/dc/terms/accrualPeriodicity"
  }),
  ...TimestampedAliasedFields
}).annotate({
  description: "Collection of datasets published separately but grouped by shared characteristics (D5)",
  [DcatClass]: "http://www.w3.org/ns/dcat#DatasetSeries",
  [DesignDecision]: "D5"
});
export type DatasetSeries = Schema.Schema.Type<typeof DatasetSeries>;
```

---

## src/domain/data-layer/variable.ts (V/S/O schemas)

```typescript
import { Schema } from "effect";
import { DesignDecision, SchemaOrgType, SdmxConcept } from "./annotations";
import { DateLike, TimestampedAliasedFields } from "./base";
import {
  SeriesOntologyFields,
  VariableOntologyFields
} from "../generated/dataLayerSpine";
import { DistributionId, ObservationId, SeriesId, VariableId } from "./ids";

export { Aggregation, StatisticType, UnitFamily } from "./variable-enums";

export const TimePeriod = Schema.Struct({
  start: DateLike,
  end: Schema.optionalKey(DateLike)
}).annotate({ description: "Time period with required start and optional end (YYYY, YYYY-MM, YYYY-MM-DD, or ISO 8601)" });
export type TimePeriod = Schema.Schema.Type<typeof TimePeriod>;

export const FixedDims = Schema.Struct({
  place: Schema.optionalKey(Schema.String),
  sector: Schema.optionalKey(Schema.String),
  market: Schema.optionalKey(Schema.String),
  frequency: Schema.optionalKey(Schema.String),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
}).annotate({ description: "Reporting-context dimensions that lock a Variable into a Series" });
export type FixedDims = Schema.Schema.Type<typeof FixedDims>;

// ---------------------------------------------------------------------------
// Variable — seven-facet composition
// ---------------------------------------------------------------------------

export const Variable = Schema.Struct({
  ...TimestampedAliasedFields,
  _tag: Schema.Literal("Variable"),
  id: VariableId,
  ...VariableOntologyFields
}).annotate({
  description: "Statistical variable defined by up to seven semantic facets (D1, D2)",
  [SchemaOrgType]: "https://schema.org/StatisticalVariable",
  [SdmxConcept]: "Concept",
  [DesignDecision]: "D1, D2"
});
export type Variable = Schema.Schema.Type<typeof Variable>;

// ---------------------------------------------------------------------------
// Series — Variable locked to a reporting context
// ---------------------------------------------------------------------------

export const Series = Schema.Struct({
  ...TimestampedAliasedFields,
  _tag: Schema.Literal("Series"),
  id: SeriesId,
  ...SeriesOntologyFields,
  fixedDims: FixedDims
}).annotate({
  description: "A Variable locked to a specific reporting context via fixed dimensions (D1)",
  [SdmxConcept]: "SeriesKey",
  [DesignDecision]: "D1"
});
export type Series = Schema.Schema.Type<typeof Series>;

// ---------------------------------------------------------------------------
// Observation — data primitive
// ---------------------------------------------------------------------------

export const Observation = Schema.Struct({
  _tag: Schema.Literal("Observation"),
  id: ObservationId,
  seriesId: SeriesId,
  time: TimePeriod,
  value: Schema.Number,
  unit: Schema.String,
  sourceDistributionId: DistributionId,
  qualification: Schema.optionalKey(Schema.String)
}).annotate({
  description: "Single data point within a Series — the atomic unit of measurement (D1, D7)",
  [SchemaOrgType]: "https://schema.org/Observation",
  [SdmxConcept]: "Observation",
  [DesignDecision]: "D1, D7"
});
export type Observation = Schema.Schema.Type<typeof Observation>;
```

---

## src/domain/data-layer/alias.ts (23 alias schemes for LOD interop)

```typescript
import { Schema } from "effect";
import { DesignDecision, SkosMapping } from "./annotations";

export const aliasSchemes = [
  "oeo", "ires-siec", "iea-shortname", "ipcc",
  "entsoe-psr", "entsoe-eic", "entsoe-document-type",
  "eia-route", "eia-series", "eia-bulk-id", "energy-charts-endpoint",
  "ember-route", "gridstatus-dataset-id", "odre-dataset-id",
  "eurostat-code", "europa-dataset-id",
  "ror", "wikidata", "doi",
  "iso3166", "url", "display-alias", "other"
 ] as const;

export const AliasSchemeValues = {
  emberRoute: "ember-route",
  eiaBulkId: "eia-bulk-id",
  eiaRoute: "eia-route",
  displayAlias: "display-alias",
  energyChartsEndpoint: "energy-charts-endpoint",
  entsoeDocumentType: "entsoe-document-type",
  gridstatusDatasetId: "gridstatus-dataset-id",
  odreDatasetId: "odre-dataset-id",
  europaDatasetId: "europa-dataset-id",
  url: "url"
} as const;

export const AliasScheme = Schema.Literals(aliasSchemes).annotate({
  description:
    "Alias namespace used for external identifiers plus display-alias title variants"
});
export type AliasScheme = Schema.Schema.Type<typeof AliasScheme>;

export const aliasRelations = [
  "exactMatch", "closeMatch", "broadMatch", "narrowMatch", "methodologyVariant"
 ] as const;

export const AliasRelation = Schema.Literals(aliasRelations).annotate({
  description: "SKOS-aligned mapping relation strength. First four from W3C SKOS; methodologyVariant is Skygest's extension for gross-vs-net / sectoral-vs-reference / location-vs-market relations.",
  [SkosMapping]: "http://www.w3.org/2004/02/skos/core#mappingRelation",
  [DesignDecision]: "D4"
});
export type AliasRelation = Schema.Schema.Type<typeof AliasRelation>;

export const ExternalIdentifier = Schema.Struct({
  scheme: AliasScheme,
  value: Schema.String,
  uri: Schema.optionalKey(Schema.String),
  relation: AliasRelation
}).annotate({
  description: "Typed alias with SKOS-aligned relation strength (D3, D4)",
  [DesignDecision]: "D3, D4"
});
export type ExternalIdentifier = Schema.Schema.Type<typeof ExternalIdentifier>;

const validateUniqueSchemeValue = (aliases: ReadonlyArray<ExternalIdentifier>) => {
  const seen = new Set<string>();
  for (const alias of aliases) {
    const key = `${alias.scheme}\0${alias.value}`;
    if (seen.has(key)) {
      return `duplicate alias: (${alias.scheme}, ${alias.value}) appears more than once`;
    }
    seen.add(key);
  }
  return undefined;
};

export const Aliases = Schema.Array(ExternalIdentifier).pipe(
  Schema.check(Schema.makeFilter(validateUniqueSchemeValue))
).annotate({
  description: "External identifiers with enforced (scheme, value) uniqueness per entity (D3)"
});
export type Aliases = Schema.Schema.Type<typeof Aliases>;
```

---

## src/domain/data-layer/annotations.ts (symbol-keyed inline RDF annotations)

```typescript
/** DCAT 3 class IRI — e.g., "http://www.w3.org/ns/dcat#Dataset" */
export const DcatClass = Symbol.for("skygest/dcat-class");

/** DCAT 3 property IRI — e.g., "http://www.w3.org/ns/dcat#distribution" */
export const DcatProperty = Symbol.for("skygest/dcat-property");

/** SKOS mapping property IRI — e.g., "http://www.w3.org/2004/02/skos/core#exactMatch" */
export const SkosMapping = Symbol.for("skygest/skos-mapping");

/** schema.org type IRI for the export codec target — e.g., "https://schema.org/Dataset" */
export const SchemaOrgType = Symbol.for("skygest/schema-org-type");

/** SDMX information model concept — e.g., "SeriesKey", "Observation", "ConceptScheme" */
export const SdmxConcept = Symbol.for("skygest/sdmx-concept");

/** Design decision reference — e.g., "D1", "D5", "D12" */
export const DesignDecision = Symbol.for("skygest/design-decision");
```

---

## src/domain/generated/dataLayerSpine.ts (generated ontology-field composition)

```typescript
/**
 * AUTO-GENERATED. DO NOT EDIT.
 *
 * Source manifest: references/data-layer-spine/manifest.json
 * Manifest version: 1
 * Ontology version: 0.2.0
 * Source commit: 458c5e416c589dff1c2b6e29dc0e4e4529fb5492
 * Generated at: 2026-04-13T12:00:00.000Z
 * Input hash: sha256:54280c2f3ec10cf4f6f70602418926839486fa19c5a8d6f4162f8fd4c7fb5627
 * Generation command: bun run gen:data-layer-spine
 */

import { Schema } from "effect";
import { DcatProperty } from "../data-layer/annotations";
import { WebUrl } from "../data-layer/base";
import { AgentId, DatasetId, DatasetSeriesId, DistributionId, VariableId } from "../data-layer/ids";
import { Aggregation, StatisticType, UnitFamily } from "../data-layer/variable-enums";

export const AgentOntologyFields = {
  name: Schema.String.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/name" }),
  alternateNames: Schema.optionalKey(Schema.Array(Schema.String)),
  homepage: Schema.optionalKey(WebUrl.annotate({ [DcatProperty]: "http://xmlns.com/foaf/0.1/homepage" })),
} as const;

export const DatasetOntologyFields = {
  title: Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/title" }),
  description: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/description" })),
  creatorAgentId: Schema.optionalKey(AgentId.annotate({ [DcatProperty]: "http://purl.org/dc/terms/creator" })),
  wasDerivedFrom: Schema.optionalKey(Schema.Array(AgentId).annotate({ [DcatProperty]: "http://www.w3.org/ns/prov#wasDerivedFrom" })),
  publisherAgentId: Schema.optionalKey(AgentId.annotate({ [DcatProperty]: "http://purl.org/dc/terms/publisher" })),
  landingPage: Schema.optionalKey(WebUrl.annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#landingPage" })),
  license: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/license" })),
  temporal: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://purl.org/dc/terms/temporal" })),
  keywords: Schema.optionalKey(Schema.Array(Schema.String).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#keyword" })),
  themes: Schema.optionalKey(Schema.Array(Schema.String).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#theme" })),
  variableIds: Schema.optionalKey(Schema.Array(VariableId).annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/hasVariable" })),
  distributionIds: Schema.optionalKey(Schema.Array(DistributionId).annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#distribution" })),
  inSeries: Schema.optionalKey(DatasetSeriesId.annotate({ [DcatProperty]: "http://www.w3.org/ns/dcat#inSeries" })),
} as const;

export const VariableOntologyFields = {
  label: Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2000/01/rdf-schema#label" }),
  definition: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2004/02/skos/core#definition" })),
  measuredProperty: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/measuredProperty" })),
  domainObject: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/domainObject" })),
  technologyOrFuel: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/technologyOrFuel" })),
  statisticType: Schema.optionalKey(StatisticType.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/statisticType" })),
  aggregation: Schema.optionalKey(Aggregation.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/aggregation" })),
  unitFamily: Schema.optionalKey(UnitFamily.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/unitFamily" })),
  policyInstrument: Schema.optionalKey(Schema.String.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/policyInstrument" })),
} as const;

export const SeriesOntologyFields = {
  label: Schema.String.annotate({ [DcatProperty]: "http://www.w3.org/2000/01/rdf-schema#label" }),
  variableId: VariableId.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/implementsVariable" }),
  datasetId: Schema.optionalKey(DatasetId.annotate({ [DcatProperty]: "https://skygest.dev/vocab/energy/publishedInDataset" })),
} as const;
```
