# Product Alignment Matrix

This document maps Skygest's actor-facing experiences to the subsystems and seams they depend on. It is the bridge between product language and the Effect-flavored architecture documented in `system-context.md` (subsystem map), `resolution-trace.md` (one-post walkthrough), and `seams.md` (seam inventory + stability heat map). Section 1 is deliberately free of Effect vocabulary — features are described as the actor encounters them. Sections 2–4 cross back over into the architectural names when bridging.

## 1. Actors and their core experiences

### Reader

1. **R1 — Headline names the question.** Opens a published edition and encounters a story headline that frames the implicit question being debated, not a generic topic roundup. The Blake Shaffer hydro thread becomes "Is Canada's hydro buffer for US grid stability holding up?", not "Energy news: hydro".
2. **R2 — Chart with provenance.** Sees a chart pulled from a post, captioned with the expert who chose it, the original post URI, and the dataset provider underneath. No chart appears without its source.
3. **R3 — Expert-data-argument link.** Reads "Expert voices" and can follow, in the body copy, how a named expert's claim ties back to a specific variable, series, or distribution from a real data provider — not a hand-written attribution.
4. **R4 — Temporal grounding.** Sees a recency signal on each story that makes it obvious whether the debate is this week's news or a long-running arc, so downstream LLM consumers (and the reader) can reason about whether the take is current.

### Editor (Mepuka, voice-driven, via the Discussion Skill)

1. **E1 — Voice-drops into a hydrated story.** Says "open the Shaffer hydro pick" and lands inside a story scaffold that already carries the post, the expert, the provider attributions, and the data references — without hand-typing any of it.
2. **E2 — Cross-expert join on a dataset.** Mid-conversation, asks "who else has talked about this Ember series?" and the Skill answers in one tool call, returning candidate posts from other experts who cited the same underlying data reference.
3. **E3 — Curate without losing hand-edits.** Commits an editorial pick on a post, re-runs hydration against the same story, and the prior narrative body, arc link, and editor notes survive intact.
4. **E4 — Arc evolution against a novel frame.** When a story strains the existing narrative arc taxonomy, proposes a new arc shape and spawns it without leaving the voice loop.

### MCP-calling model (the LLM inside the Discussion Skill, and future agentic bundles)

1. **M1 — Resolve a single data ref.** Receives a candidate URI or dataset hint from the Editor's voice prompt and calls a single tool to get back a typed registry record (variable, series, distribution, dataset, agent) it can cite in-line.
2. **M2 — Cross-expert join as a tool.** Calls a join tool on a resolved data reference and gets back the set of posts (across experts) that cite the same underlying variable or series. This is the join that answers "do these experts agree on the number?"
3. **M3 — Typed residuals on partial resolution.** When resolution is partial, receives structured residuals naming what was ambiguous, rather than an opaque error string it has to parse.
4. **M4 — Rich post context in a single call.** Pulls vision output, source-attribution candidates, thread context, and editorial pick state for a post in one round-trip, so the response to the Editor doesn't stall on repeated tool calls.

### Operator

1. **O1 — Flip the resolver flag in staging.** Enables the data-ref resolver feature flag in staging, runs real posts through the existing cron sweep, inspects the resulting `data-ref-resolution` enrichments, and makes a production go/no-go decision.
2. **O2 — Single pipeline-health read.** Asks "is the pipeline healthy?" and gets back one aggregated status across ingest, enrichment, and resolution without stitching together five admin endpoints.
3. **O3 — Gap triage loop.** Lists posts with missing or failed enrichments, retries a batch, and sees the gaps close — all without manually opening D1.
4. **O4 — Deploy without breaking the editorial repo.** Ships a schema change to `src/domain/` and knows within one build-graph run whether `skygest-editorial` still typechecks against the new Schemas.

## 2. The matrix

Columns use the subsystem names from `system-context.md`. Cells: ✅ shipped and load-bearing, 🚧 in-progress blocker (with SKY ticket), 📋 planned blocker (with SKY ticket), ⚪ not required.

| # | Experience | Post Ingest | Vision Lane | Source-Attr Lane | Stage 1 Resolver | Data Layer Registry | Resolver Worker | Stage 2/3 Resolvers | data-ref-resolution Enrichment | MCP Surface | HTTP API | Editorial Caches | hydrate-story | Discussion Skill | Story Files | Build-graph Validator | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R2 | Chart with provenance | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R3 | Expert-data-argument link | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | ✅ | 🚧 |
| R4 | Temporal grounding | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| E1 | Voice-drops into hydrated story | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | ✅ | ⚪ |
| E2 | Cross-expert join on a dataset | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | 📋 SKY-241/244 | ⚪ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ⚪ |
| E3 | Curate without losing hand-edits | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ |
| E4 | Arc evolution against novel frame | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ |
| M1 | Resolve a single data ref | ⚪ | ⚪ | ⚪ | ✅ | ✅ | 📋 SKY-238 | ⚪ | ⚪ | 📋 SKY-241 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M2 | Cross-expert join as a tool | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | 📋 SKY-241/244 | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| M3 | Typed residuals on partial resolution | ⚪ | ⚪ | ⚪ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | 📋 SKY-241 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M4 | Rich post context in one call | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| O1 | Flip resolver flag in staging | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 SKY-238 | ⚪ | 📋 SKY-238 | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O2 | Single pipeline-health read | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O3 | Gap triage loop | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O4 | Deploy without breaking editorial | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ |

Assumption note: `Editorial Caches` is now the shipped `SKY-232` substrate. The remaining editorial-side guardrail is `SKY-243` (build-graph warnings over unresolved data-layer refs), which matters as a publish-time quality layer and is discussed below rather than getting its own column.

Two experiences — **E4 (arc evolution)** and **O4 (deploy without breaking editorial)** — have zero dependencies on the resolution column stack and on the write-side enrichment lanes. E4 runs entirely inside the Discussion Skill + Story Files + MCP read path. O4 runs inside the `@skygest/domain` bridge described in `system-context.md` and the `build-graph` validator. That's worth saying out loud: the voice-driven editorial loop and the cross-repo Schema contract are the two experiences that are already whole today.

## 3. Three analyses

### (a) Critical-path experiences: what SKY-238 alone unlocks

SKY-238 ships five things (per `resolution-trace.md` Stage 7 and `seams.md` row `RESOLVER` binding): the standalone `skygest-resolver` Worker, the `RESOLVER` Service Binding from both `skygest-bi-ingest` and `skygest-bi-agent`, the `data-ref-resolution` variant on the `post_enrichments` discriminated union, the `EnrichmentRunWorkflow` `step.do("call resolver service binding")` gated by `enableDataRefResolution`, and the `DataRefResolverWorkflow` stub. It builds on Stage 1 logic already shipped in `SKY-235`, the D1 registry already shipped in `SKY-237`, the editorial caches already shipped in `SKY-232`, and a materially stronger cold-start corpus from `SKY-254`, `SKY-257`, `SKY-261`, `SKY-265`, and `SKY-266` plus the staging snapshot loop from `SKY-248` / `SKY-249`. It does **not** ship `SKY-242` (`hydrate-story` `dataRefs:` block), `SKY-243` (build-graph data-layer warnings), Stage 2 (`SKY-239`), Stage 3 LLM body (`SKY-240`), or the resolver MCP tools (`SKY-241`, `SKY-244`).

The day SKY-238 ships in staging, the **only** experience fully unlocked is **O1 — Flip the resolver flag in staging**. The Operator can enable the flag, watch `data-ref-resolution` rows accumulate on `post_enrichments`, and decide on production. The existing MCP tool `get_post_enrichments` already surfaces the new enrichment variant by virtue of the discriminated union described in `seams.md` row 2 — the Operator reads the rows through a shipped seam.

**M2 (cross-expert join as a tool)** and **E2 (cross-expert join in voice)** both require the MCP lookup pair — `SKY-241` (`resolve_data_ref`) plus `SKY-244` (`find_candidates_by_data_ref`). They are **not** unlocked by SKY-238 alone — the `data-ref-resolution` rows will be present in D1, but the cross-expert join is not yet callable from the MCP Surface. An agent could in principle scan `post_enrichments` by hand, but the seam isn't exposed as a tool.

**R3 (expert-data-argument link)** and **E1 (voice-drops into hydrated story with data refs visible in frontmatter)** are blocked on a shorter chain than the earlier doc family assumed: `SKY-241` for direct lookup, then `SKY-242` for the `hydrate-story` `dataRefs:` block. The cache substrate is already done, so the remaining editorial-side quality layer is `SKY-243` — important before publish time, but not the transport blocker it would have been before `SKY-232` shipped.

So SKY-238 in isolation still unlocks exactly one experience (O1) and moves the ball on six others (R3, E1, E2, M1, M2, M3) without finishing any of them. The difference versus the March snapshot is that the storage, cache, and seed-data groundwork is now in place; the remaining blockers are mostly interface and hydration slices, not missing substrate.

### (b) MCP-calling model gap

The MCP-calling model has **M4 (rich post context in one call)** fully shipped today — `get_post_enrichments`, `get_post_thread`, `get_editorial_pick_bundle`, `search_posts` are all listed in the `seams.md` actor-exposure section and cover the Editor's mid-conversation context needs for shipped lanes.

But **M1 (resolve a single data ref)**, **M2 (cross-expert join as a tool)**, and **M3 (typed residuals on partial resolution)** are still blocked on the same missing pair: `SKY-241` (`resolve_data_ref`) and `SKY-244` (`find_candidates_by_data_ref`). The `seams.md` row for these tools is now explicitly ticketed, which is progress. The actor-exposure analysis already made the call: "Reads are wide, writes are reasonably wide. The gap is on the data-ref side … Acceptable for cand-284; thin for arbitrary mid-conversation lookups."

The honest judgment: the gap is no longer untracked; it is split cleanly into `SKY-241` and `SKY-244`. That is the right shape. But the product truth is unchanged: the moment the Resolver Worker ships rows into `post_enrichments`, those rows still stop at D1 until the MCP lookup surface lands. The single biggest remaining distance between "resolver exists" and "editor can use it in the voice loop" is still the missing tool pair.

### (c) Unjustified work

Scanning every column and every 📋 cell against the experiences in Section 1:

**Stage 2/3 Resolvers (SKY-239, SKY-240) — do not block any listed experience.** Stage 1 alone, per the gold file trace for cand-284 in `resolution-trace.md` Stage 4, already produces the four Ember matches (agent, dataset, distribution, variable) via `AgentHomepageEvidence`, `DatasetTitleEvidence`, `DistributionHostnameEvidence`, and `VariableAliasEvidence`. The residual on cand-284 is a single `DeferredToStage2Residual` covering the "25 years" temporal frame — which is not part of any experience in Section 1. R3 (expert-data-argument link), E1 (voice-drops into hydrated story), and E2 (cross-expert join) all resolve against direct-grain matches that Stage 1 produces. Stage 2 facet decomposition is a refinement, not an unblock. Stage 3 LLM reranking only fires on residuals that Stage 2 couldn't narrow — and none of the listed experiences depend on it. **Recommendation: defer `SKY-239` and `SKY-240` behind `SKY-241`, `SKY-242`, and `SKY-244`**. If cand-284-class posts resolve cleanly on Stage 1 alone, Stage 2/3 should wait until a real post produces an ambiguous residual that blocks a real editorial session.

**`find_candidates_by_data_ref` vs `resolve_data_ref` priority.** The split is now explicit in Linear, and that is fine; the key is sequencing, not recombining. `resolve_data_ref` (`SKY-241`) alone unblocks M1 and M3 and is the prerequisite for `SKY-242` (`hydrate-story` `dataRefs:`). `find_candidates_by_data_ref` (`SKY-244`) is what unblocks M2 and E2, and the April 8 D10 still calls that join "the actual product value of the resolution layer exposed as a callable." So the right move is: land `SKY-241` first, then keep `SKY-244` immediately adjacent in the plan rather than letting it drift behind Stage 2/3 work.

**Editions subsystem (in-progress per `system-context.md`).** R1, R2, R3, and R4 all mark Editions as 🚧, because today `editions/published/*.md` is the only Reader touchpoint per `seams.md` actor exposure. But the SKY-188 brief explicitly says weekly compilations are **deferred until the core flow works end-to-end**, and SKY-192 says "the discussion skill is the product". That tension is real. The honest read: Editions is not unjustified — R1/R2/R3/R4 do need a published-artifact seam — but the compile workflow should **not** be on the critical path before `SKY-238`, `SKY-241`, `SKY-242`, and ideally `SKY-244` land. If the Editor can't yet pin and join data refs inside the voice loop, polishing the edition compile pipeline is premature. **Recommendation: hold Editions in its current 🚧 state and do not allocate further work there until R3's upstream chain is unblocked.**

No other unjustified work found. Every other planned subsystem in the matrix is a direct blocker of at least one named experience.

## 4. What we should build next

The matrix points to one ordering. SKY-238 unlocks O1 and nothing else. The experiences that matter for the product — **R3 (expert-data-argument link)**, **E1 (voice-drops into hydrated story with data refs)**, **E2 (cross-expert join in voice)** — now sit on a shorter, clearer chain than before: `SKY-238` for the runtime write, `SKY-241` for direct lookup, `SKY-242` for hydrate-story projection, and `SKY-244` for the join itself. The cache substrate (`SKY-232`) is already there; `SKY-243` is the publish-time warning layer that keeps the loop fail-loud once the data refs hit disk.

**After SKY-238, land the MCP-facing lookup pair before deeper resolver work.** Start with `SKY-241` so the editorial repo can call `resolve_data_ref` at all and `SKY-242` can unblock. Keep `SKY-244` immediately adjacent, because the cross-expert join is still the distinctive product move. The seam being crossed is the MCP tool surface row in `seams.md` currently marked planned; this is the single highest-leverage cell in the matrix because it lights up three model/editor experiences without requiring Stage 2 or Stage 3.

**Then ship `SKY-242` and `SKY-243` as the editorial-side finish.** The `StoryFrontmatter` + `PostAnnotationFrontmatter` seams described in `seams.md` are already stable at the base level; `SKY-242` is the additive `dataRefs:` projection, and `SKY-243` is the fail-loud warning pass over the now-shipped caches. That pairing gives the Editor E1 immediately and gives R3 a believable path into the reader artifact without asking build-graph to stay blind. The tiebreaker from SKY-192 — *does this tighten the voice-driven editorial loop for @mepuka in a real session?* — still picks this ordering unambiguously. Stage 2, Stage 3, and additional Editions polish stay on the shelf until a real session produces a residual or a reader artifact gap they alone can fix.
