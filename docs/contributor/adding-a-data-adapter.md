# Adding a new data adapter

This runbook covers the end-to-end flow for adding a new DCAT data source to the Skygest catalog under the **git-backed snapshots regime** that landed in [SKY-361](https://github.com/mepuka/skygest/pull/125). It replaces the older in-tree `references/cold-start/` workflow.

**Audience:** a developer who has been handed a new data source URL (or a vendor spec) and needs to get it ingested into the Skygest catalog.

**Non-goals:** this document does not cover ontology authoring (that lives in `ontology_skill`), runtime enrichment, or resolver wiring.

---

## System overview — the big picture

The catalog no longer lives in this repo. It lives in a separate private git repo — [`skygest-ingest-artifacts`](https://github.com/mepuka/skygest-ingest-artifacts) — and is fetched at build time via a pinned commit in `ingest-artifacts.lock.json`. The fetch happens automatically as a `postinstall` hook when you run `bun install`.

```
┌─────────────────────────┐      ┌──────────────────────────┐
│ You, running an ingest  │      │ skygest-ingest-artifacts │
│ adapter with            │─────▶│ (separate git repo,      │
│ COLD_START_ROOT=...     │      │  you clone it as sibling)│
└─────────────────────────┘      └──────────┬───────────────┘
                                            │
                                            │ merged PR + tag
                                            ▼
                                 ┌──────────────────────────┐
                                 │ ingest-artifacts.lock    │
                                 │ .json in this repo       │
                                 │ (one-line bump PR)       │
                                 └──────────┬───────────────┘
                                            │
                                            │ bun install
                                            │ → fetch-ingest-artifacts.ts
                                            ▼
                                 ┌──────────────────────────┐
                                 │ .generated/cold-start/   │
                                 │ (gitignored, fetched)    │
                                 └──────────────────────────┘
```

Key consequences:

- **You never edit `.generated/cold-start/`** — it is a fetch target, not a source of truth. Any change you make there is blown away on the next `bun install`.
- **You write into a sibling checkout of `skygest-ingest-artifacts`** — that repo is the source of truth for catalog content.
- **Every catalog refresh is a PR** on the snapshot repo, followed by a one-line bump of `ingest-artifacts.lock.json` on this repo.
- **The runtime worker never imports from `skygest-ingest-artifacts` directly.** It reads from `.generated/cold-start/` at build time, which is seeded by the fetch. The spec's "no Node built-ins in `src/`" rule is preserved.

---

## Prerequisites

1. **Clone `skygest-ingest-artifacts` as a sibling directory.** All adapter runs will write into that checkout via the `COLD_START_ROOT` env override.

   ```bash
   cd "$(dirname "$(pwd)")"
   git clone git@github.com:mepuka/skygest-ingest-artifacts.git
   ```

   You should end up with `skygest-cloudflare/` and `skygest-ingest-artifacts/` as siblings under the same parent directory.

2. **SSH access to the private snapshot repos.** Your GitHub SSH key must be authorized to read `mepuka/skygest-ingest-artifacts` (required for `bun install`'s `postinstall` fetch hook as well as the manual clone above). Confirm with `ssh -T git@github.com`.

3. **Bun is installed.** `bun --version` ≥ `1.3.x`. See `package.json` for the pinned toolchain.

---

## Step-by-step: adding a new adapter

### 1. Create an Agent record for the publisher (one-time, per publisher)

Every DCAT adapter expects the **Agent** (the publishing organization) to already exist in the catalog. Adapters resolve the agent by file slug in their `buildContext.ts` and error out if it's missing:

```text
NESO agent not found in catalog index (expected file slug "neso"). Ensure .generated/cold-start/catalog/agents/neso.json exists.
```

If your publisher is new, you must hand-author the Agent JSON and land it in `skygest-ingest-artifacts` **before** running the adapter:

1. Pick a file slug. Convention: lowercase-kebab-case matching the publisher's common short name (`eia`, `neso`, `rte`, `ember`, `energy-institute`).
2. Mint an Agent ID via the `Agent` domain schema (`src/domain/data-layer/catalog.ts`). You can do this by hand-editing — copy the shape of an existing agent under `skygest-ingest-artifacts/catalog/agents/*.json` and swap the fields. Be sure to mint a fresh ULID-shaped ID rather than reusing an existing one.
3. Write the file into your sibling checkout: `../skygest-ingest-artifacts/catalog/agents/<slug>.json`.
4. Commit it in the snapshot repo with a focused one-file commit (`feat(catalog): seed <publisher> agent`).
5. Open a PR on `skygest-ingest-artifacts`. Merge. Tag a new snapshot (see step 5 of the adapter flow below for the tag conventions).
6. Bump `ingest-artifacts.lock.json` on this repo in a separate one-line PR.

At that point `.generated/cold-start/catalog/agents/<slug>.json` is available for your adapter to resolve.

> **Why this cant be collapsed into the adapter run:** the adapter writes *derived* catalog entities (datasets, distributions, catalog records) that reference the Agent by ID. Minting the Agent from inside the adapter would mean a new ID every run, which breaks FK references on re-runs. Keep agent seeding explicit and one-shot.

### 2. Scaffold the adapter under `src/ingest/dcat-adapters/<source>/`

Follow the layout used by existing adapters (`ember`, `energy-institute`, `entsoe`, `neso`, `odre`, `eia-tree`, `gridstatus`, `data-europa`, `energy-charts`). A minimal adapter has:

```
src/ingest/dcat-adapters/<source>/
  index.ts                # barrel: re-exports the public surface
  run.ts                  # ScriptConfig + runXxxIngest entry point
  buildContext.ts         # resolves existing Agent/Catalog from the registry index
  buildCandidateNodes.ts  # maps the upstream data into typed IngestGraph nodes
  fetchSpec.ts            # (optional) remote spec fetcher — OpenAPI, CKAN API, etc.
  types.ts or api.ts      # (optional) typed upstream response shapes
```

Recommended starting exemplar: **`ember`** (`src/ingest/dcat-adapters/ember/`). It demonstrates the full pattern including spec fetching, OpenAPI introspection, and derived distribution minting.

Key contracts every adapter must implement:

- **`ScriptConfig`** — `Config.all(XxxIngestKeys)` from `src/platform/ConfigShapes.ts`. You will add `XxxIngestKeys` there next.
- **`buildContextFromIndex(idx, nowIso)`** — pure function that takes the loaded catalog index and returns a typed `BuildContext` containing the resolved Agent, Catalog, and (optionally) `DataService` the new content will hang off.
- **`buildCandidateNodes(fetched, context)`** — pure function that walks the fetched upstream data and produces typed nodes (`Agent | Catalog | CatalogRecord | Dataset | Distribution | DataService | DatasetSeries`) in topological order.
- **`runXxxIngest(config)`** — thin orchestrator that calls `runDcatIngest` from `src/ingest/dcat-harness` with the adapter's callbacks. The harness handles fetch retries, schema validation via `Effect.partition`, idempotent file writes, and report generation.

### 3. Add a config-keys entry under `src/platform/ConfigShapes.ts`

Every adapter has its own `XxxIngestKeys` that extends `ColdStartCommonKeys` with whatever source-specific settings it needs (API keys, base URLs, rate limits, cache TTLs):

```ts
export const MySourceIngestKeys = {
  ...ColdStartCommonKeys,
  apiKey: nonEmptyRedacted("MY_SOURCE_API_KEY"),
  baseUrl: Config.withDefault(
    Config.string("MY_SOURCE_BASE_URL"),
    "https://api.example.com/v1"
  ),
  minIntervalMs: Config.withDefault(Config.int("MY_SOURCE_MIN_INTERVAL_MS"), 250)
} as const;
```

The inherited `rootDir` (from `ColdStartCommonKeys.rootDir`) is the one the harness writes into. Its default is `.generated/cold-start` — but you override it via `COLD_START_ROOT` when running the adapter (see step 4).

### 4. Add a harness entry script at `scripts/cold-start-ingest-<source>.ts`

Mirror the existing entries. For example `scripts/cold-start-ingest-ember.ts`:

```ts
import { Effect } from "effect";
import {
  ScriptConfig,
  type ScriptConfigShape,
  runMySourceIngest
} from "../src/ingest/dcat-adapters/my-source";
import { Logging } from "../src/platform/Logging";
import {
  runScriptMain,
  scriptPlatformLayer
} from "../src/platform/ScriptRuntime";

export { runMySourceIngest };
export type { ScriptConfigShape };

const main = Effect.fn("MySourceIngest.main")(function* () {
  const config = yield* ScriptConfig;
  yield* runMySourceIngest(config);
});

const mainEffect = main().pipe(
  Effect.tapError((error) => Logging.logFailure("my-source ingest failed", error))
);

if (import.meta.main) {
  runScriptMain(
    "MySourceIngest",
    mainEffect.pipe(Effect.provide(scriptPlatformLayer))
  );
}
```

### 5. Run the adapter against the sibling snapshot-repo checkout

```bash
# from skygest-cloudflare/
COLD_START_ROOT=../skygest-ingest-artifacts \
  MY_SOURCE_API_KEY="..." \
  bun run scripts/cold-start-ingest-my-source.ts
```

The harness will:

1. Load the existing catalog index from `../skygest-ingest-artifacts/catalog/`
2. Resolve the pre-existing Agent via `buildContextFromIndex`
3. Fetch the upstream spec (if applicable) via your `fetchSpec.ts`
4. Build typed candidate nodes
5. Validate every candidate via `Effect.partition`
6. Write out new or updated entity JSON files in topological order (Agents → Catalogs → DataServices → Datasets → Distributions → CatalogRecords)
7. Emit a report under `../skygest-ingest-artifacts/reports/<source>-ingest-report.json`

### 6. Review the diff, PR the snapshot repo, tag

```bash
cd ../skygest-ingest-artifacts
git status                          # inspect every new/modified file
git checkout -b ingest/<source>-<YYYY-MM-DD>
git add catalog reports             # stage the new content
git commit -m "feat(ingest): add <source> via cold-start-ingest-<source>"
git push -u origin ingest/<source>-<YYYY-MM-DD>
gh pr create --base main \
  --title "ingest: add <source> via cold-start-ingest-<source>" \
  --body "Run log: ..."
```

After merge, tag the merge commit. Ingest-artifacts tags are **date + sequence**, not semver (snapshots are content, not schema):

```bash
git checkout main
git pull --ff-only
git tag -a v2026.04.15 -m "Add <source> via cold-start-ingest-<source>"
git push origin v2026.04.15
git rev-parse v2026.04.15^{commit}   # record this SHA for the lock bump
```

Multiple publishes on the same day use a suffix: `v2026.04.15.1`, `v2026.04.15.2`, etc.

### 7. Validate the new catalog locally

Before bumping the lock in `skygest-cloudflare`, prove the fetched tree loads cleanly:

```bash
# from skygest-cloudflare/
bun run scripts/validate-data-layer-registry.ts
```

This runs every invariant check against the loaded registry. Exits non-zero on any failure. The script does **not** block the unit-test run (invariants are too slow to run in every CI job), so it's your responsibility to run it before opening the lock-bump PR.

### 8. Bump `ingest-artifacts.lock.json` on this repo

```bash
# from skygest-cloudflare/
git switch -c ingest-artifacts-bump/<YYYY-MM-DD>
```

Edit `ingest-artifacts.lock.json`:

```json
{
  "repo": "git@github.com:mepuka/skygest-ingest-artifacts.git",
  "ref": "v2026.04.15",
  "commit": "<40-char SHA from step 6>",
  "manifestHash": "<sha256 of the new manifest.json>"
}
```

- `commit` is **authoritative** — the tag is informational only.
- `manifestHash` is the sha256 of the merged commit's `manifest.json`. You can compute it locally after the fetch:
  ```bash
  rm -rf .generated/cold-start
  bun run scripts/fetch-ingest-artifacts.ts
  # the fetcher re-verifies the tree hash; if the lock is wrong, this fails loud
  ```

Then:

```bash
bun run typecheck
bun run test
git add ingest-artifacts.lock.json
git commit -m "chore(ingest): bump snapshot to v2026.04.15"
gh pr create --base main --title "chore(ingest): bump snapshot to v2026.04.15"
```

This is the one-line review surface the spec intends.

---

## Testing

Every adapter ships with a `tests/cold-start-ingest-<source>.test.ts` covering the happy path and a representative failure. Follow `tests/cold-start-ingest-ember.test.ts` as an exemplar — it shows how to:

- Build a temporary catalog root under `os.tmpdir()`
- Seed pre-existing fixtures by copying from `.generated/cold-start/catalog/` (the fetched tree)
- Stub `HttpClient` with a fixture-driven handler
- Run the adapter via `runXxxIngest`
- Assert on the written entity files

The test suite picks up the fetched tree automatically because `postinstall` runs `fetch-ingest-artifacts.ts` before tests. Do not import static JSON from `.generated/` — it is not guaranteed to exist at TypeScript compile time on a fresh clone. Use runtime `fs.copyFile` or `fs.readFile`.

---

## Rollback

If a snapshot introduces a bad catalog state, rollback is a one-line revert of the lock-bump PR. The old snapshot is still reachable in git history. No multi-repo coordination required.

---

## Troubleshooting

### `bun install` fails with `Host key verification failed` or `Permission denied (publickey)`

Your SSH key isn't authorized on `skygest-ingest-artifacts`. Check `ssh -T git@github.com` and confirm you're logged in as the right account. The `postinstall` hook runs `scripts/fetch-ingest-artifacts.ts` which `git clone`s via SSH.

### The fetcher complains about `manifestHash` mismatch

The `manifestHash` in `ingest-artifacts.lock.json` does not match the sha256 of the fetched `manifest.json`. Either the lock file is stale or the snapshot repo has been force-pushed (bad — snapshots are immutable). Re-compute the hash from the live commit and bump the lock.

### The fetcher complains about `treeHash` mismatch

The `treeHash` inside the snapshot's `manifest.json` does not match the tree you fetched. This is a corruption signal — never the fetcher's fault. Inspect the snapshot repo's content at the pinned commit and look for a file that was accidentally modified post-publish.

### The adapter errors with `<X> agent not found in catalog index`

You haven't completed step 1 of the adapter flow — the Agent record for your publisher doesn't exist in the snapshot repo yet. Seed it first via a one-off hand-authored commit on `skygest-ingest-artifacts`, merge + tag + bump lock, then re-run the adapter.

### Local `.generated/cold-start/` disappears after `bun install`

Expected. The fetcher wipes and re-populates the destination on every fetch. Never edit files under `.generated/` — your changes will vanish.

---

## Related

- Authoritative spec: `docs/plans/2026-04-15-git-backed-snapshots-spec.md`
- Execution plan: `docs/plans/2026-04-15-sky-361-362-execution-plan.md`
- Consumer cutover PR: [#125](https://github.com/mepuka/skygest/pull/125)
- Shared fetch primitive: [SKY-364 / #123](https://github.com/mepuka/skygest/pull/123)
- Ingest-artifacts import: [skygest-ingest-artifacts#1](https://github.com/mepuka/skygest-ingest-artifacts/pull/1)
- Parent epic: SKY-213

## Open items captured at runbook-write time

- **Automated validation gate**: `scripts/validate-data-layer-registry.ts` is run manually. Consider wiring it into a separate CI job (not blocking unit tests) so every snapshot bump is validated before merge.
- **Adapter scaffolding helper**: a `scripts/new-adapter.ts` generator that stamps out the `src/ingest/dcat-adapters/<source>/` tree would save a few minutes per new source. Not urgent; only worth it when the next 2-3 new sources go through.
- **Archaeology review**: the SKY-216-era probes (`scripts/catalog-harvest/probe-*.ts`) were deleted in the cutover PR because they hardcoded `references/cold-start/`. Some probes (e.g. `probe-ror`, `probe-wikidata`) are plausibly useful for initial research on a new provider. Re-introducing them as `COLD_START_ROOT`-aware scripts is a judgment call for whoever onboards the next adapter.
