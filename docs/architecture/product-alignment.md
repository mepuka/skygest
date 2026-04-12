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

Columns use the product-relevant subsystem names from `system-context.md`. Cells: ✅ shipped and load-bearing, 🚧 in-progress blocker (with SKY ticket), 📋 planned blocker (with SKY ticket), ⚪ not required.

| # | Experience | Post Ingest | Vision Lane | Source-Attr Lane | Stage 1 Resolver | Data Layer Registry | Resolver Worker | Stage 2 Resolver | data-ref-resolution Enrichment | MCP Surface | HTTP API | Editorial Caches | hydrate-story | Discussion Skill | Story Files | Build-graph Validator | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R2 | Chart with provenance | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R3 | Expert-data-argument link | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | ✅ | 🚧 |
| R4 | Temporal grounding | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| E1 | Voice-drops into hydrated story | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | ✅ | ⚪ |
| E2 | Cross-expert join on a dataset | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | 📋 SKY-241/244 | ⚪ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ⚪ |
| E3 | Curate without losing hand-edits | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ |
| E4 | Arc evolution against novel frame | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ |
| M1 | Resolve a single data ref | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | 📋 SKY-241 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M2 | Cross-expert join as a tool | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | 📋 SKY-241/244 | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| M3 | Typed residuals on partial resolution | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M4 | Rich post context in one call | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| O1 | Flip resolver flag in staging | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O2 | Single pipeline-health read | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O3 | Gap triage loop | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O4 | Deploy without breaking editorial | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ |

Assumption note: `Editorial Caches` is now the shipped `SKY-232` substrate. The remaining editorial-side guardrail is `SKY-243` (build-graph warnings over unresolved data-layer refs), which matters as a publish-time quality layer and is discussed below rather than getting its own column. `Stage 3 Resolver` is discussed in the analysis sections rather than getting its own matrix column because none of the listed experiences currently require the real `SKY-240` LLM body.

Two experiences — **E4 (arc evolution)** and **O4 (deploy without breaking editorial)** — have zero dependencies on the resolution column stack and on the write-side enrichment lanes. E4 runs entirely inside the Discussion Skill + Story Files + MCP read path. O4 runs inside the `@skygest/domain` bridge described in `system-context.md` and the `build-graph` validator. That's worth saying out loud: the voice-driven editorial loop and the cross-repo Schema contract are the two experiences that are already whole today.

## 3. Three analyses

### (a) Critical-path experiences: what the shipped resolver stack now unlocks

The shipped resolver stack is now bigger than `SKY-238` alone. As of April 12, 2026 it includes: the standalone `skygest-resolver` Worker and `data-ref-resolution` enrichment lane from `SKY-238`, the typed `WorkerEntrypoint` RPC seam from `SKY-287`, the live Stage 2 kernel and vocabulary loader from `SKY-239` / `SKY-306` / `SKY-307`, and the first comparative Stage 1 + Stage 2 eval loop from PR #91. It still does **not** include the editorial projection and tool-surface slices: `SKY-241`, `SKY-242`, `SKY-243`, `SKY-244`, or the real Stage 3 LLM body in `SKY-240`.

This shipped stack fully unlocks **O1 — Flip the resolver flag in staging**. The Operator can now enable the flag, watch `data-ref-resolution` rows accumulate on `post_enrichments`, inspect both Stage 1 and Stage 2 output, and make a production go/no-go decision. That was not true in the March snapshot.

It also partially unlocks **M3 — Typed residuals on partial resolution**. For posts that have already been through enrichment, `get_post_enrichments` can now surface stored resolver rows carrying Stage 1 residuals, optional Stage 2 corroborations, and optional queued Stage 3 stub metadata. That is real progress, even though it is still not a first-class resolver tool on the MCP surface.

But the editor-facing experiences are still blocked further downstream. **R3 (expert-data-argument link)** and **E1 (voice-drops into hydrated story with data refs visible in frontmatter)** are now blocked primarily on `SKY-242`, not on standing up the resolver runtime. **E2 (cross-expert join in voice)** and **M2 (cross-expert join as a tool)** are still blocked on the MCP lookup pair `SKY-241` / `SKY-244`. **M1 (resolve a single data ref)** is blocked on `SKY-241` even though the resolver Worker that will host it is already there.

So the system has crossed an important threshold: the resolver substrate is mostly built, and the remaining critical-path gaps are now interface and projection gaps rather than runtime-foundation gaps.

### (b) MCP-calling model gap

The MCP-calling model has **M4 (rich post context in one call)** fully shipped today — `get_post_enrichments`, `get_post_thread`, `get_editorial_pick_bundle`, `search_posts` are all listed in the `seams.md` actor-exposure section and cover the Editor's mid-conversation context needs for shipped lanes.

**M3 (typed residuals on partial resolution)** is now partly shipped too, because stored `data-ref-resolution` enrichments can already be read back through the existing MCP surface. That is a meaningful change from the earlier doc family.

But the biggest gap is still the missing data-ref tool pair. **M1 (resolve a single data ref)** needs `SKY-241`, and **M2 (cross-expert join as a tool)** needs `SKY-241` plus `SKY-244`. The gap is now well-scoped in Linear, which is good. The product truth is still the same: resolver output stops at D1 until the MCP lookup surface lands, and that is the single biggest remaining distance between "resolver exists" and "editor can use it fluidly in the voice loop."

### (c) Unjustified work

Scanning every column and every 📋 cell against the experiences in Section 1:

**Additional resolver-deepening work — no longer the main product blocker.** The Stage 2 runtime is already shipped, and the first comparative eval has now split the next resolver-side work into three concrete tickets: `SKY-308` (misclassification fixes), `SKY-309` (new facet vocabularies), and `SKY-310` (coverage expansion). That makes the work justified, but not top-of-stack for the experiences in Section 1. Those tickets improve quality and recall; they do not unblock the editor-facing chain as directly as `SKY-241`, `SKY-242`, and `SKY-244`. `SKY-240` remains even further downstream: the real Stage 3 LLM body still does not block any listed experience.

**`find_candidates_by_data_ref` vs `resolve_data_ref` priority.** The split is now explicit in Linear, and that is fine; the key is sequencing, not recombining. `resolve_data_ref` (`SKY-241`) unblocks M1, upgrades M3 from a stored-read experience into a direct lookup experience, and is the prerequisite for `SKY-242` (`hydrate-story` `dataRefs:`). `find_candidates_by_data_ref` (`SKY-244`) is what unblocks M2 and E2, and the April 8 D10 still calls that join "the actual product value of the resolution layer exposed as a callable." So the right move is: land `SKY-241` first, then keep `SKY-244` immediately adjacent in the plan rather than letting it drift behind later resolver work.

**Editions subsystem (in-progress per `system-context.md`).** R1, R2, R3, and R4 all mark Editions as 🚧, because today `editions/published/*.md` is the only Reader touchpoint per `seams.md` actor exposure. But the SKY-188 brief explicitly says weekly compilations are **deferred until the core flow works end-to-end**, and SKY-192 says "the discussion skill is the product". That tension is real. The honest read: Editions is not unjustified — R1/R2/R3/R4 do need a published-artifact seam — but the compile workflow should **not** be on the critical path before `SKY-241`, `SKY-242`, and ideally `SKY-244` land. If the Editor can't yet pin and join data refs inside the voice loop, polishing the edition compile pipeline is premature. **Recommendation: hold Editions in its current 🚧 state and do not allocate further work there until R3's upstream chain is unblocked.**

No other unjustified work found. Every other planned subsystem in the matrix is a direct blocker of at least one named experience, or a clearly justified quality-improvement loop surfaced by the shipped eval harness.

## 4. What we should build next

The matrix points to one ordering. The runtime resolver substrate is largely in place. The experiences that matter most for the product — **R3 (expert-data-argument link)**, **E1 (voice-drops into hydrated story with data refs)**, **E2 (cross-expert join in voice)** — now sit on a shorter, clearer chain than before: `SKY-241` for direct lookup, `SKY-242` for hydrate-story projection, `SKY-244` for the join itself, and `SKY-243` for the fail-loud validation layer once those refs hit disk.

**Land the MCP-facing lookup pair before more resolver-deepening work.** Start with `SKY-241` so the editorial repo can call `resolve_data_ref` at all and `SKY-242` can unblock. Keep `SKY-244` immediately adjacent, because the cross-expert join is still the distinctive product move. The seam being crossed is the MCP tool surface row in `seams.md` currently marked planned; this is now the single highest-leverage cell in the matrix because it lights up three model/editor experiences on top of already-shipped runtime substrate.

**Then ship `SKY-242` and `SKY-243` as the editorial-side finish.** The `StoryFrontmatter` + `PostAnnotationFrontmatter` seams described in `seams.md` are already stable at the base level; `SKY-242` is the additive `dataRefs:` projection, and `SKY-243` is the fail-loud warning pass over the now-shipped caches. That pairing gives the Editor E1 immediately and gives R3 a believable path into the reader artifact without asking build-graph to stay blind.

**Keep resolver tuning as an eval-driven parallel track, not the main sequencing path.** `SKY-308`, `SKY-309`, and `SKY-310` are justified follow-ons from the first Stage 1 + Stage 2 comparative run, and they should proceed when quality needs demand it. But they should not delay the MCP/story projection chain that actually exposes the shipped resolver work to the editor.
