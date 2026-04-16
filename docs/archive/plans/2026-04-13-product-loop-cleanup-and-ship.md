# Product Loop: Cleanup and Ship

Date: 2026-04-13
Status: Draft — strategy lock, pre-implementation
Owner: mepuka

## Why this doc exists

The resolver runtime shipped on 2026-04-12. `stage1 + kernel` now writes `post_enrichments(kind='data-ref-resolution')` rows on every enriched post. The architecture family (`docs/architecture/product-alignment.md`, `system-context.md`, `seams.md`) records that change and prescribes two tracks: editorial surfaces first, kernel quality second.

The backlog since then has done the opposite. Every landed ticket in the last month (SKY-317, SKY-320, SKY-321, SKY-322, SKY-323, SKY-331) is kernel-quality or data-layer infra. Every open ticket in flight (SKY-326, SKY-328, SKY-332, SKY-239) is more of the same. The editorial surface tickets named in the architecture doc (SKY-241, SKY-242, SKY-243, SKY-244) have no in-flight work, no plan doc, and no stubs.

The resolver is writing rows nothing reads. The ontology is not yet earning its keep because the surfaces that would expose it to an operator, editor, or model do not exist. This plan reverses the drift and sequences the work that turns the shipped resolver into the expert-data-linking utility the product was designed around.

## The product loop

The ontology exists to support one concrete loop:

1. **Resolve.** Every enriched post runs through `stage1 + kernel` and gets a `ResolutionOutcome[]` with bound variable / series / dataset / agent IDs. Shipped, running on every post.
2. **Look up.** Given a hint — a URL, an alias, a human-readable name — return the typed registry entity with its facets, aliases, and agent. Not shipped. Blocks ad-hoc inspection by operator or model (M1).
3. **Join back.** Given a variable / series / dataset ID, return every other post whose resolution outcomes contain it. Not shipped. Blocks the cross-expert join (E2, M2) — the feature that turns individual resolutions into a shared index of what experts are saying about the same underlying data.

Steps 2 and 3 are the ontology payoff. Without them, step 1 is a diagnostic loop against its own eval harness. With them, the Blake Shaffer hydro thread cited in the product memory becomes "Blake Shaffer says X about hydro generation; here are four other experts discussing this exact dataset."

## Scope reframe

This plan treats the 20-row eval gold set as a diagnostic instrument, not a product target. Moving it from 0/20 Resolved to 5/20 Resolved is real work but does not ship anything a user experiences until steps 2 and 3 exist. Kernel quality work is therefore bounded here: one defensible algorithmic fix (SKY-326), nothing more, until the editorial surfaces land and operator use produces evidence for what to fix next.

Vocabulary growth, unit-family inference, publisher adapters, and a runtime Stage 2 decomposition are parked explicitly. The architecture doc already rejected a revived runtime Stage 3; this plan extends that rejection to speculative Stage 2 infrastructure that would ship ahead of operator demand.

## Phases

### Phase 0 — Cleanup audit and deletion (1–2 days)

Run a read-only inventory of dead and duplicative code across `src/`, `tests/`, `eval/`, and `references/`. Delete what the audit confirms dead. Rename or relocate what is live but mis-located. The point is not to shrink the repo for its own sake — it is to narrow the surface area of what can regress before we start adding new surfaces.

The audit runs in parallel with this doc; its findings will be appended as an inline update. Targets include:

- `Stage1.ts` vs `Stage1Resolver.ts` duplication in `src/resolution/` — trace which is the live path.
- `src/ontology/` modules not imported by any Worker entry point (`src/worker/filter.ts`, `src/worker/feed.ts`, `src/resolver-worker/index.ts`).
- Legacy `post_enrichments` kinds in `src/domain/enrichment.ts` that predate `data-ref-resolution`.
- Unused exports across `src/resolution/` and `src/resolver/`.
- Stale eval sub-paths in `eval/` that reference deleted runtime stages.
- `@deprecated`, `TODO remove`, `LEGACY`, `XXX` markers.
- Plan docs in `docs/plans/` dated before 2026-03-01 that describe pre-cutover architecture.
- The untracked `skygest-cloudflare/` directory at the repo root — confirm whether it is a nested worktree, an accidental copy, or real work in progress.

**Out of bounds for Phase 0.** Do not touch `facetVocabulary/` (confirmed live), the eval harness (confirmed seam), the checked-in cold-start registry (confirmed audited source), or the registry diagnostic validation path in `dataLayerRegistry.ts` (load-time-only, earns its keep).

**Acceptance.** A single cleanup PR lands with a before/after line count, the deletion list, the rename list, and a one-sentence justification per item. `bun run typecheck` and `bun run test` stay green.

#### Phase 0 audit findings (2026-04-13)

The read-only audit ran and produced a tighter inventory than expected. The project is not meaningfully bloated with dead code. The real drift is in *effort allocation*, not in the source tree. Cleanup is small; the weight of this plan shifts decisively to Phase 1.

**Safe deletions (HIGH confidence).**

| Item | File | Lines | Why dead |
|---|---|---|---|
| `PromptsLayer` deprecated alias | `src/mcp/prompts.ts:275-276` | 2 | `@deprecated` marker, zero importers across `src/`, `tests/`, `eval/`. |
| `PostUriPathParams` deprecated alias | `src/domain/api.ts:591-593` | 3 | `@deprecated` marker, zero importers. |

Total: **5 lines**. These land as a single trivial commit.

**Archive (not delete).**

Four plan docs from January 2026 predate the resolver cutover and describe architecture that no longer matches `main`. Move to `docs/archive/plans/`, add a banner linking to the current architecture family:

- `docs/plans/2026-01-20-skygest-agentic-personalization-design.md`
- `docs/plans/2026-01-20-skygest-effect-native-design.md`
- `docs/plans/2026-01-21-jetstream-ingestor-supervisor-logging-design.md`
- `docs/plans/2026-01-24-skygest-saas-architecture-research.md`

Leave the SKY-239 Stage 2 decomposition design doc in place with a frontmatter banner linking here; do not archive it, because the ticket is parked rather than cancelled.

**Things suspected, confirmed live.**

The audit cleared every other cleanup suspicion. These are now explicitly load-bearing and out of bounds for Phase 0:

| Suspected | Verdict | Evidence |
|---|---|---|
| `Stage1.ts` vs `Stage1Resolver.ts` duplication | **No duplication.** Stage1Resolver is a 41-line Effect service wrapper around `runStage1` in the 757-line Stage1. Clean separation of boundary from logic. | Both imported, both on the live call path through ResolverService. |
| `src/ontology/buildSnapshot.ts` + `canonical.ts` (1,250L combined) | **KEEP.** Load-bearing via the KV seed chain: `buildSnapshot.ts` → `config/ontology/energy-snapshot.json` → `seed-ontology-kv.ts` → `ONTOLOGY_KV` → runtime reads. | `buildSnapshot.ts` last touched 2 days ago; snapshot JSON last touched 13 days ago. Both warm. |
| Legacy `post_enrichments` kinds | **None dead.** `vision`, `source-attribution`, `grounding`, `data-ref-resolution` are all live. | `src/domain/enrichment.ts:55` union members all referenced. |
| `src/source/` provider registry | **All live**, just frozen for new providers. Not deleted, not a cleanup target. | Every file imported by the source-attribution executor. |
| Unused exports across `src/resolution/` and `src/resolver/` | **None found.** All public exports are imported by workers, services, or Layer wiring. | Systematic export trace across both modules. |
| Stale eval sub-paths | **None.** Every eval sub-directory was touched within the last 11 days. The "deferred-to-stage2" bucket label in `eval/resolution-stage1/shared.ts` is a historical test category, not a runtime reference. | `git log` per sub-directory. |
| Dead test files | **None.** No `.skip.ts`, `.disabled`, or orphaned test files. | Glob + import trace across `tests/`. |
| `references/` and generated files | **All live.** Vocabulary JSONs feed `facetVocabulary`, cold-start JSONs feed the data-layer registry, generated profiles feed partial-variable algebra. | Each traced to a runtime importer. |
| Untracked `skygest-cloudflare/` directory at repo root | Active git worktree, not an accidental copy. | Confirmed alongside `.worktrees/sky-239-*` and `.worktrees/sky-303-*`. |

**The diagnosis.**

The source tree is already clean. The project is not overengineered in the code; it is misaligned in the backlog. Phase 0 is therefore tiny — a 5-line deletion plus a plan-doc archive pass — and the strategic question the user raised ("are we yak-shaving?") is answered "yes, but the yak-shaving is in what we are *building next*, not in what we have already built." Phase 1 is where this plan earns its keep.

### Phase 1 — Ship the data-linking surface

Two MCP tools and one smoke test. Nothing else.

#### 1a. `resolve_data_ref` (SKY-241)

**Input.** A hint: URL, alias string with optional scheme, variable slug, dataset slug, or series ID.
**Output.** A typed discriminated union: `{ kind: 'variable' | 'dataset' | 'series' | 'agent', entity: <typed schema>, matchedVia: <alias scheme | title | url | id> }` or a typed `NotFound` with nearest candidates.

**Implementation.** One MCP tool in `src/mcp/Toolkit.ts`. All indices already exist on `PreparedDataLayerRegistry`:

- `variableByAlias: Map<[scheme, value], Variable>`
- `datasetByAlias: Map<[scheme, value], Dataset>`
- `distributionByUrl`, `distributionsByHostname`, `distributionUrlPrefixEntries`
- `agentByLabel`

The tool is wiring, not new logic. Use existing normalization helpers; do not add a second normalization path.

**Acceptance.** Given the canonical Blake Shaffer hydro thread's source URL, the tool returns the Ember dataset entity with the expert's agent attached. Given the alias `eia:ELEC.GEN.WND-US-99.M`, it returns the wind-electricity-generation variable. Given gibberish, it returns `NotFound` with the three nearest fuzzy candidates.

#### 1b. `find_candidates_by_data_ref` (SKY-244)

**Input.** A variable ID, dataset ID, or series ID.
**Output.** `{ post: KnowledgePost, outcome: ResolutionOutcome, expert: Agent }[]` — every post whose `data-ref-resolution` row contains a `Resolved` (or optionally `Ambiguous`) outcome binding the requested entity.

**Implementation.** A D1 JSON-path query against `post_enrichments` filtered by `kind = 'data-ref-resolution'`, joined to `posts` and `experts`. D1 supports JSON path expressions; the query extracts `payload.kernel[*].variableIds` and filters. Wire behind a new repo method in `src/services/d1/` and a new tool in `src/mcp/Toolkit.ts`.

**Acceptance.** Given the wind-electricity-generation variable ID, returns a list of posts (count dependent on current ingest state), each with its resolution outcome and expert. Given a variable ID with zero resolved citations, returns an empty list, not an error. The tool is called from a smoke test and from a one-off operator script that iterates the top twenty variables by citation count and prints the join density.

#### 1c. End-to-end smoke test

Run the Blake Shaffer hydro thread (canonical example in user memory) through the full pipeline in staging: ingest → vision → source-attribution → resolver → stored row → `get_post_enrichments` → `resolve_data_ref` → `find_candidates_by_data_ref`. Output: a short markdown note at `docs/smoke/2026-04-XX-blake-shaffer-hydro.md` documenting what worked, what the kernel returned, which joins fired, and every friction point. This note becomes the real backlog driver for Phase 2.

**Phase 1 acceptance.** Both tools land, the smoke test runs, the markdown note is written. Gold eval numbers are observed but not gated against.

### Phase 2 — Land SKY-326, freeze the rest of kernel-tuning

**Land SKY-326** (soft scoring in Bind) as the single kernel-quality lever. The ticket is already scoped; the soft-scoring change increases the number of `Resolved` outcomes, which directly increases join density in Phase 1's `find_candidates_by_data_ref`. It is the one Track 2 ticket whose benefit survives the reframe.

**Freeze** SKY-239, SKY-328, SKY-331 follow-on vocabulary expansions, and SKY-332. Do not close them; mark them blocked on "operator demand from Phase 1 smoke loop." They come back if and only if Phase 1 surface use demonstrates the specific gap they target.

**Acceptance.** SKY-326 lands. The eval harness shows ≥5 of 20 rows flipping to Resolved per the ticket's own acceptance criteria. No other kernel-tuning work in flight.

### Phase 3 — Editorial surface projection (cross-repo)

Lives in `skygest-editorial`. Prerequisite: Phase 1 tools exist.

- **SKY-242.** `hydrate-story` calls `resolve_data_ref` during story projection and writes `dataRefs` into story frontmatter. The editor sees resolver output on disk, not just through MCP.
- **SKY-243.** `build-graph` warns on unresolved refs in story frontmatter. Fail-loud editorial guardrail.

These are out of scope for this plan to implement directly, but are named so the sequencing is explicit: they unblock when Phase 1 is green.

## What gets parked and why

| Item | Reason | Unpark condition |
|---|---|---|
| SKY-239 Stage 2 facet decomposition | Designed against a "Stage 2" shape the architecture family deleted. Vocabulary growth already happens inside Interpret. A separate decomposition stage is speculative until operator use shows the existing Interpret surface fails in a specific, repeatable way. | Phase 1 smoke loop produces ≥3 distinct operator-flagged cases where Interpret's vocabulary-fed facet parsing misses something the operator considers obvious. |
| SKY-328 unit-family → statisticType inference | Targets one eval row (020) in isolation. Benefit is illegible until the join tools exist and show whether the row matters to a real operator. | Phase 1 surface use produces a case where an unresolved intensity-unit chart blocks a cross-expert join the operator wanted. |
| SKY-331 vocabulary follow-ons | German + intensity + compound vocab already landed. Further expansion is eval-driven, not operator-driven. | Phase 1 smoke loop or operator review of stored rows surfaces a specific surface form that the current vocabulary cannot parse. |
| SKY-332 NESO publisher adapter | Specific to two eval rows. Real publisher coverage should track ingest pressure, not gold-set pressure. | Ingest data shows NESO posts arriving in volume and the missing publisher narrowing blocks a real join. |
| Runtime Stage 3 / LLM lane | Architecture doc explicitly rejects. Keep it rejected. | None in this cycle. Re-evaluate only after Phase 3 lands and the full editorial loop is running. |
| Further `references/vocabulary/` growth | See SKY-331 row. Freeze at current state. | Same trigger as SKY-331 row. |

## Risks

1. **Phase 0 misses a live dependency.** The audit is read-only, but deletions in Phase 0 could break something subtle. Mitigation: the cleanup PR runs `bun run typecheck` and `bun run test` before merging, and any deletion that looks ambiguous goes in the INVESTIGATE bucket rather than the DELETE bucket.
2. **Phase 1 join density is low because kernel accuracy is genuinely insufficient.** If `find_candidates_by_data_ref` returns mostly empty lists on the current corpus, Phase 1 feels dead and we will be tempted back into kernel-tuning. Counter-argument: empty joins are themselves evidence. They tell us which specific variables have zero citations because of resolver misses versus zero citations because the corpus does not mention them. That is more actionable than 0/20 on an eval gold set.
3. **D1 JSON-path performance on `post_enrichments`.** The cross-expert join query depends on D1's JSON extraction. At current row counts (low thousands) this is fine. At higher counts it may need an index-friendly denormalized table. Mitigation: write the query first, measure, denormalize only if needed.
4. **SKY-326 soft scoring regresses something.** The ticket changes a hard filter to a soft score. Mitigation: existing unit tests are updated with new scoring expectations, and the eval harness run is compared row-by-row before landing.
5. **Phase 3 is stuck behind the editorial repo's pace.** `SKY-242` and `SKY-243` live in `skygest-editorial` and cannot be forced from here. Accepted. Phase 3 is named but not gated against.

## Success criteria

1. Phase 0 ships a cleanup PR with a measurable line-count delta and zero test regressions.
2. Phase 1 ships both MCP tools, both acceptance tests pass, and the Blake Shaffer smoke note is written and committed.
3. Phase 2 lands SKY-326 with the ticket's existing acceptance criteria met.
4. No new kernel-tuning work begins outside Phase 2 during this cycle.
5. The backlog tickets parked in the table above are explicitly labeled "blocked on operator demand from Phase 1 smoke loop" in Linear.

## Open questions

1. Does `find_candidates_by_data_ref` return only `Resolved` outcomes, or also `Ambiguous` ones with a flag? The operator may want to see near-misses. Defer to Phase 1 implementation; lean toward returning both with a status discriminator.
2. Is there a reason Track 1 stalled that is not visible from code and tickets — a cross-repo pacing issue, an unstated blocker on the editorial side, or something about how the work feels to do? The answer shapes whether Phase 3 sequencing stays aspirational or becomes concrete.
3. Should the cleanup PR delete the parked plan docs (`docs/plans/2026-04-11-sky-239-stage-2-facet-decomposition-design-interview.md`) or leave them as frozen history? Lean toward leaving them and adding a banner at the top linking to this doc.

## References

- `docs/architecture/product-alignment.md` — the two-track prescription this plan executes.
- `docs/architecture/system-context.md` — the shipped runtime map.
- `docs/architecture/seams.md` — the seam inventory, notably the planned MCP seams.
- `src/domain/enrichment.ts:278` — `DataRefResolutionEnrichment` row shape, which Phase 1b queries against.
- `src/resolution/dataLayerRegistry.ts` — the registry indices Phase 1a wraps.
- `docs/plans/2026-04-13-sky-317-series-dataset-backfill.md` — recent Track 2 work whose benefits this plan locks in rather than extends.
