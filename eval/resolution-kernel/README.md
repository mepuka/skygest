# Resolution Kernel Eval

Deterministic fixtures for the post-SKY-314 resolution kernel. Feeds the same
`Stage1Input` shape the live `ResolverService.resolvePost` builds from an
enriched post and asserts that `ResolutionKernel.resolve` emits the expected
`ResolutionOutcome[]` against the checked-in data layer registry.

## Inputs

- **Snapshot rows** (shared with the stage1 harness):
  `eval/resolution-stage1/snapshot.jsonl`
  Each row carries `postContext`, `vision`, and `sourceAttribution` — the exact
  deterministic resolver inputs for one post.
- **Expected outcomes** (kernel-specific ground truth):
  `eval/resolution-kernel/expected-outcomes.jsonl`
  One hand-authored assertion per line. Format documented inside the file.

Ground truth is seeded from `references/cold-start/candidates/` — any
candidate with `resolutionState === "partially_resolved"` and a
`referencedVariableId` becomes an expected `Resolved` entry. The kernel eval
does **not** modify the candidate schema; assertions live in a sibling JSONL.

## Run the eval

```bash
bun eval/resolution-kernel/run-eval.ts
```

Filter to one row by slug prefix:

```bash
bun eval/resolution-kernel/run-eval.ts 001-
```

Each run writes into `eval/resolution-kernel/runs/<timestamp>/`:

- `summary.md` — wall-clock, outcome-tag confusion matrix, failing rows with
  per-check diffs, and a list of unannotated bundles that should grow the
  gold set.
- `confusion-matrix.json` — raw 6×6 expected × actual tag counts.
- Per-entry JSON files — one per `(slug, expected)` pair plus one per
  unannotated bundle.

## Ground-truth format

Entries live in `expected-outcomes.jsonl`. Required fields:

- `postUri` — full `x://` or `at://` PostUri string
- `outcomeTag` — one of `Resolved | Ambiguous | Underspecified | Conflicted | OutOfRegistry | NoMatch`

Optional fields:

- `assetKey` — when set, the entry targets one specific bundle. When omitted,
  the entry applies to the whole post (at least one bundle must satisfy it).
- `expectedVariableIds` — required for `Resolved` / `OutOfRegistry` assertions.
- `expectedGapReason` — for `Ambiguous` / `Underspecified` / `Conflicted`.
- `expectedAgentId` — optional agent-scope assertion (verifies the bound
  candidates came from the expected publisher agent).
- `notes` — free text; surfaces in the per-entry JSON output.

Lines starting with `//` are treated as comments.

## What's checked

For each annotated bundle the runner reports pass/fail on:

1. **outcome-tag** — did the kernel emit the expected tag?
2. **variable-ids** — did the bound items cover the expected variables?
   (When `assetKey` is unset we only fail on *missing* variables — other
   bundles can legitimately bind different variables.)
3. **gap-reason** — when expected, does the emitted gap match?
4. **agent-scope** — when expected, does the bound candidate belong to the
   expected agent?

Confidence and tier (`entailment` / `strong-heuristic` / `weak-heuristic`) are
**log-only** in v1 — they appear in per-entry JSON but do not affect pass/fail.

## Growing the gold set

Every bundle without a matching expected entry is emitted as an "unannotated"
row in `summary.md`, showing the actual outcome tag, bound variable IDs, and
gap reason. Use that output to hand-author new lines in
`expected-outcomes.jsonl` over time.
