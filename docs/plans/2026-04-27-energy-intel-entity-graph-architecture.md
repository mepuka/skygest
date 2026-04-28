# Energy-Intel Entity-Graph Architecture (Slice 2)

**Status:** Architecture plus slice-2 runtime foundation. Design synthesized 2026-04-27 from 5 parallel Opus 4.7 design agents. **Revised 2026-04-28** in response to three PR #138 review passes, local Alchemy reference verification, and production-hardening feedback.
**Companion:** `docs/plans/2026-04-27-energy-intel-unified-abstraction-architecture.md` (slice 1, superseded by this doc on the AI-Search-as-spine framing).
**Goal:** Land the entity-graph foundation — `EntityDefinition` core contract, relation graph schema, unified projection contract, AI Search adapter, context assembly, and reindex queue substrate — while keeping Alchemy unification as the deployment target for the next slice.

**Review revisions (2026-04-28):**

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | P1 | Context assembly depended on a missing entity registry | Added `entities` table + `lookupEntity` / `upsertEntity` / `listEntities` to `EntityGraphRepo`; `assembleEntityContext` rewritten to two-step (graph layer → storage adapter dispatch). Cross-cutting decision #11 records the pattern. |
| 2 | P1 | Unique `triple_hash` blocked supersession audit chain | `triple_hash` uniqueness made conditional on `state = 'active'` via partial unique index; supersession is a three-step transaction (draft replacement → supersede old → activate replacement). |
| 3 | P1 | Non-default AI Search namespace modeled with the wrong binding | Dropped instance binding; worker accesses via `env.ENERGY_INTEL_SEARCH.get("entity-search")`. Section 4.2 + Section 3.2 + adapter updated. |
| 4 | P2 | AI Search items.upload used object-arg shape | Switched to positional `upload(name, content, { metadata })` per Workers binding API. |
| 5 | P2 | Predicate examples drifted from generated `iris.ts` | `PREDICATES` now imports from `iris.ts`; hand-writing predicate URLs forbidden; codegen is the source of truth. |
| 6 | P2 | Drift check called `e.exampleInstance` / `e.toMetadata` (wrong abstractions) | Drift check consumes `(projection, fixture)` pairs sourced from per-entity `*ProjectionFixture` exports; `EntityDefinition` stays free of testing concerns. |
| 7 | P2 | Reindex dedup via `Ref<HashSet<…>>` was not durable cross-isolate | Resolved open Q #1: cron'd D1-backed `reindex_queue` with durable UPSERT coalescing on a unique coalesce index. Cloudflare Queue is not provisioned in slice 2. |
| 8 | P1 | Generated IRI imports still could not typecheck | Predicate terms are a TTL/codegen prerequisite; generated `NamedNode` values are normalized through `.value` into branded `PredicateIri` strings before entering the entity/graph contracts. |
| 9 | P2 | Entity links could orphan traversal | `entities` gains composite uniqueness and edge rows carry registry-backed foreign keys; `createLink` validates both endpoint registry rows before insert. |
| 10 | P2 | Provisioning leaked storage back onto `EntityDefinition` | `provisionEntity` now consumes a separate `EntityProvisioningPlan`; storage/projection/deployment policies close over definitions but do not live on them. |
| 11 | P2 | Reindex coalescing could drop stronger work | Queue scheduling uses conflict-merge UPSERT semantics, preserving the max depth and strongest cause instead of first-writer-wins insert-only dedup. |
| 12 | P1 | D1 supersession used unsupported transactions | Production path uses D1 `batch()` for the three-step supersession write; SQLite tests keep the local transaction path. |
| 13 | P1 | Foreign keys were inert in production | Schema includes `PRAGMA foreign_keys = ON`, and `EntityGraphRepoD1` enables it at layer construction. |
| 14 | P1 | AI Search client had no reliability policy | AI Search upload/list/delete/search calls now have per-attempt timeout, transient-status retry, jittered exponential backoff, and `Retry-After` support. |
| 15 | P2 | Link/evidence reads had N+1 query shape | `linksOut` / `linksIn` load selected links and evidence with one `LEFT JOIN` query and group rows in TypeScript. |
| 16 | P2 | Identifier/hash spec drift was implicit | Current runtime uses Effect `Random.nextUUIDv4` link IDs and SHA-256 triple hashes; ULID/BLAKE3 remains a future policy upgrade, not the current contract. |
| 17 | P2 | PR claimed design-only while shipping runtime code | This doc and PR body now describe the branch as a runtime foundation PR with Alchemy implementation deferred. |

## Overview

The spine, locked:

```
ontology entity definition  →  relation graph  →  workflow services  →  backend projections
```

AI Search is a **projection target**, not the core abstraction. The relation graph (typed edges + provenance) is first-class. Workflow services are short-lived Effect programs over the graph. Backends consume the entity definition + graph; they don't constrain it.

Five sections follow, each authored by a parallel agent with full context. They're presented lightly synthesized — minor terminology unification, cross-references resolved — but the load-bearing technical content is the agents' work.

| Section | Scope | Anchor concept |
|---------|-------|----------------|
| 1. EntityDefinition Core Contract | What an entity *is*, independent of any backend | `defineEntity({...})` + 4-param generic |
| 2. Relation Graph and Storage | The first-class typed edge + evidence model | `entity_links` + `entity_link_evidence` + `PredicateRegistry` |
| 3. Unified Projection Contract | How entities reach search/discovery backends | `ProjectionContract<E, M, K>` + `ProjectionAdapter` |
| 4. Alchemy Unification | Entity definitions drive infrastructure | `provisionEntity()` + `ENTITY_METADATA_FIELDS` SSoT |
| 5. Workflow Services and Agent Surface | Short-lived agent operations + reindex | `EntityLinkingService` + `ReindexQueueService` + bounded depth |

## 1. EntityDefinition Core Contract

The contract is generic in four parameters carried at the type level so a value of `EntityDefinition<...>` advertises everything callers need:

```ts
// packages/ontology-store/src/Domain/EntityDefinition.ts
export interface EntityDefinition<
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec,
> {
  readonly tag: Tag
  readonly schema: Self
  readonly identity: IdentitySpec<Self, IriBrand>
  readonly ontology: OntologySpec<Self>
  readonly render: RenderSpec<Self, IriBrand>
  readonly relations: Relations
  readonly agentContext: AgentContextSpec<Self>
}
```

Each slot is a small interface:

```ts
export interface IdentitySpec<Self extends Schema.Top, IriBrand extends Schema.Schema<string>> {
  readonly iri: IriBrand
  readonly iriOf: (e: Schema.Schema.Type<Self>) => Schema.Schema.Type<IriBrand>
  readonly derive: (input: { readonly handle: string }) => Schema.Schema.Type<IriBrand>
}

export interface OntologySpec<Self extends Schema.Top> {
  readonly classIri: string
  readonly typeChain: ReadonlyArray<string>
  readonly shapeRef: string
  readonly toTriples: (e: Schema.Schema.Type<Self>) => ReadonlyArray<RdfQuad>
  readonly fromTriples: (
    quads: ReadonlyArray<RdfQuad>,
    subject: string,
  ) => Effect.Effect<Schema.Schema.Type<Self>, RdfMappingError | Schema.SchemaError>
}

export interface RenderSpec<Self extends Schema.Top, IriBrand extends Schema.Schema<string>> {
  readonly summary: (e: Schema.Schema.Type<Self>) => string
  readonly fulltext: (e: Schema.Schema.Type<Self>) => string
  /** Durable structured ontology claims. NOT an AI Search payload. */
  readonly facts: (e: Schema.Schema.Type<Self>) => ReadonlyArray<EntityFact<IriBrand>>
}

export type PredicateIri = string & { readonly PredicateIri: unique symbol }
export const asPredicateIri = (value: string): PredicateIri => value as PredicateIri

export interface EntityFact<IriBrand extends Schema.Schema<string>> {
  readonly subject: Schema.Schema.Type<IriBrand>
  readonly predicate: PredicateIri
  readonly object: string | number | boolean
}

export interface RelationDeclaration<TargetTag extends string> {
  readonly direction: "outbound" | "inbound"
  readonly predicate: PredicateIri
  readonly target: TargetTag
  readonly cardinality: "one" | "many"
}
export type RelationsSpec = Readonly<Record<string, RelationDeclaration<string>>>

export interface AgentContextSpec<Self extends Schema.Top> {
  readonly description: string
  readonly tools: ReadonlyArray<string>
  readonly summaryTemplate: (e: Schema.Schema.Type<Self>) => string
}
```

**Adapter slots are SEPARATE values** — `StorageAdapter<Def>`, `SearchAdapter<Def>`, `MigrationAdapter<Def>`, `PopulationAdapter<Def>` close over a definition; they do NOT live on `EntityDefinition` itself.

```ts
export interface StorageAdapter<Def extends EntityDefinition<any, any, any, any>> {
  readonly definition: Def
  readonly load: (iri: Schema.Schema.Type<Def["identity"]["iri"]>)
    => Effect.Effect<Schema.Schema.Type<Def["schema"]>, NotFoundError | DbError>
  readonly save: (e: Schema.Schema.Type<Def["schema"]>)
    => Effect.Effect<void, DbError>
}
// SearchAdapter, MigrationAdapter, PopulationAdapter follow the same closure pattern.
```

A `defineEntity({...})` builder gives type inference for all four parameters:

```ts
export const defineEntity = <
  Self extends Schema.Top,
  IriBrand extends Schema.Schema<string>,
  Tag extends string,
  Relations extends RelationsSpec,
>(spec: EntityDefinition<Self, IriBrand, Tag, Relations>) => spec
```

Concrete `ExpertEntity`:

```ts
// packages/ontology-store/src/agent/expert.ts
// After the Slice 2 TTL/codegen prerequisite adds EI.affiliatedWith.
import type { NamedNode } from "n3"
import { BFO, EI } from "../iris"

const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value)

export const ExpertEntity = defineEntity({
  tag: "Expert" as const,
  schema: Expert,
  identity: {
    iri: ExpertIri,
    iriOf: (e) => e.iri,
    derive: ({ handle }) => Schema.decodeUnknownSync(ExpertIri)(
      `https://w3id.org/energy-intel/expert/${handle.replace(/[^A-Za-z0-9_-]+/g, "_")}`
    ),
  },
  ontology: {
    classIri: EI.Expert.value,
    typeChain: ["foaf:Person", "ei:Expert"],
    shapeRef: "shapes/expert.ttl",
    toTriples: expertToTriples,
    fromTriples: expertFromTriples,
  },
  render: {
    summary: renderExpertSummary,
    fulltext: renderExpertFulltext,
    facts: expertFacts,
  },
  relations: {
    affiliatedWith: { direction: "outbound", predicate: predicate(EI.affiliatedWith), target: "Organization", cardinality: "many" },
    bears:          { direction: "outbound", predicate: predicate(BFO.bearerOf),      target: "EnergyExpertRole", cardinality: "many" },
  },
  agentContext: {
    description: "A foaf:Person bearing at least one EnergyExpertRole.",
    tools: ["expert.linksOut", "expert.linksIn", "expert.search"],
    summaryTemplate: (e) => `Expert ${e.displayName} (${e.did})`,
  },
})
```

Predicate IRIs (`EI.affiliatedWith`, `BFO.bearerOf`, …) are imported from the codegen-driven `iris.ts` as N3 `NamedNode` values, then normalized once through `.value` into the branded `PredicateIri` string used by D1 rows and relation contracts. See Section 2.3 for the predicate-registry pattern and the rule that hand-writing predicate URL strings is forbidden.

**Type-level invariants enforced (no runtime checks needed):**

1. `identity.iriOf` returns the brand — caller cannot return a plain string.
2. `render.facts[].subject` carries the entity's own IRI brand.
3. `relations[K].target` is a known tag from the registry (when registry is composed).
4. `agentContext.tools` is a subset of a known tool catalog.
5. `StorageAdapter<Def>.load` returns the entity's own schema type — passing an Expert adapter where an Organization is expected fails at the call site.

**Forward-looking patterns:**

**(A) Type-safe entity registry + tagged-union view.** Slice 2 ships this:

```ts
export const Registry = { Expert: ExpertEntity, Organization: OrganizationEntity } as const
export type Registry = typeof Registry
export type EntityTag = keyof Registry

export type AnyEntity = {
  [K in EntityTag]: Schema.Schema.Type<Registry[K]["schema"]> & { readonly _tag: K }
}[EntityTag]

export const lookup = <T extends EntityTag>(tag: T): Registry[T] => Registry[tag]
```

`AnyEntity` is the discriminated union for every cross-type code path — `linksOut` returns it, search results carry it, agent traversal walks edges by tag.

**(B) Hydrated read models composed from definition + graph.** `hydrate(tag, iri)` lives in the graph layer (so `EntityDefinition` stays free of `EntityGraphRepo` as a dependency), composes core entity + edges. When the caller already knows the tag at compile time it can skip the `lookupEntity` step; the registry-dispatched composition in Section 5.2 (`assembleEntityContext`) is the form to use when the tag is dynamic.

```ts
export const hydrate = <T extends EntityTag>(tag: T, iri: string) =>
  Effect.gen(function* () {
    const def = lookup(tag)
    const storage = yield* storageOf(tag)
    const graph = yield* EntityGraphRepo
    const core = yield* storage.load(iri as never)
    const edges = yield* graph.linksOut(iri as never, { predicates: Object.values(def.relations).map((r) => r.predicate) })
    return { ...core, _tag: tag, _edges: edges } as HydratedFor<T>
  })
```

**(C) Layer composition derived from the registry.** Adding an entity is one line in `Registry`; the merged Layer regenerates and `EntityTag` widens.

**Open questions:** `agentContext.tools` as `Schema.Literal` union vs string-literal union? `render.facts` vs `toTriples` overlap (defer to slice 3). Predicate IRI values are no longer open: generated `NamedNode` values normalize into branded `PredicateIri` strings at the ontology boundary.

## 2. Relation Graph and Storage

Three D1 tables: a minimal `entities` registry plus two edge tables keyed by stable `link_id`. Triple identity is enforced by separate `triple_hash` so re-asserting an edge on a fresh run is a deterministic upsert. Bitemporal edge rows use `effective_from/until` (valid time) + `created_at/updated_at` (transaction time).

### 2.1 D1 schema

```sql
PRAGMA foreign_keys = ON;

-- Canonical registry: "this IRI is a known entity of this type".
-- Full row data lives in per-entity storage adapters (`experts`, `organizations`, …).
CREATE TABLE IF NOT EXISTS entities (
  iri          TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (iri, entity_type)
);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS entity_links (
  link_id          TEXT PRIMARY KEY,                     -- UUIDv4 in current runtime; ULID is a future ordering policy
  triple_hash      TEXT NOT NULL,                        -- SHA-256(s|p|o|graph) in current runtime; unique only over active rows
  subject_iri      TEXT NOT NULL,
  predicate_iri    TEXT NOT NULL,
  object_iri       TEXT,                                 -- branded EntityIri OR
  object_value     TEXT,                                 -- literal datatype value
  object_datatype  TEXT,                                 -- xsd:* IRI when object_value is set
  graph_iri        TEXT NOT NULL DEFAULT 'urn:skygest:graph:default',
  subject_type     TEXT NOT NULL,                        -- 'Expert' | 'Organization' | …
  object_type      TEXT NOT NULL,                        -- same enum or 'Literal'
  state            TEXT NOT NULL DEFAULT 'active'
                     CHECK (state IN ('active','superseded','retracted','draft')),
  effective_from   INTEGER NOT NULL,                     -- ms epoch (valid time)
  effective_until  INTEGER,                              -- nullable: open-ended
  superseded_by    TEXT,                                 -- link_id of replacement
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  CHECK ((object_value IS NULL AND object_iri IS NOT NULL) OR (object_value IS NOT NULL AND object_iri IS NULL)),
  FOREIGN KEY (subject_iri, subject_type) REFERENCES entities(iri, entity_type),
  -- Nullable composite FK: skipped for literal objects because object_iri is NULL.
  FOREIGN KEY (object_iri, object_type) REFERENCES entities(iri, entity_type),
  FOREIGN KEY (superseded_by) REFERENCES entity_links(link_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_links_out
  ON entity_links(subject_iri, predicate_iri, state, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_entity_links_in
  ON entity_links(object_iri, predicate_iri, state, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_entity_links_pred_time
  ON entity_links(predicate_iri, effective_from DESC, state);
CREATE INDEX IF NOT EXISTS idx_entity_links_subject_type
  ON entity_links(subject_type, predicate_iri);
CREATE INDEX IF NOT EXISTS idx_entity_links_object_type
  ON entity_links(object_type, predicate_iri);

-- Partial unique index: only one ACTIVE row per (s, p, o, graph) triple.
-- Superseded/retracted rows preserve the audit chain by sharing the same hash as their replacement.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_links_triple_active
  ON entity_links(triple_hash) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS entity_link_evidence (
  evidence_id      TEXT PRIMARY KEY,                     -- UUIDv4 in current runtime
  link_id          TEXT NOT NULL,
  asserted_by      TEXT NOT NULL,                        -- 'agent:gemini-vision' | 'curator:human:<did>'
  assertion_kind   TEXT NOT NULL CHECK (assertion_kind IN ('extracted','curated','inferred','imported')),
  confidence       REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence_span    TEXT,                                 -- {sourceUri, charStart, charEnd, snippet, …}
  source_iri       TEXT,                                 -- post IRI / dataset IRI that justified it
  review_state     TEXT NOT NULL DEFAULT 'pending'
                     CHECK (review_state IN ('pending','accepted','rejected','superseded')),
  reviewer         TEXT,
  reviewed_at      INTEGER,
  asserted_at      INTEGER NOT NULL,
  FOREIGN KEY (link_id) REFERENCES entity_links(link_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_evidence_link_review
  ON entity_link_evidence(link_id, review_state, asserted_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_source
  ON entity_link_evidence(source_iri, asserted_at DESC);
```

`linksOut(iri)` hits `idx_entity_links_out` with a single prefix scan; `linksIn(iri)` hits `idx_entity_links_in`. Retracted/superseded rows persist; queries default-filter to `state = 'active'`.

**The `entities` table is the canonical registry of "this IRI is a known entity of this type."** It is intentionally minimal — full row data lives in per-entity storage adapters (`experts`, `organizations`, etc.). The graph layer answers topology questions (does this IRI exist? what type? what edges?); content questions dispatch through the registry to the appropriate `StorageAdapter<Def>`. This split keeps the graph layer free of per-entity column drift while making cross-type traversal cheap (every edge resolves to a typed neighbor in one lookup). See cross-cutting decision #11.

**Graph edges cannot orphan traversal.** `entity_links.subject_iri/subject_type` and `entity_links.object_iri/object_type` are backed by composite foreign keys into `entities(iri, entity_type)`. Literal objects skip the object FK because `object_iri` is `NULL`. `createLink` still validates both endpoint registry rows before insert so callers get a domain error (`EntityGraphEndpointNotFoundError` / `EntityGraphTypeMismatchError`) instead of a raw SQL constraint failure. The DB constraints are the final guardrail against older code paths or manual repair scripts creating edges that `assembleEntityContext` cannot hydrate.

**`triple_hash` is unique only over active rows (partial unique index).** Superseded and retracted rows preserve the audit chain while allowing the active replacement to reuse the same hash when the replacement describes the same triple. Re-asserting an active edge that already exists becomes a deterministic upsert via `INSERT ... ON CONFLICT(triple_hash) WHERE state = 'active' DO UPDATE`. Supersession is a three-step write: (1) insert the replacement row as `state = 'draft'` with the replacement triple hash; (2) update the old active row to `state = 'superseded'`, set `effective_until`, and set `superseded_by = replacement.link_id`; (3) update the replacement row to `state = 'active'`. The replacement exists before the old row points to it, and there is never more than one active row for the triple. In production D1 this is one `batch()` call because `@effect/sql-d1` does not support `withTransaction`; SQLite tests use a local transaction path. This unblocks the audit-chain pattern that a global `UNIQUE(triple_hash)` would have rejected.

### 2.2 EntityGraphRepo service

```ts
export class EntityGraphRepo extends ServiceMap.Service<EntityGraphRepo, {
  // Entity registry (`entities` table) — graph-layer topology answers.
  readonly upsertEntity: (iri: EntityIri, entityType: EntityTag) =>
    Effect.Effect<EntityRecord, SqlError | DbError>

  readonly lookupEntity: (iri: EntityIri) =>
    Effect.Effect<EntityRecord, SqlError | DbError | EntityNotFoundError>

  readonly listEntities: (filter?: { entityType?: EntityTag; limit?: number; cursor?: string }) =>
    Effect.Effect<{ readonly records: ReadonlyArray<EntityRecord>; readonly nextCursor?: string }, SqlError | DbError>

  // Edge / evidence operations
  readonly createLink: <P extends keyof PredicateRegistry>(input: TypedLinkInput<P>) =>
    Effect.Effect<
      EntityLink,
      | SqlError
      | DbError
      | EntityGraphLinkInvalidError
      | EntityGraphEndpointNotFoundError
      | EntityGraphTypeMismatchError
    >

  readonly recordEvidence: (linkId: LinkId, evidence: NewLinkEvidence) =>
    Effect.Effect<LinkEvidence, SqlError | DbError | EntityGraphLinkNotFoundError>

  readonly retractLink: (linkId: LinkId, reason: string) =>
    Effect.Effect<boolean, SqlError | DbError | EntityGraphLinkNotFoundError>

  readonly supersede: (oldId: LinkId, replacement: TypedLinkInput<keyof PredicateRegistry>) =>
    Effect.Effect<EntityLink, SqlError | DbError | EntityGraphLinkInvalidError | EntityGraphLinkNotFoundError>

  readonly linksOut: (subject: EntityIri, opts?: LinkQueryOpts) =>
    Effect.Effect<ReadonlyArray<EntityLinkWithEvidence>, SqlError | DbError>

  readonly linksIn: (object: EntityIri, opts?: LinkQueryOpts) =>
    Effect.Effect<ReadonlyArray<EntityLinkWithEvidence>, SqlError | DbError>

  readonly neighbors: (iri: EntityIri, predicate?: PredicateIri, opts?: LinkQueryOpts) =>
    Effect.Effect<ReadonlyArray<EntityLink>, SqlError | DbError>

  readonly traverse: (seed: EntityIri, pattern: TraversalPattern) =>
    Effect.Effect<TraversalResult, SqlError | DbError | EntityGraphTraversalLimitError>
}>()("@skygest/EntityGraphRepo") {}
```

`EntityRecord = { iri: EntityIri; entity_type: EntityTag; created_at: number; updated_at: number }`. The graph layer answers "does this IRI exist and what type is it?"; full row hydration goes through the per-entity `StorageAdapter<Def>`. `lookupEntity` raises `EntityNotFoundError` when the IRI is absent; `upsertEntity` is the only write path to the registry table and is called from each per-entity storage adapter's `save()` so the registry stays consistent with adapter-owned tables.

`LinkQueryOpts` includes `predicate`, `state`, `asOf` (temporal point query), `minConfidence`, `limit`. `TraversalPattern` carries `hops`, `maxDepth`, `maxNodes`, `asOf`.

### 2.3 Predicate-type-safety pattern

Predicates are not just IRI strings — they carry a `(subjectType, objectType)` contract. A `PredicateRegistry` baked into TS at compile time makes `createLink` reject `(Organization, ei:authoredBy, Dataset)` before it touches D1.

```ts
import type { NamedNode } from "n3"
import { BFO, EI } from "../iris"

// After the Slice 2 TTL/codegen prerequisite adds EI.mentions,
// EI.authoredBy, and EI.affiliatedWith.
const predicate = (term: NamedNode): PredicateIri => asPredicateIri(term.value)

export const PREDICATES = {
  "ei:mentions":       { iri: predicate(EI.mentions),        subject: ["Expert", "Post"],          object: ["Post", "Article", "Dataset", "Organization", "Expert"] },
  "ei:authoredBy":     { iri: predicate(EI.authoredBy),      subject: ["Post", "Article"],         object: ["Expert"] },
  "bfo:bearerOf":      { iri: predicate(BFO.bearerOf),       subject: ["Expert", "Organization"],  object: ["EnergyExpertRole", "PublisherRole"] },
  "ei:affiliatedWith": { iri: predicate(EI.affiliatedWith),  subject: ["Expert"],                  object: ["Organization"] },
} as const satisfies Record<string, PredicateSpec>

export type PredicateRegistry = typeof PREDICATES
type SubjectOf<P extends keyof PredicateRegistry> = PredicateRegistry[P]["subject"][number]
type ObjectOf<P extends keyof PredicateRegistry> = PredicateRegistry[P]["object"][number]

export type TypedLinkInput<P extends keyof PredicateRegistry> = {
  readonly predicate: P
  readonly subject: { readonly iri: EntityIri; readonly type: SubjectOf<P> }
  readonly object:  { readonly iri: EntityIri; readonly type: ObjectOf<P> }
  readonly effectiveFrom: number
  readonly evidence: NewLinkEvidence
}
```

> **The codegen-driven `iris.ts` is the single source for predicate IRIs.** Slice 2's first codegen task is to add `ei:mentions`, `ei:authoredBy`, and `ei:affiliatedWith` to the vendored TTL as `owl:ObjectProperty`, regenerate `iris.ts`, and then compile this registry. The current PR #137 generated file does not export those symbols yet, so this registry must not be implemented by hand-writing URL strings as a shortcut. Generated constants are N3 `NamedNode` values; graph contracts store branded string IRIs, so every predicate crosses the boundary through `asPredicateIri(term.value)` exactly once.

A runtime guard re-checks `subjectType ∈ subject` because TS soundness ends at decoded D1 row boundaries — older schema rows could carry obsolete combinations; `EntityGraphLinkInvalidError` makes that visible.

### 2.4 Reindex propagation hook (graph side)

```ts
export type EntityGraphChange =
  | { readonly _tag: "LinkCreated"; readonly link: EntityLink }
  | { readonly _tag: "LinkSuperseded"; readonly oldId: LinkId; readonly newLink: EntityLink }
  | { readonly _tag: "LinkRetracted"; readonly link: EntityLink }
  | { readonly _tag: "EvidenceAdded"; readonly linkId: LinkId; readonly evidence: LinkEvidence }

export class EntityGraphChangeBus extends ServiceMap.Service<EntityGraphChangeBus, {
  readonly publish: (change: EntityGraphChange) => Effect.Effect<void, never>
}>()("@skygest/EntityGraphChangeBus") {}
```

Slice 2 ships the `Layer.succeed` no-op layer. Slice 3 swaps in the queue-backed implementation (see Section 5).

**Forward-looking patterns:**

**(a) Materialized link-strength view.** `entity_link_strength` view computing `MAX(confidence)` and `COUNT(distinct asserted_by)` per `link_id`. Ranking, dedup, link-curation queues all use the same metric.

**(b) Predicate-driven access control.** Every predicate spec gains `accessTier: "public" | "internal" | "review-only"`. Repo accepts `viewerCapability` and filters at SQL time.

**(c) Bitemporal default.** `effective_from/until` is *valid time*; `created_at/updated_at` is *transaction time*. Both axes show up in brief generation and reproducibility audits.

**Tests:** `createLink` round-trip with `triple_hash` upsert behavior; TS-only `expectType` confirming type rejection; `linksOut`/`linksIn` index hits via `EXPLAIN QUERY PLAN`; `traverse` depth/node bounds; supersession audit chain; temporal `asOf` queries; evidence not-found errors; reindex `EntityGraphChangeBus.publish` invocation on every mutation.

**Open questions:** Object literals as separate `entity_link_literals` table (defer until literal fulltext is needed)? `graph_iri` partitioning — drop column if not used within 2 slices? Ordered ID/hash policy (current branch uses UUIDv4 + SHA-256; ULID + BLAKE3 can replace those behind the same branded fields if ordering or hash throughput matters).

## 3. Unified Projection Contract

`ProjectionContract<E, M, K>` is the search-backend-agnostic seam. It says: given an entity `E`, derive a stable identity (`K`), a renderable body, and a structured filter payload (`M`). Nothing in this contract names AI Search.

```ts
// packages/ontology-store/src/Domain/Projection.ts
export interface ProjectionContract<
  Self extends Schema.Top,
  Meta extends Readonly<Record<string, string | number | boolean>>,
  Key extends string = string,
> {
  readonly entityType: string
  readonly toKey: (e: Schema.Schema.Type<Self>) => Key
  readonly toBody: (e: Schema.Schema.Type<Self>) => string
  readonly toMetadata: (e: Schema.Schema.Type<Self>) => Meta
  readonly previousKeys?: (e: Schema.Schema.Type<Self>) => ReadonlyArray<Key>
}

export interface ProjectionAdapter<
  Self extends Schema.Top,
  Meta extends Readonly<Record<string, string | number | boolean>>,
> {
  readonly upsert: (e: Schema.Schema.Type<Self>) => Effect.Effect<void, ProjectionWriteError>
  readonly delete: (iri: string) => Effect.Effect<void, ProjectionWriteError>
  readonly rename: (e: Schema.Schema.Type<Self>) => Effect.Effect<void, ProjectionWriteError>
}
```

**Verified Cloudflare AI Search API status:** Custom metadata capped at 5 fields, `data_type ∈ {text, number, boolean, datetime}`, `text` ≤ 500 chars. Schema changes trigger full reindex. Reserved built-in metadata: `timestamp`, `folder`, `filename` (all derived from item key). Filter operators: `$eq, $ne, $in, $nin, $lt, $lte, $gt, $gte` — **`$or`/`$and`/`$exists` are NOT supported**; AND is implicit across keys, OR via `$in`. Items API is `upload`/`uploadAndPoll` with overwrite-on-name semantics. Search returns `chunks` containing `{ id, score, text, item: { key, timestamp, metadata } }`.

### 3.1 Unified metadata schema (the SSoT)

```ts
export const UNIFIED_METADATA_KEYS = [
  "entity_type",
  "iri",
  "topic",
  "authority",
  "time_bucket",
] as const satisfies ReadonlyArray<string>

export type EntityMetadataKey = (typeof UNIFIED_METADATA_KEYS)[number]
export type UnifiedSearchMetadata = Readonly<Record<EntityMetadataKey, string>>

// Alchemy-side declaration mechanically derived from the array:
export const aiSearchInstanceConfig = {
  custom_metadata: UNIFIED_METADATA_KEYS.map((field_name) => ({ field_name, data_type: "text" as const })),
}
```

This single `as const` array is the type-level SSoT for: each entity's `toMetadata` return type, Alchemy's `customMetadata` declaration, and the worker's runtime `env.ENERGY_INTEL_SEARCH.get("entity-search").search({ filters })` calls (namespace binding; see Section 4.2 for the rule).

### 3.2 AI Search adapter

```ts
export const makeAiSearchAdapter = <S extends Schema.Top>(
  contract: ProjectionContract<S, UnifiedSearchMetadata, `entities/${string}/${string}.md`>,
): Effect.Effect<ProjectionAdapter<S, UnifiedSearchMetadata>, never, EnergyIntelSearch> =>
  Effect.gen(function* () {
    const svc = yield* EnergyIntelSearch
    // Non-default namespace requires a namespace binding (see Section 4.2).
    // `svc.namespace` is the wrapped `env.ENERGY_INTEL_SEARCH` namespace binding.
    const inst = svc.namespace.get("entity-search")
    return {
      upsert: (e) => Effect.tryPromise({
        // Cloudflare AI Search items binding is positional:
        //   items.upload(name, content, { metadata })
        // See https://developers.cloudflare.com/ai-search/api/items/workers-binding/
        try: () => inst.items.upload(contract.toKey(e), contract.toBody(e), {
          metadata: contract.toMetadata(e),
        }),
        catch: (cause) => new ProjectionWriteError({ cause, op: "upsert" }),
      }),
      delete: (iri) => /* list-by-iri-then-items.delete */,
      rename: (e) => Effect.gen(function* () {
        for (const old of contract.previousKeys?.(e) ?? []) yield* del(old)
        yield* up(e)
      }),
    }
  })
```

Item-key folder routing (`entities/expert/<id>.md`) carries `entity_type` for free via the built-in `folder` field — frees the custom metadata slot for `time_bucket`. Two API-shape pitfalls fixed in review:

1. **Namespace binding, not instance binding.** `entity-search` lives in the non-default `energy-intel` namespace, so the only available binding form is namespace-binding plus `.get("entity-search")`. See Section 4.2.
2. **Positional `items.upload(name, content, opts)`.** The Workers binding does not accept the object-arg shape `{ name, content, metadata }`. Source: https://developers.cloudflare.com/ai-search/api/items/workers-binding/.

### 3.3 Cross-type search API

```ts
export interface EntitySearchFilter {
  readonly entity_type?: ReadonlyArray<string>
  readonly topic?: ReadonlyArray<string>
  readonly authority?: ReadonlyArray<string>
  readonly time_bucket?: ReadonlyArray<string>
  readonly iri?: ReadonlyArray<string>
}

export interface EntityResult {
  readonly entity_type: string
  readonly iri: string
  readonly summary: string  // chunk text
  readonly score: number
  readonly key: string
  readonly metadata: UnifiedSearchMetadata
}

export class EntitySearch extends ServiceMap.Service<EntitySearch, {
  readonly search: (
    query: string,
    opts?: { filter?: EntitySearchFilter; maxResults?: number; mode?: "hybrid" | "vector" | "keyword" },
  ) => Effect.Effect<ReadonlyArray<EntityResult>, EntitySearchError>
}>()("@skygest/EntitySearch") {}
```

Filter compilation: `entity_type` filtering compiles to a `folder` prefix predicate when a single type is requested, otherwise to `$in` over `entity_type`. Single-element arrays become implicit equality; multi-element become `$in`.

### 3.4 Per-entity metadata mapping

Each entity declares how its `render.facts` collapse to the 5 globals:

```ts
// Expert
export const expertProjection: ProjectionContract<typeof Expert, UnifiedSearchMetadata> = {
  entityType: "Expert",
  toKey: (e) => `entities/expert/${slugifyDid(e.did)}.md`,
  toBody: renderExpertMarkdown,
  toMetadata: (e) => ({
    entity_type: "Expert", iri: e.iri,
    topic: e.primaryTopic ?? "unknown",
    authority: e.tier ?? "unknown",          // tier collapses into authority
    time_bucket: bucketRecency(e.lastActivityAt),
  }),
  previousKeys: (e) => e.formerIris.map((p) => `entities/expert/${slugifyDid(p.did)}.md`),
}

// Organization
export const organizationProjection: ProjectionContract<typeof Organization, UnifiedSearchMetadata> = {
  entityType: "Organization",
  toKey: (o) => `entities/organization/${o.slug}.md`,
  toBody: renderOrganizationMarkdown,
  toMetadata: (o) => ({
    entity_type: "Organization", iri: o.iri,
    topic: o.primaryDomain ?? "unknown",
    authority: o.kind,                       // "lab" | "agency" | "utility" | "ngo"
    time_bucket: bucketRecency(o.lastSeenAt),
  }),
}
```

The five globals never see Expert-specific names. Each entity decides what *its* `authority` means; the global vocabulary stays uniform.

### 3.5 Reindex propagation contract (projection side)

```ts
export class ReindexPropagation extends ServiceMap.Service<ReindexPropagation, {
  readonly onEntityChanged: (iri: string) => Effect.Effect<void, ReindexError>
  readonly onEdgeChanged: (linkId: string) => Effect.Effect<void, ReindexError>  // re-renders both endpoints
  readonly onEntityRenamed: (oldIri: string, newIri: string) => Effect.Effect<void, ReindexError>
  readonly rebuildAll: (filter?: EntitySearchFilter) => Effect.Effect<RebuildSummary, ReindexError>
}>()("@skygest/ReindexPropagation") {}
```

### 3.6 Path forward when 5 fields aren't enough

Decision rules in priority order:

- **(c) Drop AI Search filtering, move to D1** — when the dimension is high-cardinality, frequently changes, or needs range queries beyond what AI Search supports.
- **(b) Composite-encoded field** — when the new dimension is low-cardinality and correlated with an existing one (e.g. `authority#region`). Acceptable for ≤ 2 levels of nesting.
- **(a) Per-type instance fanout** — last resort. Chosen when the new dimension is type-specific and would not generalize. The namespace binding already preserves this option.

### 3.7 Identity stability for IRI renames

`previousKeys` is the rename hook. The reconciliation workflow writes `formerIris` onto the entity's intrinsic state; the projection adapter's `rename` op deletes those keys before uploading the new one. AI Search has no atomic move; pattern is delete-then-upload with idempotent retries. Slice 2 picks the "absorbing" variant for supersession chains (entity-A merged into entity-B): A's `previousKeys` absorb into B.

**Forward-looking pattern: multi-backend projection pipeline.** A `composite(...adapters)` runs N adapters in parallel — AI Search for keyword/hybrid first stage, Vectorize for cosine reranking, D1 FTS as eventual-consistency recovery. One contract feeds parallel backends; the cross-type `EntitySearch` service score-merges and dedupes by `iri`.

**Open questions:** Datetime vs text for `time_bucket` (text bucketing now; `datetime` for range queries later). Per-tenant namespacing (sibling namespaces if a second tenant lands). Edge-as-projected-doc (slice 4+). Vectorize reranker (defer until measurement).

## 4. Alchemy Unification

The unification target: **one entity definition drives one deployment plan, and Alchemy materializes the Cloudflare resources from that plan.** No hand-syncing between entity TS, D1 migrations, AI Search metadata, Worker bindings, or runtime `Env` types. Verified against the local Alchemy reference checkout at `.reference/alchemy/alchemy/src/cloudflare`.

**Implementation status:** Section 4 is the next deployment slice, not current PR runtime code. This branch does not add `alchemy.run.ts`, `infra/AiSearchWithMetadata.ts`, or retire the existing Wrangler files. The slice-2 code deliberately stops at the entity, graph, projection, and runtime adapter contracts that Alchemy will consume.

### 4.1 Critical Alchemy limitation discovered

`BaseAiSearchProps` exposes `metadata?: Record<string, unknown>` (the wizard-created flag) but **NOT** the `custom_metadata` array on the user-facing prop. The wire payload has `custom_metadata: Array<{ data_type, field_name }>` (line 809 in source), but it's not exposed through Alchemy's user prop surface.

**Workaround for the Alchemy slice:** wrap `AiSearch` with `AiSearchInstanceWithMetadata` in `infra/AiSearchWithMetadata.ts` — uses Alchemy's exported `updateAiSearchInstance(api, namespace, id, payload)` helper after the parent resource resolves to PUT the `custom_metadata` declaration. Track upstream PR adding `customMetadata?` to `BaseAiSearchProps`.

### 4.2 `alchemy.run.ts` skeleton (entity-driven)

```ts
import alchemy from "alchemy"
import { AiGateway, AiSearchNamespace, D1Database, KVNamespace, R2Bucket, Worker } from "alchemy/cloudflare"
import { CloudflareStateStore } from "alchemy/state"
import { ExpertProvisioning } from "./packages/ontology-store/src/agent/expert.ts"
import { OrganizationProvisioning } from "./packages/ontology-store/src/agent/organization.ts"
import { ENTITY_METADATA_FIELDS } from "./packages/ontology-store/src/Domain/Projection.ts"
import { provisionEntity, AiSearchInstanceWithMetadata } from "./infra/provisionEntity.ts"

const ENTITY_PROVISIONING = [ExpertProvisioning, OrganizationProvisioning] as const
const STAGE = process.env.STAGE ?? "dev"

export const app = await alchemy("skygest-energy-intel", {
  stateStore: (scope) => new CloudflareStateStore(scope),
})

// Shared infra
const db = await D1Database("skygest", {
  name: STAGE === "prod" ? "skygest" : `skygest-${STAGE}`,
  adopt: true,
  migrationsDir: "./migrations",
  migrationsTable: "d1_migrations",
})
const ontologyKv = await KVNamespace("ontology-kv", { title: `ontology-kv-${STAGE}`, adopt: true })
const transcripts = await R2Bucket("transcripts", {
  name: `skygest-transcripts-${STAGE}`,
  adopt: true,
  dev: { remote: true }, // AI Search requires deployed R2 / remote binding even during alchemy dev.
})
const aiGateway = await AiGateway("energy-intel-gw", { collectLogs: true })
const searchNs = await AiSearchNamespace("energy-intel", { name: "energy-intel", adopt: true })

// Per-entity provisioning
await Promise.all(
  ENTITY_PROVISIONING.map((plan) => provisionEntity(plan, { db, namespace: searchNs, aiGateway, source: transcripts, stage: STAGE })),
)

// Unified entity-graph search instance
await AiSearchInstanceWithMetadata("entity-search", {
  name: "entity-search",
  namespace: searchNs,
  source: transcripts,
  customMetadata: ENTITY_METADATA_FIELDS,    // [{ field_name, data_type }, …] derived from UNIFIED_METADATA_KEYS
  embeddingModel: "@cf/baai/bge-m3",
  adopt: true,
})

// Workers (translated from wrangler.toml at parity)
//
// IMPORTANT: `entity-search` lives in the non-default `energy-intel` namespace.
// Cloudflare instance bindings only target the DEFAULT namespace; non-default
// namespaces must be reached via a NAMESPACE binding plus
// `env.ENERGY_INTEL_SEARCH.get("entity-search")`. There is no
// `ENTITY_SEARCH` instance binding for this design.
export const ingestWorker = await Worker("ingest", {
  bindings: {
    DB: db,
    ONTOLOGY_KV: ontologyKv,
    ENERGY_INTEL_SEARCH: searchNs,    // namespace binding only
    AI_GATEWAY: aiGateway,
    /* … */
  },
})
export const resolverWorker = await Worker("resolver", { /* … */ })
export const agentWorker = await Worker("agent", {
  bindings: {
    DB: db,
    ONTOLOGY_KV: ontologyKv,
    ENERGY_INTEL_SEARCH: searchNs,    // namespace binding only
    AI_GATEWAY: aiGateway,
    INGEST_SERVICE: ingestWorker,
    RESOLVER: resolverWorker,
  },
})
// Worker accesses the instance via `env.ENERGY_INTEL_SEARCH.get("entity-search")`.
export type AgentEnv = typeof agentWorker.Env

await app.finalize()
```

Cloudflare distinguishes instance bindings (which target only the default namespace) from namespace bindings (which work for any namespace including non-default ones). Because `entity-search` lives in the non-default `energy-intel` namespace, the worker MUST use a namespace binding. There is no instance binding for `entity-search`.

Alchemy's AI Search resources are always remote in local development. `alchemy dev` emits `wrangler.json` with remote AI Search bindings, and an AI Search instance backed by R2 rejects a local-only bucket. Any R2 bucket used as an AI Search source therefore needs `dev: { remote: true }`. That is part of the "just works" contract: local Worker code can run, but the search namespace, instance, and source bucket are real Cloudflare resources.

### 4.3 `provisionEntity()` — aggregation, not Resource

```ts
export interface EntityProvisioningPlan<Def extends EntityDefinition<any, any, any, any>> {
  readonly definition: Def
  readonly storage?: {
    readonly tableMode: "shared" | "dedicated"
    readonly databaseName?: (ctx: ProvisionEntityCtx, def: Def) => string
  }
  readonly projections: ReadonlyArray<ProjectionContract<Def["schema"], EntityMetadata>>
  readonly fixtures: ReadonlyArray<ProjectionFixture<Def["schema"]>>
}

export async function provisionEntity<Def extends EntityDefinition<any, any, any, any>>(
  plan: EntityProvisioningPlan<Def>,
  ctx: ProvisionEntityCtx,
): Promise<ProvisionedEntity<Def>> {
  const def = plan.definition
  // Optional per-entity row DB (slice 4+ for measurement entities).
  // This policy lives on the provisioning plan, not on EntityDefinition.
  const perEntityRowDb = plan.storage?.tableMode === "dedicated"
    ? await D1Database(`${def.tag}-rows`, {
        name: plan.storage.databaseName?.(ctx, def) ?? `skygest-${def.tag}-${ctx.stage}`,
        adopt: true,
      })
    : undefined
  return { definition: def, perEntityRowDb, projections: plan.projections }
}
```

`provisionEntity` is an aggregation: it composes existing Alchemy primitives from a separate `EntityProvisioningPlan`. Wrapping it as a Resource would force Alchemy to track a synthetic state row with no remote counterpart. The aggregation pattern leaves each contribution as a first-class Alchemy resource, and `EntityDefinition` remains a pure ontology/entity contract with no storage or deployment policy fields.

The single AI Search instance is provisioned **outside** the per-entity loop because the metadata fields are a static union of all entities' declared fields (validated at compile time).

### 4.4 State backend: `CloudflareStateStore`

Recommended over file or S3 stores:
1. CI safety guard — Alchemy throws when `process.env.CI` is set and `stateStore` is undefined.
2. No new vendor (S3 needs AWS creds; we're Cloudflare-only).
3. DO state store handles the small per-entity state row count (~30 rows even at slice 5 with 13 entities).

### 4.5 Type-safety chain

The chain anchors on `ENTITY_METADATA_FIELDS` reused in three places:

```ts
// SSoT
export const ENTITY_METADATA_FIELDS = [
  { field_name: "entity_type", data_type: "text" },
  { field_name: "iri", data_type: "text" },
  { field_name: "topic", data_type: "text" },
  { field_name: "authority", data_type: "text" },
  { field_name: "time_bucket", data_type: "text" },
] as const satisfies ReadonlyArray<{ field_name: string; data_type: "text" | "number" | "boolean" }>

export type EntityMetadataKey = typeof ENTITY_METADATA_FIELDS[number]["field_name"]
export type EntityMetadata = Readonly<Record<EntityMetadataKey, string>>

// alchemy.run.ts → customMetadata: ENTITY_METADATA_FIELDS
// Each entity's projection.toMetadata returns EntityMetadata
// Worker runtime: env.ENERGY_INTEL_SEARCH.get("entity-search").search({ filters }) accepts Partial<EntityMetadata>
```

A 6th field is a TS error in every projection's return type AND every search-call type-arg. Add/remove is a compile-time event, not a deploy-time event.

### 4.6 Drift detection

If entity A declares `topic` and entity B declares `theme`, both their `toMetadata` must satisfy `EntityMetadata`. They can't — `EntityMetadata` carries the global key set. TS rejects before `bun run typecheck` finishes. For runtime drift (someone bypasses the type system), `provisionEntity` runs an assertion pass before calling Alchemy.

The check operates on `(projection, fixture)` pairs — `toMetadata` lives on the **projection contract**, not the entity definition, and entity definitions stay free of testing concerns. Each entity module exports a `<Entity>ProjectionFixture` value following the precedent set in PR #137 (`tests/fixtures/expert.fixture.ts`). `alchemy.run.ts` collects them and passes the array to the assertion:

```ts
export interface ProjectionFixture<Self extends Schema.Top> {
  readonly entityType: string
  readonly fixture: Schema.Schema.Type<Self>
  readonly projection: ProjectionContract<Self, UnifiedSearchMetadata>
}

function assertNoMetadataDrift(fixtures: ReadonlyArray<ProjectionFixture<any>>) {
  const declared = new Set(ENTITY_METADATA_FIELDS.map((f) => f.field_name))
  for (const f of fixtures) {
    const sample = f.projection.toMetadata(f.fixture)
    const keys = new Set(Object.keys(sample))
    if (![...keys].every((k) => declared.has(k))) {
      throw new Error(
        `Projection ${f.entityType} emits metadata field not in ENTITY_METADATA_FIELDS: ` +
        [...keys].filter((k) => !declared.has(k)).join(", ")
      )
    }
  }
}
```

Runs at module load before `app.finalize()` — deploy aborts before any Cloudflare API call. `EntityDefinition` does NOT carry `exampleInstance` or `toMetadata`; both belong to the test fixture and the projection respectively.

### 4.7 CI flow

```yaml
- run: bun install
- run: bun run typecheck            # catches metadata drift at type level
- run: bun run test
- run: bun run build
- run: bunx alchemy deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    ALCHEMY_PASSWORD: ${{ secrets.ALCHEMY_PASSWORD }}
    ALCHEMY_STATE_TOKEN: ${{ secrets.ALCHEMY_STATE_TOKEN }}
    STAGE: staging
```

Order is implicit via Alchemy's dependency graph: `D1Database` → `AiSearchInstanceWithMetadata` → `Worker`. D1 migrations apply during `D1Database` resource resolution; by the time the worker deploys, the schema is in place.

### 4.8 Wrangler retirement (verified against local Alchemy source)

Alchemy emits `wrangler.json` for `wrangler types` codegen + Miniflare local dev. The 3 `wrangler*.toml` files retire after parity. `bunx alchemy dev` boots Miniflare with the same binding graph as `alchemy deploy`, with remote proxies for products that are not Miniflare-native (including AI Search).

Local Alchemy source shows Worker Durable Object migrations are first-class enough for this cutover: `DurableObjectNamespace(..., { sqlite: true })` feeds `new_sqlite_classes`, deleted bindings feed `deleted_classes`, renamed classes feed `renamed_classes`, and Alchemy stores/reuses migration tags. The cutover still needs an `adopt: true` deploy, but not because DO migration history is absent; it is the normal path for taking over existing Worker resources and preserving their migration tag.

**Forward-looking pattern: blue-green AI Search instance swaps.** When metadata schema changes (unavoidable over a multi-quarter horizon), AI Search instances cannot mutate `custom_metadata` in place — adding a field requires reindex. Pattern: name with version suffix (`entity-search-v2`), provision alongside, dual-write during cutover, flip the worker binding in one `alchemy deploy`. Both instances live in the same namespace; the namespace-binding is a one-line worker change. Slice 2 adopts the schema-version naming convention from day one.

**Open questions / Alchemy gaps:**
1. `custom_metadata` not in user props (workaround in slice 2; track upstream PR).
2. AI Search local dev is remote-backed; preview environments need deployed namespace/instance/source resources.
3. Cron triggers per-stage: pattern `crons: STAGE === "prod" ? [...] : []`.
4. Service bindings between workers in one `alchemy.run.ts`: confirmed working.

## 5. Workflow Services and Agent Surface

Workflow services are short-lived `Effect` programs composed by an LLM call — NOT Cloudflare Workflows or a homebrew state machine. Each lives behind a `ServiceMap.Service` with a `Layer.effect` constructor pulling lower layers from context. Long-lived flows (multi-day reconciliation review) are modeled as state in `entity_links` + `entity_link_evidence` rows; the agent re-enters at any time and acts on the durable state.

### 5.1 Service interfaces

```ts
export class EntityContextService extends ServiceMap.Service<EntityContextService, {
  readonly assemble: (iri: EntityIri, opts?: AssembleOptions) =>
    Effect.Effect<EntityContext, EntityNotFoundError | DbError>
}>()("EntityContextService") {}

export class EntityLinkingService extends ServiceMap.Service<EntityLinkingService, {
  readonly linkPostToEntities: (input: LinkPostInput) =>
    Effect.Effect<WorkflowResult<EntityLink>, LinkingError | DbError>
  readonly reviewLink: (input: ReviewLinkInput) =>
    Effect.Effect<EntityLink, LinkNotFoundError | DbError>
}>()("EntityLinkingService") {}

export class ReindexQueueService extends ServiceMap.Service<ReindexQueueService, {
  readonly schedule: (req: ReindexRequest) => Effect.Effect<void, never>
  readonly drain: (batch: ReadonlyArray<EnqueuedReindex>) =>
    Effect.Effect<ReindexBatchResult, ReindexError>
}>()("ReindexQueueService") {}
```

These names avoid baking the entity catalog into service identities — the same `EntityLinkingService` handles `Post → Expert`, `Post → Chart`, and future `Brief → EnergyProject` because entity types are carried in input, not service identity.

### 5.2 Worked workflow: `assembleEntityContext`

The smallest realistic example — graph traversal + per-entity render. The hydration is **two-step**: the graph layer answers topology ("what type is this IRI?") via `lookupEntity`, then the per-entity `StorageAdapter<Def>` answers content ("give me the full row"). This split keeps the graph layer free of per-entity column drift; see Section 2.1 (entities table) and cross-cutting decision #11.

```ts
export const assembleEntityContext = (iri: EntityIri, depth = 1) =>
  Effect.gen(function* () {
    const registry = yield* EntityRegistry
    const graph = yield* EntityGraphRepo
    const projection = yield* AgentContextProjection

    const record = yield* graph.lookupEntity(iri)              // (iri, entity_type) — graph layer
    const definition = yield* registry.getDefinition(record.entity_type)
    const storage = yield* registry.getStorageAdapter(record.entity_type)
    const entity = yield* storage.load(iri)                    // full row — adapter dispatch

    const linksOut = yield* graph.linksOut(iri, { acceptedOnly: true })
    const linksIn = yield* graph.linksIn(iri, { acceptedOnly: true })

    const neighborIris = [...linksOut, ...linksIn].map((l) => l.other_iri)
    const neighbors = depth > 0
      ? yield* Effect.forEach(neighborIris, (n) =>
          Effect.gen(function* () {
            const nRec = yield* graph.lookupEntity(n)
            const nStorage = yield* registry.getStorageAdapter(nRec.entity_type)
            return yield* nStorage.load(n)
          }), { concurrency: 8 })
      : []

    return yield* projection.render({ entity, definition, linksOut, linksIn, neighbors })
  })
```

Every primitive is a slice 2 capability; slice 3 wraps this in `EntityContextService.assemble` and exposes it as an `assemble_context` MCP tool. There is no `getEntity` on `EntityGraphRepo` — the registry-dispatched composition above replaces it.

### 5.3 Agent-tool exposure: per-entity gating + MCP generation

`EntityDefinition.agentContext.tools: ReadonlyArray<ToolName>` enumerates tool *types* exposed for that entity. Runtime materializes them into entity-discriminated names plus cross-type generics:

- `search_experts` — entity-scoped, gated by `Expert.agentContext.tools`
- `search_organizations` — entity-scoped
- `search_entities` — cross-type, always present
- `get_expert / get_chart` — entity-scoped
- `links_out / links_in` — cross-type primitives, type-discriminated payloads

A `buildEntityToolkit(definitions, options)` helper iterates registered definitions, reads each `agentContext.tools`, emits `Tool.make(...)` instances calling underlying services. JSON Schema is auto-derived from the `Schema.Struct` input definitions.

### 5.4 Reindex propagation runtime — the sharp edge

Three change classes each declare their fanout:

| Change | Initial fanout | Bounded depth |
|---|---|---|
| Entity intrinsic field (`Expert.bio`) | `[entity.iri]` | depth 0 |
| Edge create/accept/supersede | `[link.subject_iri, link.object_iri]` | depth 1 |
| Related entity summary-affecting field (`Expert.tier`) | `[entity.iri, ...linksIn(entity).map((l) => l.subject_iri)]` | depth 1 |

`ReindexRequest` carries `originIri`, `propagationDepth: number`, and `cause: ReindexCause`. **Depth budget is a hard stop:** `propagationDepth >= 2` is rejected at `schedule()` time. Slice 2 ships only depth 0 and depth 1; "transitive summary refresh" is opt-in per `EntityDefinition.render.summaryDependsOnNeighbors: boolean` (default false).

**Idempotency** comes from a coalescing key `${entity_type}:${iri}:${batch_window_ms}`. The earlier draft of this section called for a `Ref<HashSet<CoalesceKey>>` in front of the queue, but that only dedups within a single isolate — cross-isolate, cross-restart, cross-consumer-worker dedup needs durable state. The substrate decision below moves dedup into the queue table itself so coalescing survives isolate eviction.

**Substrate (RESOLVED — was open question #1):** cron'd D1-backed `reindex_queue` table. A cron'd consumer worker drains in batches. This decision pairs with the durability requirement above: coalescing lives in D1 as an UPSERT merge on a unique `(coalesce_key)` index. Coalescing is durable across isolates, restarts, and worker swaps because the dedup state IS the queue state. Cloudflare Queues are the alternative for high-fanout durable messaging but require a binding + consumer worker AND a separate dedup mechanism (DO or D1 lookup). For slice 2's expected workload (~10² reindex events per hour), D1 is sufficient and aligned with the "AI Search projection is one of many" framing. The `ReindexQueueService` interface is identical either way; impl is swappable without touching call sites.

```sql
CREATE TABLE IF NOT EXISTS reindex_queue (
  queue_id           TEXT PRIMARY KEY,                              -- UUIDv4 in current runtime
  coalesce_key       TEXT NOT NULL,                                 -- entity_type:iri:batch_window_ms
  target_entity_type TEXT NOT NULL,
  target_iri         TEXT NOT NULL,
  origin_iri         TEXT NOT NULL,
  cause              TEXT NOT NULL CHECK (cause IN ('entity-changed','edge-changed','entity-renamed','rebuild-all')),
  cause_priority     INTEGER NOT NULL DEFAULT 0,
  propagation_depth  INTEGER NOT NULL CHECK (propagation_depth >= 0),
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    INTEGER NOT NULL,
  enqueued_at        INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reindex_queue_coalesce
  ON reindex_queue(coalesce_key);
CREATE INDEX IF NOT EXISTS idx_reindex_queue_next
  ON reindex_queue(next_attempt_at) WHERE attempts < 3;
```

The `idx_reindex_queue_coalesce` UNIQUE index makes conflict-merge UPSERT the natural dedup path:

```sql
INSERT INTO reindex_queue (...)
VALUES (...)
ON CONFLICT(coalesce_key) DO UPDATE SET
  propagation_depth = max(reindex_queue.propagation_depth, excluded.propagation_depth),
  cause_priority = max(reindex_queue.cause_priority, excluded.cause_priority),
  cause = CASE
    WHEN excluded.cause_priority >= reindex_queue.cause_priority THEN excluded.cause
    ELSE reindex_queue.cause
  END,
  next_attempt_at = min(reindex_queue.next_attempt_at, excluded.next_attempt_at),
  attempts = 0,
  updated_at = excluded.updated_at;
```

That means a later depth-1 edge-change request can strengthen an earlier depth-0 entity-change request in the same coalescing window; the queue never silently keeps weaker work just because it arrived first. The `idx_reindex_queue_next` partial index is the consumer's drain query. After a successful render-and-upload, the row is deleted; on failure, `attempts++` and `next_attempt_at = now + backoff`. After 3 failed attempts, the row is moved to `reindex_queue_dlq` for inspection. Section 4.2's Alchemy provisioning therefore does NOT include a Cloudflare Queue resource — slice 2 ships only D1 + cron'd worker.

**Failure mode:** single render failure must not poison the batch. Drain effect uses `Effect.forEach(items, (item) => Effect.either(renderOne(item)), { concurrency: 4 })`; outcomes partition into `{ rendered, failed }`; failed set re-enqueues with attempt counter capped at 3.

### 5.5 Layer composition delta

```ts
// src/edge/Layer.ts (delta)
const entityRegistryLayer = EntityRegistry.layer.pipe(Layer.provideMerge(baseLayer))
const entityGraphRepoLayer = EntityGraphRepoD1.layer.pipe(Layer.provideMerge(baseLayer))
const reindexQueueLayer = ReindexQueueService.layer.pipe(Layer.provideMerge(Layer.mergeAll(baseLayer, configLayer)))
const entityContextServiceLayer = EntityContextService.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(entityRegistryLayer, entityGraphRepoLayer, agentContextProjectionLayer))
)
```

Layers merge into `queryLayer` (read-side) and `adminLayer` (write-side). One service gets one layer; the entity registry handles per-entity dispatch internally — adding `EnergyProject` later does not change `Layer.ts`.

### 5.6 Type-safe workflow inputs at the boundary

The MCP/HTTP boundary calls `Schema.decodeUnknownEffect(WorkflowInput)(rawJson)` before invoking the service. Workflow input schemas live in `src/domain/workflows.ts` keyed by tool name; service signature consumes the validated `Type`. Decode failure becomes `McpToolQueryError` with the formatted Schema parse error.

### 5.7 Evaluation hooks

Slice 2 emits structured telemetry (no instrumentation backend yet) via thin `WorkflowTelemetry`:

```ts
yield* telemetry.emit({
  event: "search_entities.result",
  query, resultCount: hits.length,
  topResultIri: hits[0]?.iri, latencyMs,
})
```

Events: `search_entities.result`, `link_disambiguation.outcome`, `traversal.completed`, `reindex.fanout`, `link_review.transition`. Backend is `Logging` for now; swappable to fixture-replay sink for the eval harness without touching call sites.

### 5.8 Partial-success failure model

`WorkflowResult<T>` is a tagged schema:

```ts
export class WorkflowResult<T> extends Schema.Class<WorkflowResult<T>>("WorkflowResult")({
  successes: Schema.Array(T),
  failures: Schema.Array(Schema.Struct({ target: Schema.String, error: ErrorSummary, recoverable: Schema.Boolean })),
  summary: Schema.Struct({ total: Schema.Number, succeeded: Schema.Number }),
}) {}
```

Inside the workflow, `Effect.partition` keeps partial successes durable when half the entities fail. Whole-workflow failures (DB down, registry corrupt) remain typed `Effect` errors — `WorkflowResult` is for per-target outcomes only.

**Forward-looking pattern: link-review state machine via `Effect.gen` + durable state.** The `candidate → accepted → rejected → superseded` lifecycle is a pure function over `entity_link_evidence` rows. Each transition is one `Effect.gen`: read current state, validate transition against an allowed-transitions `Map<FromState, Set<ToState>>` constant, write new evidence row with `reviewer/decided_at/supersedes_link_id`, schedule reindex. Composes naturally with future versioning — bump the constant, leave storage alone, typed transition function rejects invalid transitions at the boundary. Same pattern handles entity reconciliation merges later.

**Open questions:** `summaryDependsOnNeighbors` as a coarse on/off flag (finer per-edge-kind dependency declaration ships in slice 4+). Tool naming convention for non-noun entities. Workflow trace persistence for replay/audit (deferred). (Reindex queue substrate is no longer open — Section 5.4 picks cron'd D1-backed queue; see cross-cutting decision #12.)

## Cross-cutting decisions

The 5 sections converge on a small set of architectural commitments:

1. **`UNIFIED_METADATA_KEYS` / `ENTITY_METADATA_FIELDS` is the type-level SSoT.** One `as const` array drives entity projections, Alchemy provisioning, and runtime search calls. Adding/removing a metadata field is a TS error.

2. **Adapters close over definitions, never live on them.** `EntityDefinition` is a pure value of contract slots; `StorageAdapter`, `ProjectionAdapter`, `ProvisionedEntity` all take a definition by reference.

3. **Hydration is a graph-layer service, not part of `EntityDefinition`.** `hydrate(tag, iri)` lives in the entity-graph package with `EntityGraphRepo` as a dependency. Entity definitions stay pure values.

4. **`PredicateRegistry` is a compile-time TS const fed by codegen.** Type-safe `createLink` is enforced at the call site; a runtime guard catches drift from older D1 row schemas. Predicate values come from generated `NamedNode`s and enter the graph as branded `PredicateIri` strings via `asPredicateIri(term.value)`.

5. **`render.facts` ≠ `search.metadata`.** `render.facts` is the durable structured ontology claim set tied to the entity's IRI brand. `search.metadata` is the 5-field AI Search filter payload. The metadata cap does not shrink the ontology model.

6. **Single AI Search instance under `energy-intel` namespace; namespace-binding.** Cross-instance fanout stays available for future per-type splits without touching contracts.

7. **Item-key folder routing carries `entity_type` for free.** `entities/<type>/<id>.md` paths populate the AI Search built-in `folder` field, freeing a custom metadata slot for `time_bucket`.

8. **Reindex is a service-mediated queue, not inline.** `ReindexQueueService.schedule(req)` is the only write path to projections. Bounded propagation depth (max 1 in slice 2). Coalescing window of 30s for idempotency.

9. **Workflows are short-lived `Effect` programs over durable state.** No workflow runtime, no homebrew state machine. Long-lived flows live in `entity_links` + `entity_link_evidence` rows; agents re-enter the durable state.

10. **Two-table edge model with bitemporal default.** `entity_links` (canonical edge with UUIDv4 `link_id` + SHA-256 `triple_hash`, `state` + `effective_from/until` + `superseded_by`) plus `entity_link_evidence` (provenance, confidence, review state, joined by `link_id`). `triple_hash` is unique only over `state = 'active'` rows (partial unique index) so supersession can preserve the audit chain; re-asserting an active edge is an upsert; supersession is a three-step write (insert draft replacement → mark old `superseded` with `superseded_by` → activate replacement), executed with D1 `batch()` in production.

11. **`entities` table is the canonical entity registry.** A minimal `(iri, entity_type, created_at, updated_at)` table answers graph-layer topology questions ("does this IRI exist? what type?"). Full row data lives in per-entity `StorageAdapter<Def>` tables (`experts`, `organizations`, …). `entity_links` carries composite FKs back to this registry so graph traversal cannot point at unregistered or mistyped neighbors. `EntityGraphRepo.lookupEntity` returns the registry row; content hydration dispatches through `EntityRegistry.getStorageAdapter(type)`. `getEntity` does NOT exist on `EntityGraphRepo` — the registry-dispatched two-step composition replaces it. This split keeps the graph layer free of per-entity column drift while making cross-type traversal cheap.

12. **Reindex substrate is cron'd D1-backed queue, not Cloudflare Queue.** A `reindex_queue` table with a UNIQUE `(coalesce_key)` index makes UPSERT merge the durable coalescing path. A cron'd consumer worker drains by `next_attempt_at`. Coalescing survives isolate eviction, restarts, and worker swaps because the dedup state IS the queue state. Later requests strengthen queued work by maxing propagation depth and cause priority; first writer does not win by accident. Cloudflare Queues remain the right tool when fanout outgrows D1 throughput, but slice 2 does not provision a Queue resource. Resolves prior open question #1.

13. **Alchemy is the Cloudflare deployment boundary for the next slice.** Entity provisioning plans will produce first-class Alchemy resources: D1 databases/migrations, AI Search namespace + instance, R2/KV resources, Worker bindings, cron triggers, and typed `typeof worker.Env`. AI Search is remote-backed in local dev, so `alchemy dev` still depends on deployed AI Search/R2 resources when that slice lands. This PR defines the contracts that deployment code will consume; it does not add `alchemy.run.ts`.

## Slice 2 scope (locked)

Ships:
- `EntityDefinition` core contract (Section 1) + `defineEntity` builder + tagged-union `AnyEntity` registry view
- TTL/codegen update for graph predicates (`ei:mentions`, `ei:authoredBy`, `ei:affiliatedWith`) before compiling `PredicateRegistry`; generated `NamedNode` values normalize into branded `PredicateIri` strings
- `EntityGraphRepo` over D1 with the three-table schema (Section 2): `entities` registry, `entity_links`, `entity_link_evidence` + composite registry FKs + partial unique index on `triple_hash WHERE state = 'active'` + `lookupEntity` / `upsertEntity` / `listEntities` / `linksOut` / `linksIn` / `neighbors` / `traverse` + typed `createLink` + D1 `batch()` supersession
- `ProjectionContract<E, M, K>` + AI Search adapter (positional `items.upload`, namespace-binding access, retry/backoff/timeout) + `EntitySearch` cross-type service (Section 3) + metadata field contract for the unified `entity-search` instance
- `Expert` and `Organization` entity definitions in the new shape (Section 1) — Organization proves multi-entity composition; per-entity `*ProjectionFixture` exports for the drift check
- `EntityRegistry` Effect Service + Layer wiring (Section 5)
- `EntityGraphChangeBus` no-op layer in slice 2; `ReindexQueueService` contract with bounded-depth scheduling
- `reindex_queue` D1 table + cron'd consumer worker contract with UPSERT merge coalescing (decision #12); slice 2 ships the schema + service interface, slice 3 ships the consumer body

Deferred:
- Alchemy implementation (Section 4): `EntityProvisioningPlan` + `provisionEntity()` + `AiSearchInstanceWithMetadata` wrapper + entity-driven `alchemy.run.ts` + Wrangler retirement (with `adopt:true` cutover); this PR documents the target but does not add those files
- Post → Entity linking workflow with LLM disambiguation (slice 3)
- Reindex propagation runtime (slice 3) — the consumer body that drains `reindex_queue` and calls per-entity projections; slice 2 ships only the table + service contract
- Link review state machine (slice 4 — depends on a real reviewer UI surface)
- Entity reconciliation (slice 4 — depends on rename + supersession primitives that slice 2 establishes)
- Temporal queries beyond `asOf` point queries (slice 4+)
- Evaluation/audit harness (slice N+ — the hooks ship in slice 2)
- Per-type AI Search instance fanout (defer until 5-field cap forces it)
- Vectorize / D1 FTS multi-backend projection (defer until measured demand)

Out of scope entirely:
- Migration of `ExpertPollCoordinator` DO, ingest workflow, agent feed, or any production paths to the new types — strangler PRs per call site.
- Deletion of `src/resolution/` and `src/search/` — happens once all entities migrate.

## Open questions consolidated

The agents flagged questions slice 2 had to resolve before the runtime foundation landed. The review revisions resolved the substrate, hydration, predicate, and Alchemy cutover questions:

1. ~~**Reindex substrate** — Cloudflare Queue vs cron'd D1 polling. [Section 5]~~ **RESOLVED 2026-04-28:** cron'd D1-backed `reindex_queue` with UPSERT merge coalescing. See cross-cutting decision #12 and Section 5.4.
2. ~~**Predicate IRIs as a brand** — codegen-emitted `PredicateIri` brand vs plain string. [Section 1]~~ **RESOLVED 2026-04-28:** generated `NamedNode` values normalize into branded `PredicateIri` strings via `.value`; graph rows store strings.
3. **`graph_iri` column** — keep for future named-graph use or drop until needed. [Section 2]
4. **Object literals separate table** — `entity_link_literals` for fulltext-on-literals path. [Section 2]
5. ~~**Hydration ownership** — graph layer vs `EntityDefinition`.~~ **RESOLVED 2026-04-28:** registry-dispatched two-step. Graph layer (`EntityGraphRepo.lookupEntity`) answers topology; per-entity `StorageAdapter<Def>` answers content. See cross-cutting decision #11 and Sections 2.1–2.2 + 5.2.
6. ~~**DO migration tag history under Alchemy adopt.** [Section 4]~~ **RESOLVED 2026-04-28:** local Alchemy source computes DO migrations and migration tags; `adopt:true` remains the takeover path, not a missing-feature workaround.
7. **Datetime vs text for `time_bucket`** — text bucketing now; datetime + range when needed. [Section 3]

The remaining items are intentionally deferred design decisions, not blockers for this runtime foundation.
