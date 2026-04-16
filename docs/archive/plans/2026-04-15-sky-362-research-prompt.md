---
status: research-prompt
created: 2026-04-15
target: GPT-5 Pro (extended thinking, ~1 hour budget)
purpose: Production-pattern research for SKY-362 ontology store design
related:
  - docs/plans/2026-04-15-sky-362-ontology-store-design.md
  - docs/plans/2026-04-14-unified-triple-store-export-design.md
  - docs/plans/2026-04-14-ontology-from-prompt-layer-design.md
---

# Research prompt — ontology store production patterns and SHACL validation

## How to use this document

This is a self-contained research prompt for an extended-thinking model (GPT-5 Pro, ~1 hour). It is NOT a prompt for Claude Code. Paste the entire "RESEARCH PROMPT" section below into the target model, along with the context files listed in the "CONTEXT BUNDLE" section. The model should have access to a web search tool.

The goal is concrete, citable, production-pattern answers — not abstract advice. If an answer cannot be backed by a real production system or paper, say so and move on.

---

# RESEARCH PROMPT

## Who I am and what I am building

I am building a knowledge-graph-backed content intelligence product for the energy sector. The stack is TypeScript on Cloudflare Workers, with a D1 (SQLite) relational store, Effect 4 for services and error handling, and Effect Schema as the single source of truth for all domain types. I have an operational data catalog modelled in Effect Schema following DCAT semantics — Agents (publishers), Catalogs, CatalogRecords, Datasets, Distributions, DataServices, DatasetSeries, and SDMX-style Variable / Series / Observation tuples. Every DCAT entity uses branded ULID-prefixed URIs in my own namespace. Field-level ontology mappings (to DCAT, DCTERMS, FOAF, PROV, SKOS, schema.org) are already declared in a JSON manifest and in inline Effect Schema annotations — the TS↔ontology bridge is half built.

I am introducing a new workspace package `packages/ontology-store/` that will be the **living ontology store** for the system. Its job is to ingest domain entities into an in-memory triple store, validate them against SHACL shapes published alongside the ontology in a separate versioned snapshot repo, and distill the resulting graph back into Effect Schema domain types on read. This seam is the load-bearing piece for several future features: SHACL-driven canonicalization, OEO (Open Energy Ontology) binding from prompt-layer scientific extraction, reasoner-driven enrichment, and eventually ingest of linked posts + charts (bundles of an expert's social post and the chart assets they attached).

Short version: I have a production DCAT catalog in TypeScript, I have an ontology in TTL sitting inert in a git repo, and I want to wire them together as a two-way Effect-native triple store seam. **I am not trying to invent this wheel**, and I want to know how real production systems handle the concerns below before I commit to a shape.

The tentative library choices are **N3.js** for the store and parser, **shacl-engine** for SHACL validation, and Effect 4 for service wrapping. A nearby reference project (`effect-ontology`) uses these same libraries under Effect 3. I will adapt their patterns to Effect 4, but their architectural decisions should not be treated as ground truth.

## The core questions

I need production-grounded answers on six clusters. For each cluster, tell me:

1. What do real production systems do for this concern?
2. What do they avoid, and why?
3. What tool or library do they typically reach for?
4. Where is the line between "necessary for correctness" and "overbuilt"?
5. Concrete examples from open-source projects, papers, or vendor docs.

### Cluster 1 — Domain-type ↔ RDF graph round-tripping

I have a TypeScript Effect Schema representation of every DCAT entity. I want to be able to:

- Emit every entity into an N3 quad store (I already know how — manifest walker over declared `ontologyIri` per field).
- Validate the resulting store with SHACL shapes published alongside the ontology.
- Serialize the store to Turtle.
- Re-parse the Turtle into a fresh store.
- Distill the store back into Effect Schema typed domain objects via `Schema.decode`.

I am NOT trying to assert bit-level equality. RDF carries strictly more information than the TS side (inferred triples, upstream vocabulary, crosswalks) and the TS side carries runtime-local metadata that does not project into RDF (tags, computed fields, timestamps). I want "projection-level parity" — the distilled domain type carries the same load-bearing fields as the source entity, within explicitly declared lossy boundaries.

**Questions:**

1. How do production ontology systems handle the impedance mismatch between a native object model and a triple store? What do they test, and how?
2. Do real systems actually do full round-trips at test time, or do they test each direction independently (emit + SHACL-validate on the forward path, query + decode on the reverse path)?
3. Is there a canonical "projection parity" testing pattern, or is this a smell that my model layer is wrong?
4. What do systems like Stardog, Ontotext GraphDB, Apache Jena, or Eclipse RDF4J do when they need to expose typed Java/Scala/Python bindings over RDF? What patterns emerge?
5. Are there projects that use JSON-LD contexts as the bridge instead of a hand-curated manifest? What are the trade-offs?

### Cluster 2 — SHACL validation in production

I plan to use shacl-engine (JS) to enforce constraints that Effect Schema cannot express cleanly — cross-entity constraints, controlled-vocabulary enforcement, referential integrity, and alias-scheme consistency. Everything per-record and type-shaped stays in Effect Schema.

**Questions:**

1. Where do production systems actually draw the line between "this constraint belongs in the type system" and "this constraint belongs in SHACL"? Show me real examples from open-source ontology projects if possible.
2. How do production systems structure SHACL shapes files for maintainability at the 50-100 shape range? Do they co-locate shapes per class, group by concern (cardinality, vocabulary, referential), or use inheritance via `sh:node`?
3. How do production systems version SHACL shapes against the ontology? Do shapes live in the same repo, or a separate one? What happens when a new ontology release adds constraints that existing data violates?
4. What are the performance characteristics of shacl-engine on ~10,000 to ~100,000 triples? At what size does JS SHACL validation become a problem?
5. Are there better alternatives to shacl-engine in the JS ecosystem? What about going off-platform (Python pyshacl, Java TopBraid, Jena SHACL)?
6. How do production systems handle SHACL violation reports — hard-fail on any violation, partition data by severity, offer a manual fix-up UI? What's the operational pattern?

### Cluster 3 — Versioning, snapshotting, and drift

I already have a three-repo boundary:

- `ontology_skill` — Python + ROBOT authoring workbench
- `skygest-ontology-snapshots` — git-tagged versioned TTL + N-Triples + SHACL shapes + lookup JSON
- `skygest-cloudflare` — the TypeScript runtime that fetches a pinned snapshot at postinstall

The snapshot repo is the runtime source of truth. The authoring workspace is just a drafting surface. Publishes are manual, PR-driven, semver-tagged.

**Questions:**

1. Is this three-repo boundary a known pattern, and if so, what is it called?
2. How do production ontology systems manage drift between a published ontology version and the operational code that consumes it? What's the deprecation model — a sunset period, a `owl:deprecated` flag, both?
3. When an ontology release renames a predicate (`foaf:name` → `rdfs:label`, hypothetically), what does a production system actually do? How is the cutover coordinated with consumers?
4. Is there a standard for publishing ontology versions? (I know about `owl:versionIRI` and `owl:priorVersion`, but how much machinery does a real system build around them?)
5. What's the canonical way to handle SHACL shapes versioning specifically? Shapes that are too strict for existing data will break every downstream consumer on upgrade.

### Cluster 4 — Ingest and change tracking

Right now my plan is a whole-catalog rebuild: emit everything into a fresh N3 store, validate, serialize, done. That's fine for a small catalog (tens of thousands of triples) but it doesn't scale, and it doesn't support incremental ingest — which I will want when linked post/chart bundles start flowing through.

**Questions:**

1. What's the production pattern for incremental ingest into a triple store? Do systems track dirty entities and emit patches, or rebuild per-class subgraphs?
2. How do production systems handle delete semantics? RDF has no native "update" — everything is add-or-remove. What's the pattern for "this Dataset is no longer published"?
3. Are named graphs the right unit of versioning (one named graph per ingest batch)? Or is quad-level provenance (rdf-star, RDF 1.2 triple terms) the direction?
4. For a content-intelligence use case where social posts link to charts link to datasets link to variables, what's the canonical way to model provenance across that chain in the graph? PROV-O all the way? Named graphs per resolution run? Both?

### Cluster 5 — Reasoning and inference

I am deferring reasoning in the first milestone but I want to build the service interface so that RDFS forward-chaining can be added without breaking consumers. Later I might want OWL-lite or a custom rule system.

**Questions:**

1. For an operational catalog ontology (DCAT + domain vocab, not a biomedical ontology), how much reasoning is actually useful? Does anyone turn on full OWL reasoning for DCAT catalogs, or is RDFS subsumption enough?
2. What's the production choice in the JS ecosystem for RDFS reasoning? N3.js built-in reasoner? Eye? Something else?
3. For the closed-loop vision (ingest → SHACL → canonicalize → reason → enrich → re-persist), is reasoning supposed to materialize triples or be computed at query time? What do real systems do?
4. At what point does an ontology store need to move to a persistent quad store (Oxigraph, Jena TDB, Blazegraph, Stardog) because reasoning over an in-memory N3.Store becomes infeasible?

### Cluster 6 — Library and stack choices

**Questions:**

1. Is N3.js the right primary store library for this use case, or should I be looking at quadstore (with LevelDB), rdflib.js, or going straight to Oxigraph WASM?
2. What are the known footguns of N3.js at the 100K-triple scale? Memory, parsing speed, serialization correctness for edge cases (typed literals, language tags, blank nodes)?
3. Is there a better JS SHACL validator than shacl-engine? I want one that returns structured reports and does not fork the JVM.
4. Are there production systems that marry TypeScript + Effect (or a similar typed-IO wrapper) + RDF? If yes, what do they look like architecturally? (I know about LinkedDataHub, LDKit, graphy.js, rdf-ext — but I have not seen an Effect-native one besides the reference repo I am adapting from.)
5. If I were to abandon the in-memory store and commit to a lightweight persistent one from day one, what would the trade-offs be? Oxigraph embedded, quadstore, or Jena Fuseki as a sidecar?

## What I need from the response

**Structure:**

1. **Executive summary (2-3 paragraphs).** Where is my current design pointing the right direction, where is it at risk, and what's the biggest decision I should make before starting implementation.
2. **Per-cluster answers.** For each of the six clusters above, hit every numbered question directly. Cite real projects and real patterns. Flag anything where you cannot find production evidence.
3. **Concrete recommendations.** A ranked list of "things I should do differently" and a second list of "things I should keep." Both lists should be ~5 items each and reference the clusters they came from.
4. **Reading list.** A short list of papers, open-source repos, and vendor docs I should read to go deeper. Prioritize things that are actually maintained and actually in production use, not academic curiosities.

**Tone and rigor:**

- Be opinionated. I am not looking for a survey; I am looking for judgment calls backed by evidence.
- Cite sources inline where possible. Point me at specific files in specific repos when you reference a production pattern.
- Flag guesses as guesses. If you are not sure, say "I believe…" or "this is speculative."
- No marketing. Do not recommend a product because its docs are glossy; recommend it because it solves the problem well.
- Be willing to tell me "your design is wrong about X" if that's the honest answer. I would rather hear it now than after three weeks of implementation.

**Length:** take the space you need. This is an extended-thinking run with a ~1 hour budget; I would rather have 5,000 words of grounded analysis than 1,500 words of hedged generalities.

---

# CONTEXT BUNDLE

Attach the following files to the research context, in this order. They are all in my local workspace. Paste the full content of each file verbatim — do not summarize. If the target model has a token budget, prioritize the files marked **CRITICAL**.

## CRITICAL (must include)

1. **`docs/plans/2026-04-15-sky-362-ontology-store-design.md`** — the full design doc for the package we are trying to build. This is the primary source of truth for what I am trying to build.
2. **`docs/plans/2026-04-14-unified-triple-store-export-design.md`** — earlier design context including the inlined DCAT schema reference. Section 1 (Schema reference) is especially load-bearing — it shows exactly what entities I am trying to emit as RDF.
3. **`docs/plans/2026-04-14-ontology-from-prompt-layer-design.md`** — why we pivoted away from facet-shelf vocabulary stitching to OEO binding. Explains the downstream motivation for the ontology store.
4. **`CLAUDE.md`** (project root) — the Skygest development rules. Establishes that we are Effect 4 native, DCAT-shaped, branded IDs everywhere, and that the Worker bundle has a zero-Node-imports constraint.
5. **`references/data-layer-spine/manifest.json`** — the TS↔ontology manifest. This is THE artifact the manifest walker consumes. Include the full file; it is not large.

## Important (include if budget allows)

6. **`src/domain/data-layer/catalog.ts`** — the Effect Schema definitions for Agent, Catalog, CatalogRecord, Dataset, Distribution, DataService, DatasetSeries. Primary source for what the domain types look like.
7. **`src/domain/data-layer/variable.ts`** — the Effect Schema definitions for Variable, Series, Observation.
8. **`src/domain/data-layer/alias.ts`** — the alias scheme definitions (23 schemes spanning ontology terms, publisher identifiers, wikidata, doi, ror).
9. **`src/domain/data-layer/annotations.ts`** — the symbol-keyed inline RDF annotations (`DcatClass`, `DcatProperty`, `SkosMapping`, `SchemaOrgType`, `SdmxConcept`, `DesignDecision`).
10. **`src/domain/generated/dataLayerSpine.ts`** — the generated file that the manifest walker effectively reverse-engineers. Shows the shape of `AgentOntologyFields`, `DatasetOntologyFields`, `VariableOntologyFields`, `SeriesOntologyFields`.

## Reference (optional, include last)

11. **`docs/plans/2026-04-15-git-backed-snapshots-spec.md`** — the full snapshot fetch and versioning spec. Explains why the ontology + shapes live in a separate git-tagged repo.
12. **`docs/plans/2026-04-15-sky-361-362-execution-plan.md`** — the execution plan. Shows how this ticket fits into the broader snapshot chain.
13. **Recent ticket state for SKY-213, SKY-361, SKY-362, SKY-364, SKY-348, SKY-349** — from Linear. These are the parent and sibling tickets that establish the surrounding work.
14. **A pointer to `/Users/pooks/Dev/effect-ontology/packages/@core-v2/`** as the Effect 3 reference implementation we are adapting from. The relevant files are `src/Service/Rdf.ts` (lines 381-476), `src/Service/Shacl.ts` (lines 1-139), `src/Service/Reasoner.ts` (lines 1-200), `src/Utils/Rdf.ts` (lines 432-476), and `src/Domain/Rdf/` (the branded RDF primitives).

## Shell command to concatenate the CRITICAL files into a single context blob

Run from the repo root. Produces `/tmp/sky-362-research-context.md` which is directly pastable into the research model alongside the RESEARCH PROMPT section above.

```bash
(
  echo "# SKY-362 research context bundle"
  echo
  echo "## CLAUDE.md (project root)"
  echo '```markdown'
  cat CLAUDE.md
  echo '```'
  echo
  echo "## docs/plans/2026-04-15-sky-362-ontology-store-design.md"
  echo '```markdown'
  cat docs/plans/2026-04-15-sky-362-ontology-store-design.md
  echo '```'
  echo
  echo "## docs/plans/2026-04-14-unified-triple-store-export-design.md"
  echo '```markdown'
  cat docs/plans/2026-04-14-unified-triple-store-export-design.md
  echo '```'
  echo
  echo "## docs/plans/2026-04-14-ontology-from-prompt-layer-design.md"
  echo '```markdown'
  cat docs/plans/2026-04-14-ontology-from-prompt-layer-design.md
  echo '```'
  echo
  echo "## references/data-layer-spine/manifest.json"
  echo '```json'
  cat references/data-layer-spine/manifest.json
  echo '```'
  echo
  echo "## src/domain/data-layer/catalog.ts"
  echo '```typescript'
  cat src/domain/data-layer/catalog.ts
  echo '```'
  echo
  echo "## src/domain/data-layer/variable.ts"
  echo '```typescript'
  cat src/domain/data-layer/variable.ts
  echo '```'
  echo
  echo "## src/domain/data-layer/alias.ts"
  echo '```typescript'
  cat src/domain/data-layer/alias.ts
  echo '```'
  echo
  echo "## src/domain/data-layer/annotations.ts"
  echo '```typescript'
  cat src/domain/data-layer/annotations.ts
  echo '```'
  echo
  echo "## src/domain/generated/dataLayerSpine.ts"
  echo '```typescript'
  cat src/domain/generated/dataLayerSpine.ts
  echo '```'
) > /tmp/sky-362-research-context.md

wc -l /tmp/sky-362-research-context.md
```

After running that, paste `/tmp/sky-362-research-context.md` into the target model as a system/context message, and paste the **RESEARCH PROMPT** section (above) as the user message. Budget ~1 hour of extended thinking.
