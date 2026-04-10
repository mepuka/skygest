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

The default invocation snapshots the remote staging D1 into a local sqlite cache
and reads from that. No flags required on the first run:

```bash
bun scripts/build-stage1-eval-snapshot.ts
```

On cache miss the script runs `wrangler d1 export skygest-staging --remote
--table <t> ...` (limited to the non-FTS tables Stage 1 actually reads),
imports the dump into `.cache/d1/skygest-staging.sqlite` via `sqlite3 .read`,
and serves every subsequent run from that file. Cache-hit runs complete in
under a second. On cache miss expect 60–120 s while the export runs.

### Flags

- `--db <path>` — explicit sqlite file, bypasses the snapshot cache entirely
  (useful for CI fixtures or ad-hoc debugging)
- `--snapshot-db-name <name>` — wrangler D1 database name when building the
  snapshot cache (default `skygest-staging`)
- `--manifest <path>` — override the gold-set manifest location
- `--out <path>` — override the snapshot jsonl output path
- `--report-out <path>` — override the diagnostic build report sidecar

### Environment overrides

- `STAGE1_EVAL_SQLITE_PATH` — short-circuits to an explicit sqlite path,
  same as `--db`. Takes precedence over the snapshot cache but is overridden
  by an explicit `--db` flag.
- `D1_SNAPSHOT_CACHE_DIR` — where cached sqlite dumps live (default
  `.cache/d1`). The directory is created on demand and gitignored.
- `D1_SNAPSHOT_MAX_AGE_HOURS` — maximum age of a cached dump before it is
  re-exported on the next run (default `24`). Delete the cache file directly
  to force an immediate refresh.

### Build report

The builder writes all successful rows even if some gold-set posts are
incomplete. Any problems are written to the sidecar build report instead of
blocking the entire snapshot.

## Run the eval

```bash
bun eval/resolution-stage1/run-eval.ts
```

To focus on one row:

```bash
bun eval/resolution-stage1/run-eval.ts 001-
```

Each run writes per-post JSON files plus a `summary.md` into `eval/resolution-stage1/runs/<timestamp>/`.
