# PR #108 — Level 5 Review: Test Coverage & Workspace Hygiene

## Running results

- **Test suite:** 7 files, **86 tests passed, 0 failures** (5.14s). All targeted files are green on this branch.
- **Typecheck:** `bun run typecheck` passes cleanly (all three tsconfigs: `tsconfig`, `tsconfig.test.json`, `tsconfig.web.json`).
- **Git status:** Only pre-existing untracked dirs (`eval/fact-finding/`) — PR introduces no stray files.

## Strengths

- **Behavior-first test names.** `tests/stage1-kernel.test.ts:364`, `:404`, `:458`, `:518` all read as concrete scenarios ("matches dataset titles with trailing years against unversioned catalog titles", "matches slug-style catalog titles against human-readable dataset names") — far better than "tests year stripping".
- **Real checked-in registry round-trip.** `tests/checked-in-data-layer-registry.test.ts:52-121` actually loads the checked-in cold-start registry via `loadCheckedInDataLayerRegistry` and runs the *real* Stage 1 pipeline against the three newly added aliases (Ember, EIA Hourly Electric Grid Monitor, NREL ATB). No mocks — a regression in either alias JSON or normalization will fail here.
- **Tied-score branch covered.** `tests/resolution-kernel.test.ts:992-1014` asserts both the `dataset-scope-empty` reason *and* the preserved candidate labels `["EIA wind electricity generation", "IEA wind electricity generation"]`, locking in the diagnostic context on the gap (including `gap.context?.datasetIds`).
- **End-to-end ResolutionKernel service test exists.** `tests/resolution-kernel-service.test.ts:215-294` wires the real service layer + registry + FacetVocabulary and asserts `outcomes[0].datasetIds === [datasetAId]` *and* that the bound item lands on `variableAId` — confirming the scope actually narrows end-to-end, not just at the `bindHypothesis` unit level.
- **Vision URL normalization tests are concrete.** `tests/gemini-vision-service.test.ts:961-996` feeds four realistic cases (bare host, URL embedded in prose, headline, uppercase scheme) and asserts the exact normalized output — this is the right way to pin behavior down.

## Must-fix coverage gaps

### SKY-336 Phase 1 — threshold and tie-breaking

- **No explicit threshold boundary test.** The constant `DATASET_TITLE_FUZZY_THRESHOLD = 0.75` in `src/resolution/datasetNameMatch.ts:8` has zero assertions against `0.74 → no match` or `0.75 → match`. Every Jaccard test hits 1.0 (full equivalence) via `tests/fuzzyMatch.test.ts:31` or the title-matching tests. If someone bumps the threshold to 0.8 or 0.6, the CI passes silently. **Add a test with a dataset name that scores in (0.60, 0.85) and pin the cutoff.**
- **Tie-breaking stability is not asserted.** `compareDatasetTitleScores` (`datasetNameMatch.ts:177`) has a three-key sort (score → title → id). No test forces two datasets to tie on score and asserts the returned order. `tests/resolution-kernel.test.ts:992` has two tied candidates but asserts *after* Bind's `dataset-scope-empty` path where tiebreaking is moot. **Add a Stage 1 test where two non-preferred datasets tie on `scoreDatasetTitle`**, and assert both are in `result.matches` (or the deterministic ordering).
- **Preferred-pool-first behavior is asserted only implicitly.** `findFuzzyDatasetTitleMatches` (`datasetNameMatch.ts:188-211`) searches `preferredDatasets` first and *returns early* once that pool yields any candidate at `>= 0.75`, even if the full-registry pool would yield a higher score. This is a **non-obvious, load-bearing decision** and deserves an explicit test: preferred dataset at 0.76 should win over unpreferred at 0.90. None of the 6 new Stage 1 tests cover this — they all have preferred agent === correct agent. **Write the test or file a comment explaining the policy choice.**
- **Zero preferred datasets → full registry fallback.** The `searchPools` branch at `datasetNameMatch.ts:195-197` is exercised only indirectly by the CAISO test (which passes `organizationMentions` but no `providerLabel`/`providerDomain`). No test asserts "when `listPreferredDatasetAgentIds` returns `[]` the full registry is searched instead of short-circuiting." Add a sourceLine input with *no* agent hints to lock this in.
- **`stripPeripheralYear` has no unit tests.** The regex at `datasetNameMatch.ts:43-48` handles `(2024)`, `[2024]`, `2024:`, leading `2024 - `, trailing `, 2024`, and more. Only two of those forms are tested indirectly ("World Energy Outlook 2024" = bare trailing, "2024 NREL ATB" = bare leading). **Break out a `stripPeripheralYear` unit test** so regressions on `"World Energy Outlook (2024)"`, `"[2024] NREL ATB"`, `"Outlook - 2024"`, `"Outlook, 2024"` are pinned. Cheap and high-leverage.
- **No "no false positives on other datasets" test.** The 3 checked-in alias tests (`tests/checked-in-data-layer-registry.test.ts:108-120`) assert the correct dataset matched, but none assert that *other* checked-in datasets did **not** match. A 0.75 threshold on a real 30+ dataset catalog is a prime false-positive surface. **Add an assertion** like `expect(result.matches.filter((m) => m._tag === "DatasetMatch")).toHaveLength(1)` to each.

### SKY-336 Phase 2 — scoping

- **Dataset scope + agent source attribution compatibility untested.** `bindHypothesis` (`src/resolution/kernel/Bind.ts:260-297`) applies dataset narrowing first, then agent narrowing on top. No test exercises both scopes being present simultaneously. If a dataset belongs to agent A but the source attribution matches agent B, what happens? Currently → `agent-scope-empty` gap. **Either add a test, or add a code comment** explaining the composition order (dataset first, agent second, both narrowing cumulatively).
- **Dataset with zero Variables in registry.** The `narrowCandidatesByDatasets` helper (`Bind.ts:123-130`) returns `[]` when a matched dataset has no linked variables. No test covers this scenario, which is realistic (alias-only dataset, catalog records without variable rows). Would emit `dataset-scope-empty`. Add a one-liner test.
- **Subsumption interaction untested.** The AssembleOutcome `allOutOfRegistry` gate at `src/resolution/kernel/AssembleOutcome.ts:155-162` now allows `dataset-scope-empty` to count as out-of-registry. No test verifies Bind's existing shared→item retraction still applies when a dataset scope is present. Low-to-medium risk, but the interaction deserves at least one integration test.

### SKY-338 — Vision URL tightening

- **No negative test for scheme-less bare hosts in the reject path.** The Grep review shows `ensureHttpUrl` (`GeminiVisionServiceLive.ts:123-126`) prepends `https://` to any regex-valid host. A bare `"bloomberg.com"` becomes `"https://bloomberg.com/"` and **is accepted**, not rejected. This is the *opposite* of what the PR description in the checklist says (the checklist asks for bare domains to be *rejected*). Based on reading the prompts update (`src/enrichment/prompts.ts:90-92`: "If only a bare domain or host/path is visible, convert it to https://..."), acceptance **is** the intended behavior — but the review checklist flags this as ambiguous. **Confirm intent and add a test that pins it either way.** The current test suite has the "good" cases (`woodmac.com` → accepted) but no case for `"bloomberg.com"` + headline + URL mix where `bloomberg.com` is the questionable one. The existing test at `:961` tests prose-embedded URL extraction, which is different.
- **No test for headline fragment containing a TLD-looking word.** Something like `"U.S.A. emissions"` or `"Section 9.11 protocol"` could plausibly match `URLISH_FRAGMENT_PATTERN`. The regex `\.[a-z]{2,}` would match `.usa` or `.11` (actually `.11` won't match since `[a-z]`). The headline case at `tests/gemini-vision-service.test.ts:978` uses `"Entergy Aims to Build More Gas in Wake of Meta's Big Data Center"` which has no dots — too easy. Add an adversarial headline with a period like `"U.S. Energy Information Admin"`.

## Should-fix (ergonomics)

- **`tests/stage1-kernel.test.ts` uses plain `it`, not `it.effect`.** The existing file convention was plain `it` so consistency holds. But `runStage1` is pure (non-Effect), so `it` is actually correct here — no change needed. Noted as resolved.
- **Duplicated seed/helper boilerplate.** `tests/stage1-kernel.test.ts:10-88` defines `makeSeed`, `makeLookup` which also exist in `tests/data-layer-registry.test.ts:141` (same name, different shape). And `tests/resolution-kernel-service.test.ts:23-117` re-rolls a similar inline seed with datasets/variables. This is ~250 lines of boilerplate across the test suite. Consider extracting `tests/support/makeRegistrySeed.ts` — deferrable, but it's getting painful.
- **`tests/stage1-kernel.test.ts:118-178` `makeSourceLineInput`** is test-specific and reasonable, but the type annotation relies on `as any` for branded IDs / post URIs (`:14`, `:17`, `:50`, etc.). A small `makeTestBrand` helper or a set of test-only id constants would clean this up, and helps if domain schemas evolve.
- **Three assertions in one test.** `tests/checked-in-data-layer-registry.test.ts:51-121` runs Stage 1 three times (Ember, EIA, NREL) in one `it.effect`. First failure hides the other two. Either split into three `it.effect` blocks or use `it.each([...])`. Low priority.
- **`tests/fuzzyMatch.test.ts:31-35` test is single-case.** Only one assertion (`"CAISO Today's Outlook"` vs `"caiso-todays-outlook"` = 1). Add at least one negative case (e.g., apostrophe mismatch where it *shouldn't* score 1) and a case with numbers/unicode letters (e.g., `"café monthly"` vs `"cafe monthly"`) so the `\p{L}\p{N}` tokenizer path is pinned.

## Workspace hygiene

- **No stray files.** `git status --short` shows only pre-PR untracked content (`eval/fact-finding/`, `docs/plans/*.md`, old `eval/resolution-kernel/runs/*`). None of it is in this PR.
- **No `TODO` / `FIXME` / `console.*` in the diff.** Grep over `/tmp/pr108.diff` returned zero hits.
- **One dead export in `datasetNameMatch.ts`:** the `DatasetNameMatch` type alias at `src/resolution/datasetNameMatch.ts:16-30` is `export`ed but only consumed locally within the same file (lines `226`, `227`, `254`). Neither `Stage1.ts` nor `ResolutionKernel.ts` import the type. Either keep it `export`ed as a public API for future consumers (e.g., MCP tools) or demote it to `type DatasetNameMatch = ...` (non-exported). The three helper functions (`findDatasetMatchesForName`, `listPreferredDatasetAgentIds`, `stripPeripheralYear`) are all legitimately consumed and/or worth exporting.
- **No unused imports** in the modified files — all imports in `Stage1.ts`, `ResolutionKernel.ts`, `Bind.ts`, `AssembleOutcome.ts`, `datasetNameMatch.ts` resolve and are used.
- **Light test touches are coherent.** `tests/fuzzyMatch.test.ts:+6` (single new assertion) fits the existing "jaccardTokenSet" describe block cleanly. `tests/vision-enrichment-executor.test.ts:+2` just bumps the prompt version string from `v3.1.0` → `v3.2.0` at line 276 — a mechanical, correct change.

## Documentation

- **No doc updates in this PR.** `docs/plans/2026-04-09-sky-235-stage-1-deterministic-resolver-design-interview.md`, `docs/plans/2026-04-12-sky-313-resolution-algebra-phase-1.md`, and `docs/plans/2026-04-12-sky-314-resolution-kernel-interpret-bind-assemble.md` all describe the resolver pipeline but none mention dataset-name scoping or the preferred-agent pool. The new `dataset-scope-empty` gap reason is a first-class concept worth a one-sentence mention in `docs/architecture/seams.md` or the Stage 1 plan (it parallels `agent-scope-empty`).
- **CLAUDE.md is silent** on dataset-name matching, which is correct — CLAUDE.md is for persistent rules, not pipeline specs.
- **`stripPeripheralYear` and `DATASET_TITLE_FUZZY_THRESHOLD = 0.75` and preferred-pool-first** are three non-obvious policies with zero doc comments in `src/resolution/datasetNameMatch.ts`. **Add a short module header comment** explaining: (1) why the threshold is 0.75 (was it tuned? fact-finding run?), (2) that preferred datasets short-circuit the full-registry search, (3) the year-stripping rationale.

## Test quality assessment

**Grade: B+**

The behavioral intent is generally well-captured — test names describe scenarios, assertions check domain outcomes (which dataset matched, which variable bound, what gap reason), and the use of `runStage1` + real registry + `ResolutionKernel.layerFromPrepared` exercises the production code paths rather than mocking them. The checked-in registry test is especially strong: it's the kind of test that catches real regressions when someone edits a catalog JSON file. The tests added to `tests/resolution-kernel.test.ts:926-1014` also lock in both the happy path (dataset narrowing succeeds → `Resolved`) and the failure path (dataset narrowing removes all candidates → `OutOfRegistry` with a specific reason and preserved candidate diagnostics), which is exactly the right way to test a branch.

What keeps it from an A:

1. **Threshold and tie-breaking** — two of the three core fuzzy-matching policies (cutoff, ordering, pool-precedence) have no pinning tests.
2. **Preferred-pool-first** is the single biggest surprise in the module and has no explicit coverage or documentation.
3. **`stripPeripheralYear`** was chosen as the mechanism for year-handling but tested only via end-to-end assertions that happen to exercise two of its six regex branches.
4. **Light coverage of the no-false-positive direction** — the tests prove "X matches Y" but rarely prove "X does NOT match Z".

These are all additive fixes (no rewrites), and the foundation is solid. Landing the PR is not blocked on these, but the must-fix items should land as follow-up commits on the same branch before merge.

## Summary of must-fix actions

1. Add unit tests for `stripPeripheralYear` covering `(2024)`, `[2024]`, trailing/leading dash, comma, colon variants.
2. Add a Stage 1 test that pins `DATASET_TITLE_FUZZY_THRESHOLD` at the boundary (one candidate scoring ~0.70 → rejected, one scoring ~0.80 → accepted).
3. Add a tied-score test exercising `compareDatasetTitleScores` deterministic ordering.
4. Add or confirm the preferred-pool-first policy test OR add an inline code comment explaining the intent.
5. Add a "no false positive" assertion to the three checked-in alias tests (`expect(matches).toHaveLength(1)`).
6. Confirm and pin the bare-host SKY-338 behavior (currently accepts `"bloomberg.com"` → `"https://bloomberg.com/"`; checklist implied rejection).
7. Demote or document the `DatasetNameMatch` exported type.
8. Add a module-header comment in `src/resolution/datasetNameMatch.ts` naming the three load-bearing policies (0.75 threshold, preferred-pool-first, peripheral year stripping).
