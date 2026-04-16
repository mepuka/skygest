# SKY-361 + SKY-362 Execution Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the git-backed snapshot chain by landing SKY-361 (ingest-artifacts store) and SKY-362 (ontology snapshot package + monorepo stub), from current WIP state through cutover, across `skygest-cloudflare` and three external repos.

**Architecture:** Two downstream tickets consuming the SKY-364 fetch primitive. Both keep the Worker bundle Node-free: snapshots become build-time KV seeds, never runtime reads. Both ship as multi-PR sequences so CI stays green on every merge — the first PR in each lands *dormant* wrapper + placeholder lock, the last PR is the cutover.

**Tech Stack:** Effect 4 (`@effect/*-beta.43`), Bun runtime, `effect-language-service`, tsgo typechecker, vitest (`@effect/vitest`), GitHub Actions, GitHub private repos, SSH deploy keys.

**Authoritative spec:** `docs/plans/2026-04-15-git-backed-snapshots-spec.md`. This plan is the execution expansion of §9 of that spec. If the spec and this plan disagree, the spec wins.

**Tickets:**
- **SKY-361** — Stand up hashable ingest-artifacts store (3 PRs in skygest-cloudflare + 1 import commit in skygest-ingest-artifacts)
- **SKY-362** — Ontology triple store package in monorepo (2 PRs in skygest-cloudflare + `publish-snapshot.sh` in ontology_skill + first snapshot in skygest-ontology-snapshots)
- **Parent epic:** SKY-213

---

## Linear context snapshot (reviewed 2026-04-15)

- **SKY-364** — Done. Landed on `main` as `a181f8a0` via PR `#123`. This plan should treat the shared fetch primitive as shipped, not hypothetical.
- **SKY-361** — Backlog. Blocker (`SKY-364`) is cleared. Related tickets called out in Linear: `SKY-343` (bundle resolution flow on EntitySearch) and `SKY-357` (extract cold-start registry to a dedicated repository).
- **SKY-362** — Backlog. Blocker (`SKY-364`) is cleared. Related tickets called out in Linear: `SKY-348` (future OEO binding consumer) and `SKY-222` (parallel OWL/RDF export track).
- **SKY-213** — Parent epic. Canonical design source is still the April 8 locked-decision document referenced on the Linear epic.

### Ticket drift to keep in mind

- The current `SKY-361` Linear description still mentions adding a `--out <path>` flag to ingest scripts. The authoritative spec narrowed that to the existing `COLD_START_ROOT` / `rootDir` path instead. Follow the spec, not the older ticket wording.
- The current `SKY-362` Linear description overstates CI de-coupling from `ontology_skill`. The authoritative spec is narrower: `sync-vocabulary` and `sync:energy-profile` still keep CI coupled to `ontology_skill` for now.

---

## Review snapshot (2026-04-15)

This plan is directionally sound, but it is **not** implementation-ready without a short correction pass first.

### Confirmed mismatches / stale assumptions

1. **P0 is stale as written.** The current local repo is already on `main` at `a181f8a0`; the dead local `sky-364/shared-git-snapshot-fetch-infrastructure` branch is already gone. The two SKY-361 PR-A files are present as untracked files in this worktree, but the branch-salvage steps no longer match reality.
2. **SKY-361 cutover is larger than "flip `COLD_START_ROOT` default".** The checked-in registry loader also hardcodes `references/cold-start` in `src/bootstrap/CheckedInDataLayerRegistry.ts`, and downstream tooling inherits from that constant (`src/data-layer/Sync.ts`, `scripts/sync-data-layer.ts`, `scripts/validate-data-layer-registry.ts`, `scripts/analysis/entity-search-audit/run-audit.ts`, and many tests). PR C must account for those call sites explicitly.
3. **Deleting `references/cold-start/` in PR C would currently break direct path consumers.** At minimum, `tests/data-layer-variable.test.ts` statically imports `../references/cold-start/variables/lignite-production.json`, and several tests pin `checkedInDataLayerRegistryRoot`. This is not just docstring drift; some test code will fail immediately if the tree disappears without replacement fixtures or test rewrites.
4. **The SKY-361 placeholder-test step can false-pass.** Right now `bun run test tests/fetch-git-snapshot.test.ts -t "short-circuits cleanly"` exits successfully with all tests skipped if the new test block has not been applied yet. The plan should require verifying that exactly one test matched, not just a zero-exit run.
5. **The SKY-362 package verification story is incomplete.** Current `tsconfig.json`, `tsconfig.test.json`, and `vitest.config.ts` only cover root `src/` and `tests/`. A new `packages/ontology-store/` package would not be typechecked or test-executed by the plan's current `bun run typecheck` / `bun run test` steps unless those configs are expanded.
6. **The ontology publish flow is not grounded in the current `ontology_skill` repo yet.** `ontologies/skygest-energy-vocab/scripts/build.py` currently builds vocabulary JSON, not a TTL artifact, `flatten-lookups.py` does not exist, `robot` is not installed on this machine, and the local `ontology_skill` checkout is already dirty on branch `kokokessy/sky-316-model-series-as-a-first-class-class-in-skygest-energy-vocab`.

### Open questions to settle before implementation

- For **SKY-361 PR C**, do we want to keep a small in-tree fixture slice under `references/cold-start/` for tests, or do we want to rewrite those tests to use generated/local temp fixtures instead?
- For **SKY-361 write paths**, is `COLD_START_ROOT` alone the intended operator interface, or do we still want an explicit CLI flag for scripts that humans run directly?
- For **SKY-362 snapshot publishing**, which file is the canonical publish source for the snapshot repo: `build/merged.ttl`, `build/reasoned-elk.ttl`, `build/reasoned-hermit.ttl`, or another artifact?
- For **SKY-362 value delivery**, is it acceptable that PR D lands a substrate-only loader with no in-repo consumer yet, or should one build-time script consume the new package in the same ticket so CI proves the package is real?

### Readiness call

- **SKY-361** — Medium-high readiness after a small plan correction pass. The fetch substrate is merged, the new external repo exists, and the local WIP wrapper/lock file are already present. The main remaining risk is underestimating how many places still assume `references/cold-start` is real.
- **SKY-362** — Medium-low readiness. The repository shape can support it, but the publish pipeline is still partly aspirational and the verification/config coverage for `packages/*` is not in place yet.

---

## Invariants you must preserve

These are from spec §7. Every task below is checked against them; if a task seems to violate one, stop and ask.

1. `.generated/` is never committed.
2. Pins are authoritative (commit SHA, not tag).
3. Fetch is idempotent via the `.git-snapshot-state.json` sentinel.
4. Manifest hash **and** tree hash verified every fetch.
5. Snapshots are immutable — never force-push a tag.
6. Manual trigger only — no cron, no bot.
7. One canonical loader path per consumer — flip `COLD_START_ROOT` default, never fork.
8. Worker bundle stays Node-free — no `node:*` imports reachable from `src/worker/`.
9. Runtime reads KV and D1, not snapshots.
10. `references/data-layer-spine/manifest.json` stays in-tree (drives codegen, not a snapshot).
11. One domain-model source of truth — extend `src/domain/data-layer/` schemas, never parallel decoders.
12. Placeholder-safe fetch — lock file with empty `commit` is a no-op so `bun install --frozen-lockfile` stays green.

---

## Prerequisites — clear current state

### Task P0: Salvage WIP, get clean on main — **COMPLETED 2026-04-15**

Already executed during the plan-correction session:

- Dead local `sky-364/shared-git-snapshot-fetch-infrastructure` branch deleted.
- Local `main` fast-forwarded to `a181f8a0` (SKY-364 PR #123).
- Test diff saved as `/tmp/sky-361-placeholder-test.patch` (41 lines) for replay during Task A4.
- The two WIP files (`ingest-artifacts.lock.json`, `scripts/fetch-ingest-artifacts.ts`) carry forward as untracked.
- The corrected plan doc itself also lives as untracked until it is committed to `main`.

Verify before continuing: `git status` should show `On branch main`, `Your branch is up to date`, and only untracked files. If anything else is present, stop and reconcile before touching the first task.

---

# PHASE 1 — SKY-361: ingest-artifacts store

Three PRs in `skygest-cloudflare` plus one import commit in the external `skygest-ingest-artifacts` repo.

## PR A — Dormant ingest-artifacts wrapper

Lands the fetch wrapper + placeholder lock file + placeholder test. **No consumer changes, no `postinstall` hook, no CI wiring.** `bun install --frozen-lockfile` stays green because the placeholder lock triggers the fetch script's no-op branch.

### Task A1: New branch from main

**Step 1:** Branch from `origin/main`.

```bash
git switch -c sky-361/ingest-artifacts-wrapper origin/main
```

### Task A2: Inspect the fetch wrapper file shape

Read the existing untracked file to confirm it follows the same conventions as the merged SKY-364 scripts.

**Step 1:** Read `scripts/fetch-ingest-artifacts.ts` to confirm shape.

Expected content (already present from WIP):

```ts
import { Effect, Path } from "effect";
import { fetchGitSnapshot } from "./fetch-git-snapshot";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export const fetchIngestArtifacts = Effect.fn("fetch-ingest-artifacts.run")(function* () {
  const path = yield* Path.Path;

  yield* fetchGitSnapshot({
    lockFile: path.resolve(process.cwd(), "ingest-artifacts.lock.json"),
    destDir: path.resolve(process.cwd(), ".generated/cold-start"),
    requiredManifestFile: "manifest.json"
  });
});

if (import.meta.main) {
  runScriptMain(
    "fetch-ingest-artifacts",
    fetchIngestArtifacts.pipe(Effect.provide(scriptPlatformLayer))
  );
}
```

**Step 2:** Cross-check against `scripts/fetch-git-snapshot.ts` on main for import parity — both must import from the same `ScriptRuntime` and use the same Effect conventions.

### Task A3: Inspect the placeholder lock file

**Step 1:** Read `ingest-artifacts.lock.json`.

Expected content:

```json
{
  "repo": "github.com/mepuka/skygest-ingest-artifacts",
  "ref": "",
  "commit": "",
  "manifestHash": ""
}
```

**Step 2:** Verify this matches the `LockFile` schema at `src/platform/LockFile.ts` with `snapshotPath` omitted (per §5.3, `snapshotPath` is `optionalKey`).

### Task A4: Write the failing placeholder short-circuit test

**Files:**
- Modify: `tests/fetch-git-snapshot.test.ts` (add a new `it` block at the top of the `describe("fetchGitSnapshot", ...)` block)

**Step 1:** Add the test block.

```ts
it("short-circuits cleanly when the lock file commit is a placeholder", async () => {
  const rootDir = await fsp.mkdtemp(
    nodePath.join(os.tmpdir(), "git-snapshot-fetch-placeholder-")
  );

  try {
    const lockPath = nodePath.join(rootDir, "placeholder.lock.json");
    const destDir = nodePath.join(rootDir, ".generated", "fixture");

    await writeJson(lockPath, {
      repo: "github.com/example/not-created-yet",
      ref: "",
      commit: "",
      manifestHash: ""
    });

    await Effect.runPromise(
      fetchGitSnapshot({
        lockFile: lockPath,
        destDir,
        requiredManifestFile: "manifest.json"
      }).pipe(Effect.provide(scriptPlatformLayer))
    );

    await expect(fsp.access(destDir)).rejects.toBeDefined();
  } finally {
    await fsp.rm(rootDir, { recursive: true, force: true });
  }
});
```

**Step 2:** Run the full `tests/fetch-git-snapshot.test.ts` file with the verbose reporter and confirm the new case is present **and** passing. Do **not** use `-t "pattern"` alone — vitest exits 0 when no tests match, which turns a silent skip into a fake green.

```bash
bun run test tests/fetch-git-snapshot.test.ts --reporter=verbose 2>&1 | tee /tmp/sky-361-a4-run.log
grep -c "short-circuits cleanly when the lock file commit is a placeholder" /tmp/sky-361-a4-run.log
grep -E "(PASS|FAIL).*short-circuits cleanly" /tmp/sky-361-a4-run.log || true
```

Expected:
- The `grep -c` count is **at least 1** (one matching test label in the verbose output).
- The status line reads `PASS` or `✓`. If anything in the verbose output says `FAIL` or `skipped`, stop — the short-circuit branch in `fetch-git-snapshot.ts` is missing or regressed, or the test block was not applied to the right file, and that needs investigation before any further work.

### Task A5: Run full typecheck + test suite

**Step 1:** Full typecheck.

```bash
bun run typecheck
```

Expected: no errors.

**Step 2:** Full test suite.

```bash
bun run test
```

Expected: all green. No new failures compared to main.

### Task A6: Commit PR A

**Step 1:** Stage the three files.

```bash
git add scripts/fetch-ingest-artifacts.ts ingest-artifacts.lock.json tests/fetch-git-snapshot.test.ts
git status
```

Expected: three files staged, nothing else.

**Step 2:** Commit.

```bash
git commit -m "$(cat <<'EOF'
SKY-361: add dormant fetch-ingest-artifacts wrapper + placeholder lock

Thin Effect wrapper around fetchGitSnapshot that reads
ingest-artifacts.lock.json and writes into .generated/cold-start/. Lock
file ships with an empty commit placeholder so the fetcher short-circuits
per spec imperative #12 — keeps bun install --frozen-lockfile green.

Adds a regression test covering the placeholder-commit no-op branch.

No consumer changes: COLD_START_ROOT still defaults to references/cold-start.
No postinstall hook. No CI wiring. The wrapper is dormant until PR C of
SKY-361 flips the default and bumps the lock file at the import tag.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task A7: Push and open PR

**Step 1:** Push the branch.

```bash
git push -u origin sky-361/ingest-artifacts-wrapper
```

**Step 2:** Open PR with `gh pr create`.

```bash
gh pr create --base main --title "SKY-361: dormant fetch-ingest-artifacts wrapper + placeholder lock" --body "$(cat <<'EOF'
## Summary
- Adds `scripts/fetch-ingest-artifacts.ts` — thin Effect wrapper around `fetchGitSnapshot` from SKY-364, targeting `ingest-artifacts.lock.json` → `.generated/cold-start/`.
- Adds `ingest-artifacts.lock.json` with an empty-commit placeholder. Fetcher short-circuits per spec imperative #12 so `bun install --frozen-lockfile` stays green.
- Adds a regression test covering the placeholder-commit no-op branch in `fetchGitSnapshot`.

## Scope
Dormant wiring only. No consumer changes:
- `COLD_START_ROOT` still defaults to `references/cold-start`.
- No `postinstall` hook.
- No CI invocation.

Reviewable in isolation. PR C of SKY-361 flips the default after the import commit in the external `skygest-ingest-artifacts` repo lands.

## Test plan
- [x] `bun run typecheck`
- [x] `bun run test` (new test covers placeholder short-circuit)
- [ ] Reviewer confirms `bun install --frozen-lockfile` still works locally

## Related
- Parent: SKY-213
- Spec: `docs/plans/2026-04-15-git-backed-snapshots-spec.md` §4.1, §9.2
- Previous: #123 (SKY-364)
- Next: PR B (external repo import commit), then PR C (cutover)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3:** Record the PR URL for later reference.

**Step 4 (human gate):** Wait for merge before moving to PR B. **Do not** advance while PR A is still open.

---

## PR B — Import cold-start tree into skygest-ingest-artifacts

Happens in `/Users/pooks/Dev/skygest-ingest-artifacts`, **not** in `skygest-cloudflare`. Single import commit copying the full `references/cold-start/` tree into the strict entity-kind layout from spec §4.1.

### Task B1: Inspect the source tree

**Step 1:** List top-level cold-start directories.

```bash
ls /Users/pooks/Dev/skygest-cloudflare/references/cold-start/
```

**Step 2:** For each directory, count files and confirm it's in one of these categories:

- Entity-kind directory (matches `dataLayerEntityKindSpec.directory`): `catalog/agents`, `catalog/catalogs`, `catalog/catalog-records`, `catalog/datasets`, `catalog/distributions`, `catalog/data-services`, `catalog/dataset-series`, `variables`, `series`
- Non-kind content listed in §4.1: `candidates`, `survey`, `reports`
- Anything else: stop, this is unexpected, ask before proceeding.

```bash
for dir in catalog variables series candidates survey reports; do
  if [ -d "/Users/pooks/Dev/skygest-cloudflare/references/cold-start/$dir" ]; then
    count=$(find "/Users/pooks/Dev/skygest-cloudflare/references/cold-start/$dir" -type f | wc -l)
    echo "$dir: $count files"
  fi
done
```

**Step 3:** Record the counts. They become the `counts` field in the manifest.

### Task B2: Prepare target repo with a fresh branch

**Step 1:** Switch the target repo to a clean state on `main`.

```bash
cd /Users/pooks/Dev/skygest-ingest-artifacts
git status   # expect clean, already pushed
git checkout main
git pull --ff-only origin main
```

**Step 2:** Create the import branch.

```bash
git checkout -b import/2026-04-15-cold-start
```

### Task B3: Copy the tree verbatim

**Step 1:** Copy per §4.1 layout. The layout matches what's already on disk — it's a verbatim copy, not a restructure.

```bash
cd /Users/pooks/Dev/skygest-ingest-artifacts
cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/catalog ./catalog
cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/variables ./variables
cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/series ./series
[ -d /Users/pooks/Dev/skygest-cloudflare/references/cold-start/candidates ] && cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/candidates ./candidates
[ -d /Users/pooks/Dev/skygest-cloudflare/references/cold-start/survey ] && cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/survey ./survey
[ -d /Users/pooks/Dev/skygest-cloudflare/references/cold-start/reports ] && cp -R /Users/pooks/Dev/skygest-cloudflare/references/cold-start/reports ./reports
```

**Step 2:** Verify counts match the source.

```bash
for dir in catalog variables series candidates survey reports; do
  if [ -d "./$dir" ]; then
    dst=$(find "./$dir" -type f | wc -l)
    src=$(find "/Users/pooks/Dev/skygest-cloudflare/references/cold-start/$dir" -type f 2>/dev/null | wc -l)
    echo "$dir: src=$src dst=$dst"
  fi
done
```

Expected: each pair matches exactly. If not, stop and investigate.

### Task B4: Write the tree-hash + counts computation script

The manifest's `treeHash` must be computed by the **same** `computeDirectoryTreeHash` function used by the fetcher at verify time, otherwise the fetch fails with a mismatch. We run it via a one-off Bun script *inside skygest-cloudflare* (since that's where the Effect helper lives), pointing at the ingest-artifacts repo's working tree.

**Files:**
- Create: `/Users/pooks/Dev/skygest-cloudflare/scripts/compute-ingest-artifacts-manifest.ts` (one-off)

This script is throwaway infrastructure for the import — not committed to `skygest-cloudflare`. It exists only to emit a valid `manifest.json` at publish time. **Do not commit it.**

**Step 1:** Write the script.

```ts
// scripts/compute-ingest-artifacts-manifest.ts
// DO NOT COMMIT — one-off import helper for SKY-361 PR B.
import { Effect, FileSystem, Path } from "effect";
import { DateTime } from "effect";
import {
  computeDirectoryTreeHash,
  sha256HexString
} from "../src/platform/GitSnapshot";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

const entityKindDirectories = [
  "catalog/agents",
  "catalog/catalogs",
  "catalog/catalog-records",
  "catalog/datasets",
  "catalog/distributions",
  "catalog/data-services",
  "catalog/dataset-series",
  "variables",
  "series",
  "candidates",
  "survey",
  "reports"
] as const;

const listAllFiles = (
  rootDir: string,
  currentDir: string
): Effect.Effect<ReadonlyArray<string>, unknown, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const exists = yield* fs.exists(currentDir).pipe(Effect.orElseSucceed(() => false));
    if (!exists) return [] as ReadonlyArray<string>;
    const entries = yield* fs.readDirectory(currentDir);
    const result: Array<string> = [];
    for (const entry of entries) {
      if (entry === ".git") continue;
      const full = path.join(currentDir, entry);
      const info = yield* fs.stat(full);
      if (info.type === "Directory") {
        result.push(...(yield* listAllFiles(rootDir, full)));
      } else if (info.type === "File") {
        result.push(full);
      }
    }
    return result;
  });

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rootDir = process.argv[2];
  if (!rootDir) {
    throw new Error("usage: compute-ingest-artifacts-manifest.ts <rootDir>");
  }

  const counts: Record<string, number> = {};
  for (const dir of entityKindDirectories) {
    const full = path.join(rootDir, dir);
    const files = yield* listAllFiles(rootDir, full);
    counts[dir] = files.length;
  }

  const manifestPathForExclude = "manifest.json";
  const treeHash = yield* computeDirectoryTreeHash(rootDir, {
    exclude: [manifestPathForExclude]
  });

  // Derive sourceCommit from the parent (skygest-cloudflare) commit used
  // as the import source. We capture the SKY-364-landed commit here.
  const sourceCommit = process.env.IMPORT_SOURCE_COMMIT ?? "UNKNOWN";

  const manifest = {
    manifestVersion: 1,
    kind: "ingest-artifacts" as const,
    generatedAt: DateTime.formatIso(DateTime.fromDateUnsafe(new Date())),
    sourceCommit,
    inputHash: treeHash,
    treeHash,
    counts
  };

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(rootDir, "manifest.json");
  yield* fs.writeFileString(manifestPath, manifestText);
  console.log(`wrote ${manifestPath}`);
  console.log(`treeHash=${treeHash}`);

  const manifestHash = yield* sha256HexString(manifestText, "compute-manifest-hash");
  console.log(`manifestHash=${manifestHash}`);
});

runScriptMain(
  "compute-ingest-artifacts-manifest",
  program.pipe(Effect.provide(scriptPlatformLayer))
);
```

**Step 2:** Record the current main commit SHA for provenance in the manifest.

```bash
cd /Users/pooks/Dev/skygest-cloudflare
git rev-parse origin/main   # record this value
```

**Step 3:** Run the helper against the ingest-artifacts working tree.

```bash
cd /Users/pooks/Dev/skygest-cloudflare
IMPORT_SOURCE_COMMIT=$(git rev-parse origin/main) \
  bun run scripts/compute-ingest-artifacts-manifest.ts /Users/pooks/Dev/skygest-ingest-artifacts
```

Expected output:

```
wrote /Users/pooks/Dev/skygest-ingest-artifacts/manifest.json
treeHash=<64-char-hex>
manifestHash=<64-char-hex>
```

**Step 4:** Record `treeHash` and `manifestHash` — they become the authoritative integrity values for PR C.

**Step 5:** Delete the one-off helper — **do not commit it**.

```bash
rm scripts/compute-ingest-artifacts-manifest.ts
```

### Task B5: Verify the manifest with a dry-run fetch

**Files:** Temporary — `/tmp/verify-import.lock.json`.

**Step 1:** Write a throwaway lock file targeting the local ingest-artifacts working copy via the file-URL remote path.

Actually — before this we need to commit to the import branch so `git archive` / `git fetch` can pull it. The fetcher operates on git commits, not working directories. So: commit in the ingest-artifacts repo first, then verify against that commit.

Skip this verification step. The manifest hash will be re-verified end-to-end by PR C's fetch-script run against the real pinned commit. A dry run here over a not-yet-committed tree adds no guarantee.

### Task B6: Commit the import in the ingest-artifacts repo

**Step 1:** Stage and commit everything as a single import commit.

```bash
cd /Users/pooks/Dev/skygest-ingest-artifacts
git add catalog variables series candidates survey reports manifest.json 2>/dev/null || true
git add -A   # catches anything git-add-by-name missed
git status --short | head -20
```

Expected: several thousand added files, one manifest.json. Nothing modified (README/CLAUDE.md/AGENTS.md are untouched).

**Step 2:** Commit with a full provenance body.

```bash
git commit -m "$(cat <<'EOF'
SKY-361: initial import of references/cold-start/ from skygest-cloudflare

Verbatim copy of references/cold-start/ at skygest-cloudflare@<SOURCE-SHA>
(SKY-364 landed as PR #123). Flat-by-entity-kind layout per spec §4.1,
matching src/domain/data-layer/kinds.ts.

manifest.json records file counts per entity-kind directory plus a
tree-hash computed with the same primitive the fetcher verifies against
at pull time (scripts/fetch-git-snapshot.ts via
src/platform/GitSnapshot.ts#computeDirectoryTreeHash).

No history rewrite, no filter-repo — single import commit per spec
§9.2 PR B.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Step 3:** Tag the import.

```bash
git tag -a v2026.04.15-import -m "SKY-361 initial import from skygest-cloudflare"
git log --oneline -3
git tag -l
```

**Step 4:** Push branch and tag.

```bash
git push -u origin import/2026-04-15-cold-start
git push origin v2026.04.15-import
```

**Step 5:** Open a PR on the ingest-artifacts repo targeting `main`.

```bash
cd /Users/pooks/Dev/skygest-ingest-artifacts
gh pr create --base main --title "SKY-361: initial import of references/cold-start/" --body "$(cat <<'EOF'
## Summary
Verbatim import of the `references/cold-start/` tree from `skygest-cloudflare` into the spec §4.1 flat-by-entity-kind layout. No content changes — pure move.

## Counts
See `manifest.json` `counts` field.

## Integrity
- `treeHash` is computed with the same `computeDirectoryTreeHash` primitive the fetcher verifies against at pull time.
- `manifestHash` (sha256 of manifest.json text) is pinned in `skygest-cloudflare/ingest-artifacts.lock.json` in PR C.

## Next
- [ ] Human review + merge.
- [ ] Tag already pushed: `v2026.04.15-import`.
- [ ] PR C in `skygest-cloudflare` flips `COLD_START_ROOT` default and bumps the lock.

## Related
- Parent: SKY-213
- Spec: `docs/plans/2026-04-15-git-backed-snapshots-spec.md` §4.1, §9.2
EOF
)"
```

**Step 6 (human gate):** Wait for merge. Once merged, capture the merge commit SHA with:

```bash
git -C /Users/pooks/Dev/skygest-ingest-artifacts fetch --tags
git -C /Users/pooks/Dev/skygest-ingest-artifacts rev-parse v2026.04.15-import
```

Record this SHA — it becomes the `commit` field in the lock file for PR C.

---

## PR C — Cutover in skygest-cloudflare

Flip `COLD_START_ROOT` default, bump the lock file, wire `postinstall` + CI fetch, audit hardcoded literals, delete `references/cold-start/`. This is the **high-blast-radius PR** — the first time CI and local dev actually pull from the remote.

### Task C1: Branch from main

```bash
cd /Users/pooks/Dev/skygest-cloudflare
git checkout main
git pull --ff-only origin main
git switch -c sky-361/cold-start-cutover
```

### Task C2: Decide the auth story for CI

**Context:** The ingest-artifacts repo is private. Local dev works because the developer's SSH key is authorized on their GitHub account. CI needs its own path in.

**Decision:** SSH deploy key. One keypair reused across both snapshot repos (SKY-361 + SKY-362). Simplest option; doesn't require a GitHub App or a PAT with cross-repo scope.

**Step 1:** Generate the keypair locally.

```bash
ssh-keygen -t ed25519 -f /tmp/skygest-snapshot-deploy -N "" -C "skygest-snapshot-deploy@ci"
cat /tmp/skygest-snapshot-deploy.pub
cat /tmp/skygest-snapshot-deploy
```

**Step 2:** Add the **public** key as a deploy key on both snapshot repos.

```bash
gh repo deploy-key add /tmp/skygest-snapshot-deploy.pub --repo mepuka/skygest-ingest-artifacts --title "skygest-cloudflare CI (SKY-361)"
gh repo deploy-key add /tmp/skygest-snapshot-deploy.pub --repo mepuka/skygest-ontology-snapshots --title "skygest-cloudflare CI (SKY-362)"
```

**Step 3:** Add the **private** key as a secret on skygest-cloudflare.

```bash
gh secret set SNAPSHOT_DEPLOY_KEY --repo mepuka/skygest < /tmp/skygest-snapshot-deploy
```

**Step 4:** Shred the local copy.

```bash
rm /tmp/skygest-snapshot-deploy /tmp/skygest-snapshot-deploy.pub
```

### Task C3: Update the lock file to point at the import commit

**Files:**
- Modify: `ingest-artifacts.lock.json`

**Step 1:** Replace the placeholder values with the real import commit + the manifest hash recorded in Task B4.

```json
{
  "repo": "git@github.com:mepuka/skygest-ingest-artifacts.git",
  "ref": "v2026.04.15-import",
  "commit": "<40-char SHA from Task B6 Step 6>",
  "manifestHash": "<64-char sha256 from Task B4 Step 4>"
}
```

Note the `repo` format shifts from the `github.com/...` shorthand to the full SSH URL — this matches the `normalizeRepo` helper's SSH path in `scripts/fetch-git-snapshot.ts` and ensures SSH auth is used consistently in both local dev and CI (where the deploy key is loaded into ssh-agent).

**Step 2:** Run the fetch script locally to prove the pin works.

```bash
rm -rf .generated/cold-start
bun run scripts/fetch-ingest-artifacts.ts
ls .generated/cold-start | head
cat .generated/cold-start/manifest.json | head -20
cat .generated/cold-start/.git-snapshot-state.json
```

Expected:
- `.generated/cold-start/` populated with `catalog/`, `variables/`, `series/`, `candidates/`, `survey/`, `reports/`, `manifest.json`.
- The sentinel file `.git-snapshot-state.json` shows the pinned commit + manifest hash.
- No errors in stdout.

**Step 3:** Prove idempotency.

```bash
bun run scripts/fetch-ingest-artifacts.ts
```

Expected: a no-op, fast exit. No destructive ops, no refetch, same sentinel.

**Step 4:** Confirm the tree hash matches by running it again with the sentinel removed.

```bash
rm .generated/cold-start/.git-snapshot-state.json
bun run scripts/fetch-ingest-artifacts.ts
```

Expected: the fetcher re-verifies both manifest hash and tree hash against what it finds on disk. No errors. If either hash doesn't match, **stop** — the import manifest was built with a different hash primitive than the one the fetcher uses, and PR B needs a redo.

### Task C4: Flip the `COLD_START_ROOT` config default

**Files:**
- Modify: `src/platform/ConfigShapes.ts:107`

**Step 1:** Change the default.

```ts
export const ColdStartCommonKeys = {
  rootDir: Config.withDefault(
    Config.string("COLD_START_ROOT"),
    ".generated/cold-start"
  ),
  // ...
} as const;
```

**Step 2:** Typecheck (expect clean — no consumers pin the literal value through `ConfigShapes`; they all read via `Config.load`).

```bash
bun run typecheck
```

### Task C5: Flip the checked-in registry root constant

This is the second hardcode site that the plan previously missed. The constant is imported by the bootstrap loader and several scripts / tests that want a stable "where the checked-in catalog lives" identifier.

**Files:**
- Modify: `src/bootstrap/CheckedInDataLayerRegistry.ts:21`

**Step 1:** Flip the literal.

```ts
export const checkedInDataLayerRegistryRoot = ".generated/cold-start";
```

**Step 2:** Typecheck again to pick up anything that depends on this constant.

```bash
bun run typecheck
```

Expected: clean. If any file still complains, capture it — it will show up in Task C6 as well.

### Task C6: Audit every hardcoded `references/cold-start` literal

Per spec §4.1, the minimal-diff path is to flip the config default — but that only works if every consumer reads through the config or through the constant from Task C5. Anything still reaching `"references/cold-start"` directly must be updated in this PR.

**Step 1:** Grep for live references across the whole tree except the about-to-be-deleted directory itself.

```bash
grep -rn "references/cold-start" \
  --include="*.ts" \
  --include="*.tsx" \
  --include="*.json" \
  --include="*.yml" \
  --include="*.md" \
  --exclude-dir="references/cold-start" \
  --exclude-dir="node_modules" \
  --exclude-dir=".generated" \
  --exclude-dir=".git" \
  .
```

**Step 2:** Classify every hit. Expected categories, based on prior reconnaissance:

1. **The two sites already flipped** (`ConfigShapes.ts`, `CheckedInDataLayerRegistry.ts`) — should not appear if Tasks C4 and C5 are done.
2. **Runtime / script consumers** (`src/data-layer/Sync.ts`, `scripts/sync-data-layer.ts`, `scripts/validate-data-layer-registry.ts`, `scripts/analysis/entity-search-audit/run-audit.ts`, any other script that grep surfaces) — these should already read from `ColdStartCommonKeys.rootDir` or from `checkedInDataLayerRegistryRoot`. If they pin the literal string instead, rewrite them to read from the config or the constant, not to replace the literal with `.generated/cold-start`. The goal is one canonical source per imperative #7.
3. **Test files with static `import` from the old path** — handled in Task C7, not here. Record them but do not edit yet.
4. **Comments / docstrings / design docs in `docs/`** — update prose as a small pass. Keep the commit focused on functional changes.
5. **CI workflow `ci.yml`** — the `deploy-staging` job currently runs `scripts/sync-data-layer.ts` against the cold-start tree via the script's own default. If that script now reads from config, no workflow edit is needed here. Confirm during Task C10.

**Step 3:** After edits, re-run the grep. Expected: zero hits in categories 1 and 2. Hits in category 3 are captured for Task C7; hits in category 4 may remain if the prose pass is deferred.

```bash
grep -rn "references/cold-start" \
  --include="*.ts" \
  --exclude-dir="references/cold-start" \
  --exclude-dir="node_modules" \
  --exclude-dir=".generated" \
  --exclude-dir=".git" \
  src/ scripts/
```

### Task C7: Migrate test static imports to hermetic fixtures

`tests/data-layer-variable.test.ts:3` does `import ligniteProductionJson from "../references/cold-start/variables/lignite-production.json"`. This is a compile-time TypeScript dependency — the file must exist on disk at typecheck time, so deleting `references/cold-start/` without migration breaks both `tsc` and `vitest`.

**Context:** Tests should not reach into the runtime catalog for fixtures. Test fixtures have different lifetimes than catalog content; mixing them means a cold-start refresh can silently break test assertions. The right move is to move the imported JSON under `tests/fixtures/` where the test owns it.

**Files:**
- Find: every `tests/**/*.ts` that statically imports `references/cold-start/**`
- Create: `tests/fixtures/data-layer/<matching-slug>.json` (one copy per imported file)
- Modify: the test files to point at the new fixture path

**Step 1:** Find every static import of the cold-start tree in `tests/`.

```bash
grep -rn "references/cold-start" --include="*.ts" tests/
```

**Step 2:** For each hit, copy the referenced JSON file into `tests/fixtures/data-layer/` (create the directory if needed) and update the import path in the test file.

Example for `tests/data-layer-variable.test.ts`:

```bash
mkdir -p tests/fixtures/data-layer
cp references/cold-start/variables/lignite-production.json \
   tests/fixtures/data-layer/lignite-production.json
```

Then edit `tests/data-layer-variable.test.ts` line 3:

```ts
import ligniteProductionJson from "./fixtures/data-layer/lignite-production.json";
```

**Step 3:** After all migrations, re-grep to confirm no test file still points at the old tree.

```bash
grep -rn "references/cold-start" --include="*.ts" tests/
```

Expected: zero hits.

**Step 4:** Run the full test suite with the new fixture paths.

```bash
bun run typecheck
bun run test
```

Expected: both green. If any test fails because the fetch hasn't happened yet and the test reads from `.generated/cold-start/`, run `bun run scripts/fetch-ingest-artifacts.ts` first and retry. **Do not** weaken the test to work around a missing fetch.

### Task C8: Wire `postinstall` hook in `package.json`

**Files:**
- Modify: `package.json`

**Step 1:** Add the hook.

```json
"scripts": {
  ...
  "postinstall": "bun run scripts/fetch-ingest-artifacts.ts",
  ...
}
```

**Step 2:** Confirm the hook runs cleanly via a synthetic install.

```bash
rm -rf node_modules
bun install --frozen-lockfile
ls .generated/cold-start | head
```

Expected: install completes successfully, `.generated/cold-start/` is populated, no errors.

### Task C9: Wire the fetch into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1:** Add a new step to the `typecheck`, `test`, and `deploy-staging` jobs that loads the deploy key into `ssh-agent` before `bun install --frozen-lockfile` runs. The install will then trigger the `postinstall` hook with the right SSH credentials.

Add this step in each job **before** the `bun install --frozen-lockfile` step:

```yaml
- name: Load snapshot deploy key
  uses: webfactory/ssh-agent@v0.9.0
  with:
    ssh-private-key: ${{ secrets.SNAPSHOT_DEPLOY_KEY }}
```

**Step 2:** Validate the workflow syntax locally with `gh workflow view` after push, or by running `actionlint` if installed.

### Task C10: Delete `references/cold-start/`

**Files:**
- Delete: `references/cold-start/` (the whole tree, ~7,700 files)

**Precondition:** Tasks C4–C7 must be complete. Specifically:
- Both hardcode sites (`ConfigShapes.ts`, `CheckedInDataLayerRegistry.ts`) have been flipped.
- `grep -rn "references/cold-start" src/ scripts/ tests/` returns zero hits (except possibly in docs/ prose).
- `bun run test` is green against `.generated/cold-start/` only.

**Step 1:** Final sanity grep.

```bash
grep -rn "references/cold-start" --include="*.ts" src/ scripts/ tests/
```

Expected: zero output. If anything remains, go back to Task C6 or C7 — do not proceed with the delete.

**Step 2:** Delete.

```bash
git rm -r references/cold-start
git status --short | wc -l
```

Expected: thousands of deletions staged. Nothing else touched.

**Step 3:** Full typecheck + test suite.

```bash
bun run typecheck
bun run test
```

Expected: both green. The `.generated/cold-start/` tree is serving every consumer that used to read `references/cold-start/`.

### Task C11: Commit PR C

**Step 1:** Stage everything.

```bash
git add \
  ingest-artifacts.lock.json \
  src/platform/ConfigShapes.ts \
  src/bootstrap/CheckedInDataLayerRegistry.ts \
  package.json \
  .github/workflows/ci.yml \
  tests/fixtures/data-layer \
  tests/data-layer-variable.test.ts
# Plus any additional audit fixes from Task C6 or fixture migrations from Task C7
# Plus the staged deletion of references/cold-start/ from Task C10
git status | head -20
```

Expected: a few small edits at the top of `git status`, then thousands of `deleted: references/cold-start/...` entries.

**Step 2:** Commit.

```bash
git commit -m "$(cat <<'EOF'
SKY-361: cutover to .generated/cold-start via git-pinned fetch

- Flip COLD_START_ROOT default from references/cold-start to
  .generated/cold-start in src/platform/ConfigShapes.ts. Every consumer
  that reads ColdStartCommonKeys.rootDir inherits the new path.
- Flip checkedInDataLayerRegistryRoot in
  src/bootstrap/CheckedInDataLayerRegistry.ts to match, so the bootstrap
  loader and every script / test that imports that constant all point at
  the fetched tree.
- Audit fixes for the remaining hardcoded references/cold-start literals
  in src/ and scripts/; each updated to read from
  ColdStartCommonKeys.rootDir or checkedInDataLayerRegistryRoot per spec
  imperative #7 (one canonical loader path per consumer).
- Migrate tests that statically imported references/cold-start/** JSON
  into tests/fixtures/data-layer/ so they own their own fixtures and
  don't re-couple to the runtime catalog.
- Bump ingest-artifacts.lock.json to the v2026.04.15-import tag from the
  skygest-ingest-artifacts repo, with the matching manifest hash so the
  fetcher verifies both manifest and tree hashes post-fetch.
- Add postinstall hook running scripts/fetch-ingest-artifacts.ts. bun
  install --frozen-lockfile populates .generated/cold-start/ automatically
  for local dev and CI.
- Wire the webfactory/ssh-agent action into CI typecheck, test, and
  deploy-staging jobs so the deploy key is available before
  bun install --frozen-lockfile triggers the fetch.
- Delete references/cold-start/ (roughly 7,700 JSON files). The snapshot
  chain owns the data now; the worker repo contains code only.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task C12: Push, open PR, monitor CI

**Step 1:** Push.

```bash
git push -u origin sky-361/cold-start-cutover
```

**Step 2:** Open PR.

```bash
gh pr create --base main --title "SKY-361: cutover to .generated/cold-start via git-pinned fetch" --body "$(cat <<'EOF'
## Summary
- Flip `COLD_START_ROOT` default to `.generated/cold-start`.
- Bump `ingest-artifacts.lock.json` to the real `v2026.04.15-import` commit.
- Add `postinstall` fetch so `bun install` populates the tree locally and in CI.
- Wire `webfactory/ssh-agent` into CI jobs so the snapshot deploy key is available.
- Delete `references/cold-start/` (~7,700 files).

## Blast radius
Every cold-start consumer now reads from the fetched tree. CI must prove all consumers still load cleanly. Rollback is a revert of this PR — the previous commit still points at `references/cold-start/`.

## Test plan
- [x] Local `bun install --frozen-lockfile` populates `.generated/cold-start/`.
- [x] Local `bun run test` green.
- [x] Local `bun run typecheck` green.
- [ ] CI green across typecheck + test + deploy-staging.
- [ ] Reviewer confirms registry loaders still see every entity.

## Related
- Parent: SKY-213
- Spec: `docs/plans/2026-04-15-git-backed-snapshots-spec.md` §4.1, §9.2
- Import: https://github.com/mepuka/skygest-ingest-artifacts/tree/v2026.04.15-import
- Prerequisite PRs: #123 (SKY-364), PR A (dormant wrapper)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3:** Watch CI. If any job fails, debug and push fixes.

**Step 4 (human gate):** Wait for merge. Once merged, SKY-361 is done. Move SKY-361 ticket to `Done` on Linear with a link to the PR.

---

# PHASE 2 — SKY-362: ontology snapshots + monorepo

> **⚠ DEFERRED — pending ontology investigation (2026-04-15)**
>
> The remainder of Phase 2 below is kept as a reference but is **not** ready to execute as written. The 2026-04-15 review surfaced five blockers that need resolution before any SKY-362 PR lands:
>
> 1. **`packages/*` is invisible to the current verification harness.** `tsconfig.json`, `tsconfig.test.json`, and `vitest.config.ts` only include `src/**` and `tests/**`. PR A must explicitly extend all three to pick up `packages/*/src/**/*.ts` and `packages/*/tests/**/*.test.ts`, or a new package ships typechecked-and-tested only by accident.
> 2. **Canonical publish source TTL is unknown.** `ontology_skill/ontologies/skygest-energy-vocab/scripts/build.py` produces vocabulary JSON, not a TTL artifact. The spec assumes a built TTL (possibly `build/merged.ttl`, `build/reasoned-elk.ttl`, or `build/reasoned-hermit.ttl`) — we need to actually run the ontology build, inspect `build/`, and decide which artifact is the authoritative snapshot source.
> 3. **ROBOT is not installed locally.** `publish-snapshot.sh` as drafted calls ROBOT to convert TTL → N-Triples. Either install ROBOT, replace with an rdflib-based Python converter, or drop N-Triples from the snapshot entirely.
> 4. **`flatten-lookups.py` does not exist yet.** The draft script is speculative. We need to either write it against reality (`build.py`'s actual output structure) or replace it with a different flattening approach.
> 5. **`ontology_skill` is on a dirty feature branch.** The local checkout is currently on `kokokessy/sky-316-model-series-as-a-first-class-class-in-skygest-energy-vocab`, not `main`. Publish-snapshot work must not happen on that branch.
>
> Execution policy: do **not** start any Task D / E / F / G until a follow-up investigation pass answers the five blockers above. At that point, rewrite this section against reality and reopen.
>
> Park SKY-362 on Linear in Backlog with a comment pointing at this DEFERRED block.

## PR A — Dormant ontology wrapper + minimal monorepo stub

Lands the ontology fetch wrapper + empty `packages/ontology-store/` + workspace hook. Placeholder lock file. **No consumer changes.**

### Task D1: Branch from main

```bash
cd /Users/pooks/Dev/skygest-cloudflare
git checkout main
git pull --ff-only origin main
git switch -c sky-362/ontology-wrapper-and-monorepo-stub
```

### Task D2: Create the fetch wrapper

**Files:**
- Create: `scripts/fetch-ontology-snapshot.ts`

**Step 1:** Mirror `scripts/fetch-ingest-artifacts.ts` with the ontology lock + destination.

```ts
import { Effect, Path } from "effect";
import { fetchGitSnapshot } from "./fetch-git-snapshot";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export const fetchOntologySnapshot = Effect.fn("fetch-ontology-snapshot.run")(function* () {
  const path = yield* Path.Path;

  yield* fetchGitSnapshot({
    lockFile: path.resolve(process.cwd(), "ontology-snapshot.lock.json"),
    destDir: path.resolve(process.cwd(), ".generated/ontology"),
    requiredManifestFile: "manifest.json"
  });
});

if (import.meta.main) {
  runScriptMain(
    "fetch-ontology-snapshot",
    fetchOntologySnapshot.pipe(Effect.provide(scriptPlatformLayer))
  );
}
```

### Task D3: Create the placeholder lock file

**Files:**
- Create: `ontology-snapshot.lock.json`

**Step 1:** Write the placeholder.

```json
{
  "repo": "git@github.com:mepuka/skygest-ontology-snapshots.git",
  "ref": "",
  "commit": "",
  "manifestHash": "",
  "snapshotPath": ""
}
```

Note the `snapshotPath` field is non-empty in production (`"snapshots/0.3.0"`) but can be empty here during the placeholder phase. If the `LockFile` schema rejects an empty `snapshotPath`, omit the key entirely.

**Step 2:** Verify the fetch wrapper short-circuits cleanly.

```bash
bun run scripts/fetch-ontology-snapshot.ts
ls .generated/ontology 2>&1 || echo "no directory (expected)"
```

Expected: fetch exits cleanly, `.generated/ontology/` is not created.

### Task D4: Add workspace hook to package.json

**Files:**
- Modify: `package.json`

**Step 1:** Add the `workspaces` field at the top level.

```json
{
  "name": "skygest-cloudflare",
  "module": "index.ts",
  "type": "module",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": { ... }
}
```

**Step 2:** Verify `bun install --frozen-lockfile` still works.

```bash
bun install --frozen-lockfile
```

Expected: clean install, no errors. `bun.lock` will update to include workspace resolution — include that update in the commit.

### Task D5: Create the minimal ontology-store package stub

**Files:**
- Create: `packages/ontology-store/package.json`
- Create: `packages/ontology-store/tsconfig.json`
- Create: `packages/ontology-store/src/index.ts`
- Create: `packages/ontology-store/README.md`

**Step 1:** `packages/ontology-store/package.json`.

```json
{
  "name": "@skygest/ontology-store",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "peerDependencies": {
    "effect": "4.0.0-beta.43"
  }
}
```

**Step 2:** `packages/ontology-store/tsconfig.json`.

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"]
}
```

**Step 3:** `packages/ontology-store/src/index.ts`.

```ts
// Placeholder. Real loader lands in SKY-362 PR D.
export const ontologyStorePackageMarker = "skygest-ontology-store@stub" as const;
```

**Step 4:** `packages/ontology-store/README.md`.

```md
# @skygest/ontology-store

Build-time loader for the Skygest ontology snapshot (`snapshots/<version>/classes.json` + `properties.json`).

Stub only in PR A of SKY-362. Real loader lands in PR D.

Not imported by the Worker runtime. Consumers are Bun build scripts
that seed KV with flattened ontology content.

## Authoritative spec

See `skygest-cloudflare/docs/plans/2026-04-15-git-backed-snapshots-spec.md` §4.2.
```

**Step 5:** Run typecheck to prove the workspace is wired.

```bash
bun run typecheck
```

Expected: no errors.

### Task D6: Run the full test suite

```bash
bun run test
```

Expected: all green.

### Task D7: Commit PR A of SKY-362

**Step 1:** Stage.

```bash
git add scripts/fetch-ontology-snapshot.ts ontology-snapshot.lock.json package.json bun.lock packages/ontology-store
git status
```

**Step 2:** Commit.

```bash
git commit -m "$(cat <<'EOF'
SKY-362: dormant ontology fetch wrapper + minimal monorepo stub

- Add scripts/fetch-ontology-snapshot.ts — thin Effect wrapper around
  fetchGitSnapshot from SKY-364.
- Add ontology-snapshot.lock.json with an empty-commit placeholder per
  spec imperative #12.
- Add "workspaces": ["packages/*"] to package.json.
- Create packages/ontology-store/ as the first sibling package. Stub
  only — real loader lands in PR D after the first snapshot is published
  in skygest-ontology-snapshots.

No consumer changes. build:ontology-snapshot + seed:ontology-kv remain
on the legacy energy-news path per spec §4.4, §9.3 PR D.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Step 3:** Push and open PR.

```bash
git push -u origin sky-362/ontology-wrapper-and-monorepo-stub
gh pr create --base main --title "SKY-362: dormant ontology wrapper + minimal monorepo stub" --body "$(cat <<'EOF'
## Summary
- `scripts/fetch-ontology-snapshot.ts` wrapper (dormant — placeholder lock).
- `ontology-snapshot.lock.json` placeholder.
- `"workspaces": ["packages/*"]` hook in root `package.json`.
- Stub `packages/ontology-store/` package (no real loader yet).

## Scope
Dormant wiring only. No consumer changes. No CI changes. Reviewable in isolation.

## Test plan
- [x] `bun run typecheck`
- [x] `bun run test`
- [x] `bun install --frozen-lockfile` clean

## Related
- Parent: SKY-213
- Spec: §4.2, §9.3
- Next: `publish-snapshot.sh` in `ontology_skill`, then first snapshot in `skygest-ontology-snapshots`, then PR D (real loader + lock bump).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 4 (human gate):** Wait for merge.

---

## Cross-repo: publish-snapshot.sh in ontology_skill

Happens in `/Users/pooks/Dev/ontology_skill`. **Not a PR in skygest-cloudflare.** Emits the snapshot content into a local clone of `skygest-ontology-snapshots`, ready for PR-against-snapshot-repo.

### Task E1: Read the existing build.py to understand inputs/outputs

**Step 1:** Find the TTL authoring path.

```bash
cd /Users/pooks/Dev/ontology_skill
find ontologies/skygest-energy-vocab -name "build.py" -o -name "*.ttl" | head -10
cat ontologies/skygest-energy-vocab/scripts/build.py 2>/dev/null | head -60
```

**Step 2:** Identify the built TTL output path, the current ontology version, and whether ROBOT is available on PATH (`which robot`).

**Step 3:** Identify the current ontology version from `owl:versionInfo` in the source TTL. Record it as `<ONT_VERSION>`.

### Task E2: Write publish-snapshot.sh

**Files:**
- Create: `/Users/pooks/Dev/ontology_skill/scripts/publish-snapshot.sh`

**Step 1:** Write the wrapper. Expects one argument — the path to a local clone of `skygest-ontology-snapshots`.

```sh
#!/usr/bin/env bash
# SKY-362: publish a new snapshot of the built ontology into skygest-ontology-snapshots.
# Usage: ./scripts/publish-snapshot.sh ../skygest-ontology-snapshots
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <path-to-skygest-ontology-snapshots>" >&2
  exit 1
fi

SNAPSHOT_REPO="$1"
cd "$(dirname "$0")/.."
ONTOLOGY_DIR="$(pwd)/ontologies/skygest-energy-vocab"

# 1. Run the ontology build to produce TTL
python3 "$ONTOLOGY_DIR/scripts/build.py"

# 2. Locate the built TTL
BUILT_TTL="$ONTOLOGY_DIR/build/skygest-energy-vocab.ttl"
if [ ! -f "$BUILT_TTL" ]; then
  echo "build.py did not produce $BUILT_TTL" >&2
  exit 1
fi

# 3. Extract the version from the TTL
ONT_VERSION=$(grep -oE 'owl:versionInfo "[^"]+"' "$BUILT_TTL" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [ -z "$ONT_VERSION" ]; then
  echo "could not extract owl:versionInfo from $BUILT_TTL" >&2
  exit 1
fi
echo "publishing ontology version $ONT_VERSION"

# 4. Convert TTL to N-Triples using ROBOT
BUILT_NT="$ONTOLOGY_DIR/build/skygest-energy-vocab.nt"
robot convert --input "$BUILT_TTL" --format nt --output "$BUILT_NT"

# 5. Compute pre-flattened classes.json + properties.json
python3 "$ONTOLOGY_DIR/scripts/flatten-lookups.py" \
  --ttl "$BUILT_TTL" \
  --classes-out "$ONTOLOGY_DIR/build/classes.json" \
  --properties-out "$ONTOLOGY_DIR/build/properties.json"

# 6. Stage into skygest-ontology-snapshots/snapshots/<version>/
SNAPSHOT_DIR="$SNAPSHOT_REPO/snapshots/$ONT_VERSION"
mkdir -p "$SNAPSHOT_DIR"
cp "$BUILT_TTL" "$SNAPSHOT_DIR/ontology.ttl"
cp "$BUILT_NT" "$SNAPSHOT_DIR/ontology.nt"
cp "$ONTOLOGY_DIR/build/classes.json" "$SNAPSHOT_DIR/classes.json"
cp "$ONTOLOGY_DIR/build/properties.json" "$SNAPSHOT_DIR/properties.json"

# 7. Count triples
TRIPLE_COUNT=$(wc -l < "$SNAPSHOT_DIR/ontology.nt" | tr -d ' ')

# 8. Extract ontology IRI
ONT_IRI=$(grep -oE '<[^>]+> a owl:Ontology' "$BUILT_TTL" | head -1 | sed -E 's/^<([^>]+)>.*/\1/')

# 9. Compute tree hash + manifest hash via the helper in skygest-cloudflare.
#    Uses the IMPORT_SOURCE_COMMIT env to embed the parent's commit into
#    the manifest for provenance. The helper script is one-off; do not
#    commit it to skygest-cloudflare.
SKYGEST_CLOUDFLARE="${SKYGEST_CLOUDFLARE:-../skygest-cloudflare}"
(cd "$SKYGEST_CLOUDFLARE" && \
  IMPORT_SOURCE_COMMIT=$(git rev-parse origin/main) \
  ONT_IRI="$ONT_IRI" \
  ONT_VERSION="$ONT_VERSION" \
  TRIPLE_COUNT="$TRIPLE_COUNT" \
  bun run scripts/compute-ontology-snapshot-manifest.ts "$SNAPSHOT_DIR")

echo "snapshot ready at $SNAPSHOT_DIR"
echo "next: cd $SNAPSHOT_REPO && git checkout -b publish/$ONT_VERSION && git add . && git commit -m \"SKY-362: publish ontology v$ONT_VERSION\" && git push -u origin publish/$ONT_VERSION && gh pr create"
```

**Step 2:** Make it executable.

```bash
chmod +x /Users/pooks/Dev/ontology_skill/scripts/publish-snapshot.sh
```

**Step 3:** Write the helper Python script for flattening lookups.

**Files:**
- Create: `/Users/pooks/Dev/ontology_skill/ontologies/skygest-energy-vocab/scripts/flatten-lookups.py`

This is a new helper that pulls classes + properties out of the TTL and writes them as flat JSON tables — the pre-flattened format the `@skygest/ontology-store` loader consumes. Consider rdflib for the TTL parse:

```py
#!/usr/bin/env python3
"""Flatten classes and properties from a TTL ontology into JSON tables."""
import argparse
import json
from rdflib import Graph, RDFS, OWL, RDF, URIRef

def literal_label(graph: Graph, subject: URIRef) -> str | None:
    for _, _, label in graph.triples((subject, RDFS.label, None)):
        return str(label)
    return None

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ttl", required=True)
    parser.add_argument("--classes-out", required=True)
    parser.add_argument("--properties-out", required=True)
    args = parser.parse_args()

    graph = Graph()
    graph.parse(args.ttl, format="turtle")

    classes = []
    for class_iri, _, _ in graph.triples((None, RDF.type, OWL.Class)):
        if not isinstance(class_iri, URIRef):
            continue
        classes.append({
            "iri": str(class_iri),
            "label": literal_label(graph, class_iri),
            "parents": [
                str(parent)
                for _, _, parent in graph.triples((class_iri, RDFS.subClassOf, None))
                if isinstance(parent, URIRef)
            ],
        })

    properties = []
    for prop_iri, _, _ in graph.triples((None, RDF.type, OWL.ObjectProperty)):
        if not isinstance(prop_iri, URIRef):
            continue
        properties.append({
            "iri": str(prop_iri),
            "kind": "object",
            "label": literal_label(graph, prop_iri),
            "domain": [
                str(domain)
                for _, _, domain in graph.triples((prop_iri, RDFS.domain, None))
                if isinstance(domain, URIRef)
            ],
            "range": [
                str(r)
                for _, _, r in graph.triples((prop_iri, RDFS.range, None))
                if isinstance(r, URIRef)
            ],
        })
    for prop_iri, _, _ in graph.triples((None, RDF.type, OWL.DatatypeProperty)):
        if not isinstance(prop_iri, URIRef):
            continue
        properties.append({
            "iri": str(prop_iri),
            "kind": "datatype",
            "label": literal_label(graph, prop_iri),
            "domain": [
                str(domain)
                for _, _, domain in graph.triples((prop_iri, RDFS.domain, None))
                if isinstance(domain, URIRef)
            ],
            "range": [
                str(r)
                for _, _, r in graph.triples((prop_iri, RDFS.range, None))
                if isinstance(r, URIRef)
            ],
        })

    classes.sort(key=lambda entry: entry["iri"])
    properties.sort(key=lambda entry: entry["iri"])

    with open(args.classes_out, "w") as handle:
        json.dump(classes, handle, indent=2, sort_keys=True)
        handle.write("\n")
    with open(args.properties_out, "w") as handle:
        json.dump(properties, handle, indent=2, sort_keys=True)
        handle.write("\n")

if __name__ == "__main__":
    main()
```

### Task E3: Write compute-ontology-snapshot-manifest.ts

This is the Bun-side helper that computes tree hash + writes the manifest with the ontology-shape fields. Mirrors `compute-ingest-artifacts-manifest.ts` from Task B4 but with `kind: "ontology-snapshot"`.

**Files:**
- Create: `/Users/pooks/Dev/skygest-cloudflare/scripts/compute-ontology-snapshot-manifest.ts` (one-off, do not commit)

**Step 1:** Write the script with the ontology-shape manifest.

```ts
// scripts/compute-ontology-snapshot-manifest.ts
// DO NOT COMMIT — one-off publish helper for SKY-362 PR C.
import { DateTime, Effect, FileSystem, Path } from "effect";
import {
  computeDirectoryTreeHash,
  sha256HexString
} from "../src/platform/GitSnapshot";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const snapshotDir = process.argv[2];
  if (!snapshotDir) {
    throw new Error("usage: compute-ontology-snapshot-manifest.ts <snapshotDir>");
  }

  const sourceCommit = process.env.IMPORT_SOURCE_COMMIT ?? "UNKNOWN";
  const ontologyIri = process.env.ONT_IRI ?? "";
  const ontologyVersion = process.env.ONT_VERSION ?? "";
  const tripleCountRaw = process.env.TRIPLE_COUNT ?? "0";
  const tripleCount = Number.parseInt(tripleCountRaw, 10);

  if (!ontologyIri || !ontologyVersion || Number.isNaN(tripleCount)) {
    throw new Error("ONT_IRI, ONT_VERSION, TRIPLE_COUNT env vars required");
  }

  const treeHash = yield* computeDirectoryTreeHash(snapshotDir, {
    exclude: ["manifest.json"]
  });

  const manifest = {
    manifestVersion: 1,
    kind: "ontology-snapshot" as const,
    generatedAt: DateTime.formatIso(DateTime.fromDateUnsafe(new Date())),
    sourceCommit,
    inputHash: treeHash,
    treeHash,
    ontologyIri,
    ontologyVersion,
    tripleCount
  };

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(snapshotDir, "manifest.json");
  yield* fs.writeFileString(manifestPath, manifestText);
  console.log(`wrote ${manifestPath}`);
  console.log(`treeHash=${treeHash}`);

  const manifestHash = yield* sha256HexString(manifestText, "compute-manifest-hash");
  console.log(`manifestHash=${manifestHash}`);
});

runScriptMain(
  "compute-ontology-snapshot-manifest",
  program.pipe(Effect.provide(scriptPlatformLayer))
);
```

### Task E4: Commit publish-snapshot.sh + flatten-lookups.py to ontology_skill

**Step 1:** Open a branch in ontology_skill, commit, push, open PR.

```bash
cd /Users/pooks/Dev/ontology_skill
git checkout main
git pull --ff-only origin main
git switch -c sky-362/publish-snapshot-wrapper
git add scripts/publish-snapshot.sh ontologies/skygest-energy-vocab/scripts/flatten-lookups.py
git commit -m "SKY-362: add publish-snapshot.sh + flatten-lookups.py helpers"
git push -u origin sky-362/publish-snapshot-wrapper
gh pr create --base main --title "SKY-362: publish-snapshot.sh wrapper + flatten-lookups.py" --body "Produces a new snapshots/<version>/ directory in skygest-ontology-snapshots ready for review. See skygest-cloudflare/docs/plans/2026-04-15-git-backed-snapshots-spec.md §9.3 PR B."
```

**Step 2 (human gate):** Wait for merge before Task F1.

---

## Cross-repo: first snapshot in skygest-ontology-snapshots

Happens in `/Users/pooks/Dev/skygest-ontology-snapshots`. Runs `publish-snapshot.sh`, reviews the output, opens a PR, tags.

### Task F1: Run publish-snapshot.sh

**Step 1:** Ensure the target repo is clean.

```bash
cd /Users/pooks/Dev/skygest-ontology-snapshots
git checkout main
git pull --ff-only origin main
```

**Step 2:** Run the publisher from ontology_skill.

```bash
cd /Users/pooks/Dev/ontology_skill
./scripts/publish-snapshot.sh /Users/pooks/Dev/skygest-ontology-snapshots
```

Expected output:
- `publishing ontology version X.Y.Z`
- Several file writes into `snapshots/X.Y.Z/`
- `treeHash=<64 hex>`
- `manifestHash=<64 hex>`
- Next-step suggestion.

**Step 3:** Record `<ONT_VERSION>`, `treeHash`, `manifestHash` for PR D.

### Task F2: Review snapshot content

**Step 1:** Inspect the new directory.

```bash
cd /Users/pooks/Dev/skygest-ontology-snapshots
ls snapshots/<ONT_VERSION>
head snapshots/<ONT_VERSION>/manifest.json
wc -l snapshots/<ONT_VERSION>/ontology.nt
head -20 snapshots/<ONT_VERSION>/classes.json
```

Verify:
- `manifest.json` has `kind: "ontology-snapshot"` with correct version and tripleCount.
- `ontology.nt` line count matches the manifest's `tripleCount`.
- `classes.json` and `properties.json` are valid JSON arrays.

### Task F3: Commit, push, tag

**Step 1:** Branch, commit, push.

```bash
cd /Users/pooks/Dev/skygest-ontology-snapshots
git switch -c publish/<ONT_VERSION>
git add snapshots/<ONT_VERSION>
git commit -m "SKY-362: publish ontology v<ONT_VERSION>"
git push -u origin publish/<ONT_VERSION>
```

**Step 2:** Open PR.

```bash
gh pr create --base main --title "SKY-362: publish ontology v<ONT_VERSION>" --body "First snapshot of the Skygest energy vocab. Generated by ontology_skill/scripts/publish-snapshot.sh. Tree hash + manifest hash pinned by the spec §5.2 shape."
```

**Step 3 (human gate):** Wait for merge.

**Step 4:** After merge, tag the merge commit.

```bash
cd /Users/pooks/Dev/skygest-ontology-snapshots
git checkout main
git pull --ff-only origin main
git tag -a ontology-v<ONT_VERSION> -m "SKY-362 first published snapshot"
git push origin ontology-v<ONT_VERSION>
git rev-parse ontology-v<ONT_VERSION>    # record this SHA for PR D
```

---

## PR D — Real loader + lock bump

Implements the `@skygest/ontology-store` loader, updates the lock file to point at `ontology-v<ONT_VERSION>`, and wires the fetch into `postinstall` + CI.

### Task G1: Branch from main

```bash
cd /Users/pooks/Dev/skygest-cloudflare
git checkout main
git pull --ff-only origin main
git switch -c sky-362/ontology-store-loader-and-cutover
```

### Task G2: Define the classes/properties schemas in the domain layer

**Files:**
- Create: `src/domain/ontology/snapshot.ts` (new — or `src/domain/ontology-snapshot.ts` if that path matches existing convention)

Per imperative #11, entity schemas live in `src/domain/`. The package loader consumes schemas from there; it does not define them.

**Step 1:** Write the domain schemas.

```ts
import { Schema } from "effect";

const OntologyIri = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const OntologyClass = Schema.Struct({
  iri: OntologyIri,
  label: Schema.NullOr(Schema.String),
  parents: Schema.Array(OntologyIri)
});
export type OntologyClass = Schema.Schema.Type<typeof OntologyClass>;

export const OntologyPropertyKind = Schema.Literals(["object", "datatype"]);
export type OntologyPropertyKind = Schema.Schema.Type<typeof OntologyPropertyKind>;

export const OntologyProperty = Schema.Struct({
  iri: OntologyIri,
  kind: OntologyPropertyKind,
  label: Schema.NullOr(Schema.String),
  domain: Schema.Array(OntologyIri),
  range: Schema.Array(OntologyIri)
});
export type OntologyProperty = Schema.Schema.Type<typeof OntologyProperty>;

export const OntologyClasses = Schema.Array(OntologyClass);
export const OntologyProperties = Schema.Array(OntologyProperty);
```

**Step 2:** Run typecheck.

```bash
bun run typecheck
```

Expected: no errors.

### Task G3: Write the loader service

**Files:**
- Create: `packages/ontology-store/src/OntologyStore.ts`
- Modify: `packages/ontology-store/src/index.ts`

**Step 1:** Write a failing test first.

**Files:**
- Create: `packages/ontology-store/tests/OntologyStore.test.ts`

```ts
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "effect";
import { BunFileSystem } from "@effect/platform-bun";
import { OntologyStore, OntologyStoreLayer } from "../src/OntologyStore";
import * as fsp from "node:fs/promises";
import * as nodePath from "node:path";
import * as os from "node:os";

describe("OntologyStore", () => {
  it("loads classes and properties from a fixture snapshot", async () => {
    const rootDir = await fsp.mkdtemp(
      nodePath.join(os.tmpdir(), "ontology-store-fixture-")
    );
    try {
      await fsp.writeFile(
        nodePath.join(rootDir, "classes.json"),
        JSON.stringify([
          { iri: "https://skygest/x#A", label: "A", parents: [] },
          { iri: "https://skygest/x#B", label: "B", parents: ["https://skygest/x#A"] }
        ])
      );
      await fsp.writeFile(
        nodePath.join(rootDir, "properties.json"),
        JSON.stringify([
          { iri: "https://skygest/x#p", kind: "object", label: "p", domain: [], range: [] }
        ])
      );

      const store = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* OntologyStore;
          return store;
        }).pipe(
          Effect.provide(OntologyStoreLayer(rootDir)),
          Effect.provide(BunFileSystem.layer)
        )
      );

      expect(store.classCount).toBe(2);
      expect(store.lookupClass("https://skygest/x#A")?.label).toBe("A");
      expect(store.parentsOf("https://skygest/x#B")).toEqual(["https://skygest/x#A"]);
      expect(store.propertyCount).toBe(1);
    } finally {
      await fsp.rm(rootDir, { recursive: true, force: true });
    }
  });
});
```

**Step 2:** Run the failing test.

```bash
bun run test packages/ontology-store/tests/OntologyStore.test.ts
```

Expected: FAIL — `OntologyStore` does not exist.

**Step 3:** Write the minimal loader.

```ts
// packages/ontology-store/src/OntologyStore.ts
import { Effect, Layer, ServiceMap, FileSystem, Path } from "effect";
import {
  OntologyClasses,
  OntologyProperties,
  type OntologyClass,
  type OntologyProperty
} from "../../../src/domain/ontology/snapshot";
import { decodeJsonStringEitherWith } from "../../../src/platform/Json";
import { Result } from "effect";

export interface OntologyStoreShape {
  readonly classCount: number;
  readonly propertyCount: number;
  readonly lookupClass: (iri: string) => OntologyClass | undefined;
  readonly lookupProperty: (iri: string) => OntologyProperty | undefined;
  readonly parentsOf: (iri: string) => ReadonlyArray<string>;
  readonly classesWithParent: (iri: string) => ReadonlyArray<string>;
}

export class OntologyStore extends ServiceMap.Key<OntologyStore, OntologyStoreShape>()(
  "@skygest/ontology-store/OntologyStore"
) {}

const decodeClasses = decodeJsonStringEitherWith(OntologyClasses as unknown as import("effect/Schema").Decoder<unknown>);
const decodeProperties = decodeJsonStringEitherWith(OntologyProperties as unknown as import("effect/Schema").Decoder<unknown>);

const readAndDecode = <A>(
  fs: FileSystem.FileSystem,
  filePath: string,
  decode: (text: string) => Result.Result<A, unknown>
) =>
  Effect.gen(function* () {
    const text = yield* fs.readFileString(filePath);
    const decoded = decode(text);
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(new Error(`failed to decode ${filePath}`));
    }
    return decoded.success as A;
  });

export const OntologyStoreLayer = (rootDir: string) =>
  Layer.effect(
    OntologyStore,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const classes = (yield* readAndDecode(
        fs,
        path.join(rootDir, "classes.json"),
        decodeClasses as any
      )) as ReadonlyArray<OntologyClass>;
      const properties = (yield* readAndDecode(
        fs,
        path.join(rootDir, "properties.json"),
        decodeProperties as any
      )) as ReadonlyArray<OntologyProperty>;

      const classByIri = new Map(classes.map((entry) => [entry.iri, entry]));
      const propertyByIri = new Map(properties.map((entry) => [entry.iri, entry]));
      const childrenByParent = new Map<string, Array<string>>();
      for (const entry of classes) {
        for (const parent of entry.parents) {
          const bucket = childrenByParent.get(parent) ?? [];
          bucket.push(entry.iri);
          childrenByParent.set(parent, bucket);
        }
      }

      return {
        classCount: classes.length,
        propertyCount: properties.length,
        lookupClass: (iri) => classByIri.get(iri),
        lookupProperty: (iri) => propertyByIri.get(iri),
        parentsOf: (iri) => classByIri.get(iri)?.parents ?? [],
        classesWithParent: (iri) => childrenByParent.get(iri) ?? []
      };
    })
  );
```

**Step 4:** Export from `packages/ontology-store/src/index.ts`.

```ts
export * from "./OntologyStore";
```

**Step 5:** Run the test.

```bash
bun run test packages/ontology-store/tests/OntologyStore.test.ts
```

Expected: PASS.

**Step 6:** Full typecheck + test suite.

```bash
bun run typecheck
bun run test
```

Expected: both green.

### Task G4: Update the lock file to point at the real tag

**Files:**
- Modify: `ontology-snapshot.lock.json`

**Step 1:** Fill in the real values from Task F3 Step 4.

```json
{
  "repo": "git@github.com:mepuka/skygest-ontology-snapshots.git",
  "ref": "ontology-v<ONT_VERSION>",
  "commit": "<40-char SHA>",
  "manifestHash": "<64-char sha256>",
  "snapshotPath": "snapshots/<ONT_VERSION>"
}
```

**Step 2:** Prove the fetch works locally.

```bash
rm -rf .generated/ontology
bun run scripts/fetch-ontology-snapshot.ts
ls .generated/ontology
cat .generated/ontology/manifest.json
```

Expected: snapshot directory populated with `ontology.ttl`, `ontology.nt`, `classes.json`, `properties.json`, `manifest.json`. Sentinel file written.

**Step 3:** Idempotency check.

```bash
bun run scripts/fetch-ontology-snapshot.ts
```

Expected: no-op.

### Task G5: Add the ontology fetch to the postinstall hook

**Files:**
- Modify: `package.json`

**Step 1:** Chain both fetches in the postinstall hook.

```json
"postinstall": "bun run scripts/fetch-ingest-artifacts.ts && bun run scripts/fetch-ontology-snapshot.ts"
```

**Step 2:** Synthetic install check.

```bash
rm -rf node_modules .generated/ontology
bun install --frozen-lockfile
ls .generated/ontology
```

Expected: both fetches populate their trees.

### Task G6: Wire the ontology fetch into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

CI already has the `webfactory/ssh-agent` step from SKY-361 PR C. The new ontology fetch runs automatically via postinstall when `bun install` fires. No new CI step required — validate by reading the diff and confirming no additional step is needed.

### Task G7: Run full verification

**Step 1:** Typecheck + full test suite.

```bash
bun run typecheck
bun run test
```

### Task G8: Commit PR D

**Step 1:** Stage.

```bash
git add \
  src/domain/ontology \
  packages/ontology-store/src/OntologyStore.ts \
  packages/ontology-store/src/index.ts \
  packages/ontology-store/tests \
  ontology-snapshot.lock.json \
  package.json
git status
```

**Step 2:** Commit.

```bash
git commit -m "$(cat <<'EOF'
SKY-362: implement @skygest/ontology-store loader + cutover

- Define OntologyClass + OntologyProperty schemas in src/domain/ontology/
  (spec imperative #11 — single source of truth; the loader consumes
  domain schemas rather than defining parallel decoders).
- Implement OntologyStore service + OntologyStoreLayer in
  packages/ontology-store/src/OntologyStore.ts. Loads
  .generated/ontology/classes.json + properties.json via Effect
  FileSystem. Typed read API: lookupClass, lookupProperty, parentsOf,
  classesWithParent.
- Bump ontology-snapshot.lock.json to ontology-v<ONT_VERSION>.
- Chain fetch-ontology-snapshot.ts into the postinstall hook.

Per spec §9.3 PR D, build:ontology-snapshot and seed:ontology-kv are
left alone — they produce the legacy energy-news catalog used by
ONTOLOGY_KV. The new chain has no runtime consumer yet; it is the
substrate for future OEO binding work (SKY-348).

Worker runtime still reads KV and D1 only. The ontology-store package
is build-time-only per spec §4.2 framing.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task G9: Push + open PR

**Step 1:** Push.

```bash
git push -u origin sky-362/ontology-store-loader-and-cutover
```

**Step 2:** Open PR.

```bash
gh pr create --base main --title "SKY-362: @skygest/ontology-store loader + ontology snapshot cutover" --body "$(cat <<'EOF'
## Summary
- `src/domain/ontology/snapshot.ts` — `OntologyClass` + `OntologyProperty` schemas (single source of truth per spec imperative #11).
- `packages/ontology-store/` — `OntologyStore` service + `OntologyStoreLayer` that loads the fetched snapshot via Effect FileSystem.
- `ontology-snapshot.lock.json` bumped to `ontology-v<ONT_VERSION>`.
- `postinstall` chained to include the ontology fetch.

## Scope
- No consumer wiring of the new loader into `build:ontology-snapshot` / `seed:ontology-kv` — per spec §9.3 PR D, those stay on the legacy energy-news path.
- No Worker runtime imports of the package — build-time only per spec §4.2.
- No SPARQL, no reasoner, no runtime triple store.

## Test plan
- [x] `bun run typecheck`
- [x] `bun run test` (new test in `packages/ontology-store/tests/`)
- [x] Local `bun install --frozen-lockfile` populates both `.generated/cold-start/` and `.generated/ontology/`.
- [ ] CI green end-to-end.

## Related
- Parent: SKY-213
- Spec: `docs/plans/2026-04-15-git-backed-snapshots-spec.md` §4.2, §9.3
- Prerequisites: SKY-361 merged, SKY-362 PR A merged, `ontology_skill` `publish-snapshot.sh` merged, `skygest-ontology-snapshots` `ontology-v<ONT_VERSION>` tagged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Step 3 (human gate):** Wait for merge. On merge, move SKY-362 to Done on Linear with the PR link.

---

# Cross-cutting concerns

## Open questions surfaced by this plan

Per spec §11, any of these that aren't resolved before Task C2 should be flagged on the SKY-361 ticket as implementation-time decisions:

1. **Auth for private repos** — plan proposes a shared SSH deploy key. If the operator prefers a PAT or GitHub App, swap Task C2 accordingly.
2. **Fetch mechanism** — the existing `scripts/fetch-git-snapshot.ts` on main uses an internal git subprocess strategy. Neither this plan nor the SKY-361 / SKY-362 tickets require changing that. If a future performance pass needs `git archive --remote`, that is a separate ticket.
3. **Local dev behavior on branch switch** — this plan wires postinstall only. If a developer switches branches and the new branch has a different lock file, they must run `bun install` (or `bun run scripts/fetch-*.ts`) to refresh `.generated/`. No git hook. Worth a mention in `docs/onboarding/` if that exists.

## Testing conventions

- **Unit tests:** `@effect/vitest` under `tests/` (existing convention) or `packages/*/tests/` for the new package.
- **Effect tests:** always via `Effect.runPromise` + explicit layer provision, never top-level `await`.
- **Integration tests:** not required for this work — the fetcher is covered by the existing test suite in `tests/fetch-git-snapshot.test.ts`; the loader is covered by the new package test.

## Commit discipline

- One logical commit per PR. No multi-topic commits.
- Commit message bodies always include the SKY ticket id and a short WHY statement.
- Always use the HEREDOC pattern for commit messages with `git commit -m "$(cat <<'EOF' ... EOF)"` to preserve formatting.
- Never `git add -A` — stage files by name.
- Never amend a commit that has been pushed.
- Never force-push to a shared branch.

## Rollback plan

- **SKY-361 PR A / SKY-362 PR A:** revert PR. Dormant wrapper, zero consumer impact.
- **SKY-361 PR C:** revert PR. `COLD_START_ROOT` default reverts to `references/cold-start`. This requires un-deleting that directory — because the PR also deletes `references/cold-start/`, a revert restores it. Verify during review.
- **SKY-362 PR D:** revert PR. Loader goes away, fetch is still wired but harmless (postinstall still runs, just the consumer stub is back).
- **Cross-repo PRs:** revert is a new commit on the external repo + a new import tag. Bump the lock file in a follow-up PR.

---

## Completion criteria

Both tickets are Done when:

- [x] `docs/plans/2026-04-15-git-backed-snapshots-spec.md` lives on main (done).
- [ ] SKY-361 PR A merged.
- [ ] `mepuka/skygest-ingest-artifacts` has an `import/2026-04-15-cold-start` PR merged and a `v2026.04.15-import` tag.
- [ ] SKY-361 PR C merged. `references/cold-start/` deleted. CI green end-to-end against the fetched tree. SKY-361 ticket moved to Done.
- [ ] SKY-362 PR A merged. `packages/ontology-store/` stub in place.
- [ ] `ontology_skill` has `publish-snapshot.sh` + `flatten-lookups.py` on main.
- [ ] `mepuka/skygest-ontology-snapshots` has the first `snapshots/<ONT_VERSION>/` merged and tagged `ontology-v<ONT_VERSION>`.
- [ ] SKY-362 PR D merged. Loader implemented. Lock pinned. `bun install` populates both generated trees. CI green end-to-end. SKY-362 ticket moved to Done.
