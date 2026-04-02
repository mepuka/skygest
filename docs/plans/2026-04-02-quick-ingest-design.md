# Quick-Ingest: URL to Curated Post in One Step

**Goal:** Let the operator paste a tweet or Bluesky post URL and have it imported, curated, and enrichment-started in a single action.

**Motivation:** The operator is the editorial eye. When they see a high-value post while browsing Twitter or Bluesky, their act of submitting it IS the curation decision. The current multi-step flow (import -> flag -> evaluate -> curate -> start enrichment) adds friction for posts the operator has already evaluated visually.

---

## Architecture

**CLI-first.** The `ops ingest-url <url>` command handles both platforms locally, calling existing remote endpoints via `StagingOperatorClient`. No cross-platform MCP tool -- the Worker cannot fetch Twitter (CycleTLS requires native binaries that V8 isolates don't support). If MCP convenience is needed later, add a Bluesky-only tool separately.

**Compose, don't duplicate.** The command chains two existing endpoints: `POST /admin/import/posts` (import + flag) then `POST /admin/curation/curate` (curate + auto-enrich). No new service abstraction needed.

**Enrichment is not a separate step.** `curatePost` already queues enrichment internally via `queuePickedEnrichment` for both Twitter (`CurationService.ts:231`) and Bluesky (`CurationService.ts:294`). The `start_enrichment` MCP tool stays as a manual retry/override tool only.

---

## Supported URL Formats

- `https://bsky.app/profile/<handle>/post/<rkey>` -> Bluesky
- `https://x.com/<handle>/status/<id>` -> Twitter
- `https://twitter.com/<handle>/status/<id>` -> Twitter

---

## CLI Command: `ops ingest-url <url>`

```bash
bun src/scripts/ops.ts -- ingest-url "https://bsky.app/profile/drsimevans.bsky.social/post/3abc" --base-url "$SKYGEST_STAGING_BASE_URL"
```

**Pipeline:**

1. **Parse URL** -- detect platform, extract handle + post ID
2. **Fetch post locally** -- Twitter: CycleTLS scraper via `scraperLayer`. Bluesky: `BlueskyClient` against public API, scoped via `Effect.provide(blueskyCliLayer)` to avoid HttpClient conflicts.
3. **Normalize** -- Convert to `ImportPostInput` + `ImportExpertInput`. Capture embed payload at this stage so `curatePost` doesn't need to re-fetch the thread.
4. **Import** -- Call `StagingOperatorClient.importPosts()` with `operatorOverride: true`. This imports the post even if topic matching yields zero matches.
5. **Curate** -- Call `StagingOperatorClient.curatePost(action: "curate")`. Enrichment starts automatically inside `curatePost`.
6. **Report** -- Print whether post was newly imported or already existed, curation state change, and enrichment status.

**Options:**
- `--tier <tier>` -- Expert tier if new (default: `energy-focused`). Existing experts keep their current tier via `mergeImportedExpertRecord`.
- `--note <text>` -- Optional curation note.
- `--base-url <url>` -- Staging worker URL.

---

## Key Design Decisions

### No cross-platform MCP tool

The Worker runs on V8 isolates -- no filesystem, no child processes, no CycleTLS. Twitter scraping requires TLS fingerprinting that only works locally. Research confirmed:
- Plain `fetch()` from Workers with cookies: blocked by JA3 fingerprinting
- Twitter API v2: works but costs money (rejected -- not funding X)
- Browser Rendering: fragile, over-engineered for single-tweet lookup

### Explicit topic gate bypass

The current import endpoint skips posts with zero topic matches (`Router.ts:460`). This is correct for bulk `import-timeline`. For operator-submitted URLs, the operator has already judged relevance.

Solution: add `operatorOverride: boolean` to `ImportPostsInput`. Defaults to `false` -- batch import behavior unchanged. Only `ingest-url` sets it to `true`.

### Avoid double Bluesky fetch

The CLI captures embed payload during normalization (step 3). `curatePost` is updated to check for stored payloads before fetching the live thread -- if a payload exists from import, it uses that and skips the fetch. Mirrors the existing Twitter path (`CurationService.ts:214-235`).

### Expert merge, not overwrite

The CLI calls the existing `importPosts` endpoint, which uses `mergeImportedExpertRecord` (`Router.ts:431`). Preserves existing expert data (tier, activation, editorial flag). Only fills gaps for new experts.

### Permission model

The CLI uses `StagingOperatorClient` which authenticates with the operator bearer token at `ops:refresh` scope. This is the same auth path as `import-tweet` and `import-timeline`. No MCP permission boundary changes needed.

---

## Error Handling

- **URL doesn't match known formats** -> clear error with supported formats
- **Twitter: tweet not found by scraper** -> report and exit
- **Bluesky: post not found** -> BlueskyApiError surfaced
- **Topic matching yields zero topics** -> still imported (`operatorOverride`)
- **Expert already exists** -> merged, existing data preserved
- **Post already imported** -> skipped import, proceeds to curate
- **Post already curated** -> idempotent, reports "no change"
- **Enrichment already running** -> reports current status

---

## What This Does NOT Do

- No MCP tool (Bluesky-only MCP tool is a follow-up if needed)
- No web share page or admin ingest-url endpoint (YAGNI)
- No `additionalTopics` AI-assisted topic flow (belongs on a future MCP tool)
- No change to default batch import behavior (`operatorOverride` must be explicitly set)
- No separate "start enrichment" step -- `curatePost` handles it

---

## Implementation Plan

See `docs/plans/2026-04-02-quick-ingest-plan.md` for the task-by-task implementation plan with exact code, tests, and commit points.
