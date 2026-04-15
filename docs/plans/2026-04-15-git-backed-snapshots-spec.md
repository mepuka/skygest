# Git-backed snapshots: ingest artifacts and raw ontology

**Status:** Design locked, implementation blocked on SKY-364
**Date:** 2026-04-15
**Tickets:** SKY-364 (prep infra) → SKY-361, SKY-362 (consumer stores) — all under SKY-213
**Supersedes:** Partially narrows `docs/plans/2026-04-14-unified-triple-store-export-design.md` (this spec drops the RDF export arm; see §11)

## 1. Summary

This spec defines how two categories of bulk content enter `skygest-cloudflare` from external git repositories at build time:

1. **Ingest artifacts** — the ~7,700 JSON files currently committed under `references/cold-start/` (DCAT catalog entities, series, variables, candidates, survey and reports outputs). These move to a dedicated `skygest-ingest-artifacts` repo (SKY-361).
2. **Raw ontology snapshots** — the built TTL + N-Triples + pre-flattened lookup tables for the sevocab ontology. These live in a new `skygest-ontology-snapshots` repo (SKY-362), distinct from `ontology_skill` (which stays as the design workspace).

Both flows share a single fetch primitive (SKY-364), a single manifest shape, and a single lock-file shape. Both are **manual, pin-driven, build-time-only**. The Worker runtime reads nothing directly from either snapshot.

The goal is to keep the `skygest-cloudflare` main branch clean, the data model tight, and the version story explicit enough to reproduce any build and roll back any update with a one-line diff.

## 2. Problem statement

Three problems motivate this work.

1. **Data-plane bloat in the runtime repo.** `references/cold-start/` holds ~7,700 loose JSON files committed directly to the worker repo. Every ingest pass expands the working tree and muddles data diffs with code diffs. Review surface for unrelated PRs is polluted by accidental cold-start deltas.
2. **No version identity for ingest content.** There is no way to ask "what version of the cold-start catalog is this deploy built against?" other than the commit SHA of the whole worker repo. We can't pin an old version and rebuild, and we can't roll forward a single data update without a full worker redeploy.
3. **Runtime has no clean home for the raw ontology.** `ontology_skill` is an engineering workspace (Python + ROBOT + Turtle authoring), not importable at runtime. Today's workaround is `scripts/sync-vocabulary.ts` reading `../ontology_skill/` from a sibling local checkout. This forces every developer to have both repos cloned and the Python build run locally, and forces CI to maintain Python + ROBOT just to keep the loop working.

## 3. System overview

Three stores, one fetch primitive, one runtime.

```
┌──────────────────────┐      ┌──────────────────────────┐
│ ontology_skill       │      │ ingest adapters          │
│ (Python + ROBOT)     │      │ (in skygest-cloudflare   │
│ TTL authoring        │      │  scripts/, run by humans)│
└──────────┬───────────┘      └──────────┬───────────────┘
           │                             │
           │ publish-snapshot.sh         │ --out flag
           │ (manual, PR)                │ (manual, PR)
           ▼                             ▼
┌──────────────────────┐      ┌──────────────────────────┐
│ skygest-ontology-    │      │ skygest-ingest-artifacts │
│ snapshots            │      │ (new git repo, flat by   │
│ (new git repo,       │      │  entity kind)            │
│  snapshots/<v>/)     │      │                          │
└──────────┬───────────┘      └──────────┬───────────────┘
           │                             │
           │           scripts/fetch-git-snapshot.ts
           │           (shared, pin-driven, SKY-364)
           ▼                             ▼
       .generated/ontology/         .generated/cold-start/
           │                             │
           │ packages/ontology-store/    │ CheckedInDataLayerRegistry
           │ + build:ontology-snapshot   │ + sync-data-layer
           │ + seed:ontology-kv          │ + rebuild-search-db
           ▼                             ▼
       Cloudflare KV                 D1 + FTS search-staging
           │                             │
           └─────────────┬───────────────┘
                         ▼
                  Worker runtime
```

Key properties:

- **`ontology_skill` never touches the worker tree.** Its only output is a PR against `skygest-ontology-snapshots`.
- **The Worker runtime reads KV and D1, nothing else.** All snapshot content is flattened into KV/D1 at build time by Bun scripts.
- **`.generated/` is never committed.** Fetched content lives there and only there.
- **One fetch script, two invocations.** Shared primitive, not a shared package.
- **Both stores are pin-driven.** A lock file in `skygest-cloudflare` names the exact commit for each store; advancing a pin is a one-line PR.

## 4. Store definitions

### 4.1 Store A — `skygest-ingest-artifacts` (SKY-361)

**Purpose.** The home for hand-curated and ingested DCAT catalog content. Replaces `references/cold-start/`.

**Layout.** Mirrors `dataLayerEntityKindSpecs.directory` in `src/domain/data-layer/kinds.ts` — the loader contract is strict, so this has to match the entity-kind specs exactly:

```
catalog/
  agents/              # Agent
  catalogs/            # Catalog
  catalog-records/     # CatalogRecord
  datasets/            # Dataset
  distributions/       # Distribution
  data-services/       # DataService
  dataset-series/      # DatasetSeries
variables/             # Variable
series/                # Series
candidates/            # resolution fixtures for tests/snapshots
survey/                # audit outputs
reports/
manifest.json          # top-level integrity + counts
```

Per-source lineage (EIA, NESO, Ember, etc.) lives inside each JSON blob via the existing `provenance` / `sourceUri` fields — **not** in directory structure. The layout is not negotiable; it's driven by the `directory` field on each `DataLayerEntityKindSpec`.

**Update flow.**

1. Developer runs an ingest adapter with the existing `COLD_START_ROOT` env override pointing at a local checkout of the artifacts repo: `COLD_START_ROOT=../skygest-ingest-artifacts bun run scripts/cold-start-ingest-eia.ts`. The harness already threads this through `DcatAdapterConfigShape.rootDir` — no new `--out` flag needed.
2. Developer reviews the diff, opens a PR against `skygest-ingest-artifacts`, merges.
3. Optional: tag as a sticky reference (`v2026.04.14`, `v2026.04.14.1`, etc. — date + sequence, not semver; this is content, not schema).
4. Developer bumps `ingest-artifacts.lock.json` in `skygest-cloudflare` via a one-line PR.

**Access flow.** `scripts/fetch-ingest-artifacts.ts` (thin wrapper around the shared SKY-364 primitive) reads `ingest-artifacts.lock.json` and pulls the pinned commit into `.generated/cold-start/`.

The fetch script is introduced and wired in different PRs for safety — see §9.2. Specifically, `postinstall` and CI fetch hooks are wired **only after** a real snapshot repo exists and the lock file points at it. `bun install --frozen-lockfile` must stay green across every PR, so the fetch script is a no-op while the lock file is a placeholder.

**Consumer.** This is **not** a one-line change. The switch touches multiple places, and the minimal-diff path is to flip the `COLD_START_ROOT` default rather than hand-edit every consumer:

- `src/platform/ConfigShapes.ts:107` — `COLD_START_ROOT` defaults to `"references/cold-start"`. Flip the default to `".generated/cold-start"`.
- `src/bootstrap/CheckedInDataLayerRegistry.ts` — already reads `rootDir` from `ColdStartCommonKeys`, so it inherits the new default.
- `scripts/sync-data-layer.ts`, `scripts/rebuild-search-db.ts`, `scripts/validate-data-layer-registry.ts`, `scripts/audit-series-dataset-evidence.ts`, and any other cold-start reader — audit each during PR C to confirm they use the shared config key. Any script with a hardcoded `"references/cold-start"` literal gets updated to read from `ColdStartCommonKeys.rootDir`.
- `references/data-layer-spine/manifest.json` **stays in-tree** — it drives TypeScript codegen, runs against source files, not snapshot content.

### 4.2 Store B — `skygest-ontology-snapshots` (SKY-362)

**Purpose.** Runtime-adjacent home for the raw ontology. Holds versioned snapshots of the built TTL + N-Triples + pre-flattened lookup tables, sourced from `ontology_skill`.

**Layout:**

```
snapshots/
  0.3.0/
    ontology.ttl         # canonical Turtle
    ontology.nt          # N-Triples (line-diffable for review)
    classes.json         # pre-flattened class lookup table
    properties.json      # pre-flattened property lookup table
    manifest.json        # version + integrity
pointer.json              # names the current release
```

One directory per version, kept forever. Single-digit MB total.

**Update flow.**

1. In `ontology_skill`, author edits TTL sources.
2. A new `publish-snapshot.sh` wrapper (lives in `ontology_skill`, **not** in the monorepo) runs `build.py`, runs ROBOT to emit N-Triples, copies the four files into a fresh `skygest-ontology-snapshots/snapshots/<version>/` checkout, writes `manifest.json`, and pushes a branch for human review.
3. Reviewer merges + tags `ontology-v0.3.0` (semver; matches the ontology's own version).
4. Developer bumps `ontology-snapshot.lock.json` in `skygest-cloudflare`.

**Access flow.** Same fetch primitive as SKY-361. `scripts/fetch-ontology-snapshot.ts` pulls the pinned tag into `.generated/ontology/`.

**Consumer — build-time, not runtime.** This is the critical framing:

- A new `packages/ontology-store/` package lives at `packages/ontology-store/` (minimal monorepo: leave worker at root, add `packages/*` as workspaces). Loads the snapshot JSON via Effect `FileSystem`, exposes a typed read API.
- The existing `build:ontology-snapshot` and `seed:ontology-kv` scripts (**already in `package.json`**) consume the package at build time to flatten content into KV.
- The Worker runtime reads from KV. **No Oxigraph, no SQLite triple store, no live SPARQL inside the Worker.** That preserves the "no Node built-ins in the Worker bundle" rule cleanly.

### 4.3 Store C — `ontology_skill` (mostly unchanged)

Still the ontology *design* workspace: TTL authoring, ROBOT validation, schema design. The one change in this spec's scope: TTL + flattened lookup tables reach `skygest-cloudflare` via a PR on the new snapshot repo (SKY-362), not by a sibling-dir file read.

**What stays coupled to `ontology_skill` (intentionally not fixed by this spec):**

- `scripts/sync-vocabulary.ts` — the hot-loop vocabulary sync for `references/vocabulary/*.json`. Still reads from `../ontology_skill/ontologies/skygest-energy-vocab/data/vocabulary/` on the local filesystem. This is the SKOS concept-scheme JSON path, not the raw ontology. May converge with the new chain later; out of scope here.
- `bun run sync:energy-profile` in CI (`.github/workflows/ci.yml:42-47`) — the energy-profile codegen reads `ontology_skill/ontologies/skygest-energy-vocab/build/shacl-manifest.json`. CI still checks out `ontology_skill` (`.github/workflows/ci.yml:19-25`) for this codegen sync. **SKY-362 does not remove this coupling.** The ontology-snapshot chain is additive; full de-coupling of CI from `ontology_skill` is a future convergence question.

### 4.4 Three pre-existing "ontology-ish" paths — what this spec does and does not touch

There are already several code paths in `skygest-cloudflare` that use the word "ontology" or read ontology-shaped content. They are distinct; SKY-362 only introduces the third one.

| Path | What it is | Status under this spec |
|---|---|---|
| `config/ontology/energy-snapshot.json` + `publications-seed.json` (built by `src/scripts/build-ontology-snapshot.ts` from `../ontology_skill/ontologies/energy-news/`, consumed by `OntologyCatalog`, `CheckedInPublications`, `SourceAttributionMatcher`, `StagingOpsService`, and the `ONTOLOGY_KV` binding) | **Legacy energy-news catalog** — publications tiers and topic taxonomy for source attribution. From an earlier direction. | **Deprecated in place.** Not touched by this spec. Keeps working as-is. Remove or rearchitect in a separate future ticket. `ONTOLOGY_KV` is considered deprecated; the spec does not add new dependencies on it. |
| `references/vocabulary/*.json` (built by `ontology_skill/ontologies/skygest-energy-vocab/scripts/build.py`, synced by `scripts/sync-vocabulary.ts`) | **skygest-energy-vocab SKOS JSON** — the hot vocabulary-lookup path, originally built for facet-matching. Most consumers are now tech-dead (SKY-239/308/309/310/312 canceled). | Still synced from sibling dir; still lives under `references/vocabulary/`. Not touched by this spec. Convergence is a future question. |
| `skygest-ontology-snapshots` (new, SKY-362) → `.generated/ontology/` → `packages/ontology-store/` | **Raw ontology snapshots** — TTL + N-Triples + pre-flattened class/property tables from `ontology_skill/ontologies/skygest-energy-vocab/`, versioned and git-pinned. Build-time only; consumers TBD. | **What this spec defines.** Additive to the two rows above. No current consumers — this is the substrate for future runtime integration (via KV seeding), not a replacement for anything running today. |

**Important.** SKY-362 does **not** consume, replace, or rearchitect `config/ontology/energy-snapshot.json` / `publications-seed.json` / `OntologyCatalog` / `ONTOLOGY_KV`. The running app keeps reading those exactly as it does today. The new chain is a clean additive lane that later work can build on without disturbing anything in the running system. When a consumer for the new lane exists (future ticket), it will use build-time KV seeding; but no runtime code in `src/` changes as part of SKY-362 itself.

## 5. Shared infrastructure (SKY-364)

One script, one manifest schema, one lock-file schema. Not a package — two call sites don't justify it.

### 5.1 `scripts/fetch-git-snapshot.ts`

```ts
fetchGitSnapshot({
  lockFile: string,              // path to the .lock.json
  destDir: string,               // target under .generated/
  requiredManifestFile: string   // usually "manifest.json"
}) => Effect<void, FetchError>
```

Behavior:

1. **Read + validate the lock file.** Parse `ingest-artifacts.lock.json` or `ontology-snapshot.lock.json` against the `LockFile` schema. Typed `FetchError` on parse or schema failure.
2. **Placeholder short-circuit.** If `lockFile.commit` is the empty string or a placeholder sentinel, the fetcher exits successfully as a no-op. This is what keeps `bun install` green in the prep PRs that land the fetch script before the real snapshot repos exist.
3. **Already-have-this-commit check.** The fetcher looks for a sentinel file at `.generated/<destDir>/.git-snapshot-state.json` containing `{ commit, manifestHash, fetchedAt }`. If both `commit` and `manifestHash` match the lock file, the fetcher exits successfully as a no-op. This is what makes the fetch reliably idempotent across repeated invocations (CI, postinstall, manual runs). Without a sentinel, the fetcher has no way to know "nothing changed"; with one, it can trust its previous work.
4. **Fetch.** Clean-slate the destination directory, then `git archive --remote` (or shallow clone + extract) into `.generated/<destDir>/`.
5. **Verify manifest hash.** Read the fetched manifest file, sha256 it, compare to `lockFile.manifestHash`. Fail loud on mismatch.
6. **Verify tree hash.** Recompute the manifest's `treeHash` field (see §5.2) by walking `.generated/<destDir>/`, sha256-ing each file, producing a canonical sorted listing, and hashing the listing. Compare to `manifest.treeHash`. Fail loud on mismatch. **This is what protects every fetched file, not just the manifest.** Manifest-hash-only integrity is insufficient — a corrupted or partially-replaced file anywhere else in the tree would slip through.
7. **Write the sentinel.** On successful verification, write `.generated/<destDir>/.git-snapshot-state.json` with the commit, manifest hash, and timestamp. This arms the already-have-this-commit check for the next run.
8. **Fail loud, don't partial-fetch.** On any error during steps 4–6, delete the destination directory entirely and exit with a typed `FetchError`. No half-populated `.generated/` trees.

Two thin wrappers hard-code the lock-file path and destination:

- `scripts/fetch-ingest-artifacts.ts` → `ingest-artifacts.lock.json` → `.generated/cold-start/`
- `scripts/fetch-ontology-snapshot.ts` → `ontology-snapshot.lock.json` → `.generated/ontology/`

### 5.2 Manifest schema (`src/platform/Manifest.ts`)

Discriminated union on a shared base. The `treeHash` field is the sha256 of a canonical sorted listing of every file in the snapshot plus each file's own sha256. It is computed at publish time by the `publish-snapshot.sh` wrapper (for ontology) and the ingest adapter writer (for ingest artifacts), and re-verified at fetch time by `fetch-git-snapshot.ts`. This is what lets the fetcher detect damage to any file in the tree, not just the manifest.

```ts
const Base = Schema.Struct({
  manifestVersion: Schema.Literal(1),
  generatedAt: Schema.String,
  sourceCommit: Schema.String,
  inputHash: Schema.String,
  treeHash: Schema.String  // sha256 of the canonical tree listing, re-verified on fetch
});

const IngestArtifactsManifest = Schema.extend(Base, Schema.Struct({
  kind: Schema.Literal("ingest-artifacts"),
  counts: Schema.Record(Schema.String, Schema.Number)
}));

const OntologySnapshotManifest = Schema.extend(Base, Schema.Struct({
  kind: Schema.Literal("ontology-snapshot"),
  ontologyIri: Schema.String,
  ontologyVersion: Schema.String,
  tripleCount: Schema.Number
}));

export const Manifest = Schema.Union(
  IngestArtifactsManifest,
  OntologySnapshotManifest
);
```

This parallels the existing `references/data-layer-spine/manifest.json` pattern — formalize as schema rather than leaving it as an ad-hoc JSON convention.

### 5.3 Lock-file schema (`src/platform/LockFile.ts`)

```ts
export const LockFile = Schema.Struct({
  repo: Schema.String,           // "github.com/org/repo"
  ref: Schema.String,            // tag or branch (human-readable)
  commit: Schema.String,         // 40-char SHA (authoritative)
  manifestHash: Schema.String,   // sha256 of manifest.json
  snapshotPath: Schema.optionalKey(Schema.String)  // path within the repo, for the ontology case
});
```

## 6. Versioning model

### 6.1 Pins

A pin is a lock file. It contains four fields the build system needs to find and verify a specific snapshot version:

- `repo` — where to fetch from
- `ref` — human-readable name (tag or branch), for PR legibility
- `commit` — the 40-character SHA, **authoritative**
- `manifestHash` — sha256 of the manifest inside the snapshot, for post-fetch integrity

The lock file is committed to `skygest-cloudflare`. **Bumping a pin is a one-line PR** — the only line that changes is the commit SHA (and the ref, and the hash). That's the review surface.

### 6.2 Tag conventions

- **Ontology snapshots:** semver. `ontology-v0.3.0`, `ontology-v0.3.1`. The ontology has explicit version semantics owned by `ontology_skill`, so the tag matches the ontology version.
- **Ingest artifacts:** date + sequence. `v2026.04.14`, `v2026.04.14.1` for multiple publishes on the same day. No semver — ingest artifacts are content snapshots, not schema versions.

### 6.3 Integrity

Every fetch re-verifies the manifest hash. If the lock file says `manifestHash: abc123` and the fetched manifest hashes to `def456`, the fetch fails loud. This protects against:

- A force-push that rewrites a tag's target commit
- A repo rename or redirect that silently points at different content
- Local disk corruption of the `.generated/` cache
- A transient fetch error that leaves `.generated/` half-populated

### 6.4 Reproducibility

Given any lock file commit, running the fetch script produces identical `.generated/` contents. This is the reproducibility guarantee:

- Production deploy logs record the lock file's commit SHA
- A developer can check out that commit, run the fetch, and reproduce the exact build input
- Rolling back is a revert of the lock file PR — no coordinated multi-repo changes

## 7. Imperatives — MUST-hold invariants

These are non-negotiable. Every change to the git-backed snapshot system should be checked against this list.

1. **`.generated/` is never committed.** Gitignored. Regenerated at build time only.
2. **Pins are authoritative.** The commit SHA in a lock file is the source of truth. Tags are informational — if a tag moves, the commit SHA pins you to the old target.
3. **Fetch is idempotent.** Two successive runs with the same lock file produce identical `.generated/` contents and perform no destructive operations. Idempotency is enforced by the sentinel file `.generated/<store>/.git-snapshot-state.json` — the fetcher trusts a prior successful fetch only when both the sentinel's commit and manifest hash match the current lock file.
4. **Manifest hash AND tree hash are verified every fetch.** Manifest-hash-only integrity is insufficient. The manifest's `treeHash` field is re-computed over every fetched file and checked. No "trust, don't verify" mode.
5. **Snapshots are immutable once published.** Once a tag is pushed, its contents never change. New content goes into a new snapshot directory under a new tag. This is what makes rollback and reproducibility safe.
6. **Manual trigger only.** No cron, no webhook, no bot that auto-advances a pin. Advancing a pin is always a human PR.
7. **One canonical loader path per consumer.** Don't fork the bootstrap between "in-repo" and "fetched" modes. Flip `COLD_START_ROOT`'s default to `.generated/cold-start` once in `src/platform/ConfigShapes.ts`; every consumer inherits. No per-consumer literal paths.
8. **The Worker bundle stays Node-free.** Snapshots are build-time inputs only. No `node:fs`, `node:path`, `node:child_process`, or `git` in any code reachable from `src/worker/` entry points.
9. **Runtime reads KV and D1, not snapshots.** Build-time code loads snapshots and seeds KV. Worker runtime only reads KV and D1.
10. **Codegen-driver manifests stay in-repo.** `references/data-layer-spine/manifest.json` is not part of the snapshot chain — it drives TypeScript codegen, which runs against source files, not against snapshot content.
11. **One domain-model source of truth.** Every entity type in the snapshot chain — ingestion writers, projection readers, registry loaders, search projectors — **must derive from the Effect Schemas in `src/domain/data-layer/`.** No parallel decoders, no inline `Schema.Struct` definitions for entity kinds, no divergent field lists between ingest and projection. The ontology is kept in sync with runtime types because both sides share exactly one schema module. Any time a new schema or decoder for `Agent` / `Dataset` / `Distribution` / etc. feels tempting, stop and extend the domain module instead. This is what keeps the snapshot data model tight.
12. **Placeholder-safe fetch.** The fetch script exits cleanly when the lock file's `commit` is empty or a sentinel. This is what keeps `bun install --frozen-lockfile` green in prep PRs that land fetch wiring before real snapshot repos exist.

## 8. Anti-patterns

These will bite anyone who tries them. Don't.

- **Mutating a published snapshot.** Delete a file, fix a typo, force-push the tag. The manifest hash drifts; every downstream pin gets silently corrupted. If a fix is needed, publish a new snapshot with a new tag.
- **Advancing a pin without a PR.** Even "just a minor bump, I'll fix CI" is off-limits. The PR is the audit trail for data changes.
- **Running Python or ROBOT in `skygest-cloudflare` CI.** The entire point of git-pinning the ontology is that `skygest-cloudflare` CI no longer depends on `ontology_skill`'s toolchain.
- **Creating a per-snapshot runtime dependency.** If you find yourself writing "the Worker imports from `packages/ontology-store`" — stop. That's the wrong shape. Go through KV.
- **Reading from both `references/cold-start/` and `.generated/cold-start/` in the same code path.** One of them is dead. Delete the old path when the new one lands.
- **Using `git filter-repo` on the initial import of `references/cold-start/`.** Overkill for non-sensitive JSON; slows review; risks silent data loss. Single import commit with the tree copied verbatim.

## 9. Migration plan

Staged across SKY-364 (prep) and three-or-four PRs per store.

### 9.1 SKY-364 — shared infrastructure (one PR)

- Add `scripts/fetch-git-snapshot.ts`
- Add `src/platform/Manifest.ts` and `src/platform/LockFile.ts`
- Add `.generated/` to `.gitignore`
- Add smoke test verifying fetch idempotency against a dummy fixture

No new repos, no consumer changes. Fully reviewable in isolation.

### 9.2 SKY-361 — ingest artifacts (three PRs)

**PR A** (in `skygest-cloudflare`): add `scripts/fetch-ingest-artifacts.ts` (thin wrapper) + `ingest-artifacts.lock.json` with **an empty-commit placeholder** (`{"repo": "...", "ref": "", "commit": "", "manifestHash": "", "treeHash": ""}`). The fetch script short-circuits on this per imperative #12. **No `postinstall` hook yet, no CI invocation yet, no consumer change** — just the fetch machinery sitting dormant in the tree. `COLD_START_ROOT` still defaults to `"references/cold-start"`. This PR is reviewable in isolation and must not break `bun install --frozen-lockfile`.

**PR B** (in the new `skygest-ingest-artifacts` repo): `git init`, single import commit with the full `references/cold-start/` tree copied verbatim into the strict `catalog/`, `variables/`, `series/`, etc. layout from §4.1. Write `manifest.json` with a computed `treeHash` over every file. Tag `v2026.04.14-import`. **No `git filter-repo` rewrite** — single import commit.

**PR C** (in `skygest-cloudflare` — the cutover): flip `COLD_START_ROOT`'s default in `src/platform/ConfigShapes.ts` from `"references/cold-start"` to `".generated/cold-start"`. Update `ingest-artifacts.lock.json` to point at the import tag. Wire the fetch script into `postinstall` + the CI `sync-data-layer` step + the deploy workflow. Audit every cold-start consumer listed in §4.1 to confirm they read from `ColdStartCommonKeys.rootDir` rather than a hardcoded literal; fix any outliers. Delete `references/cold-start/`. CI proves every entity still loads via the fetched tree.

### 9.3 SKY-362 — ontology snapshots (four PRs)

**PR A** (in `skygest-cloudflare`): add `scripts/fetch-ontology-snapshot.ts` (thin wrapper) + `ontology-snapshot.lock.json` with an empty-commit placeholder + `"workspaces": ["packages/*"]` in `package.json` + an empty `packages/ontology-store/` stub package. **No `postinstall` hook, no CI invocation, no consumers.** Same `bun install` safety bar as SKY-361 PR A.

**PR B** (in `ontology_skill`): add `publish-snapshot.sh` wrapper. Computes `treeHash` at publish time.

**PR C** (in the new `skygest-ontology-snapshots` repo): initial snapshot directory (`snapshots/0.3.0/`) with TTL + N-Triples + flattened `classes.json` + `properties.json` + manifest (including `treeHash`). Tag `ontology-v0.3.0`.

**PR D** (in `skygest-cloudflare` — the cutover): implement `packages/ontology-store/`'s loader + typed read API. Update `ontology-snapshot.lock.json` to point at `ontology-v0.3.0`. Wire the fetch script into `postinstall` + CI + deploy. The `build:ontology-snapshot` and `seed:ontology-kv` scripts **may or may not** be rewired to consume the new package — see §4.4 for the framing. Recommended: leave them alone in this ticket (they produce the legacy `energy-snapshot.json` / `publications-seed.json` for the legacy catalog path, which is deprecated-in-place). Any rewiring happens in a separate future ticket once a real consumer for the new chain exists.

## 10. What's deliberately excluded

Capture these here so they don't leak into the implementation.

- **Automated snapshot publishing.** No cron, no GitHub Action rebuilding on merge. Manual only.
- **A per-project `packages/git-snapshot-resolver/` package.** Two call sites don't justify it. Revisit on a third consumer.
- **Moving `references/vocabulary/*.json` into the snapshot chain.** That's the hot vocabulary loop, served by a separate sync path from `ontology_skill`. May converge later.
- **Runtime triple-store / SPARQL endpoint in the Worker.** Explicitly dropped.
- **Per-source directory nesting in `skygest-ingest-artifacts`.** Flat layout. Per-source lineage goes inside each JSON blob.
- **Multi-version co-existence in `.generated/`.** One pin, one version, at a time. No A/B testing at the snapshot layer.
- **OEO or ontology schema work of any kind.** Tracked under SKY-348; off-limits here.
- **Hoisting the existing worker into `packages/worker/`.** The minimal monorepo leaves the worker at repo root. Revisit only if a third package justifies it.
- **RDF export of resolved bundles or data-layer entities.** Earlier `2026-04-14-unified-triple-store-export-design.md` proposed a two-way flow; this spec narrows to one-way ingest of ontology + catalog artifacts. The export arm is deferred until resolution is proven and stable.

## 11. Open questions

Non-blocking for the spec. These become implementation decisions during SKY-364 / 361 / 362.

1. **Fetch mechanism details.** `git archive --remote` vs shallow clone + extract. `git archive` is lighter but requires the remote to enable `uploadArchive`. Shallow clone is more robust. Pick during SKY-364.
2. **Authentication for private repos.** CI needs read access to two new private repos. Options: PAT in a secret, a GitHub App, or GitHub deploy keys. Likely PAT for speed; implementation-time decision.
3. **Local dev ergonomics when `.generated/` is stale.** If a developer switches branches and the new branch has a different lock file, should the fetch run at checkout time (git hook), on next `bun install`, or lazily on first consumer call? Probably on next `bun install` — simplest.
4. **Eventual convergence of `references/vocabulary/*.json` into the snapshot chain.** Not in scope now. Worth watching as the vocabulary grows.
5. **Binary content in snapshots.** All current content is text (JSON, TTL, N-Triples). If binary ever enters (e.g., pre-built SQLite for a resolver index), the manifest hash still works but review surface degrades. Budget for it.

## 12. Related

### Tickets

- **SKY-213** — parent epic: Data Intelligence Layer
- **SKY-343** — Bundle resolution flow (direct consumer of `.generated/cold-start/`)
- **SKY-348** — OEO binding (future consumer of `packages/ontology-store/`)
- **SKY-361** — Stand up hashable ingest-artifacts store
- **SKY-362** — Ontology triple store package in monorepo
- **SKY-363** — Resolution job queue (separate infra, not in this spec)
- **SKY-364** — Shared git-snapshot fetch infrastructure

### Prior docs

- `docs/plans/2026-04-14-unified-triple-store-export-design.md` — earlier brainstorm; **partially superseded by this spec.** This spec is narrower (no RDF export, just snapshot ingestion).
- `docs/plans/2026-04-14-graph-centralization-survey.md` — graph unification; landed in SKY-356.
- `docs/architecture/skygest-resolution-improvement-plan.md` — higher-level strategic blueprint.
- `ontology_skill/ontologies/skygest-energy-vocab/scripts/build.py` — the existing ontology build script that `publish-snapshot.sh` wraps.

### Existing infrastructure to extend (not reinvent)

- `src/bootstrap/CheckedInDataLayerRegistry.ts` — single-line path flip for the ingest consumer
- `scripts/sync-data-layer.ts`, `scripts/rebuild-search-db.ts` — downstream consumers with existing `--root` flags
- `references/data-layer-spine/manifest.json` — shape precedent for the manifest schema
- `build:ontology-snapshot`, `seed:ontology-kv` `package.json` scripts — downstream consumers for `.generated/ontology/`
