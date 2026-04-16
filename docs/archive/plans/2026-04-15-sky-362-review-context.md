# SKY-362 design review context bundle

Generated: 2026-04-15T16:21:13Z
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

## docs/plans/2026-04-15-sky-362-ontology-store-design.md (THE LOCKED DESIGN UNDER REVIEW)

```markdown
---
status: design-locked
created: 2026-04-15
revised: 2026-04-15 (post design interview)
ticket: SKY-362
parent: SKY-213
subsumes: SKY-229
related:
  - docs/architecture/triplestore-rdf-design.md (research findings from GPT-5 Pro)
  - docs/plans/2026-04-14-unified-triple-store-export-design.md
  - docs/plans/2026-04-14-ontology-from-prompt-layer-design.md
  - docs/plans/2026-04-15-git-backed-snapshots-spec.md
  - docs/plans/2026-04-15-sky-361-362-execution-plan.md
  - /Users/pooks/Dev/effect-ontology (reference implementation, Effect 3)
---

# SKY-362 — Ontology store package design (locked)

## Status

**Locked after design interview on 2026-04-15.** All eleven substantive branches resolved. This document supersedes the earlier design draft. Implementation may begin once the ticket is updated and SKY-229 is closed as subsumed.

The document is organized as: mental model, architectural boundaries, package layout, service surfaces, milestone-one scope, open questions that remained open, and an annex walking the AEMO subgraph through the full pipeline as a concrete worked example.

## Mental model (trunk decision)

`packages/ontology-store/` is an **application-profile graph seam**, not a generic ontology store.

That framing is load-bearing. The seam emits a specific, closed set of DCAT classes into an N3.js triple store, validates them against a hand-authored SHACL shapes file, and distills them back into Effect Schema domain types. It does not promise to round-trip arbitrary RDF. It does not pretend to be a general-purpose triple store. It is the bounded, versioned, lossy seam between one TypeScript domain model and one SKOS vocabulary plus DCAT application profile.

The research pass (`docs/architecture/triplestore-rdf-design.md`) was unambiguous on this: production RDF systems (Jena, RDF4J, GraphDB, Stardog) keep graph-native APIs at the center and put typed objects at the edge. LDkit and LDO are the TypeScript-side analogues. None of them promise bit-level symmetry. The ones that tried are the ones that grew into 5,000-line mapping engines chasing impossible round-trip guarantees. We explicitly avoid that trap by treating the `EmitSpec`/`DistillSpec` as a versioned API contract with explicit lossy boundaries.

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

This is the single most important clarification from the design interview.

The existing `ontology_skill/ontologies/skygest-energy-vocab/shapes/skygest-energy-vocab-shapes.ttl` (371 lines) validates **SKOS vocabulary well-formedness**: every `skos:Concept` has a `prefLabel`, `altLabel`, `definition`, and is in exactly one scheme. These are TBox shapes. They already exist. They are good. **We do not touch them.**

The DCAT instance layer — Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries, Variable, Series — has **no SHACL shapes authored today**. That's SKY-362's shape work: a new, flat, hand-authored file at `packages/ontology-store/shapes/dcat-instances.ttl` covering cardinality, value types, referential integrity, controlled vocabulary membership, and alias scheme patterns for the DCAT instance layer.

The two shape files are loaded together at validation time, complementary in purpose:

| File | Location | Layer | Validates |
|---|---|---|---|
| `skygest-energy-vocab-shapes.ttl` | `ontology_skill/` (existing) | TBox / vocabulary | SKOS concept well-formedness |
| `dcat-instances.ttl` | `packages/ontology-store/shapes/` (new) | ABox / instances | DCAT cardinality, referential integrity |

**We do NOT use `publish-snapshot.sh`.** No such script exists; earlier drafts referenced it speculatively. The instance shapes live in the package until there is a concrete reason to promote them to the snapshot repo (e.g., a second consumer needing them). If and when that happens, we move the file; until then, the package is the authoritative source.

## Package layout (file-count discipline)

> **Hard rule:** minimize file count. ONE of each artifact type. No per-class shape splits. No per-concern shape modules. No modular composition via `sh:node`. If a concern grows unmanageable, we split it in a follow-up ticket, not prophylactically.

```
packages/ontology-store/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── shapes/
│   └── dcat-instances.ttl                # ONE flat shapes file for all DCAT classes
├── generated/
│   └── emit-spec.json                    # committed, regenerated at build time
├── src/
│   ├── Domain/
│   │   ├── Rdf.ts                        # branded IRI, BlankNode, Literal, Quad + RdfError
│   │   └── Shacl.ts                      # ShaclValidationReport, ShaclViolation, errors
│   ├── Service/
│   │   ├── RdfStore.ts                   # Effect 4 wrapping N3.Store, targetGraph? param
│   │   ├── Shacl.ts                      # Effect 4 wrapping shacl-engine
│   │   └── Reasoner.ts                   # no-op stub
│   ├── emit/
│   │   ├── ManifestWalker.ts             # reads references/data-layer-spine/manifest.json
│   │   ├── entityToQuads.ts              # one flat transformer
│   │   └── aliasEmitter.ts               # ExternalIdentifier[] → skos:*Match
│   ├── distill/
│   │   ├── classIndex.ts                 # quads indexed by rdf:type
│   │   ├── quadsToEntity.ts              # inverse of entityToQuads via EmitSpec
│   │   └── schemaDecoder.ts              # Schema.decode over the projection
│   └── index.ts
└── tests/
    └── catalog-round-trip.test.ts        # ONE test: whole catalog end-to-end
```

Non-obvious absences:

- No `SnapshotLoader.ts`. Milestone one reads shapes from the relative path `packages/ontology-store/shapes/dcat-instances.ttl`. When shapes eventually graduate to the snapshot repo, a `SnapshotLoader` gets added in that ticket.
- No `valueEncoders.ts`. The value-to-RDF-term mapping is simple enough to live inline in `entityToQuads.ts`. Extracting it is premature abstraction.
- No per-class emitters or distillers. The walkers iterate over `EmitSpec.classes` at runtime.
- No `ProvenanceService.ts`. PROV-O is deferred.
- No fixture directory. The test loads the full `.generated/cold-start/catalog/` directly.

## Library choices (locked)

| Library | Version | Role |
|---|---|---|
| N3.js | 1.26+ | Quad store, Turtle + N-Triples parse/serialize |
| shacl-engine | 1.1+ | SHACL validation |
| Effect 4 | `@effect/*-beta.43` | Service wrapping, error channels, schema decoding |

Deferred indefinitely:
- Oxigraph / SPARQL runtime
- Persistent quad store (quadstore, Jena, Stardog sidecar)
- pySHACL reference validator (research recommended it; we decided against because JS-only keeps the runtime footprint small and a reference validator is nice-to-have CI tooling, not critical-path)
- N3.js built-in reasoner (interface exposed, implementation stays no-op until a consumer needs it)

## Effect 4 adaptation note

The reference implementation at `/Users/pooks/Dev/effect-ontology/packages/@core-v2/` is on **Effect 3**. Every pattern copied from that repo must be adapted to **Effect 4** semantics before use. Specifically:

- Service definition: use the `ServiceMap.Service` + `Layer.effect` two-step pattern from `src/services/d1/*`, not the Effect 3 `Effect.Service` class
- Schema module: `effect/Schema` (core), not `@effect/schema`
- Scoped resource: verify `Effect.acquireRelease` signature in the current beta
- Layer construction: verify `Layer.provideMerge`, `Layer.effect`, `Layer.scoped` signatures

Rule: before writing any production code in `packages/ontology-store/`, run `effect-solutions show services-and-layers` and mirror the house style from `src/services/d1/*`. The `effect-ontology` code is architectural inspiration only.

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

The `targetGraph?: IRI` parameter on every mutation is the one forward-looking hook from the interview: milestone one emits everything to the default graph, but the API already takes the per-source named graph unit so Branch 2's "named graphs from day one as the API boundary" commitment is satisfied without implementing the routing logic yet.

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

// Service/Shacl.ts
export class ShaclService extends ServiceMap.Service<ShaclService>()(
  "ShaclService",
  {
    loadShapes: (shapesTurtle: string) => Effect.Effect<RdfStore, ShapesLoadError, Scope.Scope>
    validate: (data: RdfStore, shapes: RdfStore) => Effect.Effect<typeof ShaclValidationReport.Type, ShaclValidationError>
  }
) {}
```

Every shape in `dcat-instances.ttl` defaults to `sh:Violation` severity. Warning/Info staging is not in scope until external ingest lands.

## EmitSpec as Level 2 derived artifact

The EmitSpec is the central data structure. It is:

- **Derived** from `references/data-layer-spine/manifest.json` + the symbol-keyed annotations in `src/domain/data-layer/annotations.ts`
- **Generated** at build time via `scripts/generate-emit-spec.ts` (new, small)
- **Committed** as `packages/ontology-store/generated/emit-spec.json` so PR diffs surface spec changes
- **Consumed** by both `emit/` and `distill/` as a single source of truth — one code path writes the spec, two code paths read it
- **Versioned** with the package (not independently)
- **Carries explicit lossy boundaries** as per-field `lossy` markers so the round-trip parity comparator reads its ignore-list from the same artifact the emitter uses

```json
{
  "version": "0.1.0",
  "generatedFrom": "references/data-layer-spine/manifest.json@<sha>",
  "classes": {
    "Dataset": {
      "primaryClassIri": "http://www.w3.org/ns/dcat#Dataset",
      "additionalClassIris": ["https://schema.org/Dataset"],
      "fields": [
        {
          "runtimeName": "title",
          "predicate": "http://purl.org/dc/terms/title",
          "valueKind": { "_tag": "Literal" },
          "cardinality": "single",
          "lossy": false
        },
        {
          "runtimeName": "accessRights",
          "predicate": null,
          "valueKind": { "_tag": "Literal" },
          "cardinality": "single",
          "lossy": "runtime-local"
        },
        ...
      ]
    }
  }
}
```

`primaryClassIri` is required for distill indexing (Branch walkthrough pain point #4). When an entity has both `dcat:Dataset` and `schema:Dataset` as types, the distill step indexes on `dcat:Dataset` as the authoritative class.

## Graph ownership (locked but mostly deferred)

Per-source named graphs are the ownership unit. Every DCAT entity logically belongs to a source-qualified graph like `graph://source/aemo`. In milestone one, the `targetGraph?` API parameter exists on every mutation method, but we emit everything to the default graph and defer the source-routing logic to a follow-up ticket. This lets us retrofit graph ownership without an API break.

PROV-O activity modelling, archive/tombstone graphs, and per-run provenance overlays are all explicitly deferred. When they land, the unit of deletion becomes "replace `graph://source/aemo` wholesale" and historical recovery is recoverable from the SKY-361 ingest artifacts store (every snapshot commit is a point-in-time archive).

## Drift protocol (minimal)

Ontology version bumps handled via coordinated upgrades, not dual-form support. `ontology-snapshot.lock.json` already pins tag + SHA + `manifestHash`. When a predicate renames in a future snapshot:

1. Bump the lock file
2. Regenerate `dataLayerSpine.ts` from the new manifest
3. Regenerate `emit-spec.json`
4. Run the round-trip catalog test
5. Fix anything broken in the same PR
6. Ship

No N+1/N+2 migration window, no distill-side tolerance for both old and new predicate forms. This is adequate while we are the only consumer. When external consumers appear, we revisit.

## Milestone 1 — The full cold-start catalog end-to-end

**Scope:** load the entire `.generated/cold-start/catalog/` (Agent/Catalog/CatalogRecord/DataService/DatasetSeries/Dataset/Distribution) plus `variables/` and `series/` into N3, validate against `dcat-instances.ttl`, serialize, re-parse, distill, assert projection parity.

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

At roughly 5–15 triples per entity, that's **~50,000–100,000 triples**. This is the upper edge of the "in-memory N3.js + shacl-engine is tractable if shapes are sane" band from the research. Deliberate choice: loading the full catalog is simultaneously a correctness test AND a real-scale stress test, which validates both the library choices and the domain model in one pass.

### PR 1 — Skeleton + monorepo hoist

- `packages/ontology-store/package.json`, `tsconfig.json`, `vitest.config.ts`
- Root `package.json` gets `"workspaces": ["packages/*"]`
- Root `tsconfig.json` / `tsconfig.test.json` / `vitest.config.ts` expanded to include the new package
- One trivial unit test importing from the package
- **Zero RDF code.** Proves the monorepo hoist, nothing more.

### PR 2 — The whole loop

Everything else. One PR. Contents:

- `Domain/Rdf.ts`, `Domain/Shacl.ts`, `Domain/Errors.ts`
- `Service/RdfStore.ts`, `Service/Shacl.ts`, `Service/Reasoner.ts`
- `emit/ManifestWalker.ts`, `emit/entityToQuads.ts`, `emit/aliasEmitter.ts`
- `distill/classIndex.ts`, `distill/quadsToEntity.ts`, `distill/schemaDecoder.ts`
- `generated/emit-spec.json` (committed, regenerated by the new `scripts/generate-emit-spec.ts`)
- `shapes/dcat-instances.ttl` (hand-authored, flat, all DCAT classes)
- `tests/catalog-round-trip.test.ts` (loads the full `.generated/cold-start/`, runs the end-to-end loop)

**Acceptance:** `bun run test` inside `packages/ontology-store/` is green.

### Pain-point fixes locked as part of PR 2

Surfaced during the 2026-04-15 AEMO walkthrough (see annex below). All land in the same PR:

1. **Alias emitter skips `scheme: "url"` entirely.** A URL alias semantically overlaps with `foaf:homepage` and doesn't carry identifier semantics — `skos:exactMatch` to a URL is meaningless. Drop.
2. **`scheme: "display-alias"` emits as `skos:altLabel`** with a language tag (`"en"` by default). This is a display variant, not a mapping.
3. **Only identifier-semantic alias schemes emit `skos:*Match` triples.** Whitelist: `wikidata` (→ `https://www.wikidata.org/entity/<QID>`), `doi` (→ `https://doi.org/<DOI>`), `ror` (→ `https://ror.org/<ROR>`), `oeo` (→ `https://openenergyplatform.org/ontology/oeo/<term>`), plus publisher-specific schemes with resolvable URIs when `ExternalIdentifier.uri` is non-null.
4. **`alternateNames` gets an ontologyIri in the manifest** mapping to `skos:altLabel`. Currently it has `ontologyIri: null` and drops silently.
5. **EmitSpec declares `primaryClassIri` per class.** When an entity has multiple `rdf:type` triples (e.g. `dcat:Dataset` + `schema:Dataset`), the primary is used for distill indexing. Secondary types are emitted but not indexed on.

### Expected side effect: domain-layer fixes

PR 2 will very likely surface small bugs in `references/data-layer-spine/manifest.json`, `src/domain/data-layer/catalog.ts`, `variable.ts`, and/or `alias.ts`. Examples of what may break:

- Fields that the manifest claims are `generated` but have `ontologyIri: null`
- Enum values that don't resolve to IRIs via the value-encoder
- Referential integrity violations (a Dataset's `distributionIds` pointing at a Distribution that doesn't exist in the cold-start catalog, surfaced by SHACL `sh:class dcat:Distribution`)
- Branded ID patterns that survive emission but fail to parse on distill (branded ID regex mismatch after round-trip)
- Alias scheme values that violate the `sh:pattern` for their scheme

Those fixes land in the same PR. PR 2 cannot be size-bounded in advance; it is bounded by "the test is green." This is a feature, not a bug — it is how the package finds and fixes data-model drift that no other check is currently enforcing.

## What is explicitly NOT in milestone 1

- Distill parity with bit-level exactness (we assert projection parity only, with an allow-list of runtime-local fields)
- Named graph routing (API hook exists, routing logic deferred)
- PROV-O activity modelling, archive graphs, tombstones
- Open-string facet resolution via `references/vocabulary/*.json` (emission for open-string facets is deferred; only closed enums are emitted via the EmitSpec)
- JSON-LD context generation
- RDFS reasoning (no-op stub only)
- pySHACL reference validator
- Snapshot-repo-hosted shapes (shapes live in the package until promotion is forced)
- Ingest of resolved post/chart bundles as RDF
- SPARQL surface
- Persistent quad store
- Staged SHACL strictness (Warning/Info ratcheting)
- Shape modularization by concern or profile
- `publish-snapshot.sh` / any new CI tooling

Each of these has a "reopen when X" trigger in the interview decision summary. None are rejected on principle.

## Open questions that remained open

Questions the interview did NOT settle — to be revisited when their downstream consumer forces the decision, not before:

1. **`skygest-internal:` IRI governance.** When a domain value has no upstream ontology term, what's the fallback IRI path and who owns minting? (Reopened when OEO binding SKY-348 forces it.)
2. **`methodologyVariant` alias round-trip fidelity.** Sub-property of `skos:mappingRelation` or collapse to `skos:closeMatch`? (Reopened when the round-trip test encounters a real `methodologyVariant` alias.)
3. **Observation modelling.** `qb:Observation` (RDF Data Cube) vs `schema:Observation` vs both? (Reopened when observations come into scope.)
4. **SHACL depth.** Sharpen the SHACL-vs-Schema boundary with real shape examples. (Reopened as we author `dcat-instances.ttl` — we will learn by writing it.)

---

## Annex — AEMO walkthrough (worked example)

This annex walks one real entity pair through the full pipeline so future readers see a concrete example. Data from `.generated/cold-start/catalog/agents/aemo.json` and `datasets/aemo-nem-data.json` as of 2026-04-15.

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

### What dropped (the lossy boundary made visible)

| Field | Reason |
|---|---|
| `Agent.kind: "organization"` | handWritten in manifest, no ontologyIri |
| `Agent.aliases[1]` (`scheme: "url"`) | alias emitter skips `url` scheme (pain-point fix #1) |
| `Dataset.accessRights: "public"` | handWritten |
| `Dataset.aliases: []` | empty set |
| `createdAt`, `updatedAt` | runtime-local, declared `lossy: "runtime-local"` in EmitSpec |
| `_tag`, `id` | `_tag` is runtime-local; `id` is the subject IRI, not a predicate value |

### SHACL shape (sketch, one of several in `dcat-instances.ttl`)

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

For AEMO, validation passes: one title, two Distribution IRIs (which will also be loaded into the graph from `distributions/aemo-nem-dashboard.json` and `aemo-nem-reports.json`), one publisher IRI resolving to the AEMO Agent which is also in the graph. The referential-integrity checks only work because we load the full catalog — single-entity validation would fail them.

### Distill back to domain type

The round-trip parity test re-parses the serialized Turtle into a fresh N3 store, then uses the same EmitSpec to project each subject back into a TS object matching the Effect Schema shape:

```ts
{
  _tag: "Dataset",
  id: "https://id.skygest.io/dataset/ds_01KNQTFC3YN0W4AWMXYCSMM7E0",
  title: "AEMO National Electricity Market Data",
  description: "Australian NEM dispatch, pricing, generation, and demand data.",
  publisherAgentId: "https://id.skygest.io/agent/ag_01KNQS8K705WWGTWT09N8JJF9V",
  landingPage: "https://aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem",
  keywords: ["Australia", "NEM", "demand", "dispatch", "generation"],  // set-order may differ
  themes: ["electricity", "grid operations"],
  distributionIds: [
    "https://id.skygest.io/distribution/dist_01KNQTFC3Y9QK77R7JNR9DZWTJ",
    "https://id.skygest.io/distribution/dist_01KNQTFC3YJQXV61WAMHV9890F"
  ],
  aliases: [],                  // empty in source, empty in distilled
  // Dropped on distill, reconstructed via defaults:
  accessRights: undefined,      // was "public" in source; runtime-local, lossy
  createdAt: <injected>,        // runtime-local, lossy
  updatedAt: <injected>         // runtime-local, lossy
}
```

### Projection parity assertion

The test asserts structural equality between source and distilled, with explicit ignore-lists sourced from the EmitSpec's `lossy` markers:

```ts
assertProjectionParity(source, distilled, {
  ignoredFields: emitSpec.classes[kind].fields
    .filter(f => f.lossy === "runtime-local")
    .map(f => f.runtimeName),
  setValuedFields: emitSpec.classes[kind].fields
    .filter(f => f.cardinality === "many")
    .map(f => f.runtimeName),
})
```

For AEMO's Dataset, the ignored fields are `accessRights`, `createdAt`, `updatedAt`, and the set-valued fields (where order may drift) are `keywords`, `themes`, `distributionIds`, `aliases`. Parity passes.

### What this walkthrough proved

- The full pipeline mechanically works end-to-end for one entity pair with real data
- Referential integrity requires the whole catalog to be loaded before validation — single-entity validation is a false friend
- The alias scheme semantics need fixing (pain-point fix #1–3)
- The manifest has an `alternateNames` gap (pain-point fix #4)
- Primary class IRI matters for distill indexing (pain-point fix #5)
- Projection parity is testable against a deterministic, explicit ignore-list sourced from the EmitSpec

These fixes are all in scope for PR 2.

## Acceptance for THIS design doc

- [x] Trunk reframe (application-profile graph seam) is stated and defended
- [x] Three-repo architectural boundary is diagrammed
- [x] Shape layer distinction (vocab vs instance) is called out explicitly
- [x] File-count discipline is stated as a hard rule
- [x] Package layout enumerates every file in milestone one
- [x] Service pseudocode shows Effect 4 idioms with the `targetGraph?` hook
- [x] EmitSpec is committed as Level 2 with the `primaryClassIri` + `lossy` fields
- [x] Milestone one acceptance is "full cold-start catalog round-trip green"
- [x] Pain-point fixes from the walkthrough are enumerated
- [x] AEMO walkthrough is annexed as a concrete example
- [x] All eleven interview decisions are captured in their respective sections
- [x] `publish-snapshot.sh` is scrubbed from every reference

## Not in scope for this doc

- Implementation code. Nothing in `packages/ontology-store/` exists yet.
- Ingest of post/chart bundles as RDF.
- Move of shapes from package to snapshot repo.
- OEO coverage measurement.
- RDF Data Cube observation modelling.
```

---

## docs/architecture/triplestore-rdf-design.md (your earlier research — reminder of what you said)

```markdown
I read your ontology-store design and the research prompt closely. The analysis below is anchored in the package seam you described for `packages/ontology-store/` and the six research clusters you explicitly asked to answer.

## Executive summary

Your design is pointed in the right direction in three important ways: it treats the TS↔RDF seam as an explicit package boundary, it keeps SHACL as a graph-level enforcement layer instead of trying to make Effect Schema do graph work, and it explicitly aims for projection-level parity rather than impossible structural identity. Those are production-like decisions. The main risk is not the choice of N3.js. The risk is conceptual drift: if `packages/ontology-store/` turns into a “generic round-trippable ontology store,” you will recreate every object–graph impedance problem people have been fighting for twenty years. If it stays an application-specific graph core with a carefully versioned emit/distill spec, it is tractable. ([Stardog Documentation][1])

The ecosystem signal is very consistent: production RDF systems keep graph-native APIs at the center and put typed/native objects at the edge. Jena centers `Model`/`Graph`; RDF4J centers `Model`/`Repository`; GraphDB exposes RDF4J; Stardog exposes RDF4J and Jena adapters. When teams want typed objects, they add a projection layer such as JOPA, KOMMA, LDkit, or LDO; they do not ask the triplestore itself to become a POJO/DTO store. For Skygest, the right mental model is: RDF is the semantic truth, Effect Schema objects are a controlled projection, and SHACL is the release-pinned contract that decides which graph states are admissible. ([Stardog Documentation][1])

The biggest decision to make before implementation is not “N3.js or something heavier.” It is whether you are willing to formalize two things up front: first, the lossy boundaries of emit/distill; second, the unit of change ownership in the graph. If you lock both now—`EmitSpec/DistillSpec` as an application profile, and named graphs as the future unit of batch/entity ownership—you can start with in-memory N3.js safely. If you do not, you will spend the next phase arguing with drift, not code. ([GitHub][2])

## Cluster 1 — Domain-type ↔ RDF graph round-tripping

1. Real production systems handle the object↔graph mismatch by **not pretending it disappears**. Jena gives you `Model`/`Graph`, RDF4J gives you `Model`/`Repository`, GraphDB is used through RDF4J, and Stardog supports RDF4J plus Jena adapters. When teams want typed bindings, they add a separate mapping layer such as JOPA, KOMMA, RDFBeans, LDkit, or LDO. They avoid promising full symmetry because RDF is open-world, graph-shaped, and multi-graph, while app models are closed-world and object/tree-shaped. Necessary for correctness is an explicit projection contract. Overbuilt is a generic bidirectional mapper that pretends arbitrary inferred/contextual RDF can always be recovered as first-class domain fields. ([Stardog Documentation][1])

2. Vendor stores do **not** present full native-object round-trips as the canonical test shape. Their docs center on parsing, storage, query, reasoning, and validation on graph APIs. By contrast, mapping tools like LDkit and LDO explicitly focus on transforming RDF into TS primitives and back through schema-mediated abstractions. My judgment is: test the forward and reverse directions independently at the store layer, and add one end-to-end projection-parity test at your package boundary because your mapper—not N3.js—is the risky part. I did not find a vendor-standard “always full-round-trip the native object model” pattern. ([Apache Jena][3])

3. There is no canonical industry term for “projection parity,” but the idea is normal. LDO explicitly frames RDF↔TypeScript as a schema-mediated transformation and highlights that JSON/tree assumptions do not line up cleanly with graphs; LDkit likewise maps RDF into TypeScript primitives according to a schema rather than promising graph identity. So: projection parity is healthy if it means “the domain projection survives within declared lossiness.” It becomes a smell only if you expect ordering, blank-node identity, inferred triples, or graph context to round-trip as though RDF were JSON with extra punctuation. ([ISWC 2023][4])

4. The vendor pattern is very stable. Jena’s core abstraction is `Model`/`Graph`; RDF4J centers `Model` and `Repository`; GraphDB is used through the RDF4J API; Stardog supports RDF4J and ships Jena `Model`/`Dataset` integrations. If users want typed bindings, they reach for add-on frameworks like JOPA, KOMMA, or RDFBeans, or they build app-specific projections. On the Python side, the center of gravity is still graph-first tooling like RDFLib; object-RDF mappers such as SuRF exist, but I did not find evidence that they define the mainstream production pattern today. On the JVM, whether people write Java or Scala, the practical patterns are the same: graph API first, object layer second. ([Stardog Documentation][1])

5. Yes, there are projects that use JSON-LD contexts as the bridge. LDkit schemas are based on JSON-LD context; LDO generates a JSON-LD context and TypeScript typings from ShEx; JSON-LD Framing exists specifically to force a friendlier tree layout for consumers. The trade-off is sharp: context-driven bridges are excellent for developer ergonomics and simple field mapping, but context alone does not strongly define node shape, cardinality, or graph ownership. For your use case—graph-level SHACL, controlled vocabularies, referential integrity, and loss-aware distillation—a hand-curated manifest/EmitSpec is stronger than context-only mapping. The compromise I would choose is to generate a JSON-LD context from the same spec, not replace the spec with JSON-LD. R2RML/RML are the right tools when your source is SQL/CSV/JSON, not when your source is already a typed domain model. ([Sage Journals][5])

## Cluster 2 — SHACL validation in production

1. The production line is basically the one you already want: local datatype/shape constraints live close to the application model, while graph-wide or closed-world data-quality rules live in SHACL. DCAT-AP’s published shapes separate cardinality/range checks, mandatory classes, and controlled-vocabulary checks. RDF4J and GraphDB then enforce SHACL at transaction commit, which is a strong signal that SHACL is treated as graph governance, not as a replacement for the host language’s type system. Keep Effect Schema for per-record shape and host-language decoding; move cross-entity, referential, and vocabulary constraints to SHACL. ([GitHub][2])

2. At 50–100 shapes, production projects split shapes by **concern or profile module**, not by one giant file and usually not by “one file per class” either. DCAT-AP is the best concrete example I found: one file for cardinality/range, one for mandatory classes, one for mandatory vocabularies, plus separate resources and tests. Newer profile work such as HealthDCAT-AP explicitly talks about importing base DCAT-AP shapes and separating reused vs extended constraints. My recommendation is: module by profile/domain, split within each module by concern, and use composition/imports only when it makes violations easier to explain. Deep shape inheritance is often overbuilt because it hides where failures come from. ([GitHub][2])

3. Production shapes usually travel with the ontology or application-profile release, even if they are published as separate artifacts. DCAT-AP folded shapes into the profile/spec release story; Bioschemas publishes released profiles as SHACL shapes and now aggregates them as versioned releases. When a stricter release would invalidate existing data, the operational choices are to reject the transaction, validate externally before promotion, or stage the rule first as warning/info before making it a hard violation. The anti-pattern is silent shape upgrades. Pin shapes with the snapshot, validate migrations in CI, and never auto-consume a stricter shapes file without a promotion step. ([GitHub][2])

4. For `shacl-engine`, public evidence is promising but thin. The project claims 15–26x speedups over other JS/Python packages on its benchmark and supports useful report/debug/coverage knobs, but I did not find neutral public benchmarks at exactly your 10k–100k-triple band. What I _did_ find on the production side is more revealing: RDF4J and GraphDB both invest in targeted validation, minimal revalidation, parallel validation, bulk validation modes, and explicit validation limits, which tells you SHACL cost is highly shape- and workload-dependent. My practical judgment: tens of thousands of triples is reasonable territory for JS validation if your shapes are sane and you benchmark them, but do not trust generic numbers until you run your own corpus. ([GitHub][6])

5. In pure JS, the two serious options I found are `shacl-engine` and `rdf-validate-shacl`. `shacl-engine` looks faster and has better debugging ergonomics, but its evidence base is still mostly project-owned. `rdf-validate-shacl` is a mature RDF/JS implementation with recent releases and broader package history. If you are willing to step off-platform for correctness, `pySHACL` is the strongest pragmatic alternative: it supports pre-inference, Meta-SHACL, warning/info policies, remote-graph validation, and even an OpenAPI service. In Java, Jena SHACL and the Jena-based TopBraid SHACL API are the conservative reference-grade options. My recommendation is a pluggable validator interface: JS in-process for local/dev speed, reference validator in CI for correctness-critical suites. ([GitHub][6])

6. Operationally, production systems do all three: hard-fail, severity partition, and human remediation. SHACL itself has `Info`, `Warning`, and `Violation`; pySHACL can allow infos and warnings without failing overall conformance; Stardog returns validation reports and lets you query structured violation rows; GraphDB exposes severities and bulk validation; TopBraid EDG turns validation into workflow/UI operations; data.world validates ingested data and stores result triples that can be queried later. For Skygest, I would hard-fail `Violation` in CI and snapshot promotion, but keep `Warning` and `Info` as reportable debt in developer tooling. That is the line between correctness and overbuilt workflow. ([Stardog Documentation][7])

## Cluster 3 — Versioning, snapshotting, and drift

1. Yes as a pattern, no as a famous ontology-specific name. What you have is a classic **source → release artifact → consumer** split. In ontology engineering the closest mature analogue is ODK/OBO practice: maintain a source ontology, generate release artefacts, and have downstream consumers pin those artefacts rather than building against the authoring workspace. I would describe your setup that way rather than inventing a new ontology-store term. The repo count is less important than immutable, reviewable release artifacts. ([OBO Academy][8])

2. Production ontology systems manage drift with three layers: release metadata, deprecation semantics, and migration windows. OBO requires documented versioning procedures and unique resolving version IRIs for official releases. OWL gives you `owl:versionIRI`, `owl:priorVersion`, and compatibility markers; OBO-style governance adds the operational layer: pre-announce obsoletions, mark terms `owl:deprecated true`, remove logical axioms/usages, and provide replacement or `consider` annotations. In practice, the deprecation model is both machine-readable and social. You want both. ([OBO Foundry][9])

3. When a predicate is renamed, production systems do not just flip the switch. They publish a new release, deprecate the old term, provide a migration mapping, and frequently tolerate both forms for a period. The closest concrete example to your world is DCAT-AP’s move from `schema:startDate`/`schema:endDate` to `dcat:startDate`/`dcat:endDate`, accompanied by dedicated SHACL validation guidance. For Skygest, the right cutover is: snapshot N+1 ships old+new mapping metadata, distill accepts both, emit writes the new one, and N+2 removes the old one after data migration. Same-day hard renames are how consumers get burned. ([Interoperable Europe Portal][10])

4. Yes, there is standard machinery, but real systems layer release engineering on top of it. The semantic core is `owl:versionIRI`, `owl:priorVersion`, and optionally `owl:backwardCompatibleWith`/`owl:incompatibleWith`. Around that, mature ecosystems add semver, immutable release artefacts, changelogs, and metadata vocabularies such as MOD for describing ontology publications. So the standards identify versions; they do not run a release program for you. Your snapshot repo is exactly where the extra machinery belongs. ([W3C][11])

5. For SHACL specifically, the safe pattern is version-locking with the ontology or application-profile release and staged enforcement. DCAT-AP treats shapes as part of the profile release story; Bioschemas publishes shapes as release artifacts of the profiles. Because stricter shapes can instantly break every downstream consumer, production setups pin a shapes version, validate candidate data against it before promotion, and often ratchet constraints from warning to violation rather than tightening everything at once. In your architecture, shapes absolutely belong in the snapshot repo and the runtime should consume a pinned shapes version, never “latest.” ([GitHub][2])

## Cluster 4 — Ingest and change tracking

1. The production pattern is delta writes against **owned graph slices**, not whole-store mutation by raw triple diffing. If a system knows ownership, it either patches a known subgraph or replaces a named graph wholesale. RDF4J’s SHACL engine validates the minimal changed data on commit; GraphDB documents “replace graph” update flows; quadstore exposes `patch` and `multiPatch` backed by atomic batches. For Skygest, I would start with whole-catalog rebuilds, but introduce named-graph ownership from day one so you can later replace `graph://catalog/{datasetId}` or `graph://resolution-run/{runId}` rather than inventing fragile triple-delta logic later. ([Eclipse RDF4J][12])

2. Delete semantics in RDF are operational, not ontological. The stores use `DELETE`, `DELETE/INSERT`, `CLEAR GRAPH`, or the equivalent of removing all quads in a named graph. SPARQL 1.1 Update is explicit that `INSERT` and `DELETE` are the fundamental update actions, and Stardog notes that deleting a named graph is simply removing all triples in that graph. For “Dataset is no longer published,” I would separate active-state deletion from historical provenance: remove it from the active named graph, but retain an archive/tombstone graph with `prov:wasInvalidatedBy` or `prov:invalidatedAtTime` so you can still explain its lifecycle. ([W3C][13])

3. Named graphs are still the pragmatic unit of versioning and provenance. Jena’s dataset model is default graph plus named graphs; LinkedDataHub makes every document a named graph; GraphDB and Stardog operate naturally on named graph IRIs. RDF-star is useful when you truly need statement-level provenance, but support is still uneven: RDF4J calls its RDF-star support experimental, and GraphDB explicitly warns that maintaining both RDF-star and standard reification can be confusing. So my advice is simple: named graphs first, RDF-star later, and only where statement annotations are actually worth the ecosystem pain. ([Apache Jena][14])

4. For your post → chart → dataset → variable chain, yes: PROV-O all the way, with named graphs as the operational boundary. PROV-O was designed as a lightweight ontology for interchange and specialization, so it fits extraction, resolution, ingest, and publication activities well. I would model posts/charts/datasets/variables as `prov:Entity`, extraction/resolution/ingest runs as `prov:Activity`, publishers/models/operators as `prov:Agent`, and keep batch/run ownership in named graphs. If you later need richer publication/version metadata, PAV is a useful lightweight complement to PROV-O rather than a replacement. ([W3C][15])

## Cluster 5 — Reasoning and inference

1. For an operational DCAT + domain catalog, full OWL reasoning is usually more machinery than value. The useful inferences are almost always RDFS-ish: subclass/subproperty expansion, inherited types, maybe a few deterministic custom rules or property-chain-like conveniences. That is also what the ecosystem signals: DCAT application-profile work centers on SHACL validation, while production stores give users a choice among lighter reasoning strategies instead of insisting on full OWL. My judgment is that RDFS plus a small rule layer is enough until a real query needs more. Full OWL is overbuilt unless you can point to a specific inference your product depends on. ([SemiCEU][16])

2. In the JS ecosystem, the realistic choices are `N3.js`’s built-in reasoner for simple forward rules or `eye-js` if you need fuller Notation3 reasoning. N3.js is explicit that its reasoner only supports rules with Basic Graph Patterns in premise and conclusion, with no built-ins or backward chaining; its own README points you to `eye-js` for full N3 reasoning features. That makes N3.js fine for simple RDFS-style forward-chaining and canonicalization rules, but not a substitute for a mature semantic reasoner. ([GitHub][17])

3. Real systems do both query-time inference and materialization. GraphDB uses forward chaining / total materialization; Stardog emphasizes query rewriting and on-the-fly inference. The right choice depends on why the inference exists. For your closed loop, I would materialize only cheap, deterministic closure that simplifies downstream validation/distillation—extra `rdf:type`, canonical superproperties, stable inferred edges—and leave heavier or more exploratory inference off the write path. That keeps the graph explainable. ([GraphDB][18])

4. You need a persistent quad store when durability, incremental updates, multi-run history, or query complexity become the problem—not when the catalog is merely “semantic.” N3.js is explicitly in-memory. Quadstore gives you a persistent Level-style backend and patch operations; Oxigraph gives you an on-disk SPARQL database but says it is still in heavy development and query evaluation is not yet optimized. For a catalog in the tens of thousands of triples, an in-memory store is fine. Move when rebuild/validate cycles become operationally annoying or when you need durable graph history. I could not find a credible universal threshold in public docs, and I would not fake one. ([GitHub][17])

## Cluster 6 — Library and stack choices

1. Today, yes: N3.js is the right default. It is RDF/JS-native, parses/writes the core RDF serializations, stores quads in memory, and its Store/Parser/Writer interfaces are a good fit for an Effect-wrapped seam. That matches your immediate need better than jumping to a persistent store. I would only skip it if SPARQL and durable local state were day-one requirements, in which case quadstore or an external RDF engine become more attractive. ([GitHub][17])

2. The N3.js footguns at ~100K scale are operational, not existential. First, the store is in-memory, so capacity is bounded by RAM and data shape rather than a hard library limit; if you use multiple stores, it can at least share an entity index to cut memory overhead. Second, the project recently moved into RDF 1.2 support, which is good but means you should watch release notes and regressions. Third, the writer does not optimize prefix shortening exhaustively for performance, and recent issues show stream-parser edge cases around chunk boundaries and some mutation quirks. Fourth, the parser is permissive by default and allows mixed syntaxes unless you pass an explicit `format`, so your production parser should be strict. None of this rules N3.js out for your first milestone; it just means you want golden tests around your own corpora. ([GitHub][19])

3. If you want a JS validator with structured reports and no JVM, `shacl-engine` is a respectable first choice, but I would not weld the package design to it. `rdf-validate-shacl` is the other serious JS option and looks more established as a maintained TypeScript/JavaScript SHACL library. My advice is to define a `ShaclService` abstraction that can target both. That lets you start with `shacl-engine`, keep `rdf-validate-shacl` as a fallback, and run `pySHACL` or Jena SHACL as an external reference implementation when you need stronger correctness guarantees. ([GitHub][6])

4. I did not find a prominent production Effect-native RDF stack besides the reference work you already know about. The closest maintained TypeScript ecosystems are LDkit, which is a typed OGM/query layer for RDF, and LDO, which generates TS typings and JSON-LD contexts from shapes; on the graph-native application side, LinkedDataHub is a production-style platform but it is Java/Jena, not TypeScript. So the answer is: you are on a relatively uncrowded path language-wise, but not concept-wise. Borrow architecture from graph-first systems and developer ergonomics from LDkit/LDO; do not wait for a perfect Effect-native precedent. ([GitHub][20])

5. If you abandon in-memory from day one, the trade-off is straightforward. Quadstore buys you incremental local persistence, RDF/JS interoperability, and patch-style updates, but it also drags in backend/storage decisions immediately. Oxigraph buys you an on-disk SPARQL store and a much more database-shaped future, but its own docs still say it is in heavy development and query evaluation is not optimized. A Jena Fuseki or Stardog sidecar gives you mature query, reasoning, and SHACL infrastructure, but at the cost of a second runtime and much more ops surface. Given your current scope, that is overbuilt. Move only when your change-tracking or query needs force you there. ([GitHub][21])

## Concrete recommendations

### Things I would do differently

1. **Rename the mental model.** Treat `packages/ontology-store/` as an **application-profile graph seam**, not as a generic ontology store. That one reframing will save you from chasing fake symmetry. Your `EmitSpec`/`DistillSpec` should be explicit, lossy, and versioned like an API. That is the correct level of abstraction for what you are building. (Clusters 1, 3) ([Apache Jena][3])

2. **Make SHACL pluggable now, not later.** Keep the `ShaclService` interface, but do not hard-code `shacl-engine` as the only execution backend. Use JS in-process for dev/test speed and add a reference path—probably `pySHACL` or Jena SHACL—in CI for the shape suites that matter. That is the cheapest way to buy correctness insurance. (Clusters 2, 6) ([GitHub][6])

3. **Introduce named graphs before you “need” them.** Even if milestone one still writes a default graph, design your APIs and quad model around an eventual graph ownership unit such as per-entity, per-source, or per-run named graphs. Retrofitting ownership after provenance arrives is much messier. (Clusters 4, 5) ([Apache Jena][14])

4. **Generate a JSON-LD context from the manifest, but keep the manifest authoritative.** That gives you better developer ergonomics and future interoperability without surrendering the stronger shape/cardinality semantics that your distill path actually needs. (Cluster 1) ([Sage Journals][5])

5. **Stage SHACL strictness.** New cross-entity constraints should enter as warnings unless they are truly mandatory for correctness; only later should they become hard violations. This is how you avoid snapshot upgrades becoming outage generators. (Clusters 2, 3) ([GraphDB][22])

### Things I would keep

1. **Keep projection-level parity as the round-trip bar.** That is the right target. Structural equality is the wrong bar for RDF-backed application models. (Cluster 1) ([ISWC 2023][4])

2. **Keep the Effect Schema vs SHACL split.** Per-record typing in Effect Schema and graph-wide constraints in SHACL is exactly the production-friendly separation of concerns. (Cluster 2) ([GitHub][2])

3. **Keep the snapshot repo as runtime source of truth.** Your “authoring workbench vs released artifacts vs consumer runtime” boundary is good release engineering, not ceremony. (Cluster 3) ([OBO Academy][8])

4. **Keep N3.js for milestone one.** For a catalog in the tens-of-thousands-of-triples range, the pain is more likely to be mapping drift than N3.js capacity. (Clusters 5, 6) ([GitHub][17])

5. **Keep reasoning optional and minimal in day one.** A no-op reasoner interface now, with room for lightweight RDFS/custom rules later, is the right shape. Full OWL is not where your value is right now. (Cluster 5) ([GraphDB][18])

## Reading list

Start with these, in roughly this order:

1. **RDF4J SHACL documentation** for the most practical view of transactional SHACL, targeted validation, and shapes graphs in a production-grade RDF framework. ([Eclipse RDF4J][12])

2. **GraphDB SHACL validation and reasoning docs** for a real vendor stack that exposes severity levels, bulk validation, and forward-chaining materialization. ([GraphDB][22])

3. **Stardog Data Quality / ICV docs plus Stardog reasoning docs** for the other major production pattern: structured validation reports and query-time inference via rewriting. ([Stardog Documentation][7])

4. **DCAT-AP validation section plus the archived `dcat-ap_shacl` repo** because it is the cleanest open example of how a widely used application profile organizes shapes by concern and ships validation assets as part of its release story. ([SemiCEU][16])

5. **ODK / OBO release workflow and OBO versioning/deprecation principles** if you want a mature ontology release discipline to imitate for your snapshot repo. ([IncaTools][23])

6. **LDkit (paper + repo)** if you want to study a modern TypeScript-first typed projection layer over RDF without pretending the graph disappears. ([GitHub][20])

7. **LDO paper** if you want the best current discussion of JSON-LD/tree ergonomics versus graph reality, especially for reverse distillation ideas. ([ISWC 2023][4])

8. **N3.js README and release notes** so you understand exactly what the library promises today, especially around RDF 1.2, in-memory storage, strict vs permissive parsing, and reasoning limits. ([GitHub][17])

9. **pySHACL** if you want a strong reference validator, Meta-SHACL, pre-inference, severity policies, and a service mode. ([GitHub][24])

10. **ERA-SHACL Benchmark and the SHACL Test Suite/Implementation Report** if you decide validator correctness/performance is important enough to benchmark formally rather than by anecdote. ([Semantic Web Journal][25])

My blunt bottom line: your design is **not wrong**. It is mostly right. The part that needs discipline is not the RDF plumbing but the contract around what gets projected, what gets validated, and who owns each slice of graph state. If you stay graph-first and projection-explicit, this can remain a ~1000-line package. If you try to make the seam magically universal, it will become the 5000-line package you are worried about.

[1]: https://docs.stardog.com/developing/programming-with-stardog/java "https://docs.stardog.com/developing/programming-with-stardog/java"
[2]: https://github.com/SEMICeu/dcat-ap_shacl "https://github.com/SEMICeu/dcat-ap_shacl"
[3]: https://jena.apache.org/documentation/rdf/ "https://jena.apache.org/documentation/rdf/"
[4]: https://iswc2023.semanticweb.org/wp-content/uploads/2023/11/142660227.pdf "https://iswc2023.semanticweb.org/wp-content/uploads/2023/11/142660227.pdf"
[5]: https://journals.sagepub.com/doi/10.1177/22104968251404248 "https://journals.sagepub.com/doi/10.1177/22104968251404248"
[6]: https://github.com/rdf-ext/shacl-engine "https://github.com/rdf-ext/shacl-engine"
[7]: https://docs.stardog.com/data-quality-constraints "https://docs.stardog.com/data-quality-constraints"
[8]: https://oboacademy.github.io/obook/reference/release-artefacts/ "https://oboacademy.github.io/obook/reference/release-artefacts/"
[9]: https://obofoundry.org/principles/fp-004-versioning.html "https://obofoundry.org/principles/fp-004-versioning.html"
[10]: https://interoperable-europe.ec.europa.eu/collection/semic-support-centre/solution/dcat-application-profile-data-portals-europe/release/200 "https://interoperable-europe.ec.europa.eu/collection/semic-support-centre/solution/dcat-application-profile-data-portals-europe/release/200"
[11]: https://www.w3.org/TR/owl-ref/ "https://www.w3.org/TR/owl-ref/"
[12]: https://rdf4j.org/documentation/programming/shacl/ "https://rdf4j.org/documentation/programming/shacl/"
[13]: https://www.w3.org/TR/sparql11-update/ "https://www.w3.org/TR/sparql11-update/"
[14]: https://jena.apache.org/tutorials/sparql_datasets.html "https://jena.apache.org/tutorials/sparql_datasets.html"
[15]: https://www.w3.org/TR/prov-o/ "https://www.w3.org/TR/prov-o/"
[16]: https://semiceu.github.io/DCAT-AP/releases/3.0.0/ "https://semiceu.github.io/DCAT-AP/releases/3.0.0/"
[17]: https://github.com/rdfjs/N3.js/blob/main/README.md "https://github.com/rdfjs/N3.js/blob/main/README.md"
[18]: https://graphdb.ontotext.com/documentation/11.3/reasoning.html "https://graphdb.ontotext.com/documentation/11.3/reasoning.html"
[19]: https://github.com/rdfjs/N3.js/issues/187?utm_source=chatgpt.com "How to store quads during parsing from stream? · Issue #187"
[20]: https://github.com/karelklima/ldkit "https://github.com/karelklima/ldkit"
[21]: https://github.com/quadstorejs/quadstore "https://github.com/quadstorejs/quadstore"
[22]: https://graphdb.ontotext.com/documentation/11.3/shacl-validation.html "https://graphdb.ontotext.com/documentation/11.3/shacl-validation.html"
[23]: https://incatools.github.io/ontology-development-kit/ "https://incatools.github.io/ontology-development-kit/"
[24]: https://github.com/rdflib/pyshacl "https://github.com/rdflib/pyshacl"
[25]: https://www.semantic-web-journal.net/system/files/swj3972.pdf "https://www.semantic-web-journal.net/system/files/swj3972.pdf"
```

---

## references/data-layer-spine/manifest.json (the TS↔ontology manifest the walker consumes)

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

## docs/plans/2026-04-14-unified-triple-store-export-design.md (predecessor design with inlined schema reference)

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

## src/domain/data-layer/catalog.ts (DCAT Effect Schema definitions)

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

## src/domain/data-layer/variable.ts (V/S/O Effect Schema definitions)

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

## src/domain/data-layer/alias.ts (23 alias schemes)

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
