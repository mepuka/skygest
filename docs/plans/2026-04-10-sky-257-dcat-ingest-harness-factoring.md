# DCAT Ingest Harness Factoring + Fraunhofer Adapter — Revised Plan

> **Parent tracking issue:** [SKY-251 — Cold-start registry expansion](https://linear.app/pure-logic-industrial/issue/SKY-251)
> **Compressed PR scope:** land **SKY-257 + SKY-261 together** in one PR
> **Conventions doc:** `docs/plans/2026-04-10-sky-251-ingest-script-conventions.md`
> **Research backing this combined scope:** `docs/research/2026-04-10-sky-251-provider-expansion-research.md`

## Why this revision exists

The earlier SKY-257 draft assumed we should factor the harness in isolation, then add the next adapter later. That is the wrong order.

For this codebase, the safer pattern is:

1. preserve the current EIA behavior
2. extract the shared harness incrementally
3. prove the abstraction immediately with a second real adapter in the same PR

Fraunhofer ISE `energy-charts.info` is the right second adapter for that job. It is materially different from EIA:

- EIA is a cached hierarchical walk
- Fraunhofer is a flat OpenAPI catalog fetched in one shot

If a shared boundary survives both of those shapes in one PR, it is probably the right one. If it does not, we learn that before the harness hardens around EIA-specific assumptions.

## Goal

Deliver one PR that:

- extracts reusable DCAT ingest primitives from `scripts/cold-start-ingest-eia.ts` into `src/ingest/dcat-harness/`
- moves EIA-specific code into `src/ingest/dcat-adapters/eia-tree/`
- adds a working Fraunhofer `energy-charts.info` adapter as the second consumer of that harness
- preserves the current end-to-end EIA behavior while adding the new Fraunhofer ingest path

## Done means

This combined SKY-257 + SKY-261 PR is done only when all of the following are true:

1. The existing EIA test suite still passes.
2. The EIA script still validates all candidates before any entity file write.
3. On EIA validation failure, the script still logs every failure and still writes the failure report before aborting.
4. On successful EIA dry run, the script still exits before entity writes, ledger writes, mermaid writes, and ingest-report writes.
5. Existing EIA dataset, distribution, and catalog-record slugs are still reused when merging.
6. The EIA entity-id ledger is still updated the same way on a successful non-dry run.
7. The EIA mermaid graph and ingest report are still emitted to the same paths on a successful non-dry run.
8. A new Fraunhofer ingest script exists and uses the shared harness modules rather than duplicating EIA logic.
9. Fraunhofer root records are created cleanly even though there are no existing `fraunhofer` / `energy-charts` files in `references/cold-start/catalog/` today.
10. The alias scheme `energy-charts-endpoint` is added and used as the Fraunhofer merge key.
11. The end state is two real adapters over one shared harness: EIA and Fraunhofer.
12. `src/platform/ScriptRuntime.ts` and `src/platform/Logging.ts` are reused as-is; this PR does not recreate them.

## Current EIA behavior to preserve

The current `scripts/cold-start-ingest-eia.ts` is the behavioral baseline. The refactor must preserve:

- Stage ordering: fetch -> load index/build context/build candidates -> validate all candidates -> build graph -> dry-run gate -> write graph -> update ledger -> emit mermaid/report.
- Validation shape: `validateCandidates(...)` returns `{ failures, successes }`, not a fail-fast single error.
- Failure handling: if validation fails, the script logs every failure, writes the failure report, logs the validation summary, and only then aborts on the first failure.
- Dry-run behavior: a successful dry run performs fetch/build/validate/graph construction and then returns before Phase B writes.
- Ownership protection: before overwriting an existing entity file, the script still checks that the on-disk entity id matches the node being written.
- Slug stability: merged datasets, distributions, and catalog records still reuse their existing file slugs when present.
- EIA-specific fetch behavior: walk cache, rate limiting, retry behavior, and route walking stay EIA-local.

## Fraunhofer baseline facts

The combined plan should assume the following, based on the current research doc:

- Fraunhofer exposes a public OpenAPI spec at `https://api.energy-charts.info/openapi.json`
- the provider shape is flat, not recursive
- one `Dataset` should be created per endpoint family, not per country or per chart image
- one `Distribution` should be created per dataset endpoint shape
- the merge key is `energy-charts-endpoint`
- there are currently no seeded Fraunhofer entity files under `references/cold-start/catalog/`

This means the combined PR is not only "adapter wiring"; it also includes first-time publisher seeding for Fraunhofer through the same validate-and-write pipeline.

## Non-goals

- Building adapters beyond Fraunhofer in this PR
- Reworking `src/platform/ScriptRuntime.ts`
- Reworking `src/platform/Logging.ts`
- Changing EIA merge semantics, alias rules, report shape, or dry-run behavior
- Building a full generic "flat OpenAPI family" abstraction for future providers before the Fraunhofer implementation proves which pieces are actually shared
- Introducing CI or deployment changes

## PR boundary

This PR should contain:

- SKY-257 harness extraction
- SKY-261 Fraunhofer adapter + script

This PR should not contain:

- SKY-265
- SKY-266

Those two follow immediately after this PR lands, reusing whatever flat-API seam the Fraunhofer implementation proves out.

## Baseline repo state

Treat these as already-landed infrastructure, not work for this PR:

- `src/platform/ScriptRuntime.ts`
- `tests/platform/ScriptRuntime.test.ts`
- `src/platform/Logging.ts`
- `tests/platform/Logging.test.ts`

Treat these as the current EIA behavior that the harness must preserve:

- `scripts/cold-start-ingest-eia.ts`
- `tests/cold-start-ingest-eia.test.ts`

## Architecture

### Shared harness in this PR

The shared harness should extract only the pieces that are already provider-neutral across EIA and Fraunhofer:

- `IngestNode`
- `IngestEdge`
- `IngestGraph`
- `stableSlug`
- graph construction
- candidate validation helpers
- catalog index loading, after removing provider-root resolution from it
- entity-path / encode / atomic-write helpers
- ledger helpers
- optional graph-summary helpers such as topological materialization and mermaid rendering

### EIA stays adapter-local

These remain EIA-specific after the refactor:

- script config
- fetch / walk / rate-limit / cache
- EIA response schema
- EIA fetch/decode errors
- `buildContextFromIndex`
- `buildCandidateNodes` and its dataset/distribution/catalog-record builders
- EIA ingest-report schema and writer

### Fraunhofer stays adapter-local

These are specific to SKY-261 and should not be over-generalized yet:

- OpenAPI spec fetch for `energy-charts.info`
- path filtering / endpoint normalization
- Fraunhofer root-record construction
- mapping from OpenAPI paths to dataset/distribution candidates
- any provider-specific endpoint exclusions or title shaping

If the Fraunhofer implementation naturally produces a tiny shared helper for "fetch spec and iterate `paths`", that helper can be extracted. Do not start by designing a full generic OpenAPI family framework.

### Generic runner rule

Do not start this PR by building a monolithic `runIngest(adapter, options)` API.

Instead:

- extract shared modules first
- rebase EIA on them
- add Fraunhofer on them
- only introduce a shared top-level orchestration helper if both adapters clearly converge on the same flow by the end of the PR

In other words: let the second adapter earn the abstraction.

### Shared `CatalogIndex` contract

The shared loader should load the existing catalog tree and build reusable lookup maps, but it must not resolve provider roots inside the loader.

Target shape:

- `datasetsByMergeKey: Map<string, Dataset>`
- `datasetFileSlugById: Map<Dataset["id"], string>`
- `distributionsByDatasetIdKind: Map<string, Distribution>`
- `distributionFileSlugById: Map<Distribution["id"], string>`
- `catalogRecordsByCatalogAndPrimaryTopic: Map<string, CatalogRecord>`
- `catalogRecordFileSlugById: Map<CatalogRecord["id"], string>`
- `agentsById: Map<Agent["id"], Agent>`
- `agentsByName: Map<string, Agent>`
- `catalogsById: Map<Catalog["id"], Catalog>`
- `dataServicesById: Map<DataService["id"], DataService>`
- `allDatasets`
- `allDistributions`
- `allCatalogRecords`
- `allCatalogs`
- `allDataServices`
- `allAgents`

Input options to the shared loader:

- `mergeAliasScheme`
- optionally `isMergeableDatasetAlias` if a provider needs to filter which aliases participate in merge lookups

Notably absent on purpose:

- no pre-resolved `catalog`
- no pre-resolved `dataService`
- no pre-resolved `agent`

Those are adapter concerns and belong in provider-specific `buildContextFromIndex`.

### Test migration rule

Do not break the large EIA test file during intermediate slices.

Preferred sequence:

1. extract one shared module
2. update the script to consume it
3. keep temporary re-exports from `scripts/cold-start-ingest-eia.ts` if that keeps the current tests stable
4. only move test imports once the adapter boundary is stable

Fraunhofer tests should start as small focused tests around adapter-local mapping plus one end-to-end script-level smoke path.

## Directory layout after this PR

```text
src/
  ingest/
    dcat-harness/
      errors.ts
      IngestNode.ts
      IngestEdge.ts
      IngestGraph.ts
      slugStability.ts
      loadCatalogIndex.ts
      buildGraph.ts
      validate.ts
      entityFiles.ts
      ledger.ts
      graphSummary.ts        # optional if it earns its keep
      index.ts
    dcat-adapters/
      eia-tree/
        EiaApiResponse.ts
        errors.ts
        fetchRoute.ts
        rateLimiter.ts
        walkRoutes.ts
        walkCache.ts
        buildContext.ts
        buildCandidateNodes.ts
        report.ts
        index.ts
      energy-charts/
        fetchSpec.ts
        buildContext.ts
        buildCandidateNodes.ts
        endpointCatalog.ts   # optional if it earns its keep
        report.ts            # only if Fraunhofer needs one; otherwise omit
        index.ts

scripts/
  cold-start-ingest-eia.ts
  cold-start-ingest-energy-charts.ts
```

## Task breakdown

### Task 1 — extract the smallest provider-neutral scaffold first

**Files**

- Create: `src/ingest/dcat-harness/IngestNode.ts`
- Create: `src/ingest/dcat-harness/IngestEdge.ts`
- Create: `src/ingest/dcat-harness/IngestGraph.ts`
- Create: `src/ingest/dcat-harness/slugStability.ts`
- Create: `src/ingest/dcat-harness/index.ts`
- Modify: `scripts/cold-start-ingest-eia.ts`

**Work**

- Move the mechanical shared pieces first: graph node/edge types, graph alias, and `stableSlug`.
- Keep EIA-specific tagged errors local for now if moving them changes the current tested surface.
- Update the EIA script to import the shared definitions.
- Keep temporary re-exports from the script if that avoids test churn in the first slice.

**Verification**

- `bun run test tests/cold-start-ingest-eia.test.ts`
- `bunx tsc --noEmit`

### Task 2 — extract validation, graph, entity-file, and ledger helpers while preserving EIA behavior

**Files**

- Create: `src/ingest/dcat-harness/validate.ts`
- Create: `src/ingest/dcat-harness/buildGraph.ts`
- Create: `src/ingest/dcat-harness/entityFiles.ts`
- Create: `src/ingest/dcat-harness/ledger.ts`
- Create: `src/ingest/dcat-harness/graphSummary.ts` only if useful
- Modify: `scripts/cold-start-ingest-eia.ts`

**Work**

- Move `validateNode(...)`.
- Move `validateCandidates(...)`.
- Preserve the current return shape exactly:

```ts
{
  readonly failures: ReadonlyArray<EiaIngestSchemaError>
  readonly successes: ReadonlyArray<IngestNode>
}
```

- Do not change validation to fail-fast.
- Move `buildIngestGraph(...)`.
- Move shared file-path / encode / atomic-write / overwrite-protection helpers.
- Move ledger helpers.
- Keep EIA logging, failure-report writing, dry-run branching, ledger update timing, and artifact emission decisions in the EIA script until both adapters prove something more shared.

**Verification**

- `bun run test tests/cold-start-ingest-eia.test.ts`
- Add focused harness tests for graph / validate / file / ledger helpers

### Task 3 — extract a genuinely shared catalog index loader

**Files**

- Create: `src/ingest/dcat-harness/loadCatalogIndex.ts`
- Modify: `scripts/cold-start-ingest-eia.ts`
- Modify: EIA builder/context code as needed

**Work**

- Move `decodeFileAs(...)`, `loadEntitiesFromDir(...)`, and `loadCatalogIndex(...)` into the harness.
- Replace EIA-shaped index fields with the shared `CatalogIndex` shape above.
- Add `agentsById`, `catalogsById`, and `dataServicesById`.
- Remove EIA root resolution from the shared loader.
- Keep `buildContextFromIndex(...)` EIA-local and update it to resolve roots from the shared maps.
- Preserve current EIA merge-key behavior.

**Verification**

- `bun run test tests/cold-start-ingest-eia.test.ts`
- Add a harness index test that loads a tiny fixture catalog and checks the shared maps

### Task 4 — move EIA-specific code into `src/ingest/dcat-adapters/eia-tree/`

**Files**

- Create: `src/ingest/dcat-adapters/eia-tree/`
- Modify: `scripts/cold-start-ingest-eia.ts`
- Modify: `tests/cold-start-ingest-eia.test.ts`

**Work**

- Move EIA-local code into adapter files:
  - `EiaApiResponse`
  - EIA fetch/decode errors
  - `fetchRoute`
  - rate limiter
  - walk cache
  - `walkRoutes`
  - `buildContextFromIndex`
  - `buildCandidateNodes`
  - EIA report builder/writer
- Keep `scripts/cold-start-ingest-eia.ts` as the explicit top-level orchestrator unless a shared orchestration helper is clearly earned later in the PR.

**Verification**

- `bun run test tests/cold-start-ingest-eia.test.ts`
- Remove temporary re-exports only after the tests have migrated cleanly

### Task 5 — add SKY-261 prerequisites

**Files**

- Modify: `src/domain/data-layer/alias.ts`
- Modify: alias tests
- Add Fraunhofer fixtures/tests as needed

**Work**

- Add `energy-charts-endpoint` to the alias scheme enum.
- Add or update tests so the new alias is accepted.
- Confirm the Fraunhofer slugs and merge keys the adapter will use.
- Decide the initial root-record slugs for:
  - Fraunhofer ISE `Agent`
  - `energy-charts` `Catalog`
  - `energy-charts` `DataService`

These decisions must be made before the adapter code lands, because the current registry has no existing files to merge against.

**Verification**

- `bun run test` for the alias/data-layer coverage affected
- `bunx tsc --noEmit`

### Task 6 — implement the Fraunhofer `energy-charts` adapter on the extracted harness

**Files**

- Create: `src/ingest/dcat-adapters/energy-charts/`
- Create: `scripts/cold-start-ingest-energy-charts.ts`
- Create: `tests/cold-start-ingest-energy-charts.test.ts`
- Modify: harness modules only if the real second adapter exposes a missing shared seam

**Work**

- Fetch `openapi.json` once.
- Iterate the OpenAPI `paths` object.
- Build:
  - one Fraunhofer `Agent`
  - one `Catalog`
  - one `DataService`
  - one `Dataset` per endpoint family
  - one `Distribution` per dataset endpoint shape
  - one `CatalogRecord` per dataset
- Use `energy-charts-endpoint` as the dataset merge key.
- Do not split datasets by country, zone, or query parameter combination.
- Keep the Fraunhofer implementation concrete. If there is an obvious tiny helper shared with future flat-API adapters, extract it; otherwise stop at the concrete adapter boundary.

**Verification**

- `bun run test tests/cold-start-ingest-energy-charts.test.ts`
- add at least one fixture-backed test that proves OpenAPI path -> dataset/distribution mapping

### Task 7 — decide whether a shared top-level runner was actually earned

**Rule**

Only after EIA and Fraunhofer both exist over the extracted harness should we decide whether a shared top-level orchestration helper belongs in this PR.

Acceptable outcomes:

- keep both scripts explicit, if their last-mile behavior still differs materially
- add a small shared orchestration helper, if both adapters genuinely converge

Unacceptable outcome:

- force both adapters through a generic runner that drops EIA failure-report behavior or awkwardly special-cases Fraunhofer

### Task 8 — final verification

**Required**

- `bunx tsc --noEmit`
- `bun run test`

**If `EIA_API_KEY` and a usable walk cache are available**

- `bun scripts/cold-start-ingest-eia.ts`
- verify no diff in:
  - `references/cold-start/catalog/`
  - `references/cold-start/.entity-ids.json`
  - `references/cold-start/reports/harvest/eia-ingest-graph.mermaid` if written by the run
  - `references/cold-start/reports/harvest/eia-ingest-report.json` if written by the run

**If network access is available for Fraunhofer**

- `bun scripts/cold-start-ingest-energy-charts.ts`
- verify the expected new Fraunhofer files are created under `references/cold-start/catalog/`
- rerun to confirm merge stability and no duplicate minting

If either live end-to-end run cannot be performed because the API key, network, or runtime environment is unavailable, call that out explicitly in the PR notes. Do not silently skip it.

## Guardrails

- Do not recreate `src/platform/ScriptRuntime.ts`.
- Do not recreate logging helpers that already exist in `src/platform/Logging.ts`.
- Do not change EIA validation from "collect all failures" to fail-fast.
- Do not move EIA report writing into the shared harness unless both adapters clearly converge on the same artifact contract.
- Do not change current EIA slug or file-naming behavior.
- Do not over-generalize Fraunhofer into a full family framework before SKY-265 / SKY-266.

## Risks

1. **Test churn from script-centric imports.** The EIA test file currently imports many helpers straight from `scripts/cold-start-ingest-eia.ts`. Temporary re-exports are acceptable during the refactor if they reduce churn.
2. **Accidental behavior drift in the EIA write path.** Entity writes, ledger updates, mermaid emission, and report emission are separate responsibilities today. Splitting them across modules without keeping the orchestration explicit would be risky.
3. **Under-scoping Fraunhofer root creation.** Because there are no existing Fraunhofer files in the registry, SKY-261 includes first-run publisher seeding, not only merge behavior.
4. **Over-generalizing the flat OpenAPI path too early.** Fraunhofer is here to prove the seam, not to force a whole framework for future adapters in advance.

## Immediate follow-up after this PR

- SKY-265
- SKY-266

Those follow next and should reuse the harness and whatever flat-API seam Fraunhofer proves out here, instead of reopening the 257 factoring work.
