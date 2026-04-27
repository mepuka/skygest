# Energy-Intel Ontology Adoption: Expert Vertical Slice

**Status:** Design locked 2026-04-27. Implementation pending.
**Scope:** One PR. ~1 week. Vertical slice on `Expert` to validate the entity-first abstraction before scaling.

## Goal

Adopt the `energy-intel` ontology in `packages/ontology-store/` end-to-end on a single entity — `Expert`. Prove the abstraction shape (Effect schema + branded IRI + RDF mapping + SHACL + AI Search projection, all co-located per entity) before mass-migrating other classes.

## Decisions

Four locked-in choices from the brainstorm:

1. **Hand-roll Effect schemas now; codegen later.** Effect 4 ships native bidirectional codegen (`SchemaRepresentation.fromJsonSchemaDocument`, `toCodeDocument`) — see `.reference/effect/packages/effect/src/SchemaRepresentation.ts`. We use it once the slice validates the target shape. No quicktype dependency.
2. **Ontology-first, then Alchemy.** The domain model shape may change Alchemy resource configuration, so we lock the model first.
3. **Consolidate, do not duplicate.** `packages/ontology-store/` becomes the energy-intel home. The DCAT-only EmitSpec content is trimmed; the package keeps its name, structure, and N3.js + SHACL machinery.
4. **Vertical slice, not breadth.** One entity (`Expert`) end-to-end. Other entities follow the same recipe.

## Slice Definition

**In scope (one PR):**

- `packages/ontology-store/` consolidates onto energy-intel. DCAT-specific machinery trimmed. Package skeleton, scripts, shapes, tests preserved.
- Hand-written `Expert` Effect schema in `packages/ontology-store/src/generated/agent.ts`.
- Branded IRI types: `ExpertIri`, `EnergyExpertRoleIri`, `OrganizationIri`. Namespace constants in `src/iris.ts`.
- SHACL shape `shapes/expert.ttl` with `sh:targetClass`, `sh:nodeKind sh:IRI`, IRI pattern, `foaf:name` minCount, role-bearer constraint, `sh:message` per constraint.
- Six-phase round-trip test on `Expert`: load → emit → SHACL → reparse → distill → parity.
- AI Search projection contract: `toKey`, `toBody`, `toMetadata` co-located with the schema.
- One read path migrates: `ExpertRepo.byDidEnergyIntel` returns the new `Expert`. Production paths stay on legacy.
- Demo script `scripts/demo-expert-aisearch.ts` that prints projection output for a real `Expert`.

**Out of scope (deferred to follow-up PRs):**

- TTL → JSON Schema → Effect codegen step (slice ships hand-written; codegen lands once the target shape is proven).
- Other entities: `Organization`, `EnergyProject`, `Article`, `Post`, role classes as first-class entities.
- Alchemy migration — provisions AI Search instances, declares per-instance metadata schemas.
- Migrating `ExpertPollCoordinator`, ingest workflow, agent feed to the new `Expert`.
- Deleting `src/resolution/` and `src/search/`.
- Deleting legacy `Expert`.
- BFO role first-class modeling. The slice flattens `roles: ReadonlyArray<EnergyExpertRoleIri>` in TS and re-expands into BFO inherence triples on emit.

## Codegen Pipeline (Future PR Target)

Pipeline runs at build time. Output commits to git. Full pipeline:

```
energy-intel/modules/agent.ttl
  ├─[1] bun script: parse with n3.js, walk pre-reasoned graph, emit JSON Schema 2020-12
  ├─[2] Effect SchemaRepresentation.fromJsonSchemaDocument(json) → Schema AST
  ├─[3] AST post-processor: substitute Schema.String → branded IRI for ei:* IRIs;
  │     fold owl:equivalentClass restrictions into Schema.Class
  ├─[4] Effect SchemaRepresentation.toCodeDocument(ast) → TS source per topologicalSort
  └─[5] prettier + write packages/ontology-store/src/generated/agent.ts
```

CI checks the committed file matches what the script produces (drift gate).

For the slice, step 1 ships hand-written. Step 2–5 land once the target shape passes review.

## Schema Shape

```ts
import { Schema } from "effect"

export const ExpertIri = Schema.String.pipe(
  Schema.pattern(/^https:\/\/w3id\.org\/energy-intel\/expert\/[A-Za-z0-9_-]+$/),
  Schema.brand("ExpertIri"),
)
export type ExpertIri = typeof ExpertIri.Type

// Sibling IRI brands: EnergyExpertRoleIri, OrganizationIri (same shape pattern).

export class Expert extends Schema.Class<Expert>("Expert")({
  iri: ExpertIri,
  did: Did,                                          // existing brand from src/domain/
  displayName: Schema.String,
  roles: Schema.NonEmptyArray(EnergyExpertRoleIri),  // flattened BFO inherence
  affiliations: Schema.optional(Schema.Array(OrganizationIri)),
  bio: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),              // ranking signal — kept for AI Search metadata
  primaryTopic: Schema.optional(Schema.String),      // ranking signal — kept for AI Search metadata
}) {}
```

## RDF Mapping

Per-entity forward and reverse functions co-locate with the schema. No JSON spec interpreter, no runtime walker. The SKY-362 EmitSpec pattern simplifies to typed TS code per generated module.

**Forward** (`expertToTriples`): re-expands the flattened TS shape into BFO inherence triples — for each role IRI, emit `(role, rdf:type, ei:EnergyExpertRole)`, `(role, bfo:0000052, expert)`, `(expert, bfo:0000053, role)`. Plus standard typing (`rdf:type ei:Expert`, `rdf:type foaf:Person`), `foaf:name`, optional `ei:bio`.

**Reverse** (`expertFromTriples`): policy, not mechanical inversion. Walk the store; select `bfo:bearerOf` objects whose type is `ei:EnergyExpertRole`; ignore unrelated triples; document lossy fields. Decode through `Schema.decodeUnknownEffect(Expert)` for validation. The codegen emits a stub — the engineer fills it once.

Namespace IRIs centralize in `packages/ontology-store/src/iris.ts`: `EI.Expert`, `BFO.inheresIn`, `FOAF.name`, etc.

## SHACL Validation

`packages/ontology-store/shapes/expert.ttl` — single shape file. Constraints:

- `sh:targetClass ei:Expert`
- `sh:nodeKind sh:IRI`
- IRI matches the energy-intel pattern
- `foaf:name` minCount 1
- At least one `bfo:bearerOf` linking to a node typed `ei:EnergyExpertRole`
- `sh:message` on every constraint
- Severity `sh:Violation`

JS-side validator: `rdf-validate-shacl`. Keeps `src/` Node-free.

The six-phase round-trip test (`tests/expert-round-trip.test.ts`):

1. **Load** — fixture `Expert` decoded via `Schema.decodeUnknownEffect`
2. **Emit** — `expertToTriples` → N3 Store
3. **SHACL** — validate Store against `shapes/expert.ttl`
4. **Reparse** — serialize to Turtle, parse back with explicit `format: "Turtle"`
5. **Distill** — `expertFromTriples` reconstructs `Expert`
6. **Parity** — assert deep-equal against original

Failures pin to a phase.

## AI Search Projection (Entity-First)

Each ontology entity owns its full AI Search contract. The projection is a property of the entity, not an external adapter.

**Per-entity contract:**

```ts
export interface AiSearchProjection<E> {
  readonly toKey: (e: E) => string
  readonly toBody: (e: E) => string
  readonly toMetadata: (e: E) => InstanceMetadata
}

export const ExpertProjection: AiSearchProjection<Expert> = {
  toKey: (e) => `expert/${e.did}.md`,
  toBody: (e) => renderExpertMarkdown(e),
  toMetadata: (e) => ({
    entity_type: "Expert",
    did: e.did,
    iri: e.iri,
    tier: e.tier ?? "unknown",
    topic: e.primaryTopic ?? "unknown",
  }),
}
```

**Cloudflare AI Search constraints (verified 2026-04-27):**

- One file per entity is the idiomatic shape. JSONL is not first-class.
- Custom metadata: max 5 fields per instance, declared at instance creation, max 500 chars per text value.
- Native plain-text formats kept as-is (`.md`, `.json`, `.yaml`, `.txt`, `.html`).
- Hybrid search (vector + BM25, RRF or max fusion) added 2026-04-16.
- Cross-instance search added 2026-04-16: `instance_ids: [...]`, max 10 instances per query.
- Filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`. Vectorize-style nesting.
- Worker binding: `ai_search_namespaces` (recommended). Auth implicit.
- Returns chunks, not docs. Dedupe by `chunks[].item.key`.

**Per-type instance topology:** each ontology class is its own AI Search instance under namespace `energy-intel`: `experts`, `organizations`, `projects`, `articles`, `posts`. Cross-entity queries use `instance_ids` fanout. Metadata schema per instance matches its entity's `toMetadata` return type.

**Body shape — Markdown with frontmatter:**

```markdown
---
displayName: Mark Z. Jacobson
did: did:plc:...
iri: https://w3id.org/energy-intel/expert/MarkZJacobson
roles:
  - https://w3id.org/energy-intel/role/EnergyExpertRole/...
affiliations:
  - https://w3id.org/energy-intel/organization/StanfordUniversity
tier: top
primary_topic: renewables-grid
---

# Mark Z. Jacobson

Energy expert. Researcher at Stanford University. Bio: ...

## Roles
- Energy expert role: covers wind, solar, water systems...
```

The frontmatter doubles as a human-readable record; the prose carries embedding signal. Related entities (organizations, roles) appear in the body so they embed, not in metadata (which is filter-only and 5-field capped).

**Query abstraction (also entity-first):**

```ts
export const searchEntities: <T extends EntityType>(
  q: string,
  opts: { types: ReadonlyArray<T>; filters?: FiltersFor<T> }
) => Effect.Effect<ReadonlyArray<EntityResult<T>>, AiSearchError, AiSearchClient>
```

Returns typed entities, not raw chunks. Dedupes by `item.key`, looks up entities by IRI, decodes through their Effect schemas. Agent flows consume `Expert[]`, `EnergyProject[]` — never raw search chunks.

For the slice: projection function + unit test only. No production wiring. The Alchemy PR provisions the `experts` instance, declares its 5 metadata fields, and adds the `searchEntities` runtime.

## Cutover (Strangler Pattern)

Old and new `Expert` coexist. Migrate one read path as proof. Kill nothing.

**Within the slice PR:**

1. **`packages/ontology-store/` consolidation.** Delete DCAT-specific EmitSpec content. Trim `references/data-layer-spine/manifest.json` consumers. Remove the JSON spec interpreter. Keep package skeleton, scripts, shapes, tests, N3.js, SHACL machinery.
2. **New artifacts** (per sections above): `src/generated/agent.ts`, `src/iris.ts`, `shapes/expert.ttl`, `tests/expert-round-trip.test.ts`. Test fixture from real prod data.
3. **One read path:** `ExpertRepo.byDidEnergyIntel(did)` returns the new `Expert`. Same D1 row, transformed via `expertFromLegacyRow`. One caller migrates — likely the demo script or a small admin route. Production paths stay on `byDid`.
4. **Demo script:** `scripts/demo-expert-aisearch.ts`. Loads one `Expert`, runs projection, prints output. No upload (instance not provisioned).
5. **Bridge type:** rename existing `Expert` to `LegacyExpert` only if locally scoped. Otherwise leave the legacy name and import the energy-intel `Expert` under a distinct path.

**Deferred to follow-up PRs:**

- Codegen step (full pipeline replaces hand-written `agent.ts`).
- Alchemy migration (provisions AI Search instances + declares metadata schemas).
- Per-entity strangler PRs (`Organization`, `EnergyProject`, `Article`, `Post`).
- Migrating `ExpertPollCoordinator`, ingest workflow, agent feed.
- Deleting `src/resolution/` and `src/search/`.
- Deleting `LegacyExpert`.

## Acceptance Criteria

- `bun run typecheck` and `bun run test` green.
- Round-trip test passes on `Expert` (six phases all green).
- Demo script runs end-to-end against real D1 data.
- No `src/` imports of Node built-ins introduced.
- `packages/ontology-store/` content delta is net-negative LOC (consolidation removes more than it adds).

## References

- Energy-intel ontology source: `/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules/agent.ttl`
- Effect codegen primitives: `.reference/effect/packages/effect/src/SchemaRepresentation.ts`
- Prior SKY-362 design (DCAT application profile, superseded): `docs/plans/2026-04-15-sky-362-ontology-store-design.md`
- Cloudflare AI Search docs: https://developers.cloudflare.com/ai-search/
