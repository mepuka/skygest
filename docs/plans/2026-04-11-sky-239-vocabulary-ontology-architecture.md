# SKY-239 Phase 2 Architecture Change: Vocabulary via Ontology

## Summary

Phase 2 of the SKY-239 implementation plan originally called for building
per-ontology RDF/XML parsers inside skygest-cloudflare (Tasks 2d-2.1 through
2d-2.6). Research revealed that:

1. N3.js cannot parse the OEO's RDF/XML format (library swap needed)
2. UCUM has significant energy-domain gaps (~50% of unitFamily entries need hand-curation)
3. 3 of 5 vocabularies (statisticType, aggregation, frequency) are 100% hand-curated
4. Multiple additional ontologies (ENTSO-E, SIEC, QUDT, Wikidata, ISO 4217) provide complementary coverage

Rather than building 5+ separate parsers in this repo, we mint a unified
`skygest-energy-vocab` ontology in the `ontology_skill` repo using its
established SKOS concept scheme + `build.py` pipeline. That ontology imports
from all sources and exports `SurfaceFormEntry[]` JSON files directly.

## Architecture

```
ontology_skill/ontologies/skygest-energy-vocab/
  docs/scope.md               <- requirements (written)
  docs/competency-questions.yaml
  docs/conceptual-model.yaml  <- 5 SKOS ConceptSchemes
  scripts/build.py            <- rdflib -> Turtle + JSON export
  mappings/                   <- SSSOM to OEO, ENTSO-E, QUDT, Wikidata
  release/
    vocabulary/*.json          <- SurfaceFormEntry[] per facet

skygest-cloudflare/
  references/vocabulary/*.json <- copied from ontology release
  scripts/sync-vocabulary.ts   <- validates JSON against SurfaceFormEntry schema
```

The cloudflare repo consumes pre-built JSON. No RDF parsing in the Worker.

## What This Replaces in the Phase 2 Plan

| Original Task | Status |
|--------------|--------|
| 2d-2.1 Check in OEO/UCUM source snapshots | Replaced: sources live in ontology_skill |
| 2d-2.2 Define OeoConcept/UcumUnit schemas | Replaced: ontology_skill handles parsing |
| 2d-2.3 OEO -> SurfaceFormEntry transform | Replaced: build.py export |
| 2d-2.4 OEO RDF reader script | Replaced: build.py + rdflib |
| 2d-2.5 UCUM XML reader script | Replaced: build.py + rdflib |
| 2d-2.6 UCUM -> UnitFamily transform | Replaced: build.py export |
| 2d-2.7 Hand-curated seeds | Replaced: altLabels in the ontology |
| 2d-2.8 seed-vocabulary.ts | Becomes: sync-vocabulary.ts (copy + validate) |

## What Remains in skygest-cloudflare Phase 2

1. `scripts/sync-vocabulary.ts` — copies JSON from ontology release, validates
   against `makeSurfaceFormEntry<Canonical>` for each facet
2. `references/vocabulary/*.json` — the 5 vocabulary files (checked in)
3. Phase 3-5 proceed unchanged (FacetVocabulary service, kernel, eval)

## Ontology Planning Document

Full requirements: `ontology_skill/ontologies/skygest-energy-vocab/docs/scope.md`

The next session runs the ontology modeling flow (`/ontology-requirements` ->
`/ontology-scout` -> `/ontology-conceptualizer` -> `/ontology-architect`) in
the ontology_skill repo to produce the vocabulary.

## Research Artifacts

These informed the architecture decision and remain at `/tmp/` for reference:
- `/tmp/sky-239_ontology_research.md` — OEO/UCUM parsing research
- `/tmp/sky-239_ontology_survey.md` — 9-ontology survey with coverage matrix
- `/tmp/sky-239_ontology_skill_report.md` — ontology_skill repo capabilities
- `/tmp/sky-239_coverage_map.md` — cold-start Variable coverage analysis
