---
status: review-prompt
created: 2026-04-15
target: GPT-5 Pro (extended thinking, ~1 hour budget)
purpose: Second pass — critique the locked SKY-362 design for modeling, abstraction, and complexity tractability
continues: docs/architecture/triplestore-rdf-design.md (previous research run by same model)
related:
  - docs/plans/2026-04-15-sky-362-ontology-store-design.md (the locked design under review)
  - docs/plans/2026-04-15-sky-362-review-context.md (context bundle to paste alongside this prompt)
---

# SKY-362 design review prompt (second pass)

## How to use this document

This is a follow-up to an earlier research run by the same model. In that earlier run, the model was asked six clusters of questions about production ontology-store patterns, and the output (`docs/architecture/triplestore-rdf-design.md`) shaped the design that is now under review here.

**The task has changed.** This is not "do more research." This is "review our locked design for issues we can't see from the inside." Paste the full `# REVIEW PROMPT` section below into the target model (GPT-5 Pro, extended thinking, ~1 hour budget), along with the context bundle at `docs/plans/2026-04-15-sky-362-review-context.md`. The model should treat its earlier research as prior context — we read it, we applied it, we made decisions, and now we want those decisions critiqued.

The operator's stated goal for this review: **keep the complexity tractable and not feel like we are juggling constantly.** That framing is load-bearing — prioritize feedback that makes the day-to-day experience of working on the package simpler, not feedback that adds rigor at the cost of cognitive load.

---

# REVIEW PROMPT

## Context: who I am, what we already did, what this review is for

I am building a knowledge-graph-backed content intelligence product for the energy sector. Stack: TypeScript on Cloudflare Workers, Effect 4 for services and errors, Effect Schema as single source of truth for domain types, D1 (SQLite) relational store under the hood. I have an operational DCAT-shaped data catalog (Agents, Catalogs, CatalogRecords, Datasets, Distributions, DataServices, DatasetSeries, plus SDMX-style Variable / Series / Observation) with ULID-prefixed URIs, declared field-level ontology mappings in a manifest, and ~7,400 real entities in a cold-start snapshot.

A few days ago you gave me a research pass on six question clusters (round-tripping, SHACL in production, versioning and drift, ingest and change tracking, reasoning, library choices). The output — `docs/architecture/triplestore-rdf-design.md` — was excellent and landed several load-bearing recommendations: treat the package as an "application-profile graph seam" rather than a generic ontology store, keep projection-level parity rather than structural equality as the round-trip bar, use named graphs from day one as the API shape, keep the Effect Schema vs SHACL split, and defer things that do not earn their cost yet.

I then ran a design interview against that research and locked eleven decisions. The locked design lives at `docs/plans/2026-04-15-sky-362-ontology-store-design.md` (in the context bundle). It translates your recommendations into a concrete plan: a new `packages/ontology-store/` workspace member, an N3.js + shacl-engine + Effect 4 service layer, a manifest-driven EmitSpec, hand-authored SHACL shapes for the DCAT instance layer in one flat file, a round-trip pipeline that emits → validates → serializes → re-parses → distills, and a milestone-1 acceptance criterion of "load the entire cold-start catalog end-to-end through the pipeline and make the round-trip test green."

Some of your earlier recommendations I deferred more aggressively than you suggested, because the operator's pace preference is "get the loop running, don't overengineer, fix what hurts once we feel the pain." Examples: I deferred the pluggable validator with a pySHACL reference path, I deferred JSON-LD context generation, I deferred PROV-O activity modelling, I deferred shape modularization by concern, I deferred RDFS reasoning beyond a no-op stub. The reasons for each deferral are enumerated in the design doc; I am not asking you to re-argue them. I am asking you to review what I kept.

**What I want from this review:** an honest, opinionated critique of the locked design. Specifically, I want to know where the plan is likely to feel like "juggling constantly" during implementation, where the abstractions are wrong or inverted, where there's a simpler model I'm not seeing, and what I've missed that is going to bite me during PR 2 when I try to run the whole cold-start catalog through the pipeline end-to-end.

This is not a validation exercise. I am not looking for "looks good." I am looking for the thing I cannot see from the inside because I have been staring at this for a day.

## The eleven decisions under review

For quick reference — full rationale for each is in the design doc.

1. **Mental model (trunk):** `packages/ontology-store/` is an application-profile graph seam, not a generic ontology store. EmitSpec / DistillSpec are a versioned, lossy, application-specific contract.
2. **SKY-229 subsumed:** the separate "SHACL validation harness" ticket folds into SKY-362. The living store replaces the throw-away harness.
3. **Graph ownership:** per-source named graphs as the ownership unit. `targetGraph?: IRI` API hook exists in milestone 1; source-routing logic deferred. Milestone 1 writes to the default graph.
4. **Validator pluggability:** `shacl-engine` only, JS-native. pySHACL reference validator deferred indefinitely (explicit call, not oversight).
5. **EmitSpec formalization:** Level 2 — a derived JSON artifact at `packages/ontology-store/generated/emit-spec.json`, regenerated from the manifest at build time, committed, consumed by both emit and distill paths as the single source of truth. Per-field `lossy` markers inside the spec drive the round-trip parity comparator's ignore list.
6. **No JSON-LD context generation.** Deferred.
7. **Delete and provenance semantics:** wholesale per-source graph replacement; no PROV-O activity modelling, no archive / tombstone graphs in milestone 1.
8. **Drift protocol:** coordinated upgrades only. No dual-form distillation, no N+1 / N+2 migration window.
9. **SHACL staging:** every shape defaults to `sh:Violation`. No Warning / Info ratcheting until external ingest lands.
10. **Full loop in milestone 1:** emit + SHACL validate + distill all ship together. (This reverses an earlier interview decision to defer distill — the operator wanted the full workflow scaffolded so pain points surface now.)
11. **Milestone 1 scope:** load the entire cold-start catalog (~7,387 entities, ~50–100K triples) through the pipeline as one acceptance test. Not a curated fixture. Two PRs: skeleton hoist, then the whole loop.

## File-count discipline (explicit hard rule)

Minimize file count. ONE shapes file (`packages/ontology-store/shapes/dcat-instances.ttl`). ONE generated EmitSpec artifact. ONE manifest walker. ONE emit transformer. ONE distill transformer. ONE alias emitter. ONE round-trip test that exercises the whole loop. No per-class splits, no modular shape composition via `sh:node`, no per-concern shape profiles, no extracted `valueEncoders.ts`. Splits happen when a file actually becomes unmanageable, not prophylactically.

This rule is also load-bearing. The operator explicitly called out the "juggling constantly" feeling as the enemy, and consolidation is our hedge against it.

## The things I want you to critique

**Category 1 — Modeling and abstraction.**

- Is the EmitSpec as Level 2 derived artifact actually the right abstraction, or did I pick the wrong spot on the formalization spectrum? Specifically: is a JSON file consumed by both an emitter and a distiller the natural shape, or am I reinventing a worse version of something that already exists in the RDF ecosystem (R2RML, RML, JSON-LD framing, ShEx, LDO schemas)?
- Is the primary-class-IRI-for-distill-indexing decision correct? We emit Dataset with two `rdf:type` triples (`dcat:Dataset` and `schema:Dataset`) and the distill step indexes only on `dcat:Dataset`. Is this a sensible abstraction, or am I setting myself up for confusion when a future entity has three or four types?
- Is the manifest walker the right abstraction at all? The manifest carries `runtimeName → ontologyIri` per field. The EmitSpec derived from it carries `predicate`, `valueKind`, `cardinality`, and `lossy` markers per field. Is this a clean layering, or am I splitting an artifact that should be one thing?
- The distill direction reuses the exact same EmitSpec as emit, inverted. Is "use the same spec, invert the direction" actually simpler than "have a separate DistillSpec, possibly with different semantics," or is this false economy?

**Category 2 — Complexity and tractability (the operator's stated priority).**

- Where is this plan likely to feel like "juggling constantly" during implementation? Name specific moments or decisions where the cognitive load is going to spike.
- The locked plan has three Effect 4 services (`RdfStore`, `Shacl`, `Reasoner`), two code directories (`emit/`, `distill/`), one generated artifact, one shapes file, and one round-trip test. Is that the right shape, or is there a simpler shape where some of these collapse?
- Is there a case for making distill a SPARQL query against the store rather than a hand-written walker? We do not have SPARQL today; the research pointed out Oxigraph as a future option. But if distill is genuinely "extract all quads where `?s rdf:type dcat:Dataset` and project to a shape," maybe the right abstraction is a SPARQL query template rather than a code walker.
- Is there any benefit to NOT writing the distill direction at all in milestone 1, and instead having the round-trip test assert only "emit is stable" (deterministic Turtle output for the same input)? The operator reversed an earlier "defer distill" decision to get the full loop, but if the distill layer is where the juggling lives, maybe it should be cut.

**Category 3 — Milestone 1 pragmatics.**

- Loading the full cold-start catalog (~50–100K triples) through `shacl-engine` with referential integrity constraints is a real stress test. Based on what you know about `shacl-engine` performance, is this a reasonable milestone-1 bar or am I setting myself up for a validation timeout that I cannot debug? If it is going to fall over, what is the softer acceptance criterion I should start from instead?
- The expected side effect named in the plan is "PR 2 will probably surface 5–15 small model bugs in `references/data-layer-spine/manifest.json`, `src/domain/data-layer/catalog.ts`, `variable.ts`, and `alias.ts`, and those fixes land in the same PR." Is this a healthy pattern or a red flag that the plan is entangled with work that should be a separate ticket?
- The AEMO walkthrough in the design doc annex exposed five pain-point fixes that landed in the plan. Are there likely pain points from looking at OTHER publishers (EIA, NESO, Ember, Energy Charts, ENTSO-E, ODRÉ) that I should have surfaced before locking the plan?

**Category 4 — What I might have missed entirely.**

- Is there a research topic I failed to ask you about in the first round that is now obviously relevant given the locked plan? A pattern, a library, a pitfall, a mode of operation I have not considered?
- Is the file-count-discipline rule going to produce an unmanageable shapes file at the 7,400-entity / nine-entity-kind scale, or will it hold up for milestone 1? Where does it break — Variable? Series with fixedDims? Multi-typed Datasets?
- Is there a mode of SHACL validation I should be using that I haven't set up correctly? Open-world vs closed-world, default vs explicit `sh:closed`, targeting by `sh:targetClass` vs `sh:targetNode` vs SPARQL target — I have not made any of those choices explicit, and they matter at scale.

## Non-goals for this review

- **Do not re-argue the deferral decisions.** pySHACL, JSON-LD contexts, PROV-O, RDFS reasoning, shape modularization, staged strictness, named-graph routing are all explicitly deferred. You critiqued some of them in the first pass and I heard you. The operator's pace preference is to defer; we will revisit when pain forces it.
- **Do not propose a different library stack.** N3.js + shacl-engine + Effect 4 is locked. You can critique HOW I'm using them, not WHICH I chose.
- **Do not propose a different repository structure.** The three-repo boundary (ontology_skill → skygest-ontology-snapshots → skygest-cloudflare) is locked.
- **Do not propose a different project-level architecture.** DCAT-shaped catalog, SKOS vocabulary, Effect 4, Cloudflare Workers — all fixed.

## Response structure I want

1. **Executive summary (3–5 sentences).** Where is the locked plan likely to feel painful, where is it likely to work, and what is the ONE thing I should change before starting.
2. **Per-category critique.** Hit every bullet in the four categories above. Be direct. Flag things as "high-confidence concern," "speculative," or "style preference" so I know how much weight to give each.
3. **Specific suggestions for simplification.** Ranked list of changes that would reduce the juggling-feeling. Maximum five items. Each item should be actionable ("merge the distill directory into emit/" not "consider whether distill belongs where it is").
4. **The thing I most want to hear you say directly.** If there is a single sentence of the form "this plan is wrong about X, and the cost of getting it wrong is Y," say it plainly. I am asking for that sentence.
5. **What I missed (if anything).** A short list of topics that should have been in the first research pass but were not, along with what you would have said if I had asked.

## Tone and rigor

- Be opinionated. Flag things as "high-confidence concern," "speculative," or "style preference." I am calibrating on weight.
- Cite sources inline where they matter. Point me at specific docs, specific files in specific repos, specific paper sections when a real production pattern backs a claim.
- No marketing. Do not recommend a product or pattern because it would be neat; recommend it because it reduces the juggling risk.
- Be willing to say "your plan is wrong about X, and you will feel it in week one" if that is honest. I can always push back; I cannot un-hear a warning that was too polite to land.
- Response length: take what you need. 3,000 grounded words beats 8,000 hedged ones. 1,000 sharp words beats 3,000 grounded ones.

---

# CONTEXT BUNDLE

Attach the following files to the research context, in this order. All are in my local workspace at `/Users/pooks/Dev/skygest-cloudflare/`. Use the `docs/plans/2026-04-15-sky-362-review-context.md` artifact if it exists (it will be the concatenation of these files with proper delimiters); otherwise, the shell command at the bottom of this document will build it.

## CRITICAL (must include)

1. **`docs/plans/2026-04-15-sky-362-ontology-store-design.md`** — the locked design under review. This is the primary artifact.
2. **`docs/architecture/triplestore-rdf-design.md`** — your own earlier research output. Included as a reminder of what you said last time so you can assess whether the design correctly absorbed your recommendations.
3. **`CLAUDE.md`** (project root) — the Skygest development rules. Establishes Effect 4 native, DCAT-shaped, branded IDs everywhere, Worker-bundle-has-zero-Node-imports constraint.
4. **`references/data-layer-spine/manifest.json`** — the TS↔ontology manifest. THIS is the artifact the manifest walker consumes. The EmitSpec is derived from it.

## Important

5. **`docs/plans/2026-04-14-unified-triple-store-export-design.md`** — predecessor design doc. Section 1 has the full inlined schema reference; it is still load-bearing because the new design refers back to it.
6. **`src/domain/data-layer/catalog.ts`** — Effect Schema definitions for Agent / Catalog / CatalogRecord / Dataset / Distribution / DataService / DatasetSeries.
7. **`src/domain/data-layer/variable.ts`** — Effect Schema definitions for Variable / Series / Observation.
8. **`src/domain/data-layer/alias.ts`** — 23 alias schemes and the `ExternalIdentifier` shape.
9. **`src/domain/data-layer/annotations.ts`** — symbol-keyed inline RDF annotations.
10. **`src/domain/generated/dataLayerSpine.ts`** — the generated composition file (what the manifest walker effectively reverse-engineers).

## Reference (optional, only if the budget allows)

11. **`docs/plans/2026-04-14-ontology-from-prompt-layer-design.md`** — why we pivoted away from facet-shelf vocabulary stitching. Explains the downstream motivation for the ontology store (OEO binding will eventually consume this package).
12. **An AEMO example row pair.** The design doc annex walks `.generated/cold-start/catalog/agents/aemo.json` plus `datasets/aemo-nem-data.json` through the full pipeline. If you want to sanity-check my walkthrough against the real data, those two files are in `.generated/cold-start/catalog/agents/aemo.json` and `.generated/cold-start/catalog/datasets/aemo-nem-data.json`.

## Shell command to concatenate the CRITICAL + Important files

Run from the repo root. Produces `/tmp/sky-362-review-context.md`. Copy it into `docs/plans/` afterward if you want a permanent pin.

```bash
(
  echo "# SKY-362 design review context bundle"
  echo
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Repo: skygest-cloudflare"
  echo "Commit: $(git rev-parse HEAD)"
  echo "Branch: $(git rev-parse --abbrev-ref HEAD)"
  echo
  echo "---"
  echo
  echo "## CLAUDE.md (project root — development rules)"
  echo
  echo '```markdown'
  cat CLAUDE.md
  echo '```'
  echo
  echo "---"
  echo
  echo "## docs/plans/2026-04-15-sky-362-ontology-store-design.md (THE LOCKED DESIGN UNDER REVIEW)"
  echo
  echo '```markdown'
  cat docs/plans/2026-04-15-sky-362-ontology-store-design.md
  echo '```'
  echo
  echo "---"
  echo
  echo "## docs/architecture/triplestore-rdf-design.md (your earlier research — reminder of what you said)"
  echo
  echo '```markdown'
  cat docs/architecture/triplestore-rdf-design.md
  echo '```'
  echo
  echo "---"
  echo
  echo "## references/data-layer-spine/manifest.json (the TS↔ontology manifest the walker consumes)"
  echo
  echo '```json'
  cat references/data-layer-spine/manifest.json
  echo '```'
  echo
  echo "---"
  echo
  echo "## docs/plans/2026-04-14-unified-triple-store-export-design.md (predecessor design, Section 1 has the inlined schema reference)"
  echo
  echo '```markdown'
  cat docs/plans/2026-04-14-unified-triple-store-export-design.md
  echo '```'
  echo
  echo "---"
  echo
  echo "## src/domain/data-layer/catalog.ts (DCAT Effect Schema definitions)"
  echo
  echo '```typescript'
  cat src/domain/data-layer/catalog.ts
  echo '```'
  echo
  echo "---"
  echo
  echo "## src/domain/data-layer/variable.ts (V/S/O Effect Schema definitions)"
  echo
  echo '```typescript'
  cat src/domain/data-layer/variable.ts
  echo '```'
  echo
  echo "---"
  echo
  echo "## src/domain/data-layer/alias.ts (23 alias schemes)"
  echo
  echo '```typescript'
  cat src/domain/data-layer/alias.ts
  echo '```'
  echo
  echo "---"
  echo
  echo "## src/domain/data-layer/annotations.ts (symbol-keyed inline RDF annotations)"
  echo
  echo '```typescript'
  cat src/domain/data-layer/annotations.ts
  echo '```'
  echo
  echo "---"
  echo
  echo "## src/domain/generated/dataLayerSpine.ts (generated ontology-field composition)"
  echo
  echo '```typescript'
  cat src/domain/generated/dataLayerSpine.ts
  echo '```'
) > /tmp/sky-362-review-context.md

wc -l /tmp/sky-362-review-context.md
wc -c /tmp/sky-362-review-context.md
```

After running that, paste `/tmp/sky-362-review-context.md` into the target model as a system / context message, then paste the **REVIEW PROMPT** section of this document (above) as the user message. Budget ~1 hour of extended thinking.
