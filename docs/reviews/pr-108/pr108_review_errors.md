# PR #108 — Level 4 Review: Error Boundaries & Data Flow

Branch: `sky-336/datasetname-matcher-normalization` (SKY-336 + SKY-338)
Scope: partial-failure behavior, error envelope compliance, data-flow coherence,
perf / N+1 / edge cases across the dataset-name matcher, kernel scoping, and
vision URL tightening.

---

## Strengths

1. **Scope-empty gap is a distinct outcome, not a silent filter.** `Bind.ts:271-285`
   returns `dataset-scope-empty` and preserves the pre-narrowing
   `compatibleCandidates` in the gap, then `AssembleOutcome.ts:154-171` lifts it
   into `OutOfRegistry` — an operator reading the outcome can see "we had
   candidates, scoping killed them" instead of a naked empty result. This is the
   right envelope for a scoping operation.

2. **Gating preserves exact-before-fuzzy-before-alias precedence.**
   `datasetNameMatch.ts:248-285` short-circuits on exact title matches before
   running the fuzzy pool and only falls through to structured aliases on a miss.
   No chance of a 0.76 fuzzy hit clobbering an exact-equality title.

3. **Slug-style tokenizer alignment is the right call.** `fuzzyMatch.ts:10-16`
   strips apostrophes and splits `[^\p{L}\p{N}]+` so `caiso-todays-outlook` ↔
   `CAISO Today's Outlook` gets the same token set. Score collisions between the
   slug and the spaced form stay rational (token-set Jaccard), so
   `DATASET_TITLE_SCORE_EPSILON = 0.000_001` is fine for the current scoring —
   though see Minor #2 below.

4. **Dataset-name matching is idempotent and tolerant of empty input.**
   `toNonEmpty` is used at every entrypoint (`listDatasetTitleCandidates`,
   `findDatasetMatchesForName`, `listStructuredAliasCandidates`,
   `listPreferredDatasetAgentIds`) so whitespace-only `datasetName` is a no-op
   that returns `[]`, never an error.

5. **Vision URL tightening is a post-validation cleanup, not a schema change.**
   The `visibleUrls` field in `src/domain/enrichment.ts:95` and
   `src/domain/sourceMatching.ts:171` remains `Schema.Array(Schema.String)`, so
   historical D1 rows re-decode cleanly. Normalization runs on write only via
   `normalizeVisibleUrls` in `GeminiVisionServiceLive.ts:291-309`. Backward compat
   is preserved.

---

## Must-fix

### M1. `findFuzzyDatasetTitleMatches` can return a 0.76 preferred hit over a 0.99 full-pool hit on a different agent (`datasetNameMatch.ts:185-221`)

```ts
const searchPools =
  preferredDatasets.length > 0
    ? [preferredDatasets, listAllDatasets(lookup)]
    : [listAllDatasets(lookup)];

for (const pool of searchPools) {
  const scored = pool.map(...).filter(score >= 0.75).sort(...);
  const bestScore = scored[0]?.score;
  if (bestScore === undefined) continue;
  return scored.filter(tied).map(...);   // early return
}
```

If the preferred pool contains a 0.76 partial-match and the full pool contains a
0.97 clean match on a different agent's Dataset, the preferred 0.76 wins. The
intent (prefer the post's attributed agent) is reasonable but the strategy
collapses to "any-preferred-beats-any-unpreferred" without a score gap test.

**Downstream impact:** `resolveDatasetIdsForAsset` in `ResolutionKernel.ts:73-94`
feeds those datasetIds directly into `Bind.narrowCandidatesByDatasets` as a hard
filter. A wrong preferred 0.76 match now **scopes the entire Bind pass to the
wrong dataset's variables**, which returns either a wrong `Resolved`
or — more likely — a `dataset-scope-empty` `OutOfRegistry`, when without scoping
we would have gotten a clean `Resolved` from the correct agent.

**Fix options:**
- Score both pools, pick the global top; break ties in favor of preferred.
- Require the preferred winner to be within `epsilon` of the full-pool winner
  OR ≥ `0.90` absolute before accepting it.
- Keep the current early-return but only when the preferred winner is exact
  (score ≥ 0.99), which matches the test seeds that exercise this code path.

No test in `tests/stage1-kernel.test.ts` exercises this scenario — all the new
fuzzy tests use a seed where the preferred agent is also the correct answer.

### M2. Dataset scoping pre-assumes the SKY-326 hard-filter semantics and will make it harder to soften

`Bind.ts:117-131, 262-285` implements dataset scoping as a hard `Set`-filter on
variable IDs, then emits `dataset-scope-empty` when it empties the candidate
set. SKY-326 (backlog) is explicitly the ticket to "soften Bind subsumption from
hard filter to tier-stratified scoring." The new scoping is a second hard
filter layered on top of the first — if SKY-326 later moves subsumption to a
score, the scoping will still gate it with a boolean membership test, so the
softening won't propagate to dataset-scoped resolutions.

**Not a blocker, but worth a Linear comment on SKY-326** pointing at
`Bind.ts:262-294` so the softening plan accounts for the new narrowing stages.

### M3. The Stage1 `datasetName` residual is duplicated on fall-through

`Stage1.ts:687-702` passes `emitResidualOnMiss: false` into
`pushDatasetTitleMatch`, then re-emits `UnmatchedDatasetTitleResidual` itself on
the `!matchedDatasetName` branch. `pushDatasetTitleMatch`'s own
`emitResidualOnMiss ?? true` default path at `Stage1.ts:363-374` also emits an
`UnmatchedDatasetTitleResidual`. The control flow is fine (only one path fires
for this caller), but the duplicated residual-emission code is a latent
refactoring hazard. **Either:**
- Drop the `emitResidualOnMiss: false` branch and let the helper emit; or
- Delete the helper's default-true branch entirely since the only caller now
  passes `false`.

Right now both code paths exist, and a future caller flipping the default gets
two residuals for one miss — the `residualKey` dedupe will swallow it, but the
semantic is confusing.

---

## Should-fix

### S1. `listAllDatasets(lookup)` is a hot-path allocation per asset per post (`datasetNameMatch.ts:82-87`)

```ts
const listAllDatasets = (lookup) =>
  Array.from(lookup.entities).flatMap((entity) =>
    entity._tag === "Dataset" ? [entity] : []
  );
```

`lookup.entities` is a `Chunk.Chunk` (`dataLayerRegistry.ts:61,82,683`).
`Array.from` on a Chunk realizes its iterator into a new array every call, then
`flatMap` allocates another array. With ~1,400 datasets in the checked-in
registry:

- **Call frequency per post:**
  Stage1 calls `findDatasetMatchesForName` once per source-line per asset; the
  kernel (`ResolutionKernel.ts:86-92`) calls it **again** for each source-line
  per asset. For a typical post with 1 asset × 2 source lines × 2 pipelines =
  **4 `listAllDatasets` calls per post**, each materializing the full entity
  chunk twice (once for preferred-pool miss, once for the full pool).
- **Per-call cost:**
  Each call is O(entity_count) = ~6,000 entities for the checked-in registry.
  Not catastrophic, but it's duplicated work that could be memoized behind
  `lookup.listAllDatasets()` as a getter that builds once per `toDataLayerRegistryLookup`.
- **Scaling concern:**
  Once the catalog crosses 10k entities (plausible by Q3 with ember/EIA expansion),
  this becomes 40k–80k array allocations per post in the hot path. Fix by adding
  `readonly datasets: ReadonlyArray<Dataset>` to `DataLayerRegistryLookup` and
  caching at build time.

The same pattern exists in `Bind.ts:46-51`'s `listVariables`, which is called
once per hypothesis per asset. That was a pre-existing concern but worth flagging
in the same fix.

### S2. Stage1 and ResolutionKernel duplicate the dataset lookup work (`Stage1.ts:681-703` + `ResolutionKernel.ts:73-94`)

`Stage1.runStage1` calls `pushDatasetTitleMatch` → `findDatasetMatchesForName`
for each source-line. `ResolutionKernel.resolveDatasetIdsForAsset` **re-runs the
same function** for each source-line. This is 2× the allocations, 2× the fuzzy
scoring, 2× the `listAllDatasets` materialization for every post that reaches
the kernel.

**Fix:** either thread the Stage1 `DatasetMatch[]` through the bundle builder so
the kernel can read them off the bundle, or memoize `findDatasetMatchesForName`
keyed by `(datasetName, preferredAgentIds)` for the duration of a single
`kernel.resolve` call.

### S3. `dedupeDatasets` is called twice per match (`datasetNameMatch.ts:89-105`)

Once in `findFuzzyDatasetTitleMatches` on `preferredAgentIds.flatMap(...)` and
once in `findDatasetMatchesForName` on `listDatasetTitleCandidates` → exact
matches. For small N this is fine, but combined with S1/S2 it's another
allocation per match. Could be inlined with a single pass.

### S4. Zero-variable Dataset edge case is silent (`Bind.ts:117-131` + cold-start data)

If the matcher scopes to a Dataset that happens to have zero Variables (bad
cold-start data — e.g. a brand-new Dataset row seeded before its Variables were
added), `narrowCandidatesByDatasets` returns `[]`, scoping emits
`dataset-scope-empty`, and `AssembleOutcome` lifts the result to `OutOfRegistry`
with the original `compatibleCandidates` preserved in the gap.

**The envelope is correct** — operator reading the outcome can see the scoping
took out every candidate. But there's no telemetry / log at the point where
scoping collapses to zero, and no way to distinguish "bad cold-start data" from
"legitimate scope miss." Consider logging at `Bind.ts:271-285` when the
scoped-but-empty branch fires with `datasetIds.length > 0`. Not a blocker, but
an observability gap for the ~50 cold-start datasets.

### S5. Multi-dataset tie is accepted as-is, with no cap

`datasetNameMatch.ts:212-217` returns **all** datasets tied at `bestScore`
(within `DATASET_TITLE_SCORE_EPSILON`). Upstream in
`ResolutionKernel.resolveDatasetIdsForAsset:86-92` those are unioned into a
`Set<DatasetId>`, and `Bind.narrowCandidatesByDatasets` unions their variables.
So a 3-way tie → kernel scopes to variables from **all three** datasets. This
is deliberate and defensible, but:

- If the tie is N=5 from different agents, scoping becomes nearly a no-op.
- Paired with M1 above, a 0.76 preferred tie can widen the scope in confusing
  ways.
- There's no test coverage for N>1 dataset ties — `tests/stage1-kernel.test.ts`
  only verifies single-dataset matches.

**Recommend:** add a test for `["EIA Electric Power Monthly", "EIA Electric Power Weekly"]`
(same score on `EIA Electric Power`), then either cap at N=2 or accept the
union explicitly with a doc comment.

### S6. `visibleUrls` tightening test gap

`tests/gemini-vision-service.test.ts:962-1000` covers the happy path (bare
domain → https, headline text dropped, mixed-case normalized). Not covered:

- **Headline containing a URL-shaped substring** — e.g.
  `"Read more at bit.ly/xyz about something"` should extract `bit.ly/xyz`.
  The `URLISH_FRAGMENT_PATTERN` regex will match it, but there's no test.
- **Quoted URLs** — `'"https://example.com"'`. `trimVisibleUrlBoundary` strips
  ``<([{'"`` but the test uses unquoted inputs.
- **Mailto / ftp / data URIs** — `normalizeVisibleUrlCandidate` explicitly
  filters to `http(s):`, but no test asserts rejection.
- **Unicode domain** — punycode / IDN handling through `new URL()` is untested.
- **Path fragments that look URL-ish but aren't** — e.g. `"v2.5.0"` or
  `"file.txt"`. The regex requires `\.[a-z]{2,}` at the end so `v2.5.0` is
  excluded, but `file.txt` would match. No assertion.

None of these are likely to break staging enrichment, but the "tighten" commit
message implies a broader guarantee than the test covers.

---

## Minor / style

1. **`DATASET_TITLE_SCORE_EPSILON = 0.000_001` is over-specified for Jaccard.**
   Jaccard is a rational number with denominator ≤ `|A∪B|` (at most a few dozen).
   Two distinct Jaccard scores differ by at least `1/(|A∪B|²)` ≈ `1e-4`. Epsilon
   of `1e-6` is fine but could be `1e-9` for future-proofing (or just `===` with
   a comment). Not a bug.

2. **`compareDatasetTitleScores` tie-breaks by title then id**
   (`datasetNameMatch.ts:177-183`). Dataset `id` is a branded
   `https://id.skygest.io/dataset/ds_...` URI (see `tests/stage1-kernel.test.ts:28-30`),
   so `localeCompare` on the full URI is deterministic across runs. Good — but
   the tie-break on `title` first means two datasets with identical titles on
   different agents will tie-break by id, not by "preferred agent first" — that
   signal is already consumed by the pool selection, so OK.

3. **`extractUrlLikeStrings` duplication in `Stage1.ts:650,669`** —
   pre-existing, not touched by this PR. Mentioned only because it was the
   reference for understanding source-line URL flow.

4. **`pushStructuredAliasMatches` short-circuits nothing on a match**
   (`Stage1.ts:377-425`) — it visits every scheme × candidate combination even
   after finding a dataset. Fine for correctness, but `O(|schemes| × |candidates|)`
   per text; under S1's scaling concerns worth noting.

5. **`structuredAliasSchemes` is redefined in both `Stage1.ts:70-72` and
   `datasetNameMatch.ts:10-12`.** Same filter expression. One should import
   from the other; doesn't matter for correctness but drifts easily.

6. **`ResolutionKernel.resolveAgentIdFromStage1Input` at
   `src/resolution/ResolutionKernel.ts:33-71` uses `_tag === "Some"` string checks
   instead of `Option.isSome`** while `resolveDatasetIdsForAsset` in the same
   file uses the matcher helpers directly. Inconsistent but harmless.

---

## Error propagation audit

| Step | Can fail? | Caught? | Envelope |
|---|---|---|---|
| `toNonEmpty(datasetName)` | No (pure) | n/a | returns `null` |
| `listDatasetTitleCandidates` | No | n/a | returns `[]` |
| `lookup.findDatasetByTitle` | No (Option) | n/a | `Option.none` |
| `scoreDatasetTitle` / `jaccardTokenSet` | No (pure math) | n/a | returns `0` |
| `lookup.findDatasetByAlias` | No (Option) | n/a | `Option.none` |
| `findDatasetMatchesForName` | **Never errors** | — | returns `[]` |
| `pushDatasetTitleMatch` | **Never errors** | — | `UnmatchedDatasetTitleResidual` |
| `Bind.bindHypothesis` | `Result.isFailure` on `joinPartials` → `required-facet-conflict` gap | caught internally | `BoundResolutionGapItem` |
| `narrowCandidatesByDatasets` | No (pure filter) | n/a | empty → `dataset-scope-empty` gap |
| `assembleOutcome` | No (pure) | n/a | `OutOfRegistry` or `Ambiguous` |
| `ResolutionKernel.resolve` decode | `EnrichmentSchemaDecodeError` | at entry | Effect error channel |
| Gemini `visibleUrls` normalization | No (catches in `URL` ctor via `try/catch`) | yes | drops invalid silently |

**Conclusion:** the matcher has zero typed errors — every failure path returns
`[]` or emits a residual. This is consistent with the rest of Stage1 but means
any future bug in the matcher (null pointer, bad lookup) will silently degrade
to empty results, not surface via `Schema.TaggedError`. Acceptable for a
best-effort scoping layer, but worth a doc comment.

---

## Data-flow diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│ GEMINI VISION (GeminiVisionServiceLive.ts)                               │
│   ai.models.generateContent(VISION_EXTRACTION_PROMPT)                    │
│        │                                                                 │
│        ▼                                                                 │
│   GeminiExtractionResponseDecoder ◄── ① GeminiParseError (caught→envelope)│
│        │                                                                 │
│        ▼                                                                 │
│   normalizeExtractionResponse()                                          │
│        │                                                                 │
│        ▼                                                                 │
│   normalizeVisibleUrls() ─── drops invalid URLs silently (NO error)      │
│        │                                                                 │
│        ▼                                                                 │
│   VisionAssetAnalysisSchema ◄── ② GeminiParseError (caught→envelope)     │
│        │                                                                 │
│        ▼                                                                 │
│   VisionAssetEnrichment.analysis.sourceLines[].datasetName (string|null) │
└──────────────────────────────────────────────────────────────────────────┘
                               │
                               │ (persisted to D1, re-decoded at read time)
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STAGE 1 (Stage1.ts:runStage1)                                            │
│                                                                          │
│   for asset in vision.assets:                                            │
│     for sourceLine in asset.analysis.sourceLines:                        │
│        datasetName = toNonEmpty(sourceLine.datasetName)                  │
│        if datasetName === null: skip ───►                                │
│                                                                          │
│        preferredAgentIds = listPreferredDatasetAgentIds(input, asset)    │
│          ├─ input.sourceAttribution.provider.providerLabel               │
│          ├─ input.sourceAttribution.contentSource.{domain,url}           │
│          ├─ asset.analysis.organizationMentions[].name                   │
│          └─ asset.analysis.logoText[]                                    │
│                                                                          │
│        pushDatasetTitleMatch(state, datasetName, asset.assetKey, ...)    │
│                │                                                         │
│                ▼                                                         │
│        findDatasetMatchesForName(datasetName, lookup, {preferredAgentIds})│
│          │                                                               │
│          ├── exact: listDatasetTitleCandidates().findDatasetByTitle      │
│          │   └──► DatasetTitleExactMatch[]  rank=1                       │
│          │                                                               │
│          ├── fuzzy: findFuzzyDatasetTitleMatches()                       │
│          │   ├── preferredDatasets (from preferredAgentIds)              │
│          │   ├── listAllDatasets(lookup)  ⚠ HOT ALLOCATION (S1)          │
│          │   ├── scoreDatasetTitle × every dataset                       │
│          │   ├── threshold 0.75                                          │
│          │   ├── ⚠ EARLY-RETURN preferred pool (M1: can miss better)     │
│          │   └──► DatasetTitleFuzzyMatch[]  rank=2                       │
│          │                                                               │
│          └── alias: findDatasetAliasMatches()                            │
│              └──► DatasetAliasMatch[]  rank=2                            │
│                                                                          │
│        on match  → addEvidence(state, "Dataset", ...)                    │
│        on miss   → addResidual(UnmatchedDatasetTitleResidual)  ⚠ M3 dup  │
│                                                                          │
│   resolveGrain("Dataset") → DatasetMatch OR AmbiguousCandidatesResidual  │
└──────────────────────────────────────────────────────────────────────────┘
                               │
                               │  Stage1Result.matches + residuals
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ RESOLUTION KERNEL (ResolutionKernel.ts:resolve)                          │
│                                                                          │
│   decodeStage1Input(input) ─── ③ EnrichmentSchemaDecodeError (Effect.ch)│
│        │                                                                 │
│        ▼                                                                 │
│   bundles = buildResolutionEvidenceBundles(decoded)                      │
│   agentId = resolveAgentIdFromStage1Input(decoded, lookup)               │
│   datasetIdsByAssetKey = resolveDatasetIdsByAssetKey(decoded, lookup)    │
│        │ ⚠ S2: DUPLICATES Stage1's findDatasetMatchesForName work       │
│        ▼                                                                 │
│   for bundle in bundles:                                                 │
│     datasetIds = datasetIdsByAssetKey.get(bundle.assetKey)               │
│     resolveBundle(bundle, lookup, vocabulary, {agentId, datasetIds})     │
│        │                                                                 │
│        ▼                                                                 │
│     interpretBundle → Hypothesis | NoMatch | Conflicted                  │
│        │                                                                 │
│        ▼                                                                 │
│     bindHypothesis(hypothesis, lookup, {agentId, datasetIds})            │
│        │                                                                 │
│        ├── joinPartials → Result.Failure? → gap "required-facet-conflict"│
│        ├── scoreCompatibleCandidates(partial, variables)                 │
│        │   └── ⚠ S1: listVariables allocates per call                   │
│        ├── missingRequired → gap "missing-required"                     │
│        ├── compatible.length === 0 → gap "no-candidates"                │
│        │                                                                 │
│        ├── datasetIds !== undefined                                      │
│        │   │                                                             │
│        │   ▼                                                             │
│        │ narrowCandidatesByDatasets(compatible, datasetIds, lookup)      │
│        │   │                                                             │
│        │   ├── narrowed.length === 0 → gap "dataset-scope-empty"        │
│        │   │   └── candidates preserved for OutOfRegistry envelope ✓    │
│        │   └── narrowed.length > 0 → continue                            │
│        │                                                                 │
│        ├── agentId !== undefined → narrowCandidatesByAgent               │
│        │   └── empty → gap "agent-scope-empty"                          │
│        │                                                                 │
│        ├── narrowed.length === 1 → BOUND ✓                               │
│        └── narrowed.length > 1  → gap "ambiguous-candidates"            │
│                                                                          │
│        ▼                                                                 │
│     assembleOutcome(interpreted, bound)                                  │
│        │                                                                 │
│        ├── all bound  → Resolved                                         │
│        ├── all missing-required → Underspecified                         │
│        ├── all (no-candidates|dataset-scope-empty|agent-scope-empty)     │
│        │     → OutOfRegistry (preserves pre-scope candidates) ✓          │
│        └── mixed       → Ambiguous                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

Error edges:
- ① `GeminiParseError` — raw Gemini output fails JSON-Schema validation.
  Caught by the Effect mapError in `extractChartData`; emitted as typed error.
- ② `GeminiParseError` — normalized response fails domain schema decode.
  Same path.
- ③ `EnrichmentSchemaDecodeError` — upstream caller passed a bad Stage1Input.
  Caught at Kernel entry, tagged error in the Effect channel.

**Uncaught / silent paths** (correctness-bearing):
- `findDatasetMatchesForName` never errors, returns `[]` on every failure.
- `normalizeVisibleUrls` swallows `URL` constructor errors via `try/catch`.
- `Bind.dataset-scope-empty` is a gap, not a log — S4 observability gap.
- M1 preferred-pool-early-return silently picks a worse match with no signal.

---

## File references

- `src/resolution/datasetNameMatch.ts` — new matcher (lines cited inline)
- `src/resolution/Stage1.ts:46-48,311-375,612-786` — integration point
- `src/resolution/ResolutionKernel.ts:33-169` — kernel scoping entry
- `src/resolution/kernel/Bind.ts:46-51,117-131,199-339` — narrow + gap branches
- `src/resolution/kernel/AssembleOutcome.ts:154-171` — OutOfRegistry lift
- `src/enrichment/GeminiVisionServiceLive.ts:254-309` — visibleUrls regex/norm
- `src/enrichment/prompts.ts:43,90-95` — prompt tightening language
- `src/domain/enrichment.ts:84-154` — V2+Legacy union preserves compat
- `tests/stage1-kernel.test.ts:364-574` — new matcher tests (no M1/S5 coverage)
- `tests/resolution-kernel.test.ts:927-1039` — dataset-scope tests (positive + empty)
- `tests/resolution-kernel-service.test.ts:215-290` — end-to-end scoping test
- `tests/gemini-vision-service.test.ts:962-1068` — visibleUrls tests (S6 gaps)
