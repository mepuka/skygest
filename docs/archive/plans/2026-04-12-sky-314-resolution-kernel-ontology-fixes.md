# Resolution Kernel Ontology Algebra Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task.

**Goal:** Apply the ontologically-principled fixes from the 2026-04-12 algebra review so the resolution kernel correctly binds gold-set posts to DCAT variables, eliminating the identity/narrative contamination, CD-008 vocabulary collisions, lexicon overfires, shared↔item conflict misbehavior, and compound-concept gap.

**Architecture:** Five sequential tasks. Each is independently committable and independently verifiable against `eval/resolution-kernel/run-eval.ts`. Acceptance signal per task = confusion matrix delta in `summary.md`. The tasks stack in dependency order — Task 1 (identity/narrative split) is load-bearing for everything else because it eliminates shared-partial contamination upstream of the bind step.

**Tech Stack:** Effect 4 (`effect` / `effect/unstable/cli`), TypeScript, bun, `@effect/vitest`, facet vocabulary JSON (source-of-truth in `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/`, runtime copies in `/Users/pooks/Dev/skygest-cloudflare/references/vocabulary/`, synced via `scripts/sync-vocabulary.ts`).

**Grounding documents:**
- `/Users/pooks/Dev/ontology_skill/docs/research/2026-04-12-resolution-algebra.md` — the algebra being implemented
- `/Users/pooks/Dev/ontology_skill/docs/research/2026-04-12-resolution-trace-examples.md` — worked examples
- `/Users/pooks/Dev/ontology_skill/docs/research/2026-04-12-text-ops-and-evidence-combination.md` — interpret-step semantics
- `/Users/pooks/Dev/ontology_skill/docs/research/2026-04-12-scoring-segmentation-feedback.md` — multiDecompose / compound concepts
- `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/conceptual-model.yaml` §CD-008 — price/share/count dual-concept rationale
- `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/anti-pattern-review.md` — vocabulary policy notes

**Four decisions already made** (documented here so subagents don't re-litigate):

| Q | Decision | Source |
|---|----------|--------|
| Q1 | Plain surface forms (`"price"`, `"cost"`, `"tariff"`) → `measuredProperty=price`. Only compound-qualified phrases (`"spot price"`, `"settlement price"`, `"strike price"`) → `statisticType=price`. Symmetric for `share`, `count`. | CD-008 implementation policy |
| Q2 | Editorial key-findings, post-text, source-lines, and publisher-hints **never** project onto `sharedPartial` identity facets. They route to `AttachedContext` only. Identity sources are restricted to `chart-title`, `x-axis`, `y-axis`, `series-label`. | Identity-vs-narrative split |
| Q3 | In the shared↔item join, the item partial always wins on any facet the item defines (retraction join). | Series-label = most specific identity |
| Q4 | Implement compound-concept support (Fix #6), not the multiDecompose workaround (Fix #5). | User directive |

**Baseline metrics (before this plan):** `eval/resolution-kernel/runs/20260412-220303-160/summary.md` — Annotated 20 / Pass 2 / Fail 18. Expected `Resolved` row of confusion matrix: `[2, 6, 1, 0, 7, 4]`.

---

## Task 1: Identity vs narrative evidence split

**Rationale:** The current `foldAssignments` in `src/resolution/kernel/Interpret.ts` conflates identity evidence (chart-title, axes, series-labels — witnesses for the variable's identity) with narrative evidence (post-text, key-findings — commentary about the observation). The algebra's `join` operator is only valid over co-referential projections, so folding narrative into `sharedPartial` produces the Class A contamination wave visible on 005-klstone, 022-klstone, and 001-ember. This task routes narrative sources away from the shared partial and into `AttachedContext`.

**Acceptance:**
- New tests pass covering: key-finding mentioning `wind` does not leak `technologyOrFuel=wind` into `sharedPartial`; post-text mentioning `price` does not leak `measuredProperty=price` into `sharedPartial` when chart-title/axes say otherwise; narrative signals still land in `AttachedContext` where appropriate.
- Eval harness `bun eval/resolution-kernel/run-eval.ts` shows 005-klstone and 022-klstone binding to `Electricity generation` (generic) instead of `Wind electricity generation`.
- All 25 existing kernel tests still pass.

**Files:**
- Modify: `src/resolution/kernel/Interpret.ts`
- Modify (if `AttachedContext` needs new fields): `src/domain/resolutionKernel.ts`
- Modify: `tests/resolution-kernel.test.ts`

**Design notes for the implementer:**

1. The current `EVIDENCE_PRECEDENCE` list in `src/domain/resolutionKernel.ts:40` orders evidence sources from strongest to weakest. Split this conceptually (NOT a domain schema change) into two roles inside `Interpret.ts`:

   ```ts
   const IDENTITY_SOURCES: ReadonlySet<ResolutionEvidenceSource> = new Set([
     "series-label",
     "x-axis",
     "y-axis",
     "chart-title"
   ]);
   const NARRATIVE_SOURCES: ReadonlySet<ResolutionEvidenceSource> = new Set([
     "key-finding",
     "post-text",
     "source-line",
     "publisher-hint"
   ]);
   ```

2. `buildSharedSites` currently returns a single flat list of `EvidenceSite`. Change it to return *two* lists — identity sites and narrative sites — or wrap each site with a role tag. Identity sites feed `foldAssignments` exactly as today. Narrative sites feed a new pass that only contributes to `AttachedContext`, never to the shared partial.

3. `AttachedContext` in `src/domain/resolutionKernel.ts:114` currently only carries `{place, sector, market, frequency, time, extra}`. It may need new fields if narrative signals want to carry things like `narrativeTechnology`, `narrativeMeasuredProperty`, etc. **Check first** whether just dropping them entirely (and only carrying in `extra`) is sufficient for the eval to pass. YAGNI — only extend the schema if a test fails without it.

4. Narrative evidence should still appear in the hypothesis `evidence[]` array so the downstream trace output can surface it. This is display, not identity.

**Test-driven steps:**

**Step 1.1 — Write a failing test locking in the 005-klstone behavior**

File: `tests/resolution-kernel.test.ts` (add new spec in the `describe("resolveBundle", ...)` block)

```ts
it.effect("does not leak technologyOrFuel from key-findings into the shared partial", () =>
  Effect.gen(function* () {
    const vocabulary = yield* FacetVocabulary;
    const prepared = yield* loadCheckedInDataLayerRegistry(
      checkedInDataLayerRegistryRoot
    );
    const lookup = toDataLayerRegistryLookup(prepared);

    // Mirrors the 005-klstone evidence bundle: chart title is generic
    // electricity generation, but a key-finding mentions wind as the
    // leading source. Under the identity/narrative split, `wind` is
    // narrative and must not end up in the shared partial.
    const outcome = decodeOutcome(
      resolveBundle(
        decodeBundle({
          postText: [],
          chartTitle: "Public net electricity generation in Germany",
          series: [],
          keyFindings: [
            "Wind power was the leading source of generation, with Wind Onshore contributing 33.6%"
          ],
          sourceLines: [],
          publisherHints: []
        }),
        lookup,
        vocabulary
      )
    );

    expect(outcome._tag).not.toBe("NoMatch");
    if (outcome._tag === "Resolved") {
      for (const item of outcome.items) {
        if (item._tag !== "bound") {
          continue;
        }
        expect(item.semanticPartial.technologyOrFuel).toBeUndefined();
      }
    }
  }).pipe(
    Effect.provide(FacetVocabulary.layer),
    Effect.provide(localFileSystemLayer)
  ),
  15_000
);
```

**Step 1.2 — Run the test, confirm it fails**

Run: `bun run test tests/resolution-kernel -t "does not leak technologyOrFuel"`
Expected: test fails because the current fold adds `technologyOrFuel=wind` from the key-finding.

**Step 1.3 — Implement `IDENTITY_SOURCES` / `NARRATIVE_SOURCES` partitioning in `buildSharedSites`**

In `src/resolution/kernel/Interpret.ts`:

- Introduce the two constants near the top of the file (after `SEGMENT_DELIMITER`).
- Change `buildSharedSites` to return either `{ identity: ReadonlyArray<EvidenceSite>; narrative: ReadonlyArray<EvidenceSite> }` or two separate exports.
- `interpretBundle` passes only identity sites to `foldAssignments`.
- Narrative sites: drop them for now (first pass) unless Task-1 tests fail without them contributing to `AttachedContext`.

**Step 1.4 — Run the new test again, confirm it passes**

Run: `bun run test tests/resolution-kernel -t "does not leak technologyOrFuel"`
Expected: PASS.

**Step 1.5 — Run the full kernel test suite, confirm no regressions**

Run: `bun run test tests/resolution-kernel`
Expected: 26/26 pass (25 pre-existing + 1 new).

**Step 1.6 — Run the eval harness, diff the confusion matrix**

Run: `bun eval/resolution-kernel/run-eval.ts`
Expected: `005-klstone` and `022-klstone` now produce `Actual: Resolved` with `boundVariableIds` containing the *generic* `Electricity generation` variable (`var_01KNQEZ5WN5TNH2HCGMHA2T3YH`), not `Wind electricity generation` (`var_01KNQEZ5WNBVQ06R676YPBZRE2`). Confusion matrix expected row `Resolved` should shift from `[2, 6, 1, 0, 7, 4]` toward something with more Resolved in column 1.

**Step 1.7 — Run the full test suite**

Run: `bun run test && bun run typecheck`
Expected: all green.

**Step 1.8 — Commit**

```bash
git add src/resolution/kernel/Interpret.ts src/domain/resolutionKernel.ts tests/resolution-kernel.test.ts
git commit -m "$(cat <<'EOF'
fix: split interpret evidence into identity vs narrative sources

Per the 2026-04-12 ontology algebra review, folding narrative evidence
(post-text, key-findings, source-lines, publisher-hints) into the
shared partial violates the algebra's join operator — it is only
valid over co-referential projections of the same variable identity.
Narrative sources are commentary about the observation, not witnesses
for the variable's facet values.

This commit restricts the shared-partial fold to identity sources
(chart-title, x-axis, y-axis, series-label) and drops narrative
sources from identity participation. Eliminates the Class A
contamination wave where key-findings like "wind power was the
leading source" were leaking technologyOrFuel=wind into the shared
partial for charts whose actual identity was total electricity
generation.

Refs: SKY-314, 2026-04-12-resolution-algebra.md §Interpret

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Enforce CD-008 in vocabulary + word-boundary matching

**Rationale:** `references/vocabulary/measured-property.json` and `references/vocabulary/statistic-type.json` contain duplicated surface forms (`"cost"`, `"tariff"`, `"wholesale price"`) for different canonical concepts. Per CD-008 in `conceptual-model.yaml`, the ontology has both `sevocab:PriceMeasure` (measuredProperty) and `sevocab:Price` (statisticType) with identical prefLabels but distinct IRIs. The current matcher fires both simultaneously on every price mention because (a) the JSON files have overlapping surface-form sets, and (b) `SurfaceFormEntry.ts` uses substring matching which picks up embedded "price" inside "retail electricity prices" indiscriminately.

This task does two things together because they're inseparable: lexicon curation alone is not enough without matcher discipline. Both must move in the same commit.

**Acceptance:**
- New tests pass covering: `"price"` alone → `measuredProperty=price` only; `"spot price"` → `statisticType=price` only; `"electricity prices"` (plural) → `measuredProperty=price` via word-boundary match; `"share of generation"` compound → `statisticType=share`; bare `"share"` → `measuredProperty=share`.
- Eval harness shows `002-1reluctantcog` and `003-janrosenow` advancing (at least one of the four checks passing, preferably outcome-tag = `Resolved`).
- `anti-pattern-review.md` in ontology_skill gains a CD-008 implementation policy section.

**Files:**
- Modify: `references/vocabulary/measured-property.json`
- Modify: `references/vocabulary/statistic-type.json`
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/measured-property.json`
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/statistic-type.json`
- Modify: `src/resolution/facetVocabulary/SurfaceFormEntry.ts`
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/anti-pattern-review.md`
- Modify: `tests/resolution-kernel.test.ts` or create a new `tests/facet-vocabulary-cd008.test.ts`

**Design notes for the implementer:**

1. **CD-008 lexicon policy** (document this in `anti-pattern-review.md` first, as the grounding for the JSON changes):
   - Unqualified surface forms `"price"`, `"cost"`, `"tariff"`, `"rate"`, `"fee"` → `measuredProperty=price` only.
   - Compound-qualified phrases `"spot price"`, `"settlement price"`, `"strike price"`, `"clearing price"`, `"locational marginal price"` / `"LMP"` → `statisticType=price` only.
   - Symmetric for share: unqualified `"share"` → `measuredProperty=share`. Compound `"share of"`, `"percent of total"`, `"proportion of"` → `statisticType=share`. Note: the 003-janrosenow case ("Share of new installations") needs to be examined — "share of X" where X is a count/stock IS a statistical transformation. Keep `"share of"` in statisticType.
   - Symmetric for count: unqualified `"count"`, `"number"` → `measuredProperty=count`. Compound forms → `statisticType=count`.

2. **Word-boundary matcher.** Look at `src/resolution/facetVocabulary/SurfaceFormEntry.ts`. The current behavior — confirm it first with `colgrep` before writing code — is likely substring match against normalized text. The fix: when matching a multi-word surface form or a short token like `"price"` (< 6 chars), require a word-boundary regex match (`\b<form>\b`). This prevents `"electricity prices"` from firing twice (once as substring of the whole phrase, once as `"price"`).

   Exact semantics depend on what `SurfaceFormEntry` actually does. The implementer should read that file first and propose a minimal change that preserves the surface-form → canonical-value map but tightens the match predicate.

3. **Source-of-truth sync.** The vocabulary JSON files live in two places:
   - `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/` (source of truth)
   - `/Users/pooks/Dev/skygest-cloudflare/references/vocabulary/` (runtime copy)

   `scripts/sync-vocabulary.ts` copies from source to runtime. Edit the source files in ontology_skill first, then run `bun scripts/sync-vocabulary.ts --apply` to propagate. Do NOT edit runtime copies directly and leave source out of sync.

**Test-driven steps:**

**Step 2.1 — Write failing tests covering CD-008 cases**

Create `tests/facet-vocabulary-cd008.test.ts`:

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";

describe("CD-008 price/share/count surface-form routing", () => {
  it.effect("routes unqualified 'price' to measuredProperty only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("retail electricity prices");
      const st = vocab.matchStatisticType("retail electricity prices");
      expect(Option.getOrUndefined(mp)?.canonical).toBe("price");
      expect(Option.isNone(st)).toBe(true);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes compound 'spot price' to statisticType only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("day-ahead spot price");
      const st = vocab.matchStatisticType("day-ahead spot price");
      expect(Option.isNone(mp)).toBe(true);
      expect(Option.getOrUndefined(st)?.canonical).toBe("price");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes unqualified 'share' to measuredProperty only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const mp = vocab.matchMeasuredProperty("market share by region");
      expect(Option.getOrUndefined(mp)?.canonical).toBe("share");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("routes compound 'share of X' to statisticType only", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const st = vocab.matchStatisticType("share of new installations");
      expect(Option.getOrUndefined(st)?.canonical).toBe("share");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );

  it.effect("does not substring-match 'price' inside unrelated words", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      // Word-boundary discipline: "enterprise" contains "prise" not "price",
      // so no match. This is a regression fence for the matcher change.
      const mp = vocab.matchMeasuredProperty("enterprise value creation");
      expect(Option.isNone(mp)).toBe(true);
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});
```

**Step 2.2 — Run tests, confirm they fail**

Run: `bun run test tests/facet-vocabulary-cd008`
Expected: 5 failures, showing the current cross-firing behavior.

**Step 2.3 — Update the CD-008 policy doc**

Edit `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/anti-pattern-review.md` to add a dated `## CD-008 implementation policy (2026-04-12)` section capturing the policy bullets from the Design Notes above.

**Step 2.4 — Edit the source-of-truth vocabulary JSONs in ontology_skill**

Remove duplicated surface forms from `statistic-type.json` that should only be in `measured-property.json`. Keep only compound-qualified forms in statistic-type per the policy.

**Step 2.5 — Sync to runtime**

Run: `bun scripts/sync-vocabulary.ts --apply`
Expected: stdout shows files copied to `references/vocabulary/`.

**Step 2.6 — Tighten `SurfaceFormEntry.ts` matcher to word-boundary**

Read the file. Change the match predicate to use `\b<form>\b` regex for short tokens (configurable threshold, default: length ≤ 6 chars) AND for any surface form containing a space. Keep current behavior for long distinctive tokens.

**Step 2.7 — Run the CD-008 tests, confirm they pass**

Run: `bun run test tests/facet-vocabulary-cd008`
Expected: 5/5 PASS.

**Step 2.8 — Run full kernel + eval suites**

Run: `bun run test && bun run typecheck`
Run: `bun eval/resolution-kernel/run-eval.ts`
Expected: no regressions, and 002-1reluctantcog / 003-janrosenow show improvement in the eval summary.

**Step 2.9 — Commit**

```bash
git add references/vocabulary/measured-property.json references/vocabulary/statistic-type.json src/resolution/facetVocabulary/SurfaceFormEntry.ts tests/facet-vocabulary-cd008.test.ts
git add /Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/measured-property.json /Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/statistic-type.json /Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/anti-pattern-review.md
git commit -m "$(cat <<'EOF'
fix: enforce CD-008 price/share/count vocabulary policy + word-boundary matching

Per CD-008 in conceptual-model.yaml, price/share/count exist as
concepts in both MeasuredPropertyScheme and StatisticTypeScheme with
distinct IRIs but identical prefLabels. The lexicon JSON files
had duplicated surface forms across both schemes, firing both
facets simultaneously on every mention and producing partials like
{measuredProperty: demand, statisticType: price} that matched no
variable.

Policy: unqualified surface forms (price, cost, tariff, rate, share,
count) route to measuredProperty only. Compound-qualified phrases
(spot price, settlement price, share of X, proportion of X, ...)
route to statisticType only. Policy documented in the
anti-pattern-review.md §CD-008 implementation policy section.

Also tightened SurfaceFormEntry matching to word-boundary regex for
short tokens and multi-word forms, so "retail electricity prices"
fires `measuredProperty=price` once cleanly rather than via greedy
substring match.

Fixes class-B vocabulary overfires visible in 002-1reluctantcog
and 003-janrosenow.

Refs: SKY-314, CD-008

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

(This commit spans two repos — the ontology_skill changes and the cloudflare runtime changes. The implementer should verify whether ontology_skill is a separate git repo. If yes, two commits. If it's a submodule or linked directory, one commit. Check with `git -C /Users/pooks/Dev/ontology_skill status` before committing.)

---

## Task 3: Tighten domain-object + aggregation lexicons

**Rationale:** Beyond the CD-008 collision in Task 2, two other surface forms overfire in the current lexicons:

- `domain-object.json` has a bare `"heat"` entry that matches "Earth's energy imbalance... retaining heat" (013-weatherprof) and fires `domainObject=heat`. But in the ontology, `Heat` means "IEA: Heat/district heating sector", not the physical quantity.
- `aggregation.json` has entries like `"peak"` that fire on narrative usage ("peak values", "RECORD high") when the intended semantics is "peak demand" / "peak load" as a compound term binding an actual aggregation operator to a flow/stock.

This task removes the bare surface forms and keeps only the categorically-diagnostic compound forms.

**Acceptance:**
- New tests pass locking in: bare `"heat"` alone does not fire `domainObject=heat`; `"district heat"` / `"heating market"` still fires; bare `"peak"` alone does not fire `aggregation=max`; `"peak demand"` / `"peak load"` still fires.
- Eval harness shows 013-weatherprof and 004-lightbucket improving (at minimum, their partials no longer carry the spurious facets).

**Files:**
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/domain-object.json`
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/aggregation.json`
- Modify: `references/vocabulary/domain-object.json` (via sync)
- Modify: `references/vocabulary/aggregation.json` (via sync)
- Modify: `tests/facet-vocabulary-cd008.test.ts` or new spec file

**Design notes:**

1. Heat removal: find the surface form `"heat"` with canonical `"heat"` and delete. Keep `"district heat"`, `"district heating"`, `"heat sector"`, `"heating market"`, `"heat pump"` (heat pump is a distinct technology and stays).

2. Peak curation: find surface form `"peak"` with canonical `"max"` in `aggregation.json`. Options:
   - Delete `"peak"` entirely. Keep only `"peak demand"`, `"peak load"`, `"peak generation"`, `"peak capacity"` as compound forms that embed both a flow/stock and the aggregation operator.
   - Or: use the future compound-concept mechanism from Task 5 and make `"peak demand"` a compound surface form carrying `{measuredProperty: demand, aggregation: max}`.

   Decision: delete `"peak"` in this task, defer the compound version to Task 5 as a refinement.

**Test-driven steps:**

**Step 3.1 — Write failing tests**

Add to `tests/facet-vocabulary-cd008.test.ts` (or a new file):

```ts
it.effect("does not fire domainObject=heat on bare narrative 'heat'", () =>
  Effect.gen(function* () {
    const vocab = yield* FacetVocabulary;
    const mp = vocab.matchDomainObject("Earth is retaining heat at an accelerating rate");
    expect(Option.isNone(mp)).toBe(true);
  }).pipe(Effect.provide(FacetVocabulary.layer))
);

it.effect("still fires domainObject=heat on 'district heating'", () =>
  Effect.gen(function* () {
    const vocab = yield* FacetVocabulary;
    const mp = vocab.matchDomainObject("district heating grid expansion");
    expect(Option.getOrUndefined(mp)?.canonical).toBe("heat");
  }).pipe(Effect.provide(FacetVocabulary.layer))
);

it.effect("does not fire aggregation=max on bare 'peak values'", () =>
  Effect.gen(function* () {
    const vocab = yield* FacetVocabulary;
    const agg = vocab.matchAggregation("peak values have been rising");
    expect(Option.isNone(agg)).toBe(true);
  }).pipe(Effect.provide(FacetVocabulary.layer))
);

it.effect("still fires aggregation=max on 'peak demand'", () =>
  Effect.gen(function* () {
    const vocab = yield* FacetVocabulary;
    const agg = vocab.matchAggregation("peak demand during heat waves");
    expect(Option.getOrUndefined(agg)?.canonical).toBe("max");
  }).pipe(Effect.provide(FacetVocabulary.layer))
);
```

**Step 3.2 — Run, confirm failure**

**Step 3.3 — Edit source-of-truth JSON files in ontology_skill**

Delete bare `"heat"` from domain-object. Delete bare `"peak"` from aggregation. Confirm compound forms exist or add them.

**Step 3.4 — Sync to runtime**

Run: `bun scripts/sync-vocabulary.ts --apply`

**Step 3.5 — Run tests, confirm they pass**

**Step 3.6 — Run full kernel + eval suites**

**Step 3.7 — Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: remove narrative-leaking surface forms from domain-object and aggregation lexicons

Bare "heat" in domain-object.json was firing on narrative usage like
"earth retaining heat" when the ontology concept sevocab:Heat means
district heating sector specifically. Bare "peak" in aggregation.json
was firing on editorial language like "peak values have been rising"
when the intended semantics is "peak demand" / "peak load" binding
an aggregation operator to a flow/stock.

Removed the bare entries, kept the categorically-diagnostic compound
forms (district heating, heat sector, heat market; peak demand, peak
load, peak generation, peak capacity).

Fixes class-B false positives on 013-weatherprof and 004-lightbucket.

Refs: SKY-314

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Retraction join in `Bind.ts`

**Rationale:** When the hypothesis has multiple items (multi-series chart), `bindHypothesis` calls `joinPartials(hypothesis.sharedPartial, hypothesisItem.partial)` at `src/resolution/kernel/Bind.ts:175` to compute the per-item semantic partial. If the shared partial already carries a facet that the item also specifies differently, this fails as `required-facet-conflict` — which is what caused 001-ember to emit `Ambiguous` with 5 item-level conflicts.

After Task 1 (identity/narrative split), the shared partial should no longer be contaminated by narrative. But there's still a legitimate case where shared and item disagree: if the chart title broadly says "Electricity generation" and a series label says "Wind", the shared partial has no technologyOrFuel but the item adds `wind` — that's a clean join, no conflict. The problematic case is when the chart title is itself technology-specific (e.g., "Wind generation", which sets `technologyOrFuel=wind` in shared) and a series label within that chart says "Offshore wind" — the item's `technologyOrFuel=offshore_wind` conflicts with shared's `wind`.

The algebraically-correct move is retraction: strip from shared any facets the item defines, then join. The item is strictly more specific.

**Acceptance:**
- New test passes: shared `{generation, wind}` + item `{offshore_wind}` → result `{generation, offshore_wind}` with no conflict.
- Existing Bind tests still pass.
- Eval harness: 001-ember shows item-level forking cleared on the 6 series items.

**Files:**
- Modify: `src/resolution/kernel/Bind.ts`
- Modify: `tests/resolution-kernel.test.ts`

**Design notes:**

1. Look at `Bind.ts:175` region — the `bindHypothesis` function loops over `hypothesis.items` and calls `joinPartials(hypothesis.sharedPartial, hypothesisItem.partial)`.

2. Replace with a retraction helper:

   ```ts
   const retractedShared = (
     shared: PartialVariableShape,
     overrideKeys: ReadonlyArray<FacetKey>
   ): PartialVariableShape => {
     const result: Record<string, unknown> = { ...shared };
     for (const key of overrideKeys) {
       delete result[key];
     }
     return result as PartialVariableShape;
   };

   // Inside bindHypothesis:
   const itemKeys = Object.keys(hypothesisItem.partial) as Array<FacetKey>;
   const narrowedShared = retractedShared(hypothesis.sharedPartial, itemKeys);
   const semanticPartialResult = joinPartials(narrowedShared, hypothesisItem.partial);
   ```

3. `joinPartials` should now never fail on Task-4 cases because the retracted shared has no conflicting facets. But preserve the existing `Result.isFailure` branch — if it still fails, that's a legitimate algebra error worth surfacing.

**Test-driven steps:**

**Step 4.1 — Write failing test**

```ts
it.effect("retracts shared-level facets when an item specifies them", () =>
  Effect.gen(function* () {
    const vocabulary = yield* FacetVocabulary;
    const prepared = yield* loadCheckedInDataLayerRegistry(
      checkedInDataLayerRegistryRoot
    );
    const lookup = toDataLayerRegistryLookup(prepared);

    // Shared partial (from chart title) says generic electricity generation.
    // Series label says "Offshore wind". After retraction, the item's
    // technologyOrFuel=offshore_wind should override shared's absence.
    const outcome = decodeOutcome(
      resolveBundle(
        decodeBundle({
          postText: [],
          chartTitle: "Wind generation",
          series: [
            { itemKey: "offshore", legendLabel: "Offshore wind", unit: "GW" }
          ],
          keyFindings: [],
          sourceLines: [],
          publisherHints: []
        }),
        lookup,
        vocabulary
      )
    );

    expect(outcome._tag).not.toBe("Conflicted");
  }).pipe(
    Effect.provide(FacetVocabulary.layer),
    Effect.provide(localFileSystemLayer)
  ),
  15_000
);
```

**Step 4.2 — Run, confirm failure**

**Step 4.3 — Implement retraction in `Bind.ts`**

**Step 4.4 — Run test, confirm pass**

**Step 4.5 — Run full suites**

**Step 4.6 — Commit**

```bash
git commit -m "$(cat <<'EOF'
fix: retract shared-level facets in shared↔item join in Bind.ts

Per the 2026-04-12 algebra review (Q3), series-label items are
strictly more specific than the shared partial on any facet they
define. The current Bind.ts join fails with required-facet-conflict
when shared and item disagree, but the algebraically-correct
behavior is retraction: strip the conflicting facets from shared
before joining, letting the item win.

Fixes item-level conflict preservation visible on 001-ember and
other multi-series charts where a shared partial's implicit
facet collides with a series-specific one.

Refs: SKY-314

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Compound-concept support in facet vocabulary + matcher

**Rationale:** Per Q4 decision, compound concepts (Fix #6 from the ontology review) are the principled solution to the Gap 2 issue identified in the algebra doc: some surface forms legitimately span multiple facets at once. For example, `"spot price of electricity"` carries `{measuredProperty: price, statisticType: spot, domainObject: electricity}` — it's one surface form, three facet assignments, which the current one-JSON-per-facet lexicon structurally cannot represent.

This task adds a new `CompoundSurfaceForm` lexicon table, teaches the matcher to consume it, and integrates compound matches into `Interpret.ts` alongside the existing per-facet matches.

**Acceptance:**
- New domain schema for `CompoundSurfaceFormEntry` with a test locking it down.
- New `compound-concepts.json` vocabulary file with a starter set covering the cases identified in the ontology review: `"spot price"`, `"settlement price"`, `"LMP"`, `"peak demand"`, `"peak load"`, `"wholesale electricity price"`, `"share of generation"`, etc.
- New `matchCompoundConcepts` vocabulary method returning all compound matches in a text.
- Interpret-step integration: compound matches feed `matchSite` as a higher-priority pass before the per-facet matches.
- Eval harness: no regressions, and at least one case where the compound concept produces a cleaner partial than the sum of per-facet matches (target: 006-edcporter "Battery price spreads" → compound `{measuredProperty: price, technologyOrFuel: battery}`).

**Files:**
- Create: `references/vocabulary/compound-concepts.json`
- Create: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/compound-concepts.json`
- Create: `src/resolution/facetVocabulary/compoundConcepts.ts`
- Modify: `src/resolution/facetVocabulary/index.ts` (add `matchCompoundConcepts` to the service)
- Modify: `src/resolution/kernel/Interpret.ts` (consume compound matches in the fold)
- Modify: `scripts/sync-vocabulary.ts` (add compound-concepts to the copy list)
- Modify: `tests/` (new compound-concepts test file)
- Modify: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/docs/conceptual-model.yaml` (document the compound-concept mechanism)

**Design notes:**

This is the largest task and may warrant a separate review checkpoint before committing. The scope includes:

1. **Domain schema** for a compound surface form entry:

   ```ts
   // src/resolution/facetVocabulary/compoundConcepts.ts
   export const CompoundSurfaceFormEntry = Schema.Struct({
     surfaceForm: Schema.String,
     normalizedForm: Schema.String,
     assignments: Schema.Struct({
       measuredProperty: Schema.optionalKey(Schema.String),
       statisticType: Schema.optionalKey(Schema.String),
       domainObject: Schema.optionalKey(Schema.String),
       technologyOrFuel: Schema.optionalKey(Schema.String),
       unitFamily: Schema.optionalKey(Schema.String),
       aggregation: Schema.optionalKey(Schema.String),
       policyInstrument: Schema.optionalKey(Schema.String)
     }),
     notes: Schema.optionalKey(Schema.String)
   });
   ```

2. **Matcher semantics**: `matchCompoundConcepts(text)` returns an array of matches, each with the compound entry and its position in the text. Matches are greedy by length — longer compound forms win over shorter ones when they overlap.

3. **Precedence over per-facet matches**: when a compound matches, its assigned facets take precedence over per-facet matches in the overlapping text region. This means the interpret step runs compound matching first, records which text regions are consumed, then runs per-facet matching on the remainder.

4. **Starter compound-concepts.json** content (just the starter set — the real curation is a follow-up):

   ```json
   [
     {
       "surfaceForm": "spot price",
       "normalizedForm": "spot price",
       "assignments": { "measuredProperty": "price", "statisticType": "spot" },
       "notes": "Spot market price — instantaneous clearing price"
     },
     {
       "surfaceForm": "peak demand",
       "normalizedForm": "peak demand",
       "assignments": { "measuredProperty": "demand", "aggregation": "max" }
     },
     {
       "surfaceForm": "peak load",
       "normalizedForm": "peak load",
       "assignments": { "measuredProperty": "demand", "aggregation": "max" }
     },
     {
       "surfaceForm": "wholesale electricity price",
       "normalizedForm": "wholesale electricity price",
       "assignments": { "measuredProperty": "price", "domainObject": "electricity" }
     }
   ]
   ```

5. **Sync script update**: `scripts/sync-vocabulary.ts` currently copies a fixed list of facet JSON files. Add `compound-concepts.json` to the list.

**Test-driven steps:**

**Step 5.1 — Write failing test for the CompoundSurfaceFormEntry schema**

```ts
// tests/compound-concepts.test.ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { CompoundSurfaceFormEntry } from "../src/resolution/facetVocabulary/compoundConcepts";
import { FacetVocabulary } from "../src/resolution/facetVocabulary";

describe("CompoundSurfaceFormEntry schema", () => {
  it("decodes a minimal entry", () => {
    const decoded = Schema.decodeUnknownSync(CompoundSurfaceFormEntry)({
      surfaceForm: "spot price",
      normalizedForm: "spot price",
      assignments: { measuredProperty: "price", statisticType: "spot" }
    });
    expect(decoded.surfaceForm).toBe("spot price");
    expect(decoded.assignments.measuredProperty).toBe("price");
  });
});

describe("matchCompoundConcepts", () => {
  it.effect("matches 'spot price' and returns both facet assignments", () =>
    Effect.gen(function* () {
      const vocab = yield* FacetVocabulary;
      const matches = vocab.matchCompoundConcepts("day-ahead spot price on the interconnector");
      expect(matches.length).toBeGreaterThan(0);
      const spot = matches.find((m) => m.entry.surfaceForm === "spot price");
      expect(spot?.entry.assignments.measuredProperty).toBe("price");
      expect(spot?.entry.assignments.statisticType).toBe("spot");
    }).pipe(Effect.provide(FacetVocabulary.layer))
  );
});
```

**Step 5.2 — Run, confirm failure (module does not exist)**

**Step 5.3 — Create `compoundConcepts.ts` with the schema + lookup builder**

**Step 5.4 — Create the source-of-truth and runtime `compound-concepts.json` with the starter set**

**Step 5.5 — Update `sync-vocabulary.ts` to include compound-concepts**

**Step 5.6 — Add `matchCompoundConcepts` to the `FacetVocabulary` service**

**Step 5.7 — Run tests, confirm pass**

**Step 5.8 — Integrate compound matches into `Interpret.ts`**

This is the delicate part. The compound matcher runs first, records text regions, and per-facet matching runs on the remainder. Compound matches produce a `SiteAssignment` with multiple facet values in its `partial`.

**Step 5.9 — Write an integration test locking the precedence**

```ts
it.effect("compound concept 'spot price' dominates per-facet matches in the same text region", () =>
  Effect.gen(function* () {
    const vocabulary = yield* FacetVocabulary;
    const prepared = yield* loadCheckedInDataLayerRegistry(
      checkedInDataLayerRegistryRoot
    );
    const lookup = toDataLayerRegistryLookup(prepared);

    const outcome = decodeOutcome(
      resolveBundle(
        decodeBundle({
          postText: [],
          chartTitle: "Electricity spot price",
          series: [],
          keyFindings: [],
          sourceLines: [],
          publisherHints: []
        }),
        lookup,
        vocabulary
      )
    );

    if (outcome._tag === "Resolved") {
      for (const item of outcome.items) {
        if (item._tag !== "bound") continue;
        expect(item.semanticPartial.measuredProperty).toBe("price");
        expect(item.semanticPartial.statisticType).toBe("spot");
      }
    }
  }).pipe(
    Effect.provide(FacetVocabulary.layer),
    Effect.provide(localFileSystemLayer)
  ),
  15_000
);
```

**Step 5.10 — Run full test + eval suites**

**Step 5.11 — Commit**

```bash
git commit -m "$(cat <<'EOF'
feat: add compound-concept support to facet vocabulary and interpret step

Per the 2026-04-12 algebra review Gap 2, some surface forms
legitimately span multiple facets at once (e.g., "spot price" is
simultaneously measuredProperty=price and statisticType=spot). The
one-JSON-per-facet lexicon structurally cannot represent these.

This commit adds a CompoundSurfaceFormEntry schema, a new
compound-concepts.json vocabulary file with a starter set, a
matchCompoundConcepts matcher, and integration in Interpret.ts so
compound matches take precedence over per-facet matches in the
same text region.

The starter set covers the cases that surfaced in the gold-set
eval: "spot price", "peak demand", "peak load", "wholesale
electricity price". Full curation is a follow-up.

Refs: SKY-314, algebra-review Gap 2

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan validation

After all five tasks land:

1. Run `bun eval/resolution-kernel/run-eval.ts` one final time.
2. Commit the resulting `runs/<timestamp>/` directory as the post-plan baseline.
3. Compare the confusion matrix to the starting baseline `runs/20260412-220303-160/summary.md`.
4. Expected direction: the `Resolved` row should shift substantially toward column 1. The specific target is not "20/20 pass" — the eval's job is diagnostic, and some gold-set entries may reveal additional issues worth filing as follow-ups.
5. Open a new PR for the combined work, stacked on `sky-314/resolution-kernel-eval-harness` (currently PR #98) or rebased onto main if that merges first.

## Scope exclusions (explicit)

These are NOT in scope for this plan:

- **Vocabulary curation beyond the specific cases called out**. Tasks 2 and 3 address the specific overfires that block the gold set. A full curation sweep of all facet JSONs is a follow-up.
- **Registry expansion**. Some gold-set rows (006-edcporter, 008-ben-inskeep, 012-hausfath, 018-simonmahan) fail because the expected variable does not exist in the cold-start registry. That's a registry curation concern, not a kernel concern.
- **Agent scope corrections**. Some gold-set entries have the wrong `expectedAgentId`. Eval-harness ground-truth updates are a separate concern.
- **Observability instrumentation on the runtime path**. Effect-native logging spans on `Interpret` / `Bind` / `Assemble` would be valuable but SKY-270 covers that. Kept out to keep this plan focused.
- **Gold set expansion**. The ontology review identified that the gold set is small and incomplete. Dispatching an agent to curate more fixture posts via MCP is a follow-up.

---

## Execution handoff

Plan complete and saved to `docs/plans/2026-04-12-sky-314-resolution-kernel-ontology-fixes.md`.

Per user directive, execution will proceed via **subagent-driven-development**: sequential implementer subagents per task, two-stage review (spec compliance → code quality) between each, committing per task, running the eval harness after each task as the diagnostic signal.
