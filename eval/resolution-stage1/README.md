# Stage 1 Resolution Eval

This folder holds the local eval loop for the Slice 2a deterministic resolver.

## Inputs

- Gold-set manifest:
  `/Users/pooks/Dev/skygest-cloudflare/references/cold-start/survey/gold-set-resolver.json`
- Snapshot output:
  `/Users/pooks/Dev/skygest-cloudflare/eval/resolution-stage1/snapshot.jsonl`
- Build report sidecar:
  `/Users/pooks/Dev/skygest-cloudflare/eval/resolution-stage1/snapshot.build-report.json`

The gold set is a curated subset of posts that should already have the stored post context and enrichments needed for Stage 1. The snapshot stores the raw resolver inputs only: `postContext`, `vision`, and `sourceAttribution`.

## Build the snapshot

```bash
bun scripts/build-stage1-eval-snapshot.ts \
  --db /path/to/skygest.sqlite
```

Optional flags:

- `--manifest` to point at a different gold-set file
- `--out` to write the snapshot somewhere else
- `--report-out` to override the diagnostic sidecar path

If `STAGE1_EVAL_SQLITE_PATH` is set, `--db` becomes optional.

The builder now writes all successful rows even if some gold-set posts are incomplete. Any problems are written to the sidecar build report instead of blocking the entire snapshot.

## Run the eval

```bash
bun eval/resolution-stage1/run-eval.ts
```

To focus on one row:

```bash
bun eval/resolution-stage1/run-eval.ts 001-
```

Each run writes per-post JSON files plus a `summary.md` into `eval/resolution-stage1/runs/<timestamp>/`.
