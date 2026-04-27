# Energy-Intel Unified Abstraction: Architecture

**Status:** Planning. Synthesized 2026-04-27 from four parallel design agents.
**Companion:** `docs/plans/2026-04-27-energy-intel-expert-vertical-slice-design.md` (the slice scope).
**Purpose:** Specify the *unified declarative abstraction* — TTL → codegen → typed schema → RDF mapping → SHACL → AI Search projection → typed query — once, so every entity slice (Expert first, then Organization, Post, Article, Distribution, Dataset, Variable, Series, Measurement, …) is a recipe-replay rather than a fresh design.

## Overview

The system has one job at a time: take an entity defined in the upstream `energy-intel` ontology and make it *complete* across every layer the application uses — typed in TS, validated as RDF, projected to AI Search, and queryable through Effect from a Worker. The abstraction is *declarative* in that the user (engineer or codegen) declares the entity once and every layer derives from that declaration. It is *unified* in that every layer speaks the same vocabulary: branded IRIs from a shared namespace, `Schema.Class` instances from `packages/ontology-store/src/generated/`, `Effect.gen` programs that fail with `Schema.TaggedErrorClass` errors.

Four design choices, all locked, anchor the abstraction:

1. **Schema is generated; transforms are hand-written; both live in the same module.** `Schema.Class` plus a co-located struct of pure functions per entity. No runtime entity registry, no `OntologyStore` service, no JSON spec interpreter. Composition is structural via an `OntologyEntityModule<S, M>` interface.
2. **The TTL is the single source of truth.** Both the TypeScript schema and the SHACL shape are projections of it. The branded IRI substitution in the codegen post-processor is the only place coherence between TTL and TS is enforced; wrong here and every downstream type is wrong.
3. **SHACL is build-time + test-only, not runtime.** Cloudflare Workers cannot host the Node-based validator without `nodejs_compat`. The compile-time guarantee chain (branded IRIs + `Schema.Class` + `decodeUnknownEffect` at every boundary) already enforces every constraint SHACL would catch at runtime. SHACL exists to pin which *phase* of the round-trip broke when something does — a debugging affordance.
4. **Three new services per entity-search-capable entity.** `AiSearchClient` (the Cloudflare binding wrapper, shared across entities), `Ontology<Entity>Repo` (D1 reads returning the new schema), `<Entity>SearchService` (the typed query path). Pure transforms (`toTriples`, `toAiSearchKey`, etc.) stay as module-level functions, not services.

What follows is the synthesized architecture in four sections — pipeline, contract, coordination, slicing — with a final critical-files list.

## 1. Pipeline Architecture

The pipeline is seven stages. Build-time stages fold ontology source into committed TypeScript artifacts; runtime stages move a single value across system boundaries. Each stage is a discrete `Effect.gen` with a tagged error type — matching the `Schema.TaggedErrorClass` discipline already established in `src/domain/errors.ts`. There is no `OntologyEntity<E>` boundary value; the boundary is an *interface* (per-entity `OntologyEntityModule<S, M>`), instantiated once per entity in `packages/ontology-store/src/agent/expert.ts`. Conventions, not a value.

**Stage 1 — TTL → JSON Schema.** `parseTtlModule(name: "agent")`: input path string, output `JsonSchema.Document<"draft-2020-12">`, error `TtlParseError`, deps N3.js (script-only, Node OK in `scripts/`). Build-time only; runs under `bun packages/ontology-store/scripts/generate-from-ttl.ts`.

**Stage 2 — JSON Schema → Effect Schema AST → TS source.** `Effect.sync(() => SchemaRepresentation.fromJsonSchemaDocument(doc))` produces a `Document`. `toMultiDocument` lifts to `MultiDocument`. The AST post-processor (`substituteIriBrands`, `foldOwlEquivalents`) walks `representation` and rewrites `String` nodes for `ei:*` IRIs into branded references, using `topologicalSort` to sequence cross-class deps. `toCodeDocument` emits TS, then prettier formats and we write to `src/generated/<module>.ts`. Errors: `CodegenAstError`, `CodegenWriteError`. The IRI brand substitution is the only place coherence between TTL and TS is enforced.

**Stage 3 — Branded IRI plumbing.** Generated. `ExpertIri = Schema.String.pipe(Schema.pattern(...), Schema.brand("ExpertIri"))`. Every cross-entity reference field carries the branded type. `Expert.iri: ExpertIri` is the type-system invariant: anywhere we accept an Expert, we must already have proven the IRI matches the energy-intel pattern. Plain `string` enters the system in exactly two places — D1 row decode and AI Search `chunk.item.key` parse — both are `Effect`-returning decodes that fail loudly.

**Stage 4 — Hand-written mapping in `<entity>.ts`.** `expertToTriples(e: Expert): ReadonlyArray<RdfQuad>` and `expertFromTriples(quads, subject): Effect.Effect<Expert, RdfMappingError | ParseError>`. Reverse path internally calls `Schema.decodeUnknownEffect(Expert)` so it cannot return a structurally invalid Expert — the function's return type is the type-level coherence guarantee with stage 3.

**Stage 5 — Projection.** `ExpertProjection: AiSearchProjection<Expert, ExpertMetadata>` is a pure record. The compile-time invariant linking Alchemy's `customMetadata` declaration and the projection: a single shared `EXPERT_METADATA_KEYS = ["entity_type", "did", "iri", "tier", "topic"] as const` lives next to the entity module. Both `toMetadata`'s return type (`Readonly<Record<typeof EXPERT_METADATA_KEYS[number], string>>`) and Alchemy's `customMetadata` argument come from the same const. Adding a sixth field to one without the other is a TS error, not a runtime upload failure.

**Stage 6 — Population (one-shot).** `populateExperts: Effect<void, DbError | UploadError, ExpertsRepo | AiSearchClient>`:

```ts
Effect.gen(function* () {
  const repo = yield* ExpertsRepo
  const ai = yield* AiSearchClient
  const rows = yield* repo.listAll()
  yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      const e: Expert = yield* expertFromLegacyRow(row)
      yield* ai.upload("experts", ExpertProjection.toKey(e),
        ExpertProjection.toBody(e), ExpertProjection.toMetadata(e))
    }), { concurrency: 8 })
})
```

**Stage 7 — Query (`searchExperts`).** Reverse decode is the critical guarantee. Chunks come back as unsanitized JSON. `decodeChunksToExperts`: dedupe by `chunks[i].item.key`, parse each `key` through `Schema.decodeUnknownEffect(ExpertKey)` (yields `ExpertIri`), call `ExpertsRepo.getByIri(iri)`, pipe the row through `Schema.decodeUnknownEffect(Expert)` mapping decode failures into a tagged error. Per-chunk failures are collected via `Effect.partition` so one rotten record does not poison the whole query. Return type is `Effect<ReadonlyArray<Expert>, AiSearchError | ParseError | SqlError, AiSearchClient | ExpertsRepo>`. The `Expert` here is the same nominal class generated in stage 2 — that nominal identity is what makes the slice's type story hold.

## 2. Per-Entity Contract

The right Effect-native abstraction for "an ontology entity" is **a `Schema.Class` plus a co-located struct of pure functions**, not a `ServiceMap.Service`.

`Schema.Class` (in `.reference/effect/packages/effect/src/Schema.ts`) gives a runtime constructor, decoder/encoder via the AST it carries, a stable identifier for telemetry, structural `fields` reflection, and the `extend` / `annotate` / `mapFields` surface. The data concern is fully covered without inventing an interface.

A `ServiceMap.Service` per entity would be wrong: the entity has no per-instance dependency graph, no lifecycle, no environment-scoped variants. The only services involved are *consumers* of entities (`AiSearchClient`, `ExpertsRepo`) and they belong to the worker layer, not to `expert.ts`.

Encoding the metadata in `Schema` annotations is appealing but is the wrong layer for this slice. AI Search projection, RDF triple expansion, and BFO inherence are not schema metadata; they are typed transforms over a decoded entity. Putting them on the AST means the codegen post-processor has to re-emit them — exactly the project-specific logic the slice keeps declarative.

**Contract interface:**

```ts
export interface OntologyEntityModule<
  Self extends Schema.Schema.Any,
  Meta extends Readonly<Record<string, string>>
> {
  readonly schema: Self
  readonly iriOf: (e: Schema.Schema.Type<Self>) => string
  readonly toTriples: (e: Schema.Schema.Type<Self>) => ReadonlyArray<RdfQuad>
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string
  ) => Effect.Effect<Schema.Schema.Type<Self>, RdfMappingError | ParseError>
  readonly toAiSearchKey: (e: Schema.Schema.Type<Self>) => string
  readonly toAiSearchBody: (e: Schema.Schema.Type<Self>) => string
  readonly toAiSearchMetadata: (e: Schema.Schema.Type<Self>) => Meta
}
```

**File shape — `packages/ontology-store/src/agent/expert.ts`:**

```ts
import { Effect, Schema } from "effect"
import { Expert, EnergyExpertRoleIri, ExpertIri } from "../generated/agent"
import { BFO, EI, FOAF, RDF } from "../iris"
import type { OntologyEntityModule, RdfQuad } from "../Domain/OntologyEntity"
import { RdfMappingError } from "../Domain/Errors"

export { Expert, ExpertIri }

export const EXPERT_METADATA_KEYS = [
  "entity_type", "did", "iri", "tier", "topic"
] as const
export type ExpertMetadataKey = (typeof EXPERT_METADATA_KEYS)[number]
export type ExpertMetadata = Readonly<Record<ExpertMetadataKey, string>>

const iriOf = (e: Expert): ExpertIri => e.iri

const toTriples = (e: Expert): ReadonlyArray<RdfQuad> => { /* BFO inherence */ }

const fromTriples = (quads: ReadonlyArray<RdfQuad>, subject: string) =>
  Effect.gen(function* () {
    // policy-driven distill; decode through Schema.decodeUnknownEffect(Expert)
  })

const toAiSearchKey = (e: Expert) => `expert/${e.did}.md`
const toAiSearchBody = (e: Expert) => renderMarkdown(e)
const toAiSearchMetadata = (e: Expert): ExpertMetadata => ({
  entity_type: "Expert",
  did: e.did,
  iri: e.iri,
  tier: e.tier ?? "unknown",
  topic: e.primaryTopic ?? "unknown",
})

export const ExpertModule: OntologyEntityModule<typeof Expert, ExpertMetadata> = {
  schema: Expert,
  iriOf, toTriples, fromTriples,
  toAiSearchKey, toAiSearchBody, toAiSearchMetadata,
}
```

**Hand-written vs derived:**

| Part | Source |
|------|--------|
| `Expert` (`Schema.Class`), `ExpertIri` brand, sibling brands | Generated in `src/generated/agent.ts` |
| Namespace constants (`EI.Expert`, `BFO.inheresIn`) | Generated in `src/iris.ts` |
| `EXPERT_METADATA_KEYS`, `ExpertMetadataKey`, `ExpertMetadata` | Hand-written; **shared with `alchemy.run.ts`** |
| `iriOf`, `toTriples`, `fromTriples`, `toAiSearchKey/Body/Metadata` | Hand-written in `agent/expert.ts` |
| `Schema.Schema.Type<typeof Expert>`, `decodeUnknownEffect` | Derived from the schema class |

**Roles are value objects, not entities.** `EnergyExpertRole`, `PublisherRole`, `DataProviderRole` are generated as `Schema.Class` because the codegen sees them as `owl:Class`. They do *not* get an `OntologyEntityModule` in the slice. The slice flattens them: `Expert.roles: NonEmptyArray<EnergyExpertRoleIri>` carries only the role's IRI; BFO inherence triples are reconstructed inside `expertToTriples`. Roles become first-class entity modules later only when a future PR needs to query roles independently.

**SHACL ↔ TS cross-reference is test-only.** Both the `Schema.Class` and `shapes/expert.ttl` are projections of the same TTL. They meet only in the round-trip test: a value decoded by `Expert` and emitted by `toTriples` must validate against `expert.ttl`, and an SHACL-conforming graph distilled by `fromTriples` must `decodeUnknownEffect(Expert)` cleanly. Drift is a test failure, not a type error — the right tradeoff because SHACL encodes constraints (`sh:nodeKind`, `sh:minCount`) that have no TypeScript surface.

## 3. Coordination Layer

The coordination layer answers one question at runtime: given a Worker `env` and an Effect program, how do dependencies flow? The answer extends the existing `ServiceMap.Service` + `Layer.effect` pattern with one new binding-wrapper service for AI Search and one read-side facade for the new ontology repo.

**Service tree (slice additions):**

| Service | Provides | Requires |
|---------|----------|----------|
| `AiSearchClient` | `upload(instance, key, body, meta)`, `search(instance, input)` typed wrappers over `env.AI_SEARCH` | `CloudflareEnv` |
| `OntologyExpertRepo` | `getByIri`, `getByIris`, `listAll` returning the **new** `Expert` | `SqlClient` (D1) |
| `ExpertSearchService` | `searchExperts(q, opts) → Effect<ReadonlyArray<Expert>, …>` | `AiSearchClient`, `OntologyExpertRepo` |

**Deliberate non-services:**
- `expertToTriples` / `expertFromTriples` / `ExpertProjection` are pure module-level functions in `packages/ontology-store/src/agent/expert.ts`. No construction effect, no shared state, no alternative implementation worth swapping. Promoting them to a service would buy nothing.
- `OntologyStore` is *not* a service. The TTL → schema codegen runs at build time; the runtime never reads TTL.
- The codegen pipeline (`scripts/generate-from-ttl.ts`) is a Bun script that uses Effect *internally* but does not participate in the worker layer graph. Treating it as a service would force a fictitious dependency loop.

**Error type hierarchy** — additions to `src/domain/errors.ts`:

```ts
export class AiSearchError extends Schema.TaggedErrorClass<AiSearchError>()(
  "AiSearchError",
  {
    operation: Schema.Literal("upload", "search", "get", "delete"),
    instance: Schema.String,
    message: Schema.String,
    status: Schema.optionalKey(Schema.Number),
    key: Schema.optionalKey(Schema.String),
  }
) {}

export class RdfMappingError extends Schema.TaggedErrorClass<RdfMappingError>()(
  "RdfMappingError",
  {
    direction: Schema.Literal("forward", "reverse"),
    entity: Schema.String,
    iri: Schema.optionalKey(Schema.String),
    message: Schema.String,
  }
) {}
```

`ParseError` arrives natively from `Schema.decodeUnknownEffect`. Full failure channel of `searchExperts`: `AiSearchError | ParseError | RdfMappingError | SqlError`.

**`AiSearchClient` shape:**

```ts
export class AiSearchClient extends ServiceMap.Service<
  AiSearchClient,
  {
    readonly upload: (instance: string, key: string, body: string,
      metadata: Record<string, string>) => Effect.Effect<void, AiSearchError>
    readonly search: (instance: string, input: AiSearchSearchInput)
      => Effect.Effect<AiSearchSearchResult, AiSearchError>
  }
>()("@skygest/AiSearchClient") {
  static readonly layer = Layer.effect(AiSearchClient, Effect.gen(function* () {
    const env = yield* CloudflareEnv
    const binding = requireEnvBinding(env, "AI_SEARCH")
    return {
      upload: (instance, key, body, metadata) =>
        Effect.tryPromise({
          try: () => binding.get(instance).items.upload(key, body, { metadata }),
          catch: (cause) => new AiSearchError({
            operation: "upload", instance, key, message: String(cause)
          }),
        }).pipe(Effect.asVoid),
      search: (instance, input) =>
        Effect.tryPromise({
          try: () => binding.search({ ...input,
            ai_search_options: { retrieval: { instance_ids: [instance],
              ...input.ai_search_options?.retrieval } } }),
          catch: (cause) => new AiSearchError({
            operation: "search", instance, message: String(cause),
          }),
        }),
    }
  }))
}
```

**`searchExperts` walk-through:**

```ts
export const searchExperts = (q: string, opts?: ExpertSearchFilters) =>
  Effect.gen(function* () {
    const ai = yield* AiSearchClient
    const repo = yield* OntologyExpertRepo
    const result = yield* ai.search("experts", {
      messages: [{ role: "user", content: q }],
      ai_search_options: { retrieval: {
        max_num_results: 20,
        ...(opts ? { filters: buildFilters(opts) } : {}),
      } },
    })
    const iris = dedupeIris(result.chunks.map((c) => c.item.metadata.iri))
    const records = yield* repo.getByIris(iris)
    return yield* Schema.decodeUnknownEffect(Schema.Array(Expert))(records)
  })
```

**Worker entry layer composition** — following `src/edge/Layer.ts` (`buildSharedWorkerParts` + `makeSharedRuntime`). Adding a second entity later is one new line.

```ts
const aiSearchLayer = AiSearchClient.layer.pipe(
  Layer.provide(CloudflareEnv.layer(env, { required: ["DB", "AI_SEARCH"] }))
)
const ontologyExpertRepoLayer = OntologyExpertRepoD1.layer.pipe(
  Layer.provideMerge(baseLayer)
)
const expertSearchLayer = ExpertSearchService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(aiSearchLayer, ontologyExpertRepoLayer))
)
const agentSearchLayer = Layer.mergeAll(aiSearchLayer, expertSearchLayer)
```

`agentSearchLayer` merges into `queryLayer` (consumed by `src/api/Router.ts` and `src/worker/feed.ts` via the existing `makeQueryLayer(env)` cache). Adding `Organization` later: one new repo + service pair, one merged Layer line. No existing service changes signature.

**Population script reuse:** `scripts/populate-experts.ts` builds the same `aiSearchLayer` + the legacy `ExpertsRepoD1.layer` (to read existing rows) + `OntologyExpertRepoD1.layer`, then calls `runScopedWithLayer` from `src/platform/EffectRuntime.ts`. Pure functions (`expertFromLegacyRow`, `ExpertProjection`) are imported directly. Zero duplication: the script and the worker share the exact same `AiSearchClient` upload path.

## 4. Slicing Strategy and Future Evolution

The Expert slice front-loads every layer onto a single entity. After it lands, scaling is mechanical — most cost sits in the codegen pipeline, the Alchemy story, and the recipe pattern, all paid once. We plan five follow-up slices (~7 weeks) plus an ingest cutover, and identify two codegen lifts that almost certainly land mid-stream.

**The Expert recipe.** Per entity, hand-write four artifacts: the mapping module (`packages/ontology-store/src/<module>/<entity>.ts`), one SHACL shape, one round-trip test, one population script, one query service. Update three things: codegen invocation list, Alchemy `AiSearchInstance` block, one read path consumer. Schema, branded IRI, and namespace constants are *free* — they emerge from `generated/<module>.ts` on the next codegen run.

**Slice 2 — Organization (~3 days).** Same `agent.ttl` module, already emitted. Hand-write `agent/organization.ts`, one shape, one round-trip test, population script, search service. The role-bearer pattern (`PublisherRole`, `DataProviderRole`) emits BFO inherence triples in the same shape as Expert's `EnergyExpertRole` — strong signal the role-flatten/expand helper should lift into a shared utility here.

**Slice 3 — Post and Article from `media.ttl` (~1.5 weeks).** New module, new prefix imports, codegen pipeline unchanged. Cost sits in projections — Posts and Articles need richer markdown bodies (embed text, related-IRI lists, attachments). *Second codegen lift here:* `toAiSearchBody` markdown rendering has been written four times (Expert, Organization, Post, Article) — extract a `defaultMarkdownProjection(schema, { titleFrom, bodyFrom, frontmatterFrom })` helper that codegen invokes from a `@projection` annotation if the entity does not override. Adoption unlocks deleting `documentRows.ts` and `projectEntitySearchDocs.ts` paths in `src/search/` for media entities (~880 LOC).

**Ingest cutover (~1 week, between slices 3 and 4).** Once Post/Article schemas are live and round-trippable, `ExpertPollCoordinatorDo`, `ExpertPollExecutor`, `IngestRunWorkflow`, and `PostImportService` migrate to the new types. This is *not* a recipe-replay — it is a type-substitution PR. ~15 files across 3 workers.

**Slice 4 — Distribution, Dataset, Variable, Series (~2 weeks).** Heaviest slice. Four entities sharing the data module; `src/services/d1/` repos cover them at ~1,277 LOC. The `src/data-layer/DataLayerGraph.ts` runtime treats them as graph nodes — graph traversal helpers need rewiring. By this slice, three patterns lift into codegen: (1) the role-bearer flatten/expand helper, (2) the markdown projection default, (3) the `entity.fromD1Row(row)` decoder skeleton.

**Slice 5 — Measurement, CapacityMeasurement, TimePeriod (~1 week).** Smaller — measurement entities have minimal projection surface (numeric values, not searchable text bodies). Some may not need AI Search instances at all (numeric facts query better via D1 + filter), pruning the recipe to mapping + shape + test only.

**Slice 6 — Cleanup (~1 week).** Delete `src/resolution/` (~2,400 LOC), `src/search/` (~1,700 LOC), `src/domain/data-layer/graph-ontology-mapping.ts`, `src/bootstrap/ExpertSeeds.ts`, the legacy `Expert` and `LegacyOrganization` types, `entitySearch.ts`. Net delta: heavily negative LOC. A `forbidden-imports` lint rule prevents regrowth.

**Total downstream effort: ~7 weeks** for five slices plus ingest cutover, after the 2-week Expert slice. The abstraction holds because each slice's hand-written surface stays small (5 files) while codegen output expands to absorb repeated patterns. Slices 3 and 4 are the natural lift points — patterns visible at slice 2 are not yet stable; waiting until slice 5 burns one entity's worth of duplication.

## Critical Files for Implementation

- `/Users/pooks/Dev/skygest-cloudflare/.reference/effect/packages/effect/src/SchemaRepresentation.ts` — codegen primitives
- `/Users/pooks/Dev/skygest-cloudflare/.reference/effect/packages/effect/src/Schema.ts` — `Schema.Class`, `decodeUnknownEffect`
- `/Users/pooks/Dev/skygest-cloudflare/.reference/effect/packages/effect/src/Layer.ts` — Layer composition
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/scripts/generate-from-ttl.ts` — new codegen entry
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/src/generated/agent.ts` — generated, never edited
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/src/iris.ts` — generated namespace constants
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/src/agent/expert.ts` — hand-written entity module
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/src/Domain/OntologyEntity.ts` — `OntologyEntityModule` interface
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/shapes/expert.ttl` — SHACL shape
- `/Users/pooks/Dev/skygest-cloudflare/packages/ontology-store/tests/expert-round-trip.test.ts` — six-phase test
- `/Users/pooks/Dev/skygest-cloudflare/src/services/AiSearchClient.ts` — binding wrapper
- `/Users/pooks/Dev/skygest-cloudflare/src/services/d1/OntologyExpertRepoD1.ts` — D1 repo (new shape)
- `/Users/pooks/Dev/skygest-cloudflare/src/services/ExpertSearchService.ts` — typed query path
- `/Users/pooks/Dev/skygest-cloudflare/src/edge/Layer.ts` — Layer wiring delta
- `/Users/pooks/Dev/skygest-cloudflare/src/domain/errors.ts` — `AiSearchError`, `RdfMappingError`
- `/Users/pooks/Dev/skygest-cloudflare/scripts/populate-experts.ts` — one-shot population
- `/Users/pooks/Dev/skygest-cloudflare/alchemy.run.ts` — IaC entry point with shared `EXPERT_METADATA_KEYS`
- `/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules/agent.ttl` — upstream ontology source
