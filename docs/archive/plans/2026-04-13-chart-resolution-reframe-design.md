# Chart Resolution Reframe — Ontology-First, Retrieval-Based

**Date**: 2026-04-13
**Status**: Brainstorming session output — validated direction, pending fact-finding before implementation
**Context**: skygest-energy-vocab DCAT structural extension + Stage 2 resolution kernel + SKY-213 Data Intelligence Layer epic
**Fact-finding tickets**: SKY-335, SKY-336, SKY-337, SKY-338 (all children of SKY-213)

## Purpose

Step back from slice-by-slice kernel optimization and reframe how the chart → Variable resolution pipeline should be structured, so that:

1. The DCAT spine (Agent → Dataset → Series → Variable) in `skygest-energy-vocab` is the load-bearing integration model — not decoration.
2. The resolution runtime is simple (retrieval + gate), not a facet algebra in the hot path.
3. The ontology's reasoning power (unit algebra, cross-facet constraints, property chains, compound concepts) lives where reasoning actually belongs — at index-time, validation-time, and as post-link consistency checks — not as an inner loop of the kernel.
4. The eval is reframed from classification ("did we pick the right Variable?") to retrieval ("was the right Variable in top-K, and where did it rank?"), so tuning signals stop violently swapping a 76-row gold set's bucket counts.

This document captures the session end-to-end so the next implementer can pick it up cold.

## What exists today

### Ontology side (sevocab v0.2)

- 8 ConceptSchemes, 114 concepts, 771 surface-form entries across 7 active facets (measuredProperty, domainObject, technologyOrFuel, statisticType, aggregation, unitFamily, policyInstrument)
- Structural extension committed 2026-04-12 (SKY-316/318): `EnergyAgent`, `EnergyDataset`, `Series`, `EnergyVariable` as OWL classes, DCAT chain wired with `dct:publisher`, `sevocab:hasSeries`, `sevocab:implementsVariable`, `sevocab:hasVariable`
- 74 SPARQL competency questions, HermiT-clean, 15 structural CQs added in SKY-318
- Research doc: `docs/research/2026-04-12-resolution-algebra.md` — formalizes Lexicon (L), Product Lattice (V), DCAT functor (R) with join / subsumes / specificity / resolvable as the TS ↔ SPARQL bridge. **This doc is a correctness argument, not a runtime spec.**

### TypeScript side (skygest-cloudflare)

- Vision enrichment schema at `src/domain/enrichment.ts` and `src/domain/media.ts`:
  - `VisionAssetAnalysisV2` per chart: `title`, `xAxis`, `yAxis`, `series[]`, `sourceLines[]` (each carrying `{sourceText, datasetName}`), `temporalCoverage`, `chartTypes`, `keyFindings`, `visibleUrls`, `organizationMentions`, `logoText`
  - `VisionEnrichment` per post: `summary` + `assets[]`
- `SourceAttributionEnrichment` runs as a **separate** enrichment kind and produces `provider: ProviderReference | null` + `providerCandidates` + `contentSource`. This is the Agent resolver — and it already exists.
- **Stage 1 already has a URL-aware schema**: `src/domain/stage1Shared.ts:18-33` defines `UrlSource = post-link | link-card | visible-url | source-line | provider-homepage` and `Stage1MatchGrain = Distribution | Dataset | Agent | Variable`. The Stage 1 resolver already knows that URLs can target *any* of the four DCAT grains, not just Agent. The design must not re-invent this layer.
- Resolution kernel at `src/resolution/kernel/Interpret.ts` lumps `series-label`, `chart-title`, `x-axis`, `y-axis` together as `IDENTITY_SOURCES` and joins all four into one shared `PartialVariableShape` via `foldAssignments`. URLs are not part of `IDENTITY_SOURCES` — the kernel delegates URL handling to Stage 1 and doesn't re-use the URL signal inside Stage 2.
- `DataRefResolutionEnrichment` persists `stage1 + kernel[]` outcomes in D1.
- Eval: 76-row gold set, buckets `wrong-new-match` / `ambiguous` / `no-facet-match`. Slice-by-slice tuning of facet vocabularies against this small N.

### What was already on the right track

- The research doc correctly identifies all five gaps (no explicit lattice algebra in TS, no compound concept type, no conflict/ambiguity model, no SSSOM bridge, no inverse indices).
- `Interpret.ts` already distinguishes `IDENTITY_SOURCES` (project into partial) from `NARRATIVE_SOURCES` (evidence-only, no projection). The distinction is correct in principle.
- `SourceAttributionEnrichment` already resolves the publisher/Agent upstream of the kernel.
- `sourceLines[].datasetName` is already extracted by the vision prompt and lives in the schema.
- `sevocab:Series` already exists as the first-class structural class for chart-line-level resolution targets (SKY-316).

## The core diagnosis

The session surfaced three conflations that are making the kernel look harder than it is:

### Conflation 1: One chart = one Variable

The kernel assumes a chart resolves to a single Variable. But a multi-line chart (Wind / Solar / Gas generation in Germany) is *N Variables* that share a stem and differ on one discriminator dimension. Forcing all N series labels through one shared `foldAssignments` either creates conflicts and throws candidates away, or silently overwrites losing the information.

**The chart's internal structure already encodes the decomposition.** `VisionAssetAnalysisV2` gives us `title + xAxis + yAxis + temporalCoverage + sourceLines` as the shared stem, and `series[]` as the per-line discriminators. The decomposition is a loop over `series[]`, not a kernel algorithm.

### Conflation 2: Linking and reasoning are one pipeline

"Find which Variable this chart refers to" (linking, an IR/retrieval problem) and "verify this Variable is consistent with what the chart says" (reasoning, an ontology problem) are being solved by the same code path. They shouldn't be.

- Linking benefits from the DCAT commitment because you search into a structured index, not because you execute SPARQL at runtime.
- Reasoning benefits from the ontology's formal semantics because you can post-check a resolved candidate against unit algebra, cross-facet constraints, publisher sanity — but only *after* you've resolved it.

Wedging reasoning into the linking hot path buys you nothing except complexity and SPARQL-in-the-request-path.

### Conflation 3: Algebra and runtime are one thing

The research doc's lattice algebra is a correct formal specification. It says: "here is what it would mean for the kernel to be correct." But nothing forces the kernel to execute `join()` and `subsumes()` as runtime code. The algebra is what *justifies* a simpler retrieval-based implementation — it's the proof that retrieval-with-gate is sound, not a recipe for what code to write.

The lattice stays in `docs/research/` as the correctness argument. The runtime is retrieval.

## The reframed architecture

### Pipeline shape

```
enriched post (vision + source-attribution already run)
  │
  ├─► Agent:    sourceAttribution.provider         ← already resolved upstream
  │             (one field read, not a lookup)
  │
  ▼
for each asset in vision.assets[]:
  │
  ├─► [URL resolver]  (new lane, zero runtime cost)
  │     collect_urls(asset.visibleUrls, asset.sourceLines, post.linkCards, post.text)
  │     lookup each against pre-built DCAT URL→node index
  │     → Distribution hit: collapse to (Distribution, Dataset, Series, Variable, Agent), DONE
  │     → Dataset hit:      set dataset_scope, continue
  │     → Agent hit:        set agent_scope (override source-attribution null), continue
  │     → no hit:           fall through, agent_scope from source-attribution if any
  │
  ▼
  decompose(asset) → (stem, lines[])
  │
  ▼
[Dataset retrieval]
  skip if dataset_scope already set by URL lane
  query = stem.title + stem.axes + stem.sourceLines[].datasetName
  scope = if Agent known: restrict to Agent's Datasets/Series
  index = pre-built Variable-card index from build.py
  │
  ▼
for each line in lines[]:
  [Variable retrieval]
    query  = stem fields + line.legendLabel + line.unit
    scope  = if Dataset known: restrict to its Variables/Series
  │
  ▼
  [Required-facet gate]     ← one predicate derived from SHACL EnergyVariableShape
    pass? continue
    fail? hand to LLM with partial candidate list
  │
  ▼
  [Tie-break / rank]
    single survivor → resolved
    ties           → hand to LLM with structured candidates
  │
  ▼
  [Post-link validation]    ← ontology reasoning lives HERE, optional, non-blocking
    unit algebra check, cross-facet consistency, publisher sanity
    fail → flag, don't block
  │
  ▼
  resolved (Variable + Agent + Dataset + Series + confidence + evidence trail)
```

### URLs are a distinct input channel — not another facet

URL signals belong in their own lane, alongside (not inside) the stem + lines decomposition. The existing `UrlSource` taxonomy already tells us they have five provenances with different trust profiles:

| UrlSource | Example | Trust | Resolution grain |
|---|---|---|---|
| `visible-url` | `eia.gov/electricity/monthly` burned into a chart image | Very high — the publisher put it there | Usually Dataset or Distribution |
| `source-line` | URL extracted from "Source: ENTSO-E Transparency (transparency.entsoe.eu/...)" | Very high | Dataset/Distribution |
| `link-card` | Post's attached link card (AT Protocol / Twitter) | High — author chose to attach it | Dataset or Agent landing |
| `post-link` | URLs in the post body text | Medium — author-provided but not chart-specific | Mixed |
| `provider-homepage` | Derived URL for a known provider | Low — fallback | Agent only |

The critical property: **URLs can short-circuit to any of the four DCAT grains** (Distribution, Dataset, Series, Agent — Stage1MatchGrain already recognizes all four). A visible URL like `https://www.eia.gov/opendata/qb.php?sdid=ELEC.GEN.WND-US-99.A` resolves directly to a *Distribution* (and transitively to the Series and Variable) without any facet decomposition, lexicon lookup, or retrieval. A URL like `https://transparency.entsoe.eu/generation/r2/actualGenerationPerProductionType/show` resolves to a Dataset landing page. A URL like `https://eia.gov/` resolves to an Agent.

**Design implication: URL lookup runs before retrieval, and a URL hit can collapse the rest of the pipeline.**

```
URL resolver (new lane, built on top of existing Stage1 URL schema):
  for each URL in collect_urls(asset, post):
    normalize(url)
    lookup(url) against pre-built DCAT accessURL/landingPage index
    → if exact Distribution hit: return (Distribution, Dataset, Series, Variable, Agent) — done
    → if prefix Dataset hit: set dataset scope, continue to Variable retrieval
    → if Agent-homepage hit: set agent scope, continue to Dataset retrieval
    → no hit: emit no constraint
```

Where `collect_urls` pulls from:
1. `asset.visibleUrls[]` (very high trust — the publisher literally drew it on the chart)
2. `asset.sourceLines[].sourceText` (regex-extracted URLs with source-line provenance)
3. `post.linkCards[].uri` with source = `embed` or `media`
4. URLs in `post.text` (lowest priority)

And `lookup` is a pre-built index generated at build time by walking the DCAT catalog:
- every `dcat:Distribution.accessURL` and `downloadURL` → Distribution ID
- every `dcat:Dataset.landingPage` → Dataset ID (plus prefix-match variants)
- every `foaf:Agent.homepage` → Agent ID
- every `sevocab:Series` with a persistent identifier URL → Series ID

This is the **DCAT commitment literally paying off at runtime** — but it's still offline-built, O(1) lookup, no SPARQL in the hot path. The ontology describes *what* these URLs mean; `build.py` materializes the `URL → DCAT node` lookup table.

#### How URLs interact with stem + lines

URL signals and text signals are **complementary constraints**, not alternatives:

- **URL → coarse scope** (Distribution / Dataset / Agent). Usually precise at the Dataset grain but not the Variable grain — one Dataset publishes many Variables.
- **Stem + lines → fine-grained target** (Variable, within whatever scope URL gave us).

The flow becomes:

```
  1. URL resolver narrows the DCAT subgraph to the smallest provably correct scope.
     (best case: Distribution hit → done)
     (common case: Dataset hit → scope set, proceed to Variable retrieval within it)
     (worst case: nothing → fall through to Agent scope from source-attribution, or unscoped)

  2. Stem retrieval narrows further:
     - within Dataset: which Series does the stem (title, temporal, axes) pick out?
     - if no Dataset yet: which Dataset does the stem (title, datasetName, axes) pick out?

  3. Per-line Variable retrieval picks the specific line within the Series/Dataset.
```

Three things this gives us:

1. **URL hits are free wins.** A visible URL on an EIA chart makes the rest of the pipeline trivial — we've already got the Dataset, and "which Variable" is just fuzzy-matching the stem against its Variables. Vocabulary tuning becomes irrelevant for this bucket.
2. **URLs disambiguate multi-Dataset Agents.** The source-attribution enrichment gives us the Agent, but an Agent like EIA publishes dozens of Datasets. A visible URL in the chart image tells us exactly *which* Dataset without any natural-language reasoning.
3. **URLs bypass the facet vocabulary entirely.** This is the strongest argument against continuing to tune the facet vocabulary against the 76-row gold set. If even 30% of charts carry a resolvable URL, those rows should never hit the facet lane at all — they should short-circuit. The eval buckets should probably be split: "URL-resolvable" vs "URL-unresolvable" vs "no URL", then measured independently.

#### Interaction with Stage 1 that already exists

Stage 1 already has `UrlSource`, `Stage1MatchGrain`, and (presumably) a URL-matching lane. The reframe's job here is not to build a new URL resolver — it's to:

- **Verify what Stage 1 currently does with URLs.** The SKY-337 inventory ticket explicitly covers this.
- **Confirm the URL → DCAT lookup table exists** (or add it to `build.py` if not).
- **Ensure Stage 1's URL hits flow into the reframed Stage 2 as scope constraints**, not as parallel hypotheses that get reconciled via some join operation. Stage 1 narrows the DCAT subgraph; Stage 2 picks the Variable within that narrowed subgraph. Clean handoff.

### What each layer does

**Agent (α-path, free):**
- Read `sourceAttribution.provider` from the post's enrichment output. Zero new code. If present, this is the resolved Agent and it becomes the scoping filter for Dataset/Variable retrieval.
- Fallback β-path: if `provider` is null, skip the scoping step and retrieve unscoped.
- Note: URL signals (previous section) often give you the Agent for free even when source-attribution misses it — a `visible-url` with host `eia.gov` is an Agent hit by host match alone.

**Decomposition (trivial):**
- Loop over `vision.assets[]` then over `asset.series[]`. That's it.
- `|series| == 0` → stem-only, target is a Dataset (or a singleton Series if the stem picks one uniquely).
- `|series| == 1` → one Variable, stem ⋈ line is a one-liner.
- `|series| >= 2` → N Variables, one per line, all sharing the same parent Series/Dataset.
- **Never join across lines.** Each line is an independent resolution target.

**Retrieval (the actual kernel):**
- Dense + lexical search over a pre-built index. Index documents are Variable cards: `label + altLabels + facet labels + parent Dataset title + Agent name`.
- The ontology build pipeline (`ontologies/skygest-energy-vocab/scripts/build.py`) generates these cards offline — it already generates the per-facet JSON vocabulary files, we're just adding a Variable-card index as another output.
- Scoping by Agent / Dataset is just a pre-filter on the index before ranking.
- Ranking is BM25 + dense embeddings fused. Top-K with K small (5–10).

**Gate (one predicate):**
- `resolvable(candidate) = candidate.measuredProperty !== undefined && candidate.statisticType !== undefined`
- Derived directly from SHACL `EnergyVariableShape`. If the SHACL changes, regenerate the predicate.
- Gate failure hands the partial candidate list to the LLM stage with a precise contract: "fill measuredProperty and/or statisticType from context."

**Post-link validation (ontology reasoning, optional):**
- Runs after a single candidate is picked. Non-blocking — failures flag, don't reject.
- Unit algebra: is the chart's Y-axis unit compatible with the resolved Variable's `unitFamily`? (e.g., TWh on a chart resolved to a `Price` variable → flag.)
- Cross-facet consistency: does the candidate's facet profile imply a combination we've flagged as nonsensical? (e.g., spot × annual, share × absolute count.)
- Publisher sanity: does the Agent actually publish the Dataset we resolved to? (Should be guaranteed by scoping, but verify.)
- These checks live as SPARQL queries or Python scripts, not in the kernel hot path. They run async on the resolved outcome.

### What gets deleted / reshaped

Pending SKY-337 inventory. Candidates for deletion:
- `foldAssignments` over `IDENTITY_SOURCES` — replaced by per-line partials.
- Multi-evidence lattice join logic inside Interpret.ts — replaced by retrieval query assembly.
- Any kernel-side Agent matching — `sourceAttribution.provider` is the source of truth.
- SKY-314's Cartesian decomposition — becomes "iterate `series[]`", done at the input layer.

Candidates for reshape:
- `PartialVariableShape` stays as the internal data structure, but is built from retrieval matches, not from kernel-side decomposition.
- The facet vocabulary JSONs stay and feed index enrichment, not runtime matching.
- The gold set gets reframed as retrieval eval with recall@K and MRR.

## Why this fixes the eval concern

The current eval asks "did the kernel produce the right Variable?" on 76 rows, and tuning facet vocabularies moves 9/37/40 bucket counts violently. That's classification-eval framing on what is fundamentally a retrieval problem. Small vocabulary changes cause large bucket swings because the signal is sparse.

Reframed as retrieval:

- **Recall@K**: "Is the true Variable in the top-K candidates?" Smooth signal, bounded above by retrieval quality.
- **MRR**: "Where in the ranked list does the true Variable appear?" Smooth gradient for tuning.
- **Gate precision**: "Of the top-1s that pass the gate, how many are correct?" Bounded above by the gate's discriminating power.
- **Scope precision**: "Of the Agent-scoped retrievals, how many are correct vs. unscoped?" Directly measures the DCAT spine's contribution.

These are independent axes. Tuning retrieval doesn't thrash gate metrics. Tuning the gate doesn't thrash scope metrics. No more eval whack-a-mole.

## Why the DCAT commitment pays off (without SPARQL in the hot path)

The user's concern was about over-engineering the ontology while still keeping the DCAT commitment. This reframe preserves the commitment *and* gets more out of it:

1. **The chart's internal structure maps onto the DCAT chain by construction.** Agent (from source-attribution) → Dataset (from `sourceLines[].datasetName` + stem) → Series (from stem + temporal coverage) → Variable (from stem + line discriminator). Every resolution step is a DCAT traversal. We don't need to reason about it at runtime — the structure *is* the reasoning.

2. **Scope filtering is a DCAT walk.** When we know the Agent, restricting to that Agent's Datasets is a foreign-key lookup in the registry, not SPARQL. That's the DCAT chain doing exactly what it's for.

3. **The ontology becomes the index generator.** `build.py` extends to produce Variable cards that carry the DCAT context inline. At retrieval time, you search rich documents, not bare labels.

4. **Reasoning (unit algebra, cross-facet, etc.) lives as post-checks.** When we add those capabilities later, they don't change the kernel — they add a validation step. The kernel stays simple; the ontology stays the design authority for what "valid" means.

## What deeper semantics get enabled (phase 2, not phase 1)

The user wanted both deeper domain semantics (A) and DCAT-graph reasoning (C), but explicitly said not to over-engineer for them now. This architecture leaves clean hooks:

- **Unit algebra**: when we formalize power × time = energy in OWL/SHACL, it becomes a post-check. No kernel change.
- **Compound concepts**: when we add `"henry hub" → {domainObject=NaturalGas, measuredProperty=Price, aggregation=Spot}` as a first-class cross-scheme surface form, it becomes an index enrichment. The retrieval query expands at build time, not at runtime.
- **Property-chain materialization for `hasVariable`**: when we turn on the reasoner to materialize `Dataset hasVariable Variable` from the `hasSeries ∘ implementsVariable` chain, it becomes extra edges in the registry. The retrieval scoping automatically gets stronger.
- **SSSOM bridge**: when OEO/Wikidata/UCUM mappings become typed edges with confidence scores, they become additional index entries with provenance tags.

Each of these is additive. None of them requires rewriting the kernel.

## The fact-finding gate

Four tickets filed as the gate on commitment:

- **SKY-335** — Distribution of `|series|` across vision enrichment. If multi-series is rare (< 15%), the current flattening is pragmatic and the stem/line reframe is lower priority than expected. If multi-series is common (> 40%), the reframe is urgent.
- **SKY-336** — Non-null rate and catalog-match rate for `sourceLines[].datasetName`. If reliable, Dataset resolution is a fuzzy-match function. If unreliable, the vision prompt needs upgrading before this architecture pays off.
- **SKY-337** — Formal inventory of the current `data-ref-resolution` pipeline: what exists, what to keep, what to reshape, what to delete. Without this we can't size the slice plan.
- **SKY-338** — URL signal coverage and DCAT-index hit rate. Per-`UrlSource` counts and resolution rates against a pre-built URL → DCAT-node index. This is the signal that tells us how much of the resolution problem evaporates when we actually use URLs. If `visible-url` + `source-line` URLs hit the DCAT index for > 50% of charts, URL-first resolution is the highest-priority change and facet vocabulary tuning deprioritizes. Also covers: what fraction of the current catalog's Distributions carry accessURL/downloadURL at all (if low, we have an upstream catalog gap to close first).

Until those four land, do not start implementation. The architecture is validated as direction; the sizing depends on the answers.

## Open questions for the next session

- **Single-line stem-only resolution target**: should a chart with no legend resolve to a Series or a Variable? The session argued Series, but this depends on whether the vision prompt emits `series: [ { legendLabel: implicit } ]` for single-line charts or leaves it empty. SKY-335 will tell us.
- **Eval framing change**: who owns reframing the gold set from classification to retrieval? This is a parallel track and someone needs to own it.
- **Index generator extension**: `build.py` currently outputs per-facet JSON. The Variable-card index is a new output. Should it live in `ontologies/skygest-energy-vocab/build/` or in a separate `skygest-cloudflare` artifact?
- **Post-link validation ownership**: unit algebra and cross-facet consistency live on the ontology side. How are those expressed (SHACL? SPARQL? OWL restrictions?) and who runs them?

## Terminology reminder

- **Stem** — the shared, co-referential part of a chart: title, axes, temporal coverage, source lines. One per asset. Joinable.
- **Line** — one entry in `series[]`. Non-joinable with other lines on the same chart. Each line is an independent resolution target.
- **α-path** — Agent-scoped retrieval. The Agent is known from `sourceAttribution.provider`, so we restrict the retrieval universe to that Agent's DCAT subgraph.
- **β-path** — Agent-unknown retrieval. Fall-through when `sourceAttribution.provider` is null. Same retrieval engine, no scoping pre-filter.
- **γ (chosen)** — "both, α first" — α-path is the default, β-path is the fallback. Same index, same ranker, same gate.
- **Retrieval target hierarchy** — Agent → Dataset → Series → Variable. Resolution picks the most specific valid target given the chart's structure.
