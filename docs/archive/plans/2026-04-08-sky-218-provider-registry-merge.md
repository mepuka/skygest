# SKY-218: Provider Registry -> Cold-Start Catalog Merge

**Goal:** Translate the frozen `config/source-registry/energy.json` registry into the checked-in cold-start catalog without touching runtime code, while forcing an explicit review pass before any catalog writes happen.

**Architecture:** A two-phase script in `scripts/catalog-harvest/harvest-provider-registry.ts`.

- `report`: reads the registry and current catalog, then writes `references/cold-start/reports/sky-218-merge-proposals.json`
- `apply`: reads that reviewed proposals file and writes only the proposals marked `approved: true`

The apply phase must be safe to re-run. It should only add missing values, create missing files, and skip work that is already present.

## Baseline

Verified on April 8, 2026:

| Entity | Count |
|---|---|
| Agents | 52 |
| Catalogs | 52 |
| Datasets | 145 |
| Distributions | 210 |
| CatalogRecords | 147 |

Validation baseline: `bun run test -- tests/cold-start-validation.test.ts` passes.

## Fixed Design Decisions

1. **Every write proposal starts unapproved.**
   `report` writes all proposals with `approved: null`.
   Nothing is auto-approved in the proposals file.
   `apply` exits immediately if any proposal is still `null`.

2. **The apply phase is genuinely idempotent.**
   Agent enrichment re-checks the current file before appending names or URL aliases.
   Dataset creation reuses existing files when present and only fills in missing links.
   Data-service wiring reuses existing API distributions instead of blindly creating duplicates.

3. **API-backed datasets get real API access records.**
   For EIA and CAISO new datasets, `apply` must create both:
   - a landing-page distribution
   - an `api-access` distribution linked via `accessServiceId`

   It must also update:
   - `Dataset.dataServiceIds`
   - `DataService.servesDatasetIds`

4. **ENTSO-E is handled explicitly.**
   The existing `entsoe-transparency` dataset should be wired to a checked-in ENTSO-E Transparency Platform data service if that service is missing today.
   This requires:
   - a `create-data-service` proposal when `entsoe-transparency-api.json` does not exist
   - a `wire-existing-dataset-service` proposal for `entsoe-transparency` if it lacks API wiring

5. **Low-confidence source families are resolved, not left vague.**
   The review file should still require approval, but the script should emit concrete recommended actions:
   - `entso-e / Annual Report` -> reject for this pass
   - `ferc / Energy Primer` -> reject for this pass
   - `iea / Electricity` -> map to existing `iea-demand`
   - `miso / Market Reports` -> map to existing `miso-market-data`
   - `pjm / Annual Report` -> reject for this pass

## Provider Matching

| energy.json `providerId` | Cold-start slug | Status |
|---|---|---|
| aeso | — | NEW |
| bc-hydro | — | NEW |
| caiso | caiso | EXISTS |
| eia | eia | EXISTS |
| entso-e | entso-e | EXISTS |
| ercot | ercot | EXISTS |
| ferc | ferc | EXISTS |
| iea | iea | EXISTS |
| ieso | — | NEW |
| iso-new-england | iso-ne | EXISTS |
| miso | miso | EXISTS |
| nrel | nrel | EXISTS |
| nyiso | nyiso | EXISTS |
| pjm | pjm | EXISTS |
| spp | spp | EXISTS |

## Reviewed Source-Family Decisions

### Existing dataset matches

| Provider | source family | Existing dataset |
|---|---|---|
| eia | Short-Term Energy Outlook | eia-steo |
| eia | Natural Gas Monthly | eia-natural-gas |
| entso-e | Transparency Platform | entsoe-transparency |
| entso-e | European Resource Adequacy Assessment | entso-e-adequacy-assessment |
| iea | World Energy Outlook | iea-weo-dataset |
| iea | Electricity | iea-demand |
| iea | Renewables | iea-renewables |
| miso | Market Reports | miso-market-data |
| nrel | Annual Technology Baseline | nrel-atb |
| pjm | Load Forecast Report | pjm-load-forecast |
| pjm | Annual Markets Report | pjm-state-of-market |

### Reject in this pass

| Provider | source family | Reason |
|---|---|---|
| entso-e | Annual Report | Treat as a publication, not a dataset |
| ferc | Energy Primer | Treat as an educational document, not a dataset |
| pjm | Annual Report | Treat as a general corporate report, not a dataset |

Everything else becomes a new dataset proposal.

## Data-Service Scope

This pass wires provider API services only where we have a clear checked-in service target:

| Provider | Data service slug | Handling |
|---|---|---|
| caiso | `caiso-oasis` | Reuse existing service for new CAISO datasets |
| eia | `eia-api` | Reuse existing service for new EIA datasets |
| entso-e | `entsoe-transparency-api` | Create if missing, then wire `entsoe-transparency` |

This pass does **not** blanket-wire all IEA datasets to `iea-api`. The existing IEA API service stays tied to the data-portal lane unless a separate review explicitly broadens it.

## Implementation Tasks

### Task 1: Build the script

Create `scripts/catalog-harvest/harvest-provider-registry.ts` with these proposal actions:

- `enrich-agent`
- `create-agent`
- `create-catalog`
- `create-data-service`
- `wire-existing-dataset-service`
- `create-dataset`
- `skip-existing-dataset`
- `reject-source-family`

`report` requirements:

- reads `energy.json`, `.entity-ids.json`, and existing catalog files
- emits one proposal per action
- sets every proposal to `approved: null`
- uses deterministic timestamps in the proposals file
- does not modify any catalog JSON under `references/cold-start/catalog/`

`apply` requirements:

- exits if any proposal still has `approved: null`
- processes proposals in dependency order
- creates missing agents/catalogs/data services/datasets/distributions/catalog records
- updates existing datasets and data services only to add missing links
- never duplicates existing alternate names, URL aliases, distribution IDs, data-service IDs, or `servesDatasetIds`

### Task 2: Run report mode

Run:

```sh
bun scripts/catalog-harvest/harvest-provider-registry.ts report
```

Verify:

- only the proposals file changes outside the new script itself
- no files under `references/cold-start/catalog/` are modified

### Task 3: Review and approve the proposals

Review `references/cold-start/reports/sky-218-merge-proposals.json`.

For the first real apply, approve the reviewed recommendations above:

- approve the create/enrich proposals that match the resolved design
- approve the existing-dataset mappings listed above
- approve the three rejections listed above
- reject only proposals that clearly contradict the reviewed decisions

No `approved: null` entries may remain before `apply`.

### Task 4: Run apply mode

Run:

```sh
bun scripts/catalog-harvest/harvest-provider-registry.ts apply
```

Expected results:

- 3 new agents: AESO, BC Hydro, IESO
- 3 new catalogs for those agents
- new datasets for the remaining unmatched source families
- new API access distributions for EIA and CAISO datasets
- a new ENTSO-E transparency data service if it did not already exist
- updated `.entity-ids.json`

### Task 5: Validate

Run:

```sh
bun run test -- tests/cold-start-validation.test.ts
```

The suite must pass after apply.

### Task 6: Review the diff

Confirm the diff only touches:

- `scripts/catalog-harvest/harvest-provider-registry.ts`
- `docs/plans/2026-04-08-sky-218-provider-registry-merge.md`
- `references/cold-start/` outputs

And confirm it does **not** touch:

- `src/`
- `config/source-registry/energy.json`
- D1 migrations

## Invariants

1. `bun run test -- tests/cold-start-validation.test.ts` passes before and after apply
2. `report` is read-only with respect to `references/cold-start/catalog/`
3. `apply` refuses to run with unreviewed proposals
4. Re-running `apply` does not duplicate additive fields
5. Every new dataset has at least one distribution and one catalog record
6. API-backed datasets get an `api-access` distribution, not just a dataset-level service link
7. ENTSO-E Transparency Platform service wiring is handled in this pass

**D2: Ambiguous sourceFamilies get `confidence: "low"` and `approved: null`.** Six entries (ENTSO-E "Annual Report", IEA "Electricity", IEA "Global Energy Review", FERC "Energy Primer", MISO "Market Reports", PJM "Annual Report") have generic titles that could overlap with existing datasets. The human must decide for each.

**D3: DataService wiring is bidirectional.** New datasets for CAISO, EIA, and IEA get `dataServiceIds` pointing to the existing DataService. The DataService's `servesDatasetIds` is also updated to include the new dataset. This is more complete than just creating a landing-page Distribution.

**D4: Report timestamp is deterministic.** The proposals file uses the fixed timestamp `2026-04-08T00:00:00.000Z` rather than `new Date().toISOString()`. IDs are only minted during apply (not report), and apply skips entities whose slug already has a file on disk. This makes both phases stable across reruns.

**D5: Idempotent apply.** If a file already exists for a given slug, apply skips it rather than overwriting. This means you can safely re-run apply without duplicating or clobbering entities.
