# PR #108 — Level 1 Review: Contract & API Design

Branch: `sky-336/datasetname-matcher-normalization`
Focus: public contracts of `datasetNameMatch.ts`, kernel scoping, vision prompt, catalog aliases.

## Strengths

- **`DatasetNameMatch` is a clean sum type with a pure-function API.** `src/resolution/datasetNameMatch.ts:16-30` exports a three-arm discriminated union (`DatasetTitleExactMatch`, `DatasetTitleFuzzyMatch`, `DatasetAliasMatch`) and `findDatasetMatchesForName` at `:248-285` is a stateless function taking `(datasetName, lookup, options)`. No hidden state, no services, no layers. This is exactly right for a pure lookup helper and it composes equally well from `Stage1.ts` and from `ResolutionKernel.ts` without any adapter.

- **The scoping contract extends rather than replaces the existing agent-scope.** `src/resolution/kernel/Bind.ts:262-307` inserts dataset-narrowing *before* agent-narrowing but composes the two cleanly: dataset-scope-empty short-circuits to a typed gap (`:275-285`), and agent narrowing then further tightens the dataset-narrowed set. The gap reasons added to `src/domain/resolutionKernel.ts:173-174` (`dataset-scope-empty` alongside the existing `agent-scope-empty`) preserve the diagnostic grain instead of collapsing into a generic "scope-empty". This is the right shape for a retrieval-gate architecture.

- **Scoping is a hard filter, not a rerank, and is honest about it.** `Bind.ts:262-285` genuinely removes candidates rather than boosting scores, and the `dataset-scope-empty` reason lets `AssembleOutcome.ts:154-161` route the outcome into `OutOfRegistry` rather than silently falling back to unscoped. No "soft scope" magic — the caller sees the decision.

- **Vision URL tightening is a *post-processing validator*, not just a prompt reword.** `GeminiVisionServiceLive.ts:254-308` introduces `normalizeVisibleUrls` which exact-tests each string against `URLISH_EXACT_PATTERN`, falls back to regex-extraction inside the candidate, and only keeps values that parse as `http(s):` URLs via `new URL(...)`. This is defense-in-depth — prompt change + output sanitization — so if Gemini regresses the schema still holds. The tests at `tests/gemini-vision-service.test.ts:977-998` confirm the contract (headline text rejected, bare domain upgraded, full URL preserved).

- **Catalog registration discipline is actually enforced.** `src/resolution/dataLayerRegistry.ts:549-567` uses `registerExactLookup` for `datasetByTitle` and `datasetByAlias`, which emits a diagnostic on collision (`:427-434`). Adding `other`-scheme aliases like `"NREL ATB"` can't silently overwrite existing mappings — if we later add a second dataset claiming `"ATB"` it will surface as a registry issue, not a mystery match.

## Must-fix

None. The contracts hang together, the types propagate correctly, and the behavior is conservative in the right places.

## Should-fix

### S1. `findDatasetAliasMatches` can false-positive on bare all-caps tokens from `extractStructuredIdentifierCandidates`
**Location:** `src/resolution/datasetNameMatch.ts:64-80`, `:223-246`; `src/resolution/normalize.ts:115-123`.

`listStructuredAliasCandidates` expands `"2024 NREL ATB"` into `["2024 NREL ATB", "NREL", "ATB", "2024"]` (because `STRUCTURED_IDENTIFIER_PATTERN` is `/\b[A-Z0-9][A-Z0-9_-]{1,}\b/gu`). `findDatasetAliasMatches` then loops every candidate against every `structuredAliasScheme`. Right now the only `"other"` aliases in the catalog are multi-word strings (`"NREL ATB"`, `"Ember Electricity Data Explorer"`, etc.), so nothing collides. But the contract is a booby trap for the next person adding aliases: if anyone lands a single-token `"other"` alias (say `"ATB"` or `"WEO"` for `World Energy Outlook`) or if a dataset has a short `"doi"` / `"wikidata"` ID that happens to appear as an acronym somewhere, this loop will silently cross-match on bare acronyms.

This alias path is only reachable when title-exact and fuzzy both miss, which mitigates impact today — but the fuzzy layer at `:185-221` already includes `other`-scheme aliases in the haystack (`:160-163`), so the alias fallback at `:284` is almost dead code for the multi-word case. Recommend either:
- (cheap) document at `:229` that `structuredAliasSchemes` should not be fed bare acronym candidates, and skip candidates shorter than some threshold when the scheme is `"other"`; or
- (better) don't consult `other`-scheme aliases at all in `findDatasetAliasMatches` — they're already in the fuzzy haystack. Keep the structured alias path for domain-specific schemes (`doi`, `wikidata`, `ror`, `eia-series`, etc.) where false-positives are near-impossible because values are structural.

### S2. `DATASET_TITLE_FUZZY_THRESHOLD = 0.75` is hardcoded at module scope
**Location:** `src/resolution/datasetNameMatch.ts:13`.

The SKY-336 summary calls out that `"Yearly electricity data"` misses at 0.88 and we decided to drop the threshold; the value should be tunable per eval run without editing source. Two specific asks:
1. Accept it as an option on `findDatasetMatchesForName`'s `options` parameter so the eval harness can sweep it.
2. Cross-reference the constant with `FUZZY_CANDIDATE_THRESHOLD` / `FUZZY_CONFIDENT_THRESHOLD` in `src/resolution/fuzzyMatch.ts:3-4`. Those are exported module-scope constants; the new constant at `:13` is *not exported*. The dataset-title matcher is now using yet a third threshold (0.75) that's invisible from outside the module. At a minimum export it so tests and eval code can reference the same name.

### S3. `VisionEnrichment.visibleUrls` remains `Schema.Array(Schema.String)` — no schema-level URL constraint
**Location:** `src/domain/sourceMatching.ts:171`, `src/domain/enrichment.ts:95`, `src/enrichment/GeminiVisionServiceLive.ts:153`.

The fix path is (a) prompt instruction, (b) runtime sanitization in `normalizeVisibleUrls`. The domain schema is unchanged, which means any code path that *doesn't* go through `normalizeExtractionResponse` (e.g. backfill, re-decode from persisted JSON, a future alternate vision provider) can still land bare domains in the field. This is acceptable given that the single producer today is `GeminiVisionServiceLive`, but the correct long-term shape is a branded `VisibleUrl` type (or at minimum `Schema.String.pipe(Schema.filter(isHttpUrl))`) so the invariant is enforced at the domain boundary, not at the Gemini adapter. Call it out as a follow-up; not a blocker for this PR.

Related: existing persisted `VisionEnrichment` JSON in staging D1 still contains bare domains from the v3.1.0 prompt runs. There is no migration and no filter on read. `Stage1.ts:725-728` feeds those raw strings into `pushDistributionMatches` → `pushStructuredAliasMatches`. That's fine today (the distribution lookup just won't match), but worth a comment that the tightening is *new-write only*. Persisted reads get the old shape. (See also the `visibleUrls: ["spp.org"]` test fixture at `tests/gemini-vision-service.test.ts:805` for the legacy path — already covered.)

### S4. `DatasetNameMatch` types carry no score or confidence — ambiguity between ties is lost
**Location:** `src/resolution/datasetNameMatch.ts:16-30`, `:185-221`.

`findFuzzyDatasetTitleMatches` computes a score per candidate (`:200-204`), picks the best, then returns all candidates within `DATASET_TITLE_SCORE_EPSILON` of the top (`:212-217`). But the returned `DatasetNameMatch` drops the score entirely — both exact and fuzzy are just `{ _tag, dataset }`. Two problems:

1. **`Stage1.ts:340` hardcodes `rank: match._tag === "DatasetTitleExactMatch" ? 1 : 2`** — any fuzzy match gets the same rank regardless of whether it scored 0.75 or 1.00. The kernel has no way to prefer a 0.92 fuzzy match over a 0.78 one. For evidence-based ranking this is the wrong shape; the evidence payload should carry the score.
2. **Multiple co-top fuzzy matches all get added as separate Dataset matches with rank 2.** `resolveGrain` at `Stage1.ts:579-610` will see them all with the same `bestRank` and emit an `AmbiguousCandidatesResidual`. That's arguably correct, but the lost score information means downstream can't distinguish "two datasets at 0.95" from "five datasets at 0.76".

Recommend either (a) add `score: number` to the `DatasetTitleFuzzyMatch` arm, or (b) return a richer `{ dataset, score, via: "title" | "alias:<scheme>" }` tuple. The latter is the shape the SKY-336 summary suggests for "use as high-precision booster" downstream.

### S5. `Stage1.ts` and `ResolutionKernel.ts` redundantly resolve the same dataset-name → dataset mapping
**Location:** `src/resolution/Stage1.ts:666-703` (Stage 1 per-sourceLine call); `src/resolution/ResolutionKernel.ts:73-94` (kernel call).

Both code paths call `findDatasetMatchesForName(sourceLine.datasetName, ...)` with the same `preferredAgentIds`. The kernel is invoked via `resolveBundle` which consumes `buildResolutionEvidenceBundles(decoded)` — it does *not* read Stage1's `matches[]`. So the same matcher runs twice per request, once for Stage 1 evidence emission and once for kernel scoping. Given the current catalog size (~1,315 datasets × ~3 haystack entries × 2 candidate variants) this is maybe 8k Jaccard comparisons doubled. Not a perf emergency — but it does mean there's no single source of truth for "which datasets does this name match", and if someone tweaks one call site's options they won't remember the other. Either:
- memoize via a per-request cache keyed by `(datasetName, preferredAgentIds)`, or
- pass Stage 1's resolved dataset IDs forward to the kernel through the input shape (coupling, but correct),
- or explicitly document at `ResolutionKernel.ts:73` that it deliberately re-runs for isolation and mark Stage 1's emission as "diagnostic only".

### S6. `preferredAgentIds` contract is duplicated, not shared
**Location:** `datasetNameMatch.ts:107-152` (`listPreferredDatasetAgentIds`) vs `ResolutionKernel.ts:33-71` (`resolveAgentIdFromStage1Input`).

Both compute an agent identity from `Stage1Input.sourceAttribution` + vision mentions, but they return different shapes (`ReadonlyArray<AgentId>` vs `AgentId | undefined`) and use slightly different precedence. `listPreferredDatasetAgentIds` also consults `organizationMentions` and `logoText` (`:143-149`); `resolveAgentIdFromStage1Input` does not. The `agentId` that eventually reaches `Bind.ts` via `ResolutionKernel.ts:138` therefore comes from a narrower set of hints than the `preferredAgentIds` that drive dataset-name scoping. This is subtle but creates a class of bugs where the dataset scope chooses a "preferred" agent set, the kernel binds against a *different* agent, and the resulting `Resolved` outcome is internally inconsistent. Consolidate both paths onto one helper; document the precedence rule.

## Minor / style

- `src/resolution/datasetNameMatch.ts:10-12` — `structuredAliasSchemes` is declared module-scope and also re-declared identically at `Stage1.ts:70-72`. Export from one place (probably `datasetNameMatch.ts` or a new `aliasFilter.ts`) and import.
- `datasetNameMatch.ts:82-87` — `listAllDatasets(lookup)` builds the array fresh on every `findFuzzyDatasetTitleMatches` call. At the current catalog size this is fine, but since `lookup.entities` is a `Chunk.Chunk`, consider caching the filtered dataset list on the lookup itself (would need a `datasets: ReadonlyArray<Dataset>` accessor).
- `datasetNameMatch.ts:158-163` — only consults aliases `where scheme === "other"` when scoring titles. An alias with `scheme: "wikidata"` whose value happens to be a plausible title string won't be scored. Given the current SKOS conventions this is probably intentional, but it's undocumented. Add a one-line comment explaining the filter.
- `Stage1.ts:311-375` — `pushDatasetTitleMatch` takes a bag of options including `emitResidualOnMiss` that the caller then *also* handles explicitly (`Stage1.ts:692-702` manually pushes the residual after setting `emitResidualOnMiss: false`). Either trust the helper or remove the parameter.
- `GeminiVisionServiceLive.ts:252-253` — `URLISH_FRAGMENT_PATTERN` uses a `g` flag globally while also being compiled into a new regex with the `u` flag at `:256` for the exact test. The `g` flag is stateful on `RegExp` — `trimmed.match(URLISH_FRAGMENT_PATTERN)` inside `normalizeVisibleUrls` at `:299` uses it correctly (non-stateful via `.match`) but future maintainers should be warned not to call `.test()` or `.exec()` on the global instance. Either remove the `g` flag from the shared constant and use a local inside `normalizeVisibleUrls`, or comment the hazard.
- `prompts.ts:40` vs `prompts.ts:87-91` — the same instruction is phrased differently for the two prompt templates. Minor drift but it matters because the evaluator diffs by `VISION_PROMPT_VERSION`. Consider a single instruction string imported from both places.

## Alignment with SKY-335 (stem/lines decomposition) and the reframe design

The reframe design doc referenced at `eval/fact-finding/sky-336/summary.md:117` is not present in `docs/plans/` on this branch (I checked — the file is listed as pending). I reviewed against the intent described in the fact-finding docs.

**Where this PR *helps* SKY-335:**
- `AssembleOutcome.ts:108-121` preserves `datasetIds` on the `Resolved` outcome. When stem/lines lands, a chart where every line binds to a Variable *of the same dataset* can be recognized by reading `outcome.datasetIds` — the scope collapse for free. No further kernel changes needed.
- `Bind.ts:262-307` operates *per hypothesis item*, so when `buildResolutionEvidenceBundles` starts producing multi-item hypotheses (one item per series), the dataset-narrowing applies correctly to each item without re-plumbing. The new gap reasons (`dataset-scope-empty`) are already per-item.

**Where this PR *constrains* SKY-335 — flag as follow-up:**
- `ResolutionKernel.ts:73-94` computes `datasetIds` per `asset.assetKey`, not per bundle. `buildResolutionEvidenceBundles` is currently one-bundle-per-asset (I'm inferring from the bundle-has-`assetKey` shape at `resolutionKernel.ts:96`), but if SKY-335 starts emitting *multiple bundles per asset* (one per series-group), the dataset scope gets replicated across every bundle of the same asset. The datasetIds are the same across replicas, so behavior is correct — but the naming `datasetIdsByAssetKey` encodes the one-bundle-per-asset assumption in the lookup shape. Before SKY-335 lands, rename to something like `datasetIdsByAsset` and document that the mapping is "scope for all bundles derived from this asset".
- `Stage1.ts:680-703` attributes each dataset-name match to `asset.assetKey` in the residual. That's fine, but it doesn't track *which sourceLine* produced it. If two sourceLines on the same asset name two different datasets, Stage 1 emits a single Dataset-grain match bucket with mixed evidence and the kernel sees `datasetIds = [ds1, ds2]` — both are then union-scoped in `narrowCandidatesByDatasets` (`Bind.ts:117-131`). That's the correct behavior *today* (single Variable per chart) but under stem/lines it will produce scope-unions across series that shouldn't share a dataset. Flag: when SKY-335 lands, `resolveDatasetIdsForAsset` should return a `Map<sourceLineIndex, DatasetId[]>` or similar, not a flat union.
- `ResolutionKernel.ts:145-156` hands the same `datasetIds` scope to every bundle in the asset. If SKY-335 introduces `bundle.itemToSourceLine` hints, the kernel should route per-item scopes rather than a single bundle-wide scope. No contract change needed for this PR, but the current shape of `ResolutionScopeOptions` at `ResolutionKernel.ts:18-21` will need to evolve to `{ agentId, datasetIdsByItemKey }`.

**Compatibility with the reframe "α-path vs β-path" split:**
- The reframe's α-path is "datasetName-match collapses scope to Dataset and picks Variable inside it". This PR implements exactly that as a hard filter in `Bind.ts:262-285`, and `OutOfRegistry` semantics at `AssembleOutcome.ts:154-161` give the β-path a clean fallback signal. The shape is compatible.
- The reframe's β-path is "facet retrieval unscoped when datasetName missing or no match". This PR's `options.datasetIds === undefined` path at `Bind.ts:262-264` is literally that. Good.
- The one friction point: reframe wants `datasetName` to be a *retrieval* input, i.e. used to build an embedding-search query. This PR uses it only as a *filter*. When the retrieval kernel lands, the filter-side implementation here must not be the only consumer — otherwise catalog-gap datasets (75% of unmatched per the SKY-336 summary) get zero value from `datasetName` until their cold-start entry lands. Flag: ensure that whatever embedding-search layer lands next also consumes `datasetName` from `sourceLine` directly, and doesn't rely on `findDatasetMatchesForName` returning a hit.

## Summary

This is a well-shaped PR for a tight, surgical fix. The new `datasetNameMatch.ts` module is small, pure, and testable. The kernel-scoping contract is honest — it's a hard filter with typed gaps, not a silent rerank. The vision URL tightening is defense-in-depth (prompt + post-processor) with proper test coverage. The catalog alias additions use the scheme/relation correctly given the existing SKOS vocabulary.

The only things that would make me want changes before merge are **S1** (bare-acronym false-positive risk in `findDatasetAliasMatches`) and **S4** (dropping score from `DatasetNameMatch` bleeds information downstream). Both are small. S2, S3, S5, S6 are follow-ups that don't block.

The stem/lines flag at `resolveDatasetIdsForAsset` → per-bundle-flat-union is the one thing I'd write down in a SKY-335 precondition doc right now, because it's not obvious from the types that the scope-union behavior will stop being correct once bundles decompose.
