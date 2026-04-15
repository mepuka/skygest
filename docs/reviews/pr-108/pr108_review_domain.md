# PR #108 Review — Level 3: Domain Model Tightness

Scope: SKY-336 (matcher normalization + dataset scope) and SKY-338 (visible URL tightening).

## Strengths

- `src/domain/resolutionKernel.ts` additions are minimal and idiomatic: `DatasetId` reused from `domain/data-layer/ids.ts`, `dataset-scope-empty` added to the existing `ResolutionGapReason` literal union, and `datasetIds` mirrors the pre-existing `agentId` shape on `ResolutionGap.context` and `Resolved`. Pure schema extension, no duplication. (src/domain/resolutionKernel.ts:3, 173, 190, 246)
- `DatasetTitleEvidence` and `DatasetAliasEvidence` already live in `src/domain/stage1Evidence.ts:47-63`, and Stage1's new branch reuses both tagged structs rather than defining local evidence shapes. `rank` is the existing `Stage1Rank` brand.
- `Bind.ts` propagates `ReadonlyArray<DatasetId>` end-to-end: `BoundHypothesis.datasetIds` is branded, `narrowCandidatesByDatasets` takes `ReadonlyArray<DatasetId>` and calls `lookup.findVariablesByDatasetId`, and the outcome is collapsed through `VariableCandidateScore.variableId` (`VariableId` brand). No raw string IDs leak. (src/resolution/kernel/Bind.ts:32, 117-129, 204)
- `AssembleOutcome.ts` correctly threads `datasetIds` through `asGap` and into both `Resolved` and `OutOfRegistry` outputs, and widens the out-of-registry predicate to include `dataset-scope-empty`. Branding preserved. (src/resolution/kernel/AssembleOutcome.ts:33, 116, 158)
- `DatasetNameMatch` variants carry the full `Dataset` domain object (with branded `id: DatasetId`), not raw strings or `{id, title}` tuples — callers always receive a re-scoped domain entity. (src/resolution/datasetNameMatch.ts:16-30)

## Must-fix

### M1. `DatasetNameMatch` tagged union belongs in `src/domain/`

`src/resolution/datasetNameMatch.ts:16-30` defines a tagged discriminated union (`DatasetTitleExactMatch` | `DatasetTitleFuzzyMatch` | `DatasetAliasMatch`) and exports it. It is already consumed across module boundaries:

- `src/resolution/Stage1.ts` imports `findDatasetMatchesForName` and pattern-matches on `match._tag` (Stage1.ts:325-351).
- `src/resolution/ResolutionKernel.ts` imports `findDatasetMatchesForName` and reads `match.dataset.id` (ResolutionKernel.ts:91).

This is a cross-module data type. Per CLAUDE.md rule 1–2, it should be defined in `src/domain/`, not in `src/resolution/`. The current placement is a domain rule violation identical in shape to why `DatasetTitleEvidence` lives in `src/domain/stage1Evidence.ts`.

Additionally, it is a **plain TypeScript union, not a `Schema`**. Everything else of this shape in the resolution layer (`BoundResolutionBoundItem`, `BoundResolutionGapItem`, `DatasetTitleEvidence`, etc.) is a `Schema.TaggedStruct` / `Schema.Union`. The type is not encoded/decoded at a boundary here, so a plain union is technically okay, but it makes the domain layer inconsistent — nothing prevents a future caller from wanting to persist or round-trip it.

**Suggested move:** Create `src/domain/datasetNameMatch.ts` (or add to `src/domain/stage1Evidence.ts`):

```ts
import { Schema } from "effect";
import { AliasScheme } from "./data-layer/alias";
import { Dataset } from "./data-layer/catalog";

export const DatasetTitleExactMatch = Schema.TaggedStruct("DatasetTitleExactMatch", {
  dataset: Dataset
});
export const DatasetTitleFuzzyMatch = Schema.TaggedStruct("DatasetTitleFuzzyMatch", {
  dataset: Dataset
});
export const DatasetAliasMatch = Schema.TaggedStruct("DatasetAliasMatch", {
  dataset: Dataset,
  aliasScheme: AliasScheme,
  aliasValue: Schema.String
});
export const DatasetNameMatch = Schema.Union([
  DatasetTitleExactMatch,
  DatasetTitleFuzzyMatch,
  DatasetAliasMatch
]);
export type DatasetNameMatch = Schema.Schema.Type<typeof DatasetNameMatch>;
```

Then `src/resolution/datasetNameMatch.ts` keeps only the *operations* (`findDatasetMatchesForName`, `listPreferredDatasetAgentIds`, `stripPeripheralYear`, scoring helpers) and imports the type from domain. This matches the pattern where `Stage1Evidence` lives in domain while operators live in `src/resolution/Stage1.ts`.

### M2. `aliasValue: Schema.String` on `DatasetAliasEvidence` — acceptable, but raw `aliasValue: string` on `DatasetAliasMatch` should align

The new `DatasetAliasMatch` carries `aliasValue: string` (src/resolution/datasetNameMatch.ts:29). When re-emitted as `DatasetAliasEvidence` in `Stage1.ts:349-355`, the `aliasValue` flows into a `Schema.String` slot. No branded type exists today for alias values, so this is fine — but note it for consistency. Not blocking.

### M3. Cold-start catalog JSON: `scheme: "other"` is the only available literal but semantically wrong

`AliasScheme` in `src/domain/data-layer/alias.ts:4-12` includes `"other"` as the catch-all. The three catalog JSON additions (eia-electric-system-operating-data.json:37,42; ember-data-explorer.json:8; nrel-atb.json:8,13) all use `scheme: "other"` with `relation: "closeMatch"` to register human-facing display names like `"EIA Hourly Electric Grid Monitor"`, `"NREL ATB"`, `"Annual Technology Baseline"`.

These are **not external identifiers**. They are vernacular title variants / alternate labels used for title-based fuzzy matching. The `AliasScheme` enum is documented as "External identifier namespace" (src/domain/data-layer/alias.ts:27) — none of the existing schemes fit this use case, and `"other"` is being repurposed as "display alias".

**This is load-bearing**: the matcher code explicitly filters aliases by `alias.scheme === "other"` to build title haystacks (src/resolution/datasetNameMatch.ts:161). The rule is implicit — a future developer adding a real `"other"`-scheme external ID (say, a vendor-specific code) will silently inject garbage into fuzzy title scoring.

**Must-fix options (pick one):**

1. **Preferred — add a new scheme** `"display-alias"` or `"alt-title"` to `aliasSchemes` and have the matcher filter on that explicitly. This makes the intent machine-readable and keeps `"other"` as true external-identifier fallback.
2. Document the semantic overload on `"other"` in `src/domain/data-layer/alias.ts` annotations, and rename the filter site to a named helper `isDisplayAlias(a)` with a comment. Weaker: still couples matcher semantics to a free-text enum slot.

Note this is the SKY-336 matcher-normalization initiative itself — it's the right time to introduce the scheme. SKY-311 (from recent history) already pruned vocabulary, so the project culture treats these additions as first-class.

### M4. `ResolutionKernel.ts` keys `datasetIdsByAssetKey` by `string`

`src/resolution/ResolutionKernel.ts:95` builds `Map<string, ReadonlyArray<DatasetId>>` keyed on `asset.assetKey` (raw `string`). `assetKey` is untyped in `VisionAssetEnrichment` as well, so this is consistent with the current domain — not a PR regression — but it's the exact spot where a future `AssetKey` brand would slot in. Flag for a follow-up, not a blocker for this PR.

### M5. `src/resolution/ResolutionKernel.ts:15` redundant type aliasing

```ts
import { Stage1Input, type Stage1Input as Stage1InputValue } from "../domain/stage1Resolution";
```

The file imports `Stage1Input` twice under two names. `Stage1Input` is already both the schema and the type (Effect's standard `Schema.Schema.Type<typeof Stage1Input>` re-export pattern). Just use `Stage1Input` as the type annotation in `resolveDatasetIdsForAsset`/`resolveDatasetIdsByAssetKey`. Minor, but the alias obscures intent.

## Should-fix

### S1. `listPreferredDatasetAgentIds` return type `ReadonlyArray<Agent["id"]>` — prefer named brand

`src/resolution/datasetNameMatch.ts:107-152` returns `ReadonlyArray<Agent["id"]>`. `Agent["id"]` resolves to `AgentId` via indexed access, but importing `AgentId` directly from `src/domain/data-layer/ids.ts` is clearer and matches how `Bind.ts`, `AssembleOutcome.ts`, and `resolutionKernel.ts` use it. Same critique applies to the `options.preferredAgentIds?: ReadonlyArray<Agent["id"]>` parameter on `findDatasetMatchesForName` (datasetNameMatch.ts:252) and on `pushDatasetTitleMatch` in Stage1.ts:317. Three call sites, three places where `AgentId` would read better.

### S2. `dedupeDatasets` uses `Set<string>`

`src/resolution/datasetNameMatch.ts:92` — `const seen = new Set<string>();` widens `DatasetId` to `string`. Functionally fine but loses the brand at the key site. Low-priority.

### S3. `normalizeVisibleUrls` could emit a branded `HttpsUrl`

`src/enrichment/GeminiVisionServiceLive.ts:298-311` now validates that each visibleUrl parses via `new URL(...)` and is `http/https`. After normalization, every output is provably a valid http(s) URL. The persisted schema `VisionAssetAnalysisV2.visibleUrls` is still `Schema.Array(Schema.String)` (src/domain/enrichment.ts:95). You already have a branded `HttpsUrl` (from the CLAUDE.md rule list). Tightening this to `Schema.Array(HttpsUrl)` would let the brand assertion run automatically when historical rows are re-decoded — but it would be a schema migration with back-compat concerns (existing D1 rows may have garbage URLs that previously decoded fine).

**Recommendation:** Leave the stored schema as `Schema.String` in this PR (back-compat). But in `normalizeVisibleUrls`, decode through `HttpsUrl` at the write boundary so the property holds for newly-written rows:

```ts
const normalized = Schema.decodeOption(HttpsUrl)(url.toString());
return Option.match(normalized, { onNone: () => [], onSome: (v) => [v] });
```

This also gives you uniform behavior if `HttpsUrl` tightens further (e.g. IDN, port restrictions). Verify `HttpsUrl` actually exists first — it's in the CLAUDE.md brand list but I didn't grep the definition.

### S4. `URLISH_FRAGMENT_PATTERN` — regex as source of truth duplicates `HttpsUrl` validation

`src/enrichment/GeminiVisionServiceLive.ts:254-256` re-implements URL shape validation via regex, then re-validates via `new URL()`. The double-check is fine for pre-filtering LLM noise, but the regex becomes a maintenance liability. Comment the *intent* ("pre-filter LLM noise before URL parsing") so it's clear why both layers exist.

### S5. `ResolutionKernel.ts` — `ResolutionScopeOptions` defined inline

`src/resolution/ResolutionKernel.ts:18-21` defines a local `ResolutionScopeOptions` type that mirrors the `options` parameter shape of `resolveBundle` / `bindHypothesis`. This shape also exists inline in `Bind.ts:202-205`. Extract it once into `src/domain/resolutionKernel.ts`:

```ts
export const ResolutionScopeOptions = Schema.Struct({
  agentId: Schema.optionalKey(AgentId),
  datasetIds: Schema.optionalKey(Schema.Array(DatasetId))
});
export type ResolutionScopeOptions = Schema.Schema.Type<typeof ResolutionScopeOptions>;
```

Then both `ResolutionKernel.ts` and `Bind.ts` import it. This also aligns with the `ResolutionGap.context` inner struct which has the same two fields — and that one *is* already schema-valued.

## Minor / Style

- `src/resolution/datasetNameMatch.ts:32` `toNonEmpty` — this helper exists in at least `Stage1.ts` and probably other resolution modules. The domain rule says "no duplicate helpers" — check `src/platform/` for a canonical `nonEmptyString` helper first. Not PR-blocking.
- `src/resolution/datasetNameMatch.ts:14` `DATASET_TITLE_SCORE_EPSILON = 0.000_001` — magic number adjacent to `FUZZY_CANDIDATE_THRESHOLD = 0.6` in fuzzyMatch.ts. Consider co-locating thresholds in fuzzyMatch.ts to give one file the "where do fuzzy constants live" answer.
- `src/resolution/datasetNameMatch.ts:10-12` — `structuredAliasSchemes = aliasSchemes.filter(...)` runs at module load. Fine, but is derivable; if you add a new `"display-alias"` scheme (M3), decide whether it joins the structured-alias pool or is kept separate.
- The new module name `datasetNameMatch.ts` reads as a type name (noun). After extracting the type to domain (M1), consider renaming the operation module to `findDatasetMatches.ts` or `datasetMatching.ts`. Nit.

## Specific moves (concrete)

1. **Create `src/domain/datasetNameMatch.ts`** with `DatasetNameMatch` as a `Schema.Union` of three `Schema.TaggedStruct`s. Import `Dataset` from `./data-layer/catalog` and `AliasScheme` from `./data-layer/alias`. Export both the schema and the derived type. (Must-fix M1)

2. **Delete `DatasetNameMatch` type from `src/resolution/datasetNameMatch.ts:16-30`** and replace with `import type { DatasetNameMatch } from "../domain/datasetNameMatch"`. Construct sites at lines 236–241 and 266–269 and 278–281 already produce compatible objects.

3. **Add `"display-alias"` to `aliasSchemes`** in `src/domain/data-layer/alias.ts:4-12`, with an annotation explaining it is for human-readable title variants used by the matcher (not external identifiers). Update the three catalog JSON files to use `"scheme": "display-alias"` instead of `"other"`. Update the filter in `src/resolution/datasetNameMatch.ts:161` to `alias.scheme === "display-alias"`. Update `structuredAliasSchemes` in that file to exclude `"display-alias"` along with `"url"`. (Must-fix M3)

4. **Replace `Agent["id"]` with `AgentId`** at `src/resolution/datasetNameMatch.ts:111, 112, 188, 252` and at `src/resolution/Stage1.ts:317`. Import from `"../domain/data-layer/ids"`. (Should-fix S1)

5. **Extract `ResolutionScopeOptions`** to `src/domain/resolutionKernel.ts`, use in `ResolutionKernel.ts:18-21` and `Bind.ts:200-205`. (Should-fix S5)

6. **Remove redundant alias** at `src/resolution/ResolutionKernel.ts:15` — use `Stage1Input` as both schema and type.

## Summary

The kernel-side domain changes (resolutionKernel.ts, Bind.ts, AssembleOutcome.ts) are clean: branded `DatasetId` flows through unchanged, schema additions reuse existing literal unions, no duplicate shapes. The headline issue is the new `src/resolution/datasetNameMatch.ts` module, which cleanly separates operations but defines a cross-module tagged union *outside* `src/domain/` (M1) and leans on `scheme: "other"` as a semantic overload for display-alias title matching (M3). Both are straightforward to fix and neither requires reworking the SKY-336 logic itself — only moving the type and adding one enum value.

The SKY-338 visible-URL tightening is well-scoped and does not touch domain schemas. Potential brand upgrade to `HttpsUrl` is called out as S3 but is optional.
