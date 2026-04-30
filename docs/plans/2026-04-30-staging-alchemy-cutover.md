# Staging Alchemy Repair (post-cutover) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring staging into the runnable state the entity-graph slice expects: agent worker `/health` returning 200, D1 migration 27 (`ontology_entity_graph`) applied, entity-graph tables live, end-to-end staging healthy. AI Search injection is intentionally deferred to its own slice.

**Verified live state (2026-04-30):**
- All three staging workers (`skygest-resolver-staging`, `skygest-bi-agent-staging`, `skygest-bi-ingest-staging`) were last deployed via API upload on 2026-04-28 — the cutover already happened. There is no "skip-ingest" cutover work to do.
- Resolver `/health` and ingest `/health` return 200.
- Agent `/health` returns 503 because it validates the enrichment-secret set including `GOOGLE_API_KEY`, which is bound on ingest only. **Open PR #140** (`codex/agent-health-cutover`) fixes this with a worker-only Config validation path.
- AI Search live state is healthy — namespace `energy-intel`, instance `entity-search`, all 5 custom_metadata fields applied per spec. No work needed.
- Staging D1 `_migrations` table is at version **25**. Migration **26** (`data_ref_candidate_citation_source_alignment`) and migration **27** (`ontology_entity_graph` — the one that creates `entities`, `entity_links`, `entity_link_evidence`, `reindex_queue`, `reindex_queue_dlq`) have not run.
- Wrangler is currently authed to the right account.

**Architecture:**
1. Land PR #140 first — staging won't be fully healthy until agent `/health` is 200.
2. Apply pending migrations via the staging ops CLI (`StagingOpsService.migrate` is the runner — `/health` does NOT trigger migrations; my earlier plan was wrong on this).
3. Verify entity-graph tables are present.
4. Re-run health checks to confirm post-repair state.
5. Defensive D1 backup of expert/post/enrichment tables before applying migrations 26–27, even though both are additive — costs nothing, removes restore anxiety.

**Tech Stack:** Cloudflare Workers + D1; `bun run ops`/`bunx ops` CLI talking to `StagingOpsService`; Wrangler 4.81.1 for D1 reads + deployment listing; `@effect/sql-d1` for the actual migration runner.

**Out of scope (each gets its own plan / PR):**
- AI Search fixture injection (needs a real admin endpoint design + tests; not a smoke step).
- Ingest worker rewrite to write through `EntityGraphRepoD1` + emit `ReindexQueue` requests (semantic change, big enough to be its own plan).
- Production stage cutover.
- MCP wiring to entity-graph.

**Pre-requisites:**
- Wrangler authed: `bunx wrangler whoami` returns the right account (`af578620f2ff4eae2042c031be82f7e7`).
- Worktree: this plan executes in `/Users/pooks/Dev/skygest-cloudflare/.worktrees/staging-cutover` on branch `codex/staging-alchemy-cutover`.
- **Run `bun install` once in the worktree before any task that uses the package code** (worktree starts with no `node_modules`).
- `.env.staging` populated with `SKYGEST_OPERATOR_SECRET` and `SKYGEST_STAGING_BASE_URL` (per `feedback_staging_deploy` memory). Bun loads `.env.staging` automatically when the operator runs ops commands.

**Shell note:** All loops in this plan use POSIX-portable syntax (no bare `for x in $UNSPLIT_VAR`) so they behave the same in zsh and bash.

---

## Task 1: Worktree setup

**Why:** Fresh worktree has no `node_modules`. Without it, `bun run ops`, `bunx alchemy run`, and `bun run typecheck` all fail.

**Step 1: Install dependencies**

Run:
```sh
cd /Users/pooks/Dev/skygest-cloudflare/.worktrees/staging-cutover
bun install
```
Expected: `bun.lock` resolves, `node_modules/` populated, no errors.

**Step 2: Confirm typecheck passes from this worktree**

Run: `bun run typecheck`
Expected: 0 errors across all 6 configs.

**Step 3: No commit. Move on.**

---

## Task 2: Capture pre-repair state

**Why:** Rollback breadcrumb + "before" snapshot for the outcome doc.

**Files:**
- Create (gitignored): `.backups/2026-04-30/wrangler-deployments-staging.txt`, `.backups/2026-04-30/migrations-version-before.txt`, `.backups/2026-04-30/health-before.txt`

**Step 1: Add `.backups/` to `.gitignore` (if not already)**

Run: `grep -qE "^\.backups/?$" .gitignore || printf "\n.backups/\n" >> .gitignore`
Expected: `.gitignore` ends with a `.backups/` line.

**Step 2: Capture deployment IDs for the three staging workers**

Run:
```sh
mkdir -p .backups/2026-04-30
for w in skygest-resolver-staging skygest-bi-agent-staging skygest-bi-ingest-staging; do
  printf '\n=== %s ===\n' "$w"
  bunx wrangler deployments list --name "$w" 2>&1 | head -10
done > .backups/2026-04-30/wrangler-deployments-staging.txt
wc -l .backups/2026-04-30/wrangler-deployments-staging.txt
```
Expected: file has 3 sections, each with a most-recent deployment row.

**Step 3: Capture current migration version**

Run:
```sh
bunx wrangler d1 execute skygest-staging --remote --json \
  --command "SELECT MAX(version) AS v FROM _migrations" \
  > .backups/2026-04-30/migrations-version-before.txt 2>&1
cat .backups/2026-04-30/migrations-version-before.txt
```
Expected: JSON with `"v": 25`.

**Step 4: Capture pre-repair `/health` for all three workers**

Source the staging env first:
```sh
set -a
. ./.env.staging
set +a
```
Then:
```sh
for w in skygest-bi-ingest-staging skygest-resolver-staging skygest-bi-agent-staging; do
  url="$SKYGEST_STAGING_BASE_URL"  # adjust per worker if you have separate base URLs
  status=$(curl -sS -o /dev/null -w "%{http_code}" "$url/health" || true)
  printf '%s %s\n' "$w" "$status"
done | tee .backups/2026-04-30/health-before.txt
```
If your staging routes the three workers under separate hostnames, repeat per-worker base URL. The expected current state is: ingest 200, resolver 200, agent 503.

**Step 5: Commit `.gitignore` change only**

```sh
git add .gitignore
git commit -m "Ignore .backups/ for staging-repair plan"
```

---

## Task 3: Backup post + expert + enrichment tables

**Why:** Migration 27 only adds tables (additive, no data mutation), but a defensive snapshot of the data we care most about is cheap. KV intentionally skipped per scope.

**Step 1: Define the backup table list as a portable array**

POSIX-portable approach (works in both zsh and bash):
```sh
TABLES_FILE=".backups/2026-04-30/tables-to-backup.txt"
cat > "$TABLES_FILE" <<'TBL'
experts
expert_sources
expert_sync_state
posts
post_topics
post_payloads
post_curation
post_enrichments
post_enrichment_runs
links
editorial_picks
publications
ingest_runs
ingest_run_items
podcast_episodes
podcast_segments
podcast_segment_topics
agents
catalogs
catalog_records
datasets
distributions
data_services
dataset_series
variables
series
data_layer_audit
data_ref_candidate_citations
TBL
wc -l "$TABLES_FILE"
```
Expected: 28 lines.

**Step 2: Capture row counts**

```sh
: > .backups/2026-04-30/d1-staging-rowcounts.txt
while IFS= read -r t; do
  count=$(bunx wrangler d1 execute skygest-staging --remote --json \
    --command "SELECT COUNT(*) AS n FROM $t;" 2>/dev/null \
    | jq -r '.[0].results[0].n // "ERR"')
  printf '%s: %s\n' "$t" "$count" | tee -a .backups/2026-04-30/d1-staging-rowcounts.txt
done < "$TABLES_FILE"
```
Expected: every line is `<table>: <integer>`. If any line ends in `ERR`, that table doesn't exist on staging — remove it from `$TABLES_FILE` before Step 3.

**Step 3: Dump every table**

```sh
while IFS= read -r t; do
  echo "=> Dumping $t..."
  bunx wrangler d1 export skygest-staging --remote \
    --table "$t" \
    --output ".backups/2026-04-30/d1-staging-$t.sql" 2>&1 | tail -3
done < "$TABLES_FILE"
```
Expected: a `.sql` file per table, non-empty for tables with rows.

**Step 4: Spot-check sizes against row counts**

```sh
while IFS= read -r t; do
  expected=$(grep "^$t: " .backups/2026-04-30/d1-staging-rowcounts.txt | cut -d' ' -f2)
  lines=$(wc -l < ".backups/2026-04-30/d1-staging-$t.sql")
  printf '%-32s rows=%s sql_lines=%s\n' "$t" "$expected" "$lines"
done < "$TABLES_FILE"
```
Expected: `sql_lines` is roughly `rows + small constant header`. Anomalies (e.g., 0 rows but file 0 bytes) are fine for empty tables; 0 rows but sql_lines > 100 deserves a peek.

**Step 5: No commit (dumps are gitignored).**

---

## Task 4: Land PR #140 (agent health fix)

**Why:** Agent `/health` is 503 until this lands. We can't claim "staging healthy" without it.

**Step 1: Review PR #140**

Run:
```sh
gh pr view 140 --json title,headRefName,body,additions,deletions,files
gh pr checks 140
```
Expected: PR is `OPEN`, all checks green. Files touched: `src/platform/Config.ts`, `src/worker/feed.ts`, two test files.

**Step 2: Merge PR #140 (squash)**

This is a destructive-to-shared-state action — confirm with the user before running.

```sh
gh pr merge 140 --squash --delete-branch
```
Expected: PR shows merged; branch deleted.

**Step 3: Wait for staging auto-deploy**

CI auto-deploys staging on merge to main per `feedback_staging_deploy` memory. Wait, then poll:

```sh
for i in 1 2 3 4 5 6; do
  status=$(curl -sS -o /dev/null -w "%{http_code}" "$SKYGEST_STAGING_BASE_URL/health")
  printf 'attempt %s: %s\n' "$i" "$status"
  [ "$status" = "200" ] && break
  sleep 30
done
```
Expected: by attempt 4–6, status flips from 503 to 200.

**Step 4: No new commit on this branch — the fix shipped via PR #140.**

---

## Task 5: Apply pending D1 migrations (26 + 27)

**Why:** This is the load-bearing repair step. Migration 27 creates `entities`, `entity_links`, `entity_link_evidence`, `reindex_queue`, `reindex_queue_dlq`. Without it, the entity-graph code paths can't read or write.

**Migration runner reference:** `src/services/StagingOpsService.ts` exposes a `migrate` operation that runs `runMigrations` from `src/db/migrate.ts`. The CLI client at `src/ops/Cli.ts` invokes it via `client.migrate(baseUrl, secret)`. There is no /health-triggered migration path.

**Step 1: Confirm the ops CLI command shape**

Run:
```sh
bunx ops --help 2>&1 | head -30
# or, if it's a bun script:
bun run ops --help 2>&1 | head -30
```
Expected: subcommand list including `migrate`. If unsure, check `package.json` for the `ops` script and `src/ops/Cli.ts` for the actual subcommand name (likely `migrate`, possibly `db:migrate`).

**Step 2: Run the migration against staging**

```sh
bun run ops migrate \
  --base-url "$SKYGEST_STAGING_BASE_URL" \
  --secret "$SKYGEST_OPERATOR_SECRET"
```
(Adjust flag names per the actual CLI surface.)

Expected: command prints applied migrations 26 + 27, exits 0.

**Step 3: Verify migration version updated**

```sh
bunx wrangler d1 execute skygest-staging --remote --json \
  --command "SELECT version, name FROM _migrations ORDER BY version DESC LIMIT 5"
```
Expected: top row `version=27, name="ontology_entity_graph"`; second row `version=26, name="data_ref_candidate_citation_source_alignment"`.

**Step 4: Verify entity-graph tables exist**

```sh
bunx wrangler d1 execute skygest-staging --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND (name='entities' OR name LIKE 'entity_link%' OR name='reindex_queue' OR name='reindex_queue_dlq') ORDER BY name" \
  | jq -r '.[0].results[].name' | tee .backups/2026-04-30/entity-graph-tables-after.txt
```
Expected output (5 lines):
```
entities
entity_link_evidence
entity_links
reindex_queue
reindex_queue_dlq
```
If any are missing, the migration runner had a partial failure — STOP and investigate before any later step.

**Step 5: No new commit (migrations are server-side state).**

---

## Task 6: Post-repair smoke

**Why:** Confirm the system is in the verified-good state we expect.

**Step 1: Re-check `/health` for all three workers**

```sh
: > .backups/2026-04-30/health-after.txt
for w in skygest-bi-ingest-staging skygest-resolver-staging skygest-bi-agent-staging; do
  url="$SKYGEST_STAGING_BASE_URL"
  status=$(curl -sS -o /dev/null -w "%{http_code}" "$url/health" || true)
  printf '%s %s\n' "$w" "$status" | tee -a .backups/2026-04-30/health-after.txt
done
```
Expected: all three 200. Diff against `health-before.txt` to confirm agent flipped from 503 → 200.

**Step 2: Confirm AI Search live state still matches spec**

(This was healthy pre-repair; this is just a sanity check that nothing regressed.)

```sh
bun -e '
import { createCloudflareApi, getAiSearchInstance } from "alchemy/cloudflare";
const api = await createCloudflareApi({ accountId: "af578620f2ff4eae2042c031be82f7e7" });
const i = await getAiSearchInstance(api, "energy-intel", "entity-search");
console.log(JSON.stringify({ name: i.name, custom_metadata: i.custom_metadata }, null, 2));
'
```
Expected: 5 fields (`entity_type`, `iri`, `topic`, `authority`, `time_bucket`), all `text`.

**Step 3: Confirm the entity-graph repo can talk to D1 from a worker**

Cheapest check: a tiny SELECT against `entities` from the staging admin surface, if one exists, OR via `wrangler d1 execute` directly:

```sh
bunx wrangler d1 execute skygest-staging --remote --json \
  --command "SELECT COUNT(*) AS n FROM entities" \
  | jq '.[0].results[0]'
```
Expected: `{ "n": 0 }`. Zero rows is correct — nothing's been written yet, but the table exists and is queryable.

---

## Task 7: Outcome doc + close-out

**Files:**
- Create: `docs/plans/2026-04-30-staging-alchemy-cutover-outcome.md`

**Step 1: Capture before/after**

Compose the outcome doc with:
- Pre-repair state: `health-before.txt`, migration version 25
- Actions taken: PR #140 merged + deployed at <timestamp>; migrations 26 + 27 applied
- Post-repair state: `health-after.txt`, migration version 27, entity-graph tables present
- Anomalies: anything that needed manual intervention
- Linkage to next plan (AI Search fixture injection slice, ingest entity-graph rewrite)

**Step 2: Commit the plan + outcome doc**

```sh
git add docs/plans/2026-04-30-staging-alchemy-cutover.md \
        docs/plans/2026-04-30-staging-alchemy-cutover-outcome.md
git commit -m "Repair staging post-cutover: migrations 26+27, agent health"
```

**Step 3: Authorize push + draft PR**

```sh
git push -u origin codex/staging-alchemy-cutover
gh pr create --draft \
  --title "Staging repair: agent health + migrations 26+27" \
  --body "Plan: docs/plans/2026-04-30-staging-alchemy-cutover.md
Outcome: docs/plans/2026-04-30-staging-alchemy-cutover-outcome.md

Repair steps after the 2026-04-28 staging cutover:
- PR #140 (agent health fix) merged + auto-deployed
- D1 migrations 26 + 27 applied via ops CLI
- entity-graph tables verified
- backups dumped to .backups/2026-04-30/"
```

---

## Roll-back plan

- **PR #140 merge** is on `main`; revert via `gh pr revert <pr-of-revert>` or `git revert <sha>` + new PR if it caused issues.
- **Migrations 26 + 27 are additive** — there's no destructive change to undo. If anything goes wrong with the migration runner, the partial state can be cleaned up by manually dropping any half-created tables and resetting `_migrations` to 25, then re-running.
- **Data restore** (only needed if something unexpected mutated existing rows): `for f in .backups/2026-04-30/d1-staging-<table>.sql; do bunx wrangler d1 execute skygest-staging --remote --file=<dump>.sql; done` after truncating the affected table.

---

## Follow-ups (each is its own plan)

1. **AI Search fixture injection slice** — design an admin endpoint on the agent worker that calls `AiSearchClient.upload` with the canonical `ExpertProjectionFixture`. Add tests. Ship as its own PR.
2. **Ingest entity-graph rewrite** — adapt the ingest pipeline to write through `EntityGraphRepoD1` and emit `ReindexQueue` requests so AI Search stays in sync with D1 state.
3. **Production cutover** — once staging is exercised against real data flows, mirror the Alchemy stack to production with a backup-first plan.
