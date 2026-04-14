# Product Alignment Matrix

This document maps actor-facing experiences to the subsystems and seams they depend on. It is the bridge between product language and the architecture described in:

- `system-context.md` for the subsystem map
- `resolution-trace.md` for the one-post walkthrough
- `seams.md` for the seam inventory

The key update in this refresh is that the resolver follow-through is no longer just runtime plumbing. The runtime write path is shipped, the editor-facing lookup tools are shipped, and the remaining question is how quickly that state becomes durable in story files and warning surfaces.

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

`/v1/resolve/search-candidates` and the typed search layer are omitted from the matrix because the code seam exists, but current worker configs still do not bind `SEARCH_DB`.

| # | Experience | Ingest | Vision | Source | Resolver | Resolution Stack | Registry | Stored Row | Kernel Eval | MCP | HTTP | Caches | hydrate-story | Discussion | Story Files | build-graph | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R2 | Chart with provenance | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R3 | Expert-data-argument link | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 📋 SKY-243 | 🚧 |
| R4 | Temporal grounding | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| E1 | Voice-drops into a hydrated story | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 📋 SKY-243 | ⚪ |
| E2 | Cross-expert join on a data reference | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| E3 | Curate without losing hand-edits | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ |
| E4 | Arc evolution against a novel frame | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ |
| M1 | Resolve a single data ref | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M2 | Cross-expert join as a tool | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M3 | Inspect structured kernel gaps for a post | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M4 | Rich post context in one call | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| O1 | Enable and inspect the resolver lane in staging | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O2 | Single pipeline-health read | ✅ | ✅ | ✅ | ✅ | 🚧 | ⚪ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O3 | Quality loop from stored rows to eval harness | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O4 | Deploy without breaking editorial | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ |

Assumption note: `Resolution Stack` is marked `🚧` for the product-facing rows because the runtime is shipped but the kernel still has active quality gaps. The earlier `SKY-317` shelf-completeness blocker is no longer the main limitation.

## 3. Three analyses

### (a) What the resolver follow-through already changed

The important shift is that the system no longer needs a hypothetical resolver story in order to talk about product outcomes. The resolver Worker, the `RESOLVER` binding, the stored `data-ref-resolution` row, and the first lookup tools on top of that row are real.

That immediately changes five experiences:

1. **O1 is now a real operating loop.** The operator can enable or inspect the resolver lane in staging and look at actual stored outputs.
2. **M3 is now substantially real.** The model can already inspect structured resolver outcomes for posts that have been through the lane because `get_post_enrichments` can surface the stored row.
3. **M1 is now real.** `resolve_data_ref` gives the model an exact registry lookup seam over canonical URIs and aliases.
4. **M2 and E2 are now real.** `find_candidates_by_data_ref` turns stored candidate citations into a shipped reverse-join tool.
5. **M4 is stronger than before.** Rich post context can now include the stored resolver result, not just vision and source attribution.

What did **not** finish with the cutover:

- **R3** still needs those data refs projected into story files (`SKY-242`) and guarded by build-graph warnings (`SKY-243`).
- **E1** still needs the same projection step before the editor sees resolver-backed data refs on disk by default.
- The typed search foundation exists in code, but it is not yet a live runtime dependency because the current worker configs do not bind `SEARCH_DB`.

So the cutover plus follow-through moved both runtime and lookup from "planned" to "real," but the editorial product still needs the last-mile on-disk surfaces.

### (b) The remaining last-mile gap

The old version of this document treated the model's data-ref gap as mostly a missing resolver runtime and missing lookup tools. That is no longer accurate.

The model already has:

- post search and thread tools
- `get_post_enrichments`
- `get_editorial_pick_bundle`
- `resolve_data_ref`
- `find_candidates_by_data_ref`
- stored resolver rows for posts that have run through the lane

The remaining gap is now narrower and more concrete:

1. **Story-frontmatter projection** is still missing (`SKY-242`).
2. **build-graph unresolved-ref warnings** are still missing (`SKY-243`).
3. **Typed search deployment** is still gated by the missing `SEARCH_DB` binding, even though the code seam exists.

That is a better product situation than before because the remaining work is concentrated on disk surfaces and deployment discipline instead of being mixed up with missing lookup primitives.

### (c) What is justified next, and what should wait

Two tracks are justified now.

**Track 1: product surface completion**

- `SKY-242` (project data refs into story files)
- `SKY-243` (warn on unresolved refs in build-graph)

This is the shortest path from "resolver and lookup tools are real" to "editor sees the same state on disk."

**Track 2: resolver quality and deployment discipline**

- eval-driven kernel follow-ups under the `SKY-314` umbrella
- bind and matching work that raises citation density and makes the shipped join surface more useful
- deploy typed search only when `SEARCH_DB` is actually bound and a real caller needs ranked retrieval

This track is justified because the kernel eval harness already shows that the shipped runtime still has meaningful misses, and the search layer should not be treated as live before its database exists in deploy config.

What should wait:

- a revived "runtime Stage 3" story
- pretending typed search is live before `SEARCH_DB` is bound
- extra editions polish before resolver-backed story files exist on disk

## 4. What we should build next

The architecture family now points to one cleaner ordering.

**First, finish the on-disk editorial follow-through for the lookup surface we already shipped.**

That means `SKY-242` and `SKY-243`. The runtime and the MCP tools already know the answer; the story files and validator still do not.

**In parallel, improve join density by improving kernel quality, not by reopening the registry-plumbing question.**

The series-backed narrowing path is real now. The remaining gains come from better matching, better candidate generation, and better bind behavior.

**Only then decide whether typed search should become a live runtime dependency.**

The code seam exists, but the current worker configs do not bind `SEARCH_DB`, so it should be treated as a deployment-gated option rather than today's product contract.

## What changed in this refresh

1. The matrix now treats the lookup tools as shipped, not planned blockers.
2. The remaining editor/model blockers are now framed as story-file projection, warning surfaces, and deployment gating.
3. The note under `Resolution Stack` now reflects quality limits rather than missing `SKY-317` shelf plumbing.
4. The recommended next work now separates editorial last-mile completion from quality and deployment discipline.
