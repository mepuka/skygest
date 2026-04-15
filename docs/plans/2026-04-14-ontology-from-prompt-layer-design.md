---
status: tracking
created: 2026-04-14
supersedes:
  - facet-shelf vocabulary stitching (measuredProperty × domainObject × technologyOrFuel × statisticType × unitFamily → Variable)
related:
  - docs/plans/2026-03-11-ontology-layer-architecture-proposal.md
  - SKY-213 (parent — newsletter & story intelligence ontology line)
  - SKY-326 (facet narrowing — symptomatic of the wrong approach)
  - SKY-347 (data-europa duplicate distributions — separate)
---

# Ontology from the prompt layer — design tracking

## TL;DR

We have been trying to mint `Variable` rows by *stitching* canonical vocabulary facets together (`measuredProperty × domainObject × technologyOrFuel × statisticType × unitFamily × policyInstrument × aggregation`) and matching the result against chart text. This is a dead end: it pushes scientific reasoning into a string-match shelf instead of doing it in the layer that already has scientific reasoning — the prompt / vision extraction layer.

The replacement: have the extraction layer emit **two distinct things per chart**, and bind directly to **OEO** (Open Energy Ontology) on the canonical side. Variables become a thin index over OEO terms instead of a custom facet bingo.

## What's wrong with facet-shelf stitching

1. **It splits a single semantic act into a shelf of independent guesses.** A chart titled "Installed solar PV capacity, GW (2010–2024)" is one variable. The facet shelf treats it as five independent lookups (`measuredProperty=capacity` AND `domainObject=solar PV` AND `statisticType=stock` AND …) where any single mismatch eliminates the variable entirely. SKY-326 documents the AMBER on this exact failure mode (`facet-narrowing-reach`).
2. **The vocabulary canonicals are our invention.** `MeasuredPropertyCanonicals`, `DomainObjectCanonicals`, etc. in `src/domain/generated/energyVariableProfile` are an in-house enum tree we maintain by hand. They have no anchor in any external ontology, so they cannot be reused, validated, or reasoned over.
3. **We're paying twice for scientific knowledge we already get for free.** The vision/enrichment LLM already knows what "Installed solar PV capacity, GW" measures — it has scientific awareness. We then ask a downstream string-match kernel to *re-derive* that knowledge from a vocabulary shelf, badly.
4. **It doesn't enable reasoning.** Even when the shelf produces a Variable row, the row is a tuple of in-house enum strings. There is no upstream ontology to reason over, no `subClassOf`, no `relatedTo`, no inferences possible.

In short: vocabulary stitching is a *workaround* for not having scientific extraction in the right layer, and the workaround has cost more time than the right thing would have.

## The two things we want to extract per chart

Every chart says two distinct things. Today our prompt collapses them. They should be separate prompt outputs:

### (1) Literal surface form

> What the chart **literally says**, verbatim.

* Title text as rendered ("Installed solar PV capacity")
* Axis labels ("Capacity (GW)")
* Legend entries ("Utility-scale", "Distributed")
* Time range as printed ("2010–2024")
* Unit token as printed ("GW", "TWh/yr", "MtCO₂e")
* Geographic scope as printed ("Global", "United Kingdom", "EU-27")

This feeds:
* Surface-form alias growth (`Variable.aliases` with `scheme: "surface-form"` so the next exact match is free)
* Provenance display (we can show the user the literal label that was on the chart)
* Disambiguation when the same OEO term has multiple common renderings

### (2) Scientific variable being measured

> What the chart **scientifically measures**, expressed in canonical ontology terms.

* `oeoTerm`: the OEO IRI that names this variable (e.g. `OEO_00010258` for *installed solar capacity*)
* `oeoLabel`: the OEO `rdfs:label` (e.g. *"installed solar capacity"*)
* `unit`: a QUDT IRI or unit token (`unit:GW`, `unit:TWh`)
* `domain`: the OEO/SO scope class (e.g. `oeo:wind power plant`, `schema:Country`)
* `statisticType`: stock vs flow vs ratio vs intensity (this *one* axis is fine because it's small and orthogonal)
* `temporalScope`: instant / period / cumulative
* `confidence`: model confidence in the binding (so we can require human review under threshold)

This feeds:
* Direct binding to a `Variable` row keyed by OEO term
* Linkage to the dataset that produced the chart (when known)
* Reasoning capabilities — once a chart is bound to OEO, downstream agents can ask "what other variables are subclasses of `installed renewable capacity`?" or "is this variable a flow or a stock?" without our facet shelf in the loop

The two outputs travel together in the same enrichment record but are independently useful and independently validated.

## Why OEO

[Open Energy Ontology](https://github.com/OpenEnergyPlatform/ontology) is:
* OBO Foundry-aligned, BFO-rooted (real upper ontology), W3C-compliant OWL
* Energy-domain specific — covers generation, capacity, fuels, markets, policy instruments, balancing, storage
* Stable IRIs (`OEO_00010257`, etc.) — already used in *one* of our 25 hand-authored variables (`installed-wind-capacity.json` carries `{ scheme: "oeo", value: "OEO_00010257", relation: "closeMatch" }`)
* Maintained and growing — the [OpenEnergyPlatform](https://openenergyplatform.org/) community curates it
* Importable into Effect Schema as a static enum dump if we want offline validation

Anchoring to OEO gives us the four things the facet shelf cannot:

| Property | Facet shelf | OEO binding |
|---|---|---|
| External anchor | None | Stable IRI |
| Reusable across publishers | No | Yes |
| Reasoning support | No | Yes (subClassOf, relatedTo, partOf) |
| Cross-walks to other vocabularies | No | Yes (OEO has crosswalks to QUDT, ENVO, schema.org) |

OEO is *not* exhaustive. Some metrics our charts care about have no OEO term yet (e.g. *interconnection queue backlog*). For those we need a fallback scheme — provisionally `scheme: "skygest-internal"` with a clear marker that it's a candidate for OEO submission. Tracked separately.

## Architecture sketch (intentionally not an implementation plan)

```
┌─────────────────────┐
│  vision/enrichment  │  ← prompt produces TWO outputs per chart:
│        prompt       │     (1) literal surface form
└──────────┬──────────┘     (2) scientific binding (OEO term + unit + domain)
           │
           │  enriched chart record
           │
           ▼
┌─────────────────────┐
│  OEO binding store  │  ← Variable row keyed by OEO IRI, not facet tuple.
│  (replaces facet    │     aliases grow from observed surface forms.
│   shelf as the      │     reasoning queries hit OEO upstream.
│   variable index)   │
└──────────┬──────────┘
           │
           │  variable.id (= OEO IRI)
           │
           ▼
┌─────────────────────┐
│  dataset binding    │  ← when we know the dataset that produced the chart,
│  (DCAT side)        │     we write dataset.variableIds = [<OEO IRI>].
│                     │     this becomes a *byproduct* of chart resolution,
│                     │     not a precondition for it.
└─────────────────────┘
```

Notable shifts from the current model:

* `Variable.id` becomes the OEO IRI (or a `skygest-internal:` IRI for gaps), not a `var_<ulid>`. This is a real schema change.
* The seven-facet `VariableOntologyFields` shelf in `generated/dataLayerSpine` is **deprecated** for resolution — it can stay as descriptive metadata for human readers, but the resolver does not match against it. `Bind.ts` and `Interpret.ts` get rewritten around OEO IRI lookup.
* `Series` gains `oeoTerm` directly so `(variable, fixedDims)` is `(oeoTerm, fixedDims)`. SDMX semantics survive.
* `variable-adapters/` (proposed in the previous turn) becomes an **OEO-binding adapter** rather than a facet-emitting adapter. For publishers with structured per-metric APIs (EIA, Ember, GridStatus, Eurostat SDMX), the adapter walks the publisher's metric list and asks: "which OEO term is this metric?" — once, at ingest, with model help.
* The chart-resolution kernel (`src/resolution/kernel/`) is rewritten around an OEO-keyed variable lookup. SKY-326 stops being relevant — there is no facet-narrowing step to soften.

## What this replaces

Concretely, in the current codebase:

| Current artifact | Status under the new design |
|---|---|
| `src/domain/data-layer/variable-enums.ts` | Deprecated for resolution; kept only as descriptive metadata if at all |
| `src/domain/generated/energyVariableProfile.ts` (`MeasuredPropertyCanonicals`, etc.) | Deprecated for resolution |
| `src/resolution/facetVocabulary/*` (the entire shelf) | Deprecated; resolver moves to OEO IRI lookup |
| `src/resolution/kernel/Bind.ts` (subsumption-based facet narrowing) | Rewritten around OEO IRI |
| `src/resolution/kernel/Interpret.ts` | Rewritten — interpret stage emits OEO IRI candidate, not facet tuples |
| `scripts/generate-variables.ts` (hand-authored 25 variables) | Replaced by OEO term import + chart-driven alias growth |
| SKY-326 (soften facet narrowing) | Obsoleted — no facet narrowing in the new design |

## What this does *not* replace

* DCAT ingest. The eight DCAT adapters keep doing exactly what they do — ingest `Catalog`, `Dataset`, `Distribution`, `DataService`, `DatasetSeries`, `Agent`, `CatalogRecord`. DCAT is the right standard for *cataloging* and stays.
* The provider registry / agent identity work (SKY-147, SKY-218, SKY-332, SKY-333). Agents are agents regardless of how variables are modeled.
* Surface-form text matching for *non-variable* axes (provider names, dataset titles). Those legitimately need string lookups.

## Open questions (need answers before writing code)

1. **Prompt ergonomics.** What does the two-output prompt actually look like? Is the model reliable enough to emit OEO IRIs directly, or does it emit a free-text scientific description that a second small step maps to the OEO IRI? The second is probably more robust.
2. **OEO coverage.** What fraction of our gold eval set's chart variables actually have an OEO term? Need to measure before committing — if it's 40%, the fallback story matters more than the OEO story.
3. **OEO version pinning.** OEO is actively maintained. We need a snapshot mechanism (probably ship the OWL file in `references/` and regenerate a TS enum from it) so resolution is deterministic across builds.
4. **Migration of existing 25 variables.** How many of them already have a clean OEO mapping? (Spot check: `installed-wind-capacity` → `OEO_00010257` ✅. The rest need to be checked.)
5. **`skygest-internal` term governance.** When a chart variable has no OEO term, who decides the internal IRI shape, and what is the path back to OEO submission?
6. **Reasoning surface.** Where does OEO reasoning actually run — at query time in the resolver, or as an offline materialization step that pre-expands every variable's parents/siblings into the index? Performance trade-off.
7. **Backwards compat.** The existing `Variable.id` shape is `https://id.skygest.io/variable/var_<ulid>`. Switching to `OEO_00010257` IRIs is a breaking schema change. What's the migration story for the 11 series that currently link to var-ulids?

## Decisive scope boundary

This document is a **tracking design**, not an implementation plan. Nothing in the codebase should change as a result of this doc landing. The next concrete step is the OEO-coverage measurement against the gold eval set (open question 2) — that single number determines whether OEO-as-primary is viable or whether we need an OEO-plus-skygest-internal hybrid from day one.

Until that measurement exists, no facet-shelf code should be deleted and no new variable-binding code should be written.

## Acceptance for *this tracking doc*

* [x] Frames vocabulary stitching as a dead end and explains why
* [x] Identifies the two distinct prompt outputs we want
* [x] Names OEO as the canonical binding target and explains the upgrade
* [x] Lists what is replaced and what is *not* replaced
* [x] Lists open questions that block design completion
* [x] Says explicitly that nothing changes in code until the OEO-coverage number lands
