# Product Alignment Matrix

This document maps actor-facing experiences to the subsystems and seams they depend on. It is the bridge between product language and the architecture described in:

- `system-context.md` for the subsystem map
- `resolution-trace.md` for the one-post walkthrough
- `seams.md` for the seam inventory

The key update in this refresh is that the resolver is no longer hypothetical infrastructure. The runtime write path is shipped. The remaining product question is how quickly that shipped runtime becomes usable in the editorial loop.

## 1. Actors and their core experiences

### Reader

1. **R1 - Headline names the question.** Opens a published edition and gets a story shaped around a real question, not a generic roundup.
2. **R2 - Chart with provenance.** Sees a chart with the expert, original post, and source/provider context attached.
3. **R3 - Expert-data-argument link.** Can follow a named expert's claim back to a concrete data reference, not just a hand-written source note.
4. **R4 - Temporal grounding.** Can tell whether a story is about a new event or a longer-running arc.

### Editor

1. **E1 - Voice-drops into a hydrated story.** Opens a story scaffold that already carries the post, expert, provider context, and eventually the relevant data refs.
2. **E2 - Cross-expert join on a data reference.** Asks "who else talked about this series or variable?" and gets the answer in one tool call.
3. **E3 - Curate without losing hand-edits.** Re-hydrates or refreshes a story without blowing away the editor's own notes and body copy.
4. **E4 - Arc evolution against a novel frame.** When the current narrative taxonomy is not enough, spawns or reshapes an arc without leaving the discussion workflow.

### MCP-calling model

1. **M1 - Resolve a single data ref.** Takes a URI or hint and returns one typed registry entity it can reason over.
2. **M2 - Cross-expert join as a tool.** Looks up the set of posts that cite the same underlying data reference.
3. **M3 - Inspect structured kernel gaps for a post.** Reads a post's resolver outcome and can tell whether the system found a match, preserved an ambiguity, or fell out of the registry.
4. **M4 - Rich post context in one call.** Pulls the post, enrichments, resolver row, and editorial state without repeated round-trips.

### Operator

1. **O1 - Enable and inspect the resolver lane in staging.** Turn the lane on, run real posts, and inspect the stored outputs.
2. **O2 - Single pipeline-health read.** Ask "is the system healthy?" without stitching together five separate endpoints.
3. **O3 - Quality loop from stored rows to eval harness.** Compare what production is storing with what the kernel eval harness says should happen.
4. **O4 - Deploy without breaking editorial.** Change shared schemas and know quickly whether the editorial repo still works.

## 2. The matrix

Legend:

- `✅` shipped and load-bearing
- `🚧` shipped but quality-limited
- `📋` planned blocker
- `⚪` not required

Columns use the current subsystem names from `system-context.md`. `Resolution Stack` means Stage 1 matching plus the kernel inside `skygest-resolver`. `Stored Row` means `post_enrichments(kind = data-ref-resolution)`. `Kernel Eval` is operator-only and is not part of the reader/editor runtime path.

| # | Experience | Ingest | Vision | Source | Resolver | Resolution Stack | Registry | Stored Row | Kernel Eval | MCP | HTTP | Caches | hydrate-story | Discussion | Story Files | build-graph | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R2 | Chart with provenance | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R3 | Expert-data-argument link | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 📋 SKY-243 | 🚧 |
| R4 | Temporal grounding | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| E1 | Voice-drops into a hydrated story | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 📋 SKY-243 | ⚪ |
| E2 | Cross-expert join on a data reference | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | 📋 SKY-241/244 | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| E3 | Curate without losing hand-edits | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ |
| E4 | Arc evolution against a novel frame | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ |
| M1 | Resolve a single data ref | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ | ⚪ | 📋 SKY-241 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M2 | Cross-expert join as a tool | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | 📋 SKY-244 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M3 | Inspect structured kernel gaps for a post | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M4 | Rich post context in one call | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| O1 | Enable and inspect the resolver lane in staging | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O2 | Single pipeline-health read | ✅ | ✅ | ✅ | ✅ | 🚧 | ⚪ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O3 | Quality loop from stored rows to eval harness | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O4 | Deploy without breaking editorial | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ |

Assumption note: `Resolution Stack` is marked `🚧` for the product-facing rows because the runtime is shipped but the kernel still has active quality gaps and registry completeness limits, especially around agent-based narrowing (`SKY-317`).

## 3. Three analyses

### (a) What the resolver cutover already changed

The important shift is that the system no longer needs a hypothetical resolver story in order to talk about product outcomes. The resolver Worker, the `RESOLVER` binding, and the stored `data-ref-resolution` row are real.

That immediately changes three experiences:

1. **O1 is now a real operating loop.** The operator can enable or inspect the resolver lane in staging and look at actual stored outputs.
2. **M3 is now substantially real.** The model can already inspect structured resolver outcomes for posts that have been through the lane because `get_post_enrichments` can surface the stored row.
3. **M4 is stronger than before.** Rich post context can now include the stored resolver result, not just vision and source attribution.

What did **not** finish with the cutover:

- **R3** still needs those data refs projected into story files (`SKY-242`) and guarded by build-graph warnings (`SKY-243`).
- **E1** still needs the same projection step before the editor sees resolver-backed data refs on disk by default.
- **E2**, **M1**, and **M2** still need the dedicated lookup and join tools (`SKY-241`, `SKY-244`).

So the cutover moved the runtime from "planned" to "real," but the editorial product still needs the last-mile surfaces.

### (b) The remaining MCP gap

The old version of this document treated the model's data-ref gap as mostly a missing resolver runtime. That is no longer accurate.

The model already has:

- post search and thread tools
- `get_post_enrichments`
- `get_editorial_pick_bundle`
- stored resolver rows for posts that have run through the lane

The remaining gap is narrower and clearer:

1. **Ad-hoc direct lookup** is missing (`SKY-241`).
2. **Cross-expert join lookup** is missing (`SKY-244`).

That is a better product situation than before because the missing surface is now concentrated in two explicit tool seams instead of being mixed up with missing runtime plumbing.

### (c) What is justified next, and what should wait

Two tracks are justified now.

**Track 1: product surface completion**

- `SKY-241` (`resolve_data_ref`)
- `SKY-242` (project data refs into story files)
- `SKY-243` (warn on unresolved refs in build-graph)
- `SKY-244` (cross-expert join tool)

This is the shortest path from "resolver writes good rows" to "editor can actually use them."

**Track 2: resolver quality and registry completeness**

- `SKY-317` (restore real agent-based narrowing)
- related registry and coverage work such as `SKY-322`, `SKY-323`, `SKY-324`
- eval-driven kernel follow-ups under the `SKY-314` umbrella

This track is justified because the kernel eval harness already shows that the shipped runtime still has meaningful misses. The resolver exists; now it needs to become more trustworthy.

What should wait:

- a revived "runtime Stage 3" story
- any documentation that implies agent narrowing is already complete
- extra editions polish before resolver-backed story files and lookup tools exist

## 4. What we should build next

The architecture family now points to one clean ordering.

**First, finish the editorial surfaces for the resolver we already shipped.**

That means `SKY-241`, `SKY-242`, `SKY-243`, and `SKY-244`. Without them, the runtime writes resolver rows that the editor can mostly inspect only indirectly.

**In parallel, improve the quality of the shipped kernel instead of inventing a new runtime stage.**

That means `SKY-317` plus the registry and coverage follow-ons the eval harness is already pointing at. This is the honest next quality loop.

**Hold future reranking or workflow escalation behind those two tracks.**

The system already has the right runtime shape. It now needs better data behind that shape and better editorial surfaces on top of it.

## What changed in this refresh

1. The matrix now treats the resolver runtime as shipped, not planned.
2. The model's structured-gap experience is now counted as real for posts that have run through the lane.
3. The remaining editor/model blockers are now framed as missing lookup and projection surfaces.
4. The recommended next work is split into a product-surface track and a quality track.
