# PR #108 — Level 2 Effect 4 Pattern Compliance Review

Scope: `SKY-336` matcher normalization + dataset-name scoping, and `SKY-338`
visible-URL tightening. Reviewed against CLAUDE.md non-negotiables.

## Verdict

**No blocking Effect rule violations.** New code is correctly partitioned
between a pure functional core (kernel / stage1 / matcher) and Effect services
at the boundary (`ResolutionKernel`, `GeminiVisionServiceLive`). All errors are
`Schema.TaggedError`, JSON decoding uses `Schema.fromJsonString(...)`, services
are `ServiceMap.Service` + `Layer.effect`, and tests uniformly use
`it.effect` from `@effect/vitest`.

A handful of places reinvent combinators that Effect 4 already exposes
(`Array.sortBy`, `Array.findFirst`, `Order.combine`, `Option.firstSomeOf`)
and one `try/catch` for URL parsing inside a pure helper that would read
better as an Effect primitive. Nothing hot-path; all should-fix.

---

## Strengths

- `datasetNameMatch.ts` correctly stays **pure functional** — it is a library
  called from both `Stage1.ts` (pure) and `ResolutionKernel.ts` (Effect
  service). Mixing Effect into it would force the entire kernel into `Effect`
  for no dependency-injection benefit, since the only "input" is an already-
  materialised `DataLayerRegistryLookup` passed by parameter. This is a
  legitimate departure from rule 1 and is not flagged.
- `ResolutionKernel.ts:127-168` keeps the new dataset-scope plumbing inside
  the existing `Layer.effect(Effect.gen)` wrapper without pulling any new
  service dependencies. The only new imports are types + the pure
  `findDatasetMatchesForName` / `listPreferredDatasetAgentIds` helpers — no
  dependency bloat.
- `GeminiVisionServiceLive.ts:544-553` still round-trips Gemini's payload
  through `Schema.decodeUnknownEffect(Schema.fromJsonString(...))` — no
  `JSON.parse`. Errors are mapped into `GeminiParseError` via
  `Effect.mapError(... new GeminiParseError(...))`, which is idiomatic.
- `Bind.ts` — the new `narrowCandidatesByDatasets` follows the exact pattern
  of the pre-existing `narrowCandidatesByAgent`. Gap ordering uses the same
  `makeGapItem` factory; no imperative drift.
- Tests: **every** new test uses `it.effect(...)` from `@effect/vitest`
  (`stage1-kernel.test.ts`, `resolution-kernel-service.test.ts`,
  `resolution-kernel.test.ts`, `gemini-vision-service.test.ts`). Zero
  `Effect.runPromise` escape hatches.

---

## Must-fix

_None._ No rule violations. Scope-appropriate purity, error types, Schema
decoding, service wiring.

---

## Should-fix

### S1. `try/catch` inside a pure helper — `GeminiVisionServiceLive.ts:279-288`

```ts
const normalizeVisibleUrlCandidate = (value: string): string | null => {
  const trimmed = trimVisibleUrlBoundary(value);
  if (!URLISH_EXACT_PATTERN.test(trimmed)) {
    return null;
  }

  try {
    const url = new URL(ensureHttpUrl(trimmed));
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};
```

This is the only `try/catch` in any file touched by the PR. CLAUDE.md rule 1
says "no `try-catch` ... except at Worker entry points." `normalizeVisibleUrls`
is called *inside* `normalizeExtractionResponse`, which is called from
`extractChartData` / `extractImageSummary` — which are both Effect-fn bodies.

Two idiomatic alternatives:

**Option A — `Either.try` / `Result.try`, still pure:**

```ts
import { Result } from "effect";

const normalizeVisibleUrlCandidate = (value: string): string | null => {
  const trimmed = trimVisibleUrlBoundary(value);
  if (!URLISH_EXACT_PATTERN.test(trimmed)) return null;

  const parsed = Result.try({
    try: () => new URL(ensureHttpUrl(trimmed)),
    catch: () => null
  });
  if (Result.isFailure(parsed)) return null;

  const url = parsed.success;
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.toString()
    : null;
};
```

**Option B — use `URL.canParse` (available on Workers runtime):**

```ts
const normalizeVisibleUrlCandidate = (value: string): string | null => {
  const trimmed = trimVisibleUrlBoundary(value);
  if (!URLISH_EXACT_PATTERN.test(trimmed)) return null;

  const candidate = ensureHttpUrl(trimmed);
  if (!URL.canParse(candidate)) return null;

  const url = new URL(candidate);
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.toString()
    : null;
};
```

Option B is shorter, zero allocations on failure path, and stays fully
synchronous — which is the reason the current code used `try/catch`. Either
removes the last CLAUDE.md rule-1 violation in touched files.

### S2. `compareDatasetTitleScores` reinvents `Order.combine` — `datasetNameMatch.ts:177-183`

```ts
const compareDatasetTitleScores = (left, right) =>
  right.score - left.score ||
  left.dataset.title.localeCompare(right.dataset.title) ||
  left.dataset.id.localeCompare(right.dataset.id);
```

The same file lives next to `Stage1.ts:81-98`, which already uses
`Order.combineAll` + `Order.mapInput` for exactly this pattern. For
consistency and sortBy composability, prefer:

```ts
import { Order } from "effect";

const datasetTitleScoreOrder = Order.combineAll([
  Order.mapInput(Order.reverse(Order.Number), (c) => c.score),
  Order.mapInput(Order.String, (c) => c.dataset.title),
  Order.mapInput(Order.String, (c) => c.dataset.id)
]);
```

Then `scored.sort(datasetTitleScoreOrder)` instead of
`scored.sort(compareDatasetTitleScores)`. Eliminates the
`right.score - left.score ||` trick, which silently misbehaves if two scores
differ by exactly zero-ish and gets promoted to `NaN` for any non-numeric
fallthrough.

### S3. `findFuzzyDatasetTitleMatches` reinvents `Array.findFirst` over pools — `datasetNameMatch.ts:185-221`

```ts
for (const pool of searchPools) {
  const scored = pool
    .map((dataset) => ({ dataset, score: scoreDatasetTitle(datasetName, dataset) }))
    .filter((c) => c.score >= DATASET_TITLE_FUZZY_THRESHOLD)
    .sort(compareDatasetTitleScores);

  const bestScore = scored[0]?.score;
  if (bestScore === undefined) continue;

  return scored
    .filter((c) => Math.abs(c.score - bestScore) <= DATASET_TITLE_SCORE_EPSILON)
    .map((c) => c.dataset);
}

return [];
```

The "try pools in order, return first one that produced results" shape is
`Array.findFirst` with an `Option` projection:

```ts
import { Array as Arr, Option } from "effect";

const scorePool = (pool: ReadonlyArray<Dataset>): Option.Option<ReadonlyArray<Dataset>> => {
  const scored = pool
    .map((dataset) => ({ dataset, score: scoreDatasetTitle(datasetName, dataset) }))
    .filter((c) => c.score >= DATASET_TITLE_FUZZY_THRESHOLD)
    .sort(datasetTitleScoreOrder);
  if (scored.length === 0) return Option.none();
  const bestScore = scored[0]!.score;
  return Option.some(
    scored
      .filter((c) => Math.abs(c.score - bestScore) <= DATASET_TITLE_SCORE_EPSILON)
      .map((c) => c.dataset)
  );
};

return Option.firstSomeOf(searchPools.map(scorePool)).pipe(
  Option.getOrElse(() => [] as ReadonlyArray<Dataset>)
);
```

Same semantics, zero mutable `for…continue`, composable with any future
search-pool expansion (e.g. when you add a third tier).

### S4. `findDatasetMatchesForName` builds a `Map` with a manual `Set` dedupe — `datasetNameMatch.ts:260-284`

```ts
const exactMatches = dedupeDatasets(
  listDatasetTitleCandidates(value)
    .map((candidate) => lookup.findDatasetByTitle(candidate))
    .flatMap((match) => (Option.isSome(match) ? [match.value] : []))
);
```

`Option.isSome ? [m.value] : []` is an Effect-4-ism anti-pattern; there are
first-class combinators:

```ts
import { Array as Arr, Option } from "effect";

const exactMatches = pipe(
  listDatasetTitleCandidates(value),
  Arr.filterMap((candidate) => lookup.findDatasetByTitle(candidate)),
  Arr.dedupeWith((a, b) => a.id === b.id)
);
```

`Arr.filterMap((c) => Option<Dataset>)` kills the `flatMap + isSome` dance,
and `Arr.dedupeWith` replaces the `dedupeDatasets` helper (which is used in
exactly two places and can be deleted). Same applies at
`datasetNameMatch.ts:190-191`.

### S5. `resolveAgentIdFromStage1Input` uses string `_tag === "Some"` instead of `Option.isSome` — `ResolutionKernel.ts:48-66`

```ts
const agentByLabel = lookup.findAgentByLabel(providerHint);
if (agentByLabel._tag === "Some") {
  return agentByLabel.value.id;
}
```

This file already imports nothing from `effect` for `Option`, and the rest of
`datasetNameMatch.ts` / `Bind.ts` / `Stage1.ts` all use
`Option.isSome(...)`. Two callsites (`:49` and `:65`). Minor but grep-hostile:
anyone scanning for `Option.isSome` misses these branches.

```ts
import { Option } from "effect";
// ...
if (Option.isSome(agentByLabel)) return agentByLabel.value.id;
```

Also, the overall "iterate candidates, return first successful lookup" shape
is `Option.firstSomeOf` again:

```ts
const byLabel = Option.firstSomeOf(
  providerHints
    .filter((h): h is string => h != null)
    .map((h) => lookup.findAgentByLabel(h))
);
if (Option.isSome(byLabel)) return byLabel.value.id;

const byHomepage = Option.firstSomeOf(
  homepageHints
    .filter((h): h is string => h != null)
    .map((h) => lookup.findAgentByHomepageDomain(h))
);
return Option.match(byHomepage, {
  onSome: (a) => a.id,
  onNone: () => undefined
});
```

Cuts ~20 lines down to ~12 and makes the "try-in-order" semantics explicit.

### S6. `Stage1.ts:618-769` — the giant imperative `runStage1` is a pre-existing shape

Not introduced by this PR (only touched: the dataset-title block at
`:680-702`). Flagging for the design-interview record but **not** asking to
refactor in this PR: the imperative `BuildState` + `for` loops predate
SKY-336. The PR's additions (`pushDatasetTitleMatch` with
`preferredAgentIds` and the fallback residual emission at `:692-702`) follow
the existing convention faithfully. Future rewrite would be an
`Effect.forEach` over a discriminated union of "signal events" — but that's
out of scope for SKY-336.

### S7. `Bind.ts:199-338` — the `bindHypothesis` loop uses `items.push` + `continue`

Also pre-existing. PR only adds two `continue` branches
(`dataset-scope-empty` at `:275-285` and changes `:287-294` / `:298-306`).
The loop shape is deliberate because each item has five possible outcomes
and falling into one stops processing — an `Array.map` would require nesting
the decision tree inside the mapper. Pre-existing and scope-appropriate.
No change requested.

---

## Minor / style

- **`datasetNameMatch.ts:10-12`** — `aliasSchemes.filter((scheme): scheme is
  AliasScheme => scheme !== "url")` is duplicated at `Stage1.ts:70-72`.
  Single-source-of-truth: export `structuredAliasSchemes` from the
  `data-layer/alias` domain module since it's a general-purpose derived
  constant.

- **`datasetNameMatch.ts:32-39`** — `toNonEmpty` is duplicated at
  `Stage1.ts:100-107` byte-for-byte. Move to `src/platform/String.ts` or
  similar. Rule 5 (no duplicate helpers). This is pre-existing in `Stage1.ts`
  but the PR **added** the second copy in `datasetNameMatch.ts`.

- **`datasetNameMatch.ts:107-152`** — `listPreferredDatasetAgentIds` is a
  correct imperative `Set` builder, but the `addAgentLabel` /
  `addHomepageHint` closures that mutate the outer `Set` are an anti-
  pattern when the same shape is expressible as `Arr.filterMap`:

  ```ts
  const labelHints = [
    input.sourceAttribution?.provider?.providerLabel,
    input.sourceAttribution?.contentSource?.publication,
    ...asset.analysis.organizationMentions.map((m) => m.name),
    ...asset.analysis.logoText
  ];
  const homepageHints = [
    input.sourceAttribution?.contentSource?.domain,
    input.sourceAttribution?.contentSource?.url
  ];

  const labelMatches = Arr.filterMap(labelHints, (h) =>
    h == null || h.trim().length === 0
      ? Option.none()
      : lookup.findAgentByLabel(h.trim())
  );
  const homepageMatches = Arr.filterMap(homepageHints, (h) =>
    h == null || h.trim().length === 0
      ? Option.none()
      : lookup.findAgentByHomepageDomain(h.trim())
  );

  return pipe(
    [...labelMatches, ...homepageMatches],
    Arr.map((a) => a.id),
    Arr.dedupe
  );
  ```

- **`ResolutionKernel.ts:149-155`** — the conditional option assignment
  pattern:

  ```ts
  const resolutionOptions: ResolutionScopeOptions = {};
  if (agentId !== undefined) resolutionOptions.agentId = agentId;
  if (datasetIds !== undefined) resolutionOptions.datasetIds = datasetIds;
  ```

  Exists purely to avoid passing `undefined` keys. The codebase already has
  `stripUndefined` in `platform/Json.ts` (used at `Bind.ts:332`,
  `AssembleOutcome.ts:25`, `Stage1.ts:298`). Reuse it:

  ```ts
  const resolutionOptions = stripUndefined({ agentId, datasetIds });
  ```

  Smaller, consistent with how every other call site in the PR handles the
  same problem.

- **`fuzzyMatch.ts:10-16`** — the tokenizer's `\p{L}\p{N}` regex correctly
  uses the `u` flag (line 12: `gu` via `[^\p{L}\p{N}]+/gu`). Apostrophe
  stripping (`['']`) is correct. Pure, ≤10 lines, fine as-is.

- **`prompts.ts`** — pure string literal updates, unreviewable under
  Effect rules.

- **`gemini-vision-service.test.ts`** — the one minor smell is the
  module-level `await import(...)` at `:23-26` to defer service import past
  `vi.mock(...)`. That's a vitest-lifecycle requirement, not an Effect
  issue. `it.effect.each([undefined])("reset mocks", ...)` at `:80` is a
  creative use — may want a plain `beforeEach` instead, but harmless.

---

## Specific refactors (ranked)

| # | File:line | Change | Effort |
|---|-----------|--------|--------|
| 1 | `GeminiVisionServiceLive.ts:279-288` | Replace `try/catch` with `URL.canParse` guard (S1) | 5 min |
| 2 | `datasetNameMatch.ts:177-183` | Replace `compareDatasetTitleScores` with `Order.combineAll` (S2) | 5 min |
| 3 | `ResolutionKernel.ts:48-66` | Replace `_tag === "Some"` with `Option.isSome` + `Option.firstSomeOf` (S5) | 10 min |
| 4 | `datasetNameMatch.ts:260-284` | Use `Arr.filterMap` + `Arr.dedupeWith` instead of `flatMap`/`dedupeDatasets` (S4) | 10 min |
| 5 | `datasetNameMatch.ts:185-221` | Use `Option.firstSomeOf` over search pools (S3) | 15 min |
| 6 | `datasetNameMatch.ts:107-152` | Replace closure mutation in `listPreferredDatasetAgentIds` with `Arr.filterMap` | 10 min |
| 7 | `ResolutionKernel.ts:149-155` | Use `stripUndefined` for `resolutionOptions` | 2 min |
| 8 | `datasetNameMatch.ts:10-12` + `Stage1.ts:70-72` + `toNonEmpty` duplication | Move to shared module (rule 5) | 10 min |

All eight together are maybe an hour of work and collectively clean up about
60 lines into composed Effect primitives. None are blocking — merge is safe.

---

## Sanity-check results

- `grep JSON.parse|JSON.stringify` across touched files → **zero hits**.
- `grep async function|new Promise` across touched `src/` files → **zero hits**.
- `grep throw ` across touched `src/` files → **zero hits**.
- `grep try {` across touched `src/` files → **1 hit** (S1 above).
- All new errors route through `GeminiParseError` / `GeminiApiError` /
  `EnrichmentSchemaDecodeError` — all `Schema.TaggedError` instances defined
  in `src/domain/errors.ts`.
- All new services wired via `ServiceMap.Service` + `Layer.effect` +
  `Effect.gen` (`ResolutionKernel.ts:116-168`).
- All new tests use `it.effect` from `@effect/vitest`.
