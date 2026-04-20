# Product Alignment Matrix

This document maps actor-facing experiences to the subsystems and seams they depend on. It is the bridge between product language and the architecture described in:

- `system-context.md` for the subsystem map
- `resolution-trace.md` for the one-post walkthrough
- `seams.md` for the seam inventory

The key update in this refresh is that the resolver is no longer hypothetical infrastructure. The runtime write path is shipped, and it is now simpler: Stage 1 plus provenance-first asset resolution. The remaining product question is how quickly that shipped runtime becomes usable in the editorial loop.

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
3. **M3 - Inspect structured resolution gaps for a post.** Reads a post's resolver outcome and can tell whether the system found a match, preserved an ambiguity, or stopped at a provenance-only result.
4. **M4 - Rich post context in one call.** Pulls the post, enrichments, resolver row, and editorial state without repeated round-trips.

### Operator

1. **O1 - Enable and inspect the resolver lane in staging.** Turn the lane on, run real posts, and inspect the stored outputs.
2. **O2 - Single pipeline-health read.** Ask "is the system healthy?" without stitching together five separate endpoints.
3. **O3 - Quality loop from stored rows to verification.** Compare what production is storing with targeted resolver checks, replay tests, and adjacent export validation.
4. **O4 - Deploy without breaking editorial.** Change shared schemas and know quickly whether the editorial repo still works.

## 2. The matrix

Legend:

- `✅` shipped and load-bearing
- `🚧` shipped but quality-limited
- `📋` planned blocker
- `⚪` not required

Columns use the current subsystem names from `system-context.md`. `Resolution Stack` means Stage 1 matching plus provenance-first bundle search inside `skygest-resolver`. `Stored Row` means `post_enrichments(kind = data-ref-resolution)`. `Resolver QA` is operator-only and is not part of the reader/editor runtime path.

| # | Experience | Ingest | Vision | Source | Resolver | Resolution Stack | Registry | Stored Row | Resolver QA | MCP | HTTP | Caches | hydrate-story | Discussion | Story Files | build-graph | Editions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | Headline names the question | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R2 | Chart with provenance | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| R3 | Expert-data-argument link | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 🚧 | 🚧 |
| R4 | Temporal grounding | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | 🚧 |
| E1 | Voice-drops into a hydrated story | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | 📋 SKY-242 | ✅ | ✅ | 🚧 | ⚪ |
| E2 | Cross-expert join on a data reference | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | 🚧 | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| E3 | Curate without losing hand-edits | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ |
| E4 | Arc evolution against a novel frame | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ |
| M1 | Resolve a single data ref | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M2 | Cross-expert join as a tool | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ⚪ | 🚧 | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M3 | Inspect structured resolution gaps for a post | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| M4 | Rich post context in one call | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ✅ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ | ✅ | ⚪ | ⚪ | ⚪ |
| O1 | Enable and inspect the resolver lane in staging | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O2 | Single pipeline-health read | ✅ | ✅ | ✅ | ✅ | 🚧 | ⚪ | ✅ | ⚪ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O3 | Quality loop from stored rows to verification | ✅ | ✅ | ✅ | ✅ | 🚧 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ |
| O4 | Deploy without breaking editorial | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ⚪ | ✅ | ✅ | ⚪ | ✅ | ✅ | ⚪ |

Assumption note: `Resolution Stack` is marked `🚧` for the product-facing rows because the runtime is shipped but still quality-limited, and it intentionally stops at provenance-first output for now.

`build-graph` is marked `🚧` on the data-ref rows because warning-only validation is shipped, but hydrate-story still does not project new `data_refs` into files automatically.

## 3. Four analyses

### (a) What the resolver cutover already changed

The important shift is that the system no longer needs a hypothetical resolver story in order to talk about product outcomes. The resolver Worker, the `RESOLVER` binding, and the stored `data-ref-resolution` row are real.

That immediately changes three experiences:

1. **O1 is now a real operating loop.** The operator can enable or inspect the resolver lane in staging and look at actual stored outputs.
2. **M3 is now substantially real.** The model can already inspect structured resolver outcomes for posts that have been through the lane because `get_post_enrichments` can surface the stored row.
3. **M4 is stronger than before.** Rich post context can now include the stored resolver result, not just vision and source attribution.

What did **not** finish with the cutover:

- **R3** still needs those data refs projected into story files (`SKY-242`).
- **E1** still needs the same projection step before the editor sees resolver-backed data refs on disk by default.
- **E2**, **M1**, and **M2** now have lookup and join tools, but they still ride on a quality-limited resolver surface and are not yet folded into story hydration.

So the cutover moved the runtime and the basic read surface from "planned" to "real," but the editorial product still needs the last-mile projection into story files.

### (b) The remaining MCP packaging gap

The old version of this document treated the model's data-ref gap as a missing resolver runtime plus missing raw lookup tools. That is no longer accurate.

The model already has:

- post search and thread tools
- `get_post_enrichments`
- `resolve_data_ref`
- `find_candidates_by_data_ref`
- `get_editorial_pick_bundle`
- stored resolver rows for posts that have run through the lane

The remaining gap is narrower and clearer:

1. **Bundle packaging is still thin.** `get_editorial_pick_bundle` keeps the scaffold contract stable, but it still does not carry resolver-backed `data_refs`.
2. **Filesystem projection is still missing.** `hydrate-story` still writes empty `data_refs` for new story and annotation files (`SKY-242`).
3. **Validation is warning-only.** `build-graph` can now surface bad refs, but it does not create them.

That is a better product situation than before because the missing work is now packaging and materialization, not basic query access.

### (c) What the ontology-store package changed

The ontology-store work matters mainly to operator confidence and future interoperability, not to the reader/editor loop yet.

What it changed already:

1. The repo now has a tested RDF emit, validate, serialize, reload, and distill path over the same snapshot the registry sync consumes.
2. The mapping rules and SHACL shapes are committed artifacts, not an implied future direction.
3. `O3` is stronger because resolver verification now sits next to a separate export-validation seam instead of standing alone.

What it did **not** change:

- it did not put RDF or SHACL on the Worker hot path
- it did not unblock editorial lookup or story projection by itself
- it did not change the live resolver's provenance-first runtime scope

So this package belongs in the architecture story, but as an adjacent validation/export seam rather than a user-facing runtime capability.

### (d) What is justified next, and what should wait

Two tracks are justified now.

**Track 1: product surface completion**

- `SKY-242` (project data refs into story files)

This is the shortest path from "resolver writes good rows and the MCP can query them" to "editor can actually use them on disk."

**Track 2: resolver quality and registry completeness**

- follow-on provenance and search-quality work
- any remaining registry coverage work the live resolver still depends on
- eventual semantic follow-through once provenance-first output is stable enough to trust

This track is justified because the shipped runtime still has meaningful misses and only covers the provenance half of the problem. The resolver exists; now it needs to become more trustworthy and eventually more semantically capable.

What should wait:

- a revived "runtime Stage 3" story
- any documentation that implies semantic variable/series resolution is already shipped
- extra editions polish before resolver-backed story files exist

## 4. What we should build next

The architecture family now points to one clean ordering.

**First, finish the last-mile editorial projection for the resolver and lookup surface we already shipped.**

That means `SKY-242`. Without it, the runtime and MCP tools can already see data refs, but new story files still start with empty `data_refs`.

**In parallel, improve the quality of the shipped resolver instead of inventing a new runtime stage.**

That means better provenance coverage, better search quality, and eventually a deliberate semantic-resolution follow-on when the runtime and data plane are ready. This is the honest next quality loop.

**Keep ontology-store on the adjacent validation/export track.**

That package now matters to architecture health, but it should stay out of the hot path until there is a concrete product reason to pull it closer.

## What changed in this refresh

1. The matrix now treats direct data-ref lookup as shipped and cross-expert join as shipped-but-quality-limited.
2. The editorial guardrail is now documented accurately: build-graph warnings exist, but hydrate-story still does not project new refs.
3. The remaining editor/model blocker is now framed as packaging and projection, not missing lookup tools.
4. The recommended next work narrows the product-surface track to `SKY-242`, while keeping runtime-quality work separate.
