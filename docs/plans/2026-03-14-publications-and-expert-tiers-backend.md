# Publications + Expert Tiers Backend Plan

Date: 2026-03-14
Status: Ready for implementation

## Goal
Add first-class publications to the backend, persist expert tier as a real domain field, and expose the new read surfaces without introducing duplicate sources of truth or a rollout that breaks before operators run migrations.

## Non-Goals
- No new MCP tools in this pass.
- No KV-based publication runtime store. Publications remain D1-backed.
- No free-form admin override UI for expert tier or publication tier in this pass.

## Locked Design Decisions
- Publications are a first-class D1 entity. The runtime source of truth is the `publications` table, not `OntologyCatalog` and not ad hoc aggregation at read time.
- Expert tier is a persisted field on `experts`. It is computed from normalized author handles against the checked-in ontology author-tier data, not inferred separately in each API handler.
- Publication seeding is build-time artifact generation plus an operator-triggered D1 seed step. The worker seeds from a bundled JSON artifact, not from KV.
- Publication auto-discovery happens inside `KnowledgeRepoD1.upsertPosts`, using the link domains it already has in hand. `processBatch` does not take on a new `PublicationsRepo` dependency.
- In this phase, publication hostnames stay normalized strings rather than introducing a new hostname brand. The invariant is enforced by shared normalization, not by a half-applied branded type.
- If `normalizeDomain` is needed outside ontology-only code, move it to a shared normalization module instead of making `bluesky/PostRecord.ts` depend on `src/ontology/*`.
- `OntologySnapshot` stays focused on ontology matching data. Do not add runtime publication read models to the snapshot or `OntologyCatalog`; that would create a second publication source of truth.

## Domain Model

### Tier Types
- Add `ExpertTier = Schema.Literal("energy-focused", "general-outlet", "independent")`.
- Add `PublicationTier = Schema.Literal("energy-focused", "general-outlet", "unknown")`.
- Add `PublicationSource = Schema.Literal("seed", "discovered")`.

### Expert Models
- Phase B only: add `tier` to `ExpertRecord`, `ExpertListItem`, `AdminExpertResult`, and `KnowledgePostResult` in `src/domain/bi.ts`.
- `tier` becomes a required persisted field after migration 10 is in place.
- `ExpertRegistryService` and bootstrap seeding both use one shared pure helper:
  `resolveExpertTier(handle: string | null, authorTiers: OntologyAuthorTiers): ExpertTier`
- Resolution rule:
  - exact normalized handle match in `authorTiers.energyFocused` -> `"energy-focused"`
  - exact normalized handle match in `authorTiers.generalOutlets` -> `"general-outlet"`
  - otherwise -> `"independent"`

### Publication Models
- Add the following schemas to `src/domain/bi.ts`:
  - `PublicationSeed`
  - `PublicationSeedManifest`
  - `PublicationRecord`
  - `PublicationListItem`
  - `ListPublicationsInput`
  - `PublicationListOutput`
  - `SeedPublicationsResult`
- Keep `PublicationListItem` as the single public aggregate shape. Do not add a parallel `PublicationStatsItem` unless an actual second consumer needs a different contract.
- Recommended shapes:
  - `PublicationSeed`: `{ hostname, tier }`
  - `PublicationSeedManifest`: `{ ontologyVersion, snapshotVersion, publications }`
  - `PublicationRecord`: `{ hostname, tier, source, firstSeenAt, lastSeenAt }`
  - `PublicationListItem`: `{ hostname, tier, source, postCount, latestPostAt }`
  - `SeedPublicationsResult`: `{ seeded, snapshotVersion }`

## Source Data Strategy

### Expert Tier Source
- Keep using `OntologySnapshot.authorTiers` for author classification.
- No schema change is needed in `OntologySnapshot` for expert tier work.

### Publication Seed Source
- Do not derive publication domains from `authorTiers.generalOutlets`; that is an author classification surface.
- Extend the ontology build step to emit a separate `config/ontology/publications-seed.json` artifact from the same input set used for the snapshot build.
- Publication seed derivation:
  - energy-focused publication domains come from the `### Link Domains` block in the derived-store filter document
  - general-outlet publication domains come from the `### General Outlet Breakdown` table, normalized from the `Author` column
- Deduping rule:
  - normalize with `normalizeDomain`
  - energy-focused wins over general-outlet if the same hostname appears in both inputs
- Do not add publication data to the runtime snapshot JSON in this pass.

### Build Output
- Refactor `src/ontology/buildSnapshot.ts` to export one shared artifact builder, for example:
  `buildOntologyArtifacts(input) -> { snapshot, publicationsSeed }`
- Update `src/scripts/build-ontology-snapshot.ts` to write:
  - `config/ontology/energy-snapshot.json`
  - `config/ontology/publications-seed.json`
- Add a checked-in decoder module for the seed artifact, mirroring expert seeds:
  - `src/bootstrap/CheckedInPublications.ts`

## Persistence

### Migration 10
- Add migration 10 in `src/db/migrations.ts`.
- Statements:
  - `ALTER TABLE experts ADD COLUMN tier TEXT NOT NULL DEFAULT 'independent'`
  - `CREATE TABLE IF NOT EXISTS publications (hostname TEXT PRIMARY KEY, tier TEXT NOT NULL, source TEXT NOT NULL, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`
  - `CREATE INDEX IF NOT EXISTS idx_publications_tier_last_seen_at ON publications(tier, last_seen_at DESC)`
  - normalize historical `links.domain` values so future publication aggregation and domain filters use one canonical string form
- Keep the migration idempotent in the same style as the existing migration set.

### Publication Writes
- Add `src/services/PublicationsRepo.ts` with methods for:
  - `seedCurated(manifest, observedAt)`
  - `list(input)`
- Add `src/services/d1/PublicationsRepoD1.ts`.
- Factor shared publication-upsert SQL into a small D1 helper if needed so curated seeding and discovered-domain upserts do not duplicate merge logic.

### Publication Upsert Rules
- Curated seed upsert:
  - inserts new rows as `source = "seed"`
  - upgrades existing discovered rows to `source = "seed"`
  - overwrites tier with the curated tier
  - preserves the earliest `first_seen_at`
  - bumps `last_seen_at`
- Discovered upsert from ingestion:
  - inserts only normalized, non-empty domains
  - sets `tier = "unknown"` and `source = "discovered"` for first sighting
  - only updates timestamps on conflict
  - never downgrades a seeded row's tier or source

## Service Design

### Publications Read Path
- Add `listPublications` to `KnowledgeQueryService`.
- `KnowledgeQueryService` depends on `PublicationsRepo` for this read path.
- Add `GET /api/publications` to `src/api/Router.ts`.
- Add request and response schemas to `src/domain/api.ts`.
- Initial query params:
  - `tier?: PublicationTier`
  - `source?: PublicationSource`
  - `limit?: number`

### Expert Tier Write Path
- Update `ExpertRegistryService` so both `addExpert` and `refreshExpertProfile` compute tier with `resolveExpertTier(...)`.
- `ExpertRegistryService` should take `OntologyCatalog` as a dependency in Phase B.
- Update `bootstrapExperts` in `src/bootstrap/ExpertSeeds.ts` to compute tier from the same helper rather than hard-coding or defaulting independently.
- This keeps expert tier logic in one pure function instead of splitting it between staging ops, bootstrap code, and the registry service.

### Publication Discovery During Ingest
- Update `KnowledgeRepoD1.upsertPosts` to record observed publication domains while it is already inserting links.
- Normalize domains before they are written:
  - update `extractLinkRecords` or its hostname helper to use `normalizeDomain`
  - keep future `links.domain` writes consistent with the migration-normalized historical rows
- Do not add `PublicationsRepo` to `processBatch`, `ExpertPollExecutor`, or staging fixture ingestion. The ingest Effect environment should stay unchanged.

## Operator Surface

### New Staging Op
- Add `POST /admin/ops/seed-publications`.
- Implement end to end in:
  - `src/services/StagingOpsService.ts`
  - `src/domain/api.ts`
  - `src/admin/Router.ts`
  - `src/ops/StagingOperatorClient.ts`
  - `src/ops/Cli.ts`
  - `src/worker/operatorAuth.ts`
- Return `SeedPublicationsResult`.
- Audit action name: `seed_publications`.

### Existing Ops Used for Backfill
- Keep using existing ops to backfill expert tier after migration:
  - `/admin/ops/bootstrap-experts` to re-upsert checked-in seed experts with computed tiers
  - `/admin/ops/refresh-profiles` to recompute tier and refresh profile fields for active experts
- Do not add a second expert-tier-only admin route in this pass.

## Repository and Query Changes

### Phase B Repository Changes
- Update `src/services/ExpertsRepo.ts` and `src/services/d1/ExpertsRepoD1.ts` to include `tier` in read and write models.
- Update `src/services/KnowledgeRepo.ts` and `src/services/d1/KnowledgeRepoD1.ts` so post result queries select `e.tier`.
- Add `src/services/PublicationsRepo.ts` and `src/services/d1/PublicationsRepoD1.ts`.
- Add a publications list query that aggregates from `publications` and `links`:
  - `postCount` from matching links
  - `latestPostAt` from `MAX(links.extracted_at)`

### API Contracts
- Add `ListPublicationsUrlParams` and `PublicationListOutput` to `src/domain/api.ts`.
- Extend `PublicReadRequestSchemas` and `PublicReadResponseSchemas`.
- Extend `src/api/Router.ts` with a `publications` group or endpoint.
- Leave MCP unchanged in this pass.

## Layer Wiring

### Shared Worker Layer
- Add `PublicationsRepoD1.layer` to `src/edge/Layer.ts`.
- Include it in the shared query/admin layer composition because:
  - `KnowledgeQueryService.listPublications` needs it
  - `StagingOpsService.seedPublications` needs it
- Update `KnowledgeQueryService.layer` provisioning to include `PublicationsRepo`.

### Registry Layer
- Update `ExpertRegistryService.layer` provisioning to include `OntologyCatalog.layer`.

### Test Runtime
- Update `tests/support/runtime.ts`:
  - `makeBiLayer` must provide `PublicationsRepoD1.layer`
  - `seedKnowledgeBase` and any bootstrap helpers must pass ontology author tiers into `bootstrapExperts`
- Because publication discovery stays inside `KnowledgeRepoD1`, `processBatch` call sites do not need a new provided service.

## Rollout Plan

### Deploy A: Schema + Seed Plumbing Only
- Land and deploy:
  - migration 10
  - publication seed artifact generation
  - `CheckedInPublications`
  - `PublicationsRepo` + `PublicationsRepoD1`
  - `POST /admin/ops/seed-publications`
  - CLI/operator client/operator auth updates
- Do not yet change:
  - `ExpertRecord` / `ExpertListItem` / `AdminExpertResult` / `KnowledgePostResult`
  - `ExpertsRepoD1` expert reads
  - public `GET /api/publications`
  - `KnowledgeRepoD1` publication auto-discovery writes

### After Deploy A
1. Run `POST /admin/ops/migrate`.
2. Run `POST /admin/ops/seed-publications`.

### Deploy B: Read Paths + Expert Tier + Discovery
- Land and deploy:
  - expert tier fields and shared classifier
  - `ExpertsRepoD1` tier reads/writes
  - `KnowledgeRepoD1` post result tier reads
  - `KnowledgeRepoD1` publication discovery writes
  - `GET /api/publications`
  - `KnowledgeQueryService.listPublications`
  - `links.domain` normalization on future ingest writes

### After Deploy B
1. Run `POST /admin/ops/bootstrap-experts`.
2. Run `POST /admin/ops/refresh-profiles`.
3. Verify `/api/experts`, `/api/posts/recent`, and `/api/publications`.

## Verification

### Unit Tests
- Add tests for `resolveExpertTier`.
- Add tests for publication seed generation from the ontology fixtures.
- Add tests for publication seed deduping and tier precedence.
- Add tests for domain normalization used by link extraction and publication discovery.

### Repository Tests
- Add `PublicationsRepoD1` tests covering:
  - curated seed insert
  - discovered insert
  - seeded row not downgraded by discovery
  - aggregate listing
- Update `ExpertsRepoD1` tests for `tier`.
- Update `KnowledgeRepoD1` tests to prove post writes create discovered publications without extra Effect services.

### API / Admin Tests
- Add admin route tests for `/admin/ops/seed-publications`.
- Add CLI/client tests if present for the new op.
- Add API tests for `/api/publications`.
- Update existing API/admin tests to assert expert tier is returned where expected after Phase B.

## Files
- `src/domain/bi.ts`
- `src/domain/api.ts`
- `src/ontology/buildSnapshot.ts`
- `src/scripts/build-ontology-snapshot.ts`
- `config/ontology/publications-seed.json`
- `src/bootstrap/CheckedInPublications.ts`
- `src/bootstrap/ExpertSeeds.ts`
- `src/db/migrations.ts`
- `src/services/PublicationsRepo.ts`
- `src/services/d1/PublicationsRepoD1.ts`
- `src/services/d1/KnowledgeRepoD1.ts`
- `src/services/d1/ExpertsRepoD1.ts`
- `src/services/KnowledgeQueryService.ts`
- `src/services/ExpertRegistryService.ts`
- `src/services/StagingOpsService.ts`
- `src/edge/Layer.ts`
- `src/api/Router.ts`
- `src/admin/Router.ts`
- `src/ops/StagingOperatorClient.ts`
- `src/ops/Cli.ts`
- `src/worker/operatorAuth.ts`
- `src/scripts/bootstrap-experts.ts`
- `tests/support/runtime.ts`
- `tests/ontology.test.ts`
- new repository/api/admin tests for publications and expert tier

## Notes
- This plan intentionally keeps the ontology runtime surface unchanged. The seed artifact is a build output, not a new runtime catalog contract.
- The two-deploy sequence is required because migrations are still operator-triggered rather than automatic at worker startup.
