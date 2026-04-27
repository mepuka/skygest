# Energy-Intel Ontology Adoption: Expert Vertical Slice

**Status:** Design locked 2026-04-27. Implementation pending.
**Scope:** One PR. ~2 weeks. Codegen + Alchemy + AI Search instance live + queryable `Expert` end-to-end.

## Goal

Prove the full integration story for the energy-intel ontology adoption on a single entity (`Expert`) by shipping every layer at once: TTL-driven codegen, Alchemy-provisioned infra, a deployed AI Search instance populated from D1, and a typed query path that returns `Expert[]` from a Worker.

The vertical slice is *not* "minimum viable schema." It is "the full pattern proven once, end-to-end, so scaling to other entities is mechanical."

## Decisions

1. **Codegen ships in this slice.** Effect 4 has native bidirectional codegen (`SchemaRepresentation.fromJsonSchemaDocument` + `toCodeDocument`, located in `.reference/effect/packages/effect/src/SchemaRepresentation.ts` under `unstable/`). No quicktype, no hand-written interim. The codegen produces `Expert` and the rest of the agent module on the same run.
2. **Alchemy migration ships in this slice.** `alchemy.run.ts` provisions all current infra at parity, plus the new AI Search namespace + instance + AI Gateway binding. `wrangler*.toml` retires.
3. **AI Search instance for `experts` is deployed and queryable** before merge. Not a demo. A `searchExperts` Effect service returns typed `Expert[]` from a Worker.
4. **Ontology-first.** Domain model shape drives Alchemy resource configuration, not the other way around.
5. **Consolidate, do not duplicate.** `packages/ontology-store/` becomes the energy-intel home. DCAT-only EmitSpec content trims out.
6. **Vertical slice on `Expert`.** Other ontology entities (Organization, EnergyProject, Article, Post) and other modules (media, measurement, data) follow the same recipe in their own PRs.

## Slice Scope

**In scope (one PR):**

- `packages/ontology-store/` consolidates onto energy-intel. DCAT-specific EmitSpec content removed. Skeleton (scripts, shapes, tests, N3.js, SHACL) survives.
- Codegen pipeline `packages/ontology-store/scripts/generate-from-ttl.ts` runs end-to-end. Produces `src/generated/agent.ts` containing all 5 classes from `agent.ttl` (`Expert`, `Organization`, `EnergyExpertRole`, `PublisherRole`, `DataProviderRole`) as Effect schemas with branded IRIs.
- Hand-written extension `packages/ontology-store/src/agent/expert.ts` adds: forward RDF mapping (re-expands flattened TS into BFO inherence triples), reverse RDF mapping (policy-driven distill), AI Search projection (`toKey`, `toBody`, `toMetadata`).
- SHACL shape `shapes/expert.ttl` plus six-phase round-trip test.
- `alchemy.run.ts` at repo root provisions all current infra plus AI Search namespace `energy-intel`, instance `experts` with declared metadata schema, and AI Gateway binding for the agent worker.
- AI Search population script `scripts/populate-experts.ts` reads current `Expert` rows from D1, projects, uploads via `items.upload`.
- `searchExperts` Effect service in the agent worker returns typed `Expert[]`.
- `wrangler*.toml` files retire. Alchemy emits `wrangler.json` for local dev / `wrangler types`.
- One read path migrates: a small admin or debug HTTP route uses `searchExperts` end-to-end, returning typed `Expert` data from the AI Search instance.

**Out of scope (still — aggressive does not mean everything):**

- Migrating `ExpertPollCoordinator` DO, ingest workflow, and agent feed off the legacy `Expert` type. *Reason:* touches ~15 files across 3 workers; orthogonal to proving the integration.
- Deleting `src/resolution/` and `src/search/`. *Reason:* other entity types still flow through them. They die when the last entity migrates.
- Other ontology modules (`media.ttl`, `measurement.ttl`, `data.ttl`).
- Other entities' projections, mappings, AI Search instances. The codegen emits their schemas (free output); the rest waits.
- BFO role first-class modeling. The slice flattens `roles: ReadonlyArray<EnergyExpertRoleIri>` in TS and re-expands into BFO inherence triples on emit.
- Cloudflare-hosted Alchemy state backend. The slice uses local file state (`.alchemy/`) committed to git. Hosted backend is a follow-up.

## Codegen Pipeline

Build-time. Output commits to git. CI drift gate.

```
energy-intel/modules/agent.ttl  (read-only upstream)
  ├─[1] bun script: parse with n3.js, walk pre-reasoned graph, emit JSON Schema 2020-12
  ├─[2] Effect SchemaRepresentation.fromJsonSchemaDocument(json) → Schema AST
  ├─[3] AST post-processor:
  │       - substitute Schema.String → branded IRI for ei:* IRIs
  │       - fold owl:equivalentClass restrictions into Schema.Class
  │       - apply topologicalSort for cross-class deps
  ├─[4] Effect SchemaRepresentation.toCodeDocument(ast) → TS source
  └─[5] prettier + write packages/ontology-store/src/generated/agent.ts
```

`bun packages/ontology-store/scripts/generate-from-ttl.ts agent` runs the pipeline. CI runs the same and diffs against the committed file — drift fails the build.

The post-processor in step 3 is the only project-specific logic. Branded IRI substitution is a name lookup (every TTL class IRI → branded type name). `owl:equivalentClass` folding is a single special case (the `Expert` role-bearer pattern). Both stay declarative.

## Schema Shape (Generated)

`packages/ontology-store/src/generated/agent.ts` is purely generated, never hand-edited. Approximate output:

```ts
import { Schema } from "effect"

export const ExpertIri = Schema.String.pipe(
  Schema.pattern(/^https:\/\/w3id\.org\/energy-intel\/expert\/[A-Za-z0-9_-]+$/),
  Schema.brand("ExpertIri"),
)
export type ExpertIri = typeof ExpertIri.Type

// Sibling brands: EnergyExpertRoleIri, OrganizationIri, PublisherRoleIri, DataProviderRoleIri.

export class Expert extends Schema.Class<Expert>("Expert")({
  iri: ExpertIri,
  did: Did,
  displayName: Schema.String,
  roles: Schema.NonEmptyArray(EnergyExpertRoleIri),
  affiliations: Schema.optional(Schema.Array(OrganizationIri)),
  bio: Schema.optional(Schema.String),
  tier: Schema.optional(Schema.String),
  primaryTopic: Schema.optional(Schema.String),
}) {}

export class Organization extends Schema.Class<Organization>("Organization")({...}) {}
export class EnergyExpertRole extends Schema.Class<EnergyExpertRole>("EnergyExpertRole")({...}) {}
export class PublisherRole extends Schema.Class<PublisherRole>("PublisherRole")({...}) {}
export class DataProviderRole extends Schema.Class<DataProviderRole>("DataProviderRole")({...}) {}
```

`Did` carries from existing `src/domain/`. Other classes generate but stay unused in this slice.

## RDF Mapping (Hand-Written Per Entity)

`packages/ontology-store/src/agent/expert.ts` imports from `generated/agent.ts` and adds typed mapping functions co-located with the schema. No JSON spec interpreter, no runtime walker.

Forward (`expertToTriples`): expands flattened TS into BFO inherence triples — for each role, emit `(role, rdf:type, ei:EnergyExpertRole)`, `(role, bfo:0000052, expert)`, `(expert, bfo:0000053, role)`. Plus standard typing (`rdf:type ei:Expert`, `rdf:type foaf:Person`), `foaf:name`, optional `ei:bio`.

Reverse (`expertFromTriples`): policy, not mechanical inversion. Walk the store; select `bfo:bearerOf` objects whose type is `ei:EnergyExpertRole`; ignore unrelated triples; document lossy fields. Decode through `Schema.decodeUnknownEffect(Expert)`.

Namespace IRIs centralize in `packages/ontology-store/src/iris.ts`: `EI.Expert`, `BFO.inheresIn`, `FOAF.name`, etc. Generated alongside schemas — every TTL prefix becomes a constant.

## SHACL Validation

`packages/ontology-store/shapes/expert.ttl` — single shape file. Constraints:

- `sh:targetClass ei:Expert`
- `sh:nodeKind sh:IRI`
- IRI matches the energy-intel pattern
- `foaf:name` minCount 1
- At least one `bfo:bearerOf` linking to a node typed `ei:EnergyExpertRole`
- `sh:message` per constraint, severity `sh:Violation`

JS validator: `rdf-validate-shacl`. Keeps `src/` Node-free.

Six-phase round-trip test (`tests/expert-round-trip.test.ts`): load → emit → SHACL → reparse → distill → parity. Failures pin to a phase.

## AI Search: Projection, Provisioning, Population, Query

**Per-entity projection contract** (entity owns its full search shape):

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

**Body shape** — Markdown with frontmatter; related-entity IRIs in body so they embed; metadata is filter-only (5-field cap forces this).

**Cloudflare AI Search constraints (verified 2026-04-27):**

- AI Search renamed from AutoRAG (2025-09-25). Open beta. Free tier within quota.
- One file per entity is idiomatic. JSONL is not first-class.
- Custom metadata: max 5 fields per instance, declared at instance creation, max 500 chars per text value.
- Native plain-text formats: `.md`, `.json`, `.yaml`, `.txt`, `.html`.
- Hybrid search (vector + BM25, RRF or max fusion) since 2026-04-16.
- Cross-instance search since 2026-04-16: `instance_ids: [...]`, max 10.
- Filter operators: `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`. Vectorize-style nesting.
- Worker binding: `ai_search_namespaces` (recommended). Auth implicit.
- Returns chunks, not docs. Dedupe by `chunks[].item.key`.

**Population script** `scripts/populate-experts.ts`:

1. Read all current `Expert` rows from D1 via the legacy repo.
2. Transform each row to the new `Expert` schema via `expertFromLegacyRow`.
3. Project via `ExpertProjection` to `{ key, body, metadata }`.
4. Call `env.AI_SEARCH.get("experts").items.upload(key, body, { metadata })` per record.
5. Idempotent — re-running overwrites by key.

Runs once during the slice. Future updates land via write-through in repo write paths (follow-up).

**Query service** `searchExperts` (Effect service in the agent worker):

```ts
export const searchExperts = (q: string, opts?: { tier?: string; topic?: string }) =>
  Effect.gen(function* () {
    const aiSearch = yield* AiSearchClient
    const result = yield* aiSearch.search({
      messages: [{ role: "user", content: q }],
      ai_search_options: {
        retrieval: {
          instance_ids: ["experts"],
          filters: opts ? buildFilters(opts) : undefined,
          max_num_results: 20,
        },
      },
    })
    return yield* decodeChunksToExperts(result.chunks)
  })
```

`decodeChunksToExperts` dedupes by `item.key`, looks up each Expert by IRI in D1, decodes through `Schema.decodeUnknownEffect(Expert)`. Returns `ReadonlyArray<Expert>`. Errors as tagged errors per `src/domain/errors.ts` convention.

## Alchemy Migration

`alchemy.run.ts` at repo root. Replaces `wrangler.toml`, `wrangler.agent.toml`, `wrangler.resolver.toml`. Local file state (`.alchemy/`) committed to git.

**Provisioned at parity with current state:**

- 3 workers: `skygest-bi-ingest`, `skygest-bi-agent`, `skygest-resolver`
- D1: `skygest` (prod), `skygest-staging`, `skygest-search-staging`
- KV: `ONTOLOGY_KV`
- R2: `TRANSCRIPTS_BUCKET` (prod and staging buckets)
- DO class: `ExpertPollCoordinatorDo`
- Workflows: `IngestRunWorkflow`, `EnrichmentRunWorkflow`
- Service bindings: `RESOLVER`, `INGEST_SERVICE`
- Cron triggers (`*/15 * * * *` on prod ingest)
- Env vars and staging overrides
- SPA assets binding for the agent worker

**New resources for this slice:**

- `AiSearchNamespace`: `energy-intel`
- `AiSearchInstance`: `experts` under `energy-intel`. `customMetadata: ["entity_type", "did", "iri", "tier", "topic"]`. Hybrid search enabled. Default chunking config.
- `AiGateway`: `skygest-ai`. Bound to the agent worker for downstream Workers AI / Gemini / Anthropic calls.
- `ai_search_namespaces` binding (`AI_SEARCH`) on the agent worker.
- `ai` binding wrapped through AI Gateway on the agent worker.

**State backend:** local file in `.alchemy/`, committed to git. Single-operator project, no team sync required. Cloudflare-hosted state backend (`CloudflareStateStore`) reopens when a second collaborator joins.

**Wrangler relationship:** Alchemy provisions and deploys; `wrangler.json` is emitted for `wrangler types` (Env shape) and Miniflare local dev. Hand-edit neither. CI runs `alchemy deploy`, not `wrangler deploy`.

## Cutover

Narrow. The slice migrates *one read path*. Legacy `Expert` continues serving every other consumer.

**Within the slice PR:**

1. New artifacts land (codegen + generated files + hand-written agent module + SHACL + tests + Alchemy + population script + searchExperts service + admin/debug route).
2. Existing `Expert` type stays in `src/domain/` under its current name. New energy-intel `Expert` imports from `packages/ontology-store/src/agent/expert.ts`. Distinct types, distinct call sites.
3. The chosen read path (admin or debug HTTP route, *not* a production-facing one) calls `searchExperts` and returns the new `Expert` shape. Nothing else changes.
4. Population script runs once during release to seed the AI Search instance with current data.

**Deferred to follow-up PRs (one per concern):**

- `ExpertPollCoordinator` DO migration to new `Expert`.
- Ingest workflow migration to new `Expert`.
- Agent feed and HTTP API surfaces migration to new `Expert`.
- Other entities (`Organization`, `EnergyProject`, `Article`, `Post`) — each one a recipe-replay PR.
- Deleting `src/resolution/` and `src/search/`.
- Deleting legacy `Expert`.
- Cloudflare-hosted Alchemy state backend.

## Acceptance Criteria

- `bun run typecheck` and `bun run test` green.
- `bun packages/ontology-store/scripts/generate-from-ttl.ts agent` runs cleanly; CI drift gate passes.
- Round-trip test passes on `Expert` (six phases all green).
- `alchemy deploy` succeeds against staging. All bindings validate. `wrangler.json` regenerates.
- Population script runs against staging D1, uploads ≥10 `Expert` records, AI Search dashboard shows them.
- The admin/debug route returns ≥1 typed `Expert` from a query like `searchExperts("hydrogen storage")`.
- No `src/` imports of Node built-ins introduced.
- `packages/ontology-store/` content delta is net-negative LOC (consolidation removes more than it adds).

## References

- Energy-intel ontology source: `/Users/pooks/Dev/ontology_skill/ontologies/energy-intel/modules/agent.ttl`
- Effect codegen primitives: `.reference/effect/packages/effect/src/SchemaRepresentation.ts`
- Prior SKY-362 design (DCAT application profile, superseded): `docs/plans/2026-04-15-sky-362-ontology-store-design.md`
- Cloudflare AI Search docs: https://developers.cloudflare.com/ai-search/
- Alchemy docs: https://alchemy.run/
- Alchemy Cloudflare resource catalog: https://github.com/alchemy-run/alchemy/tree/main/alchemy/src/cloudflare
