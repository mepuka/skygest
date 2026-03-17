# Expert News Feed — Execution Plan

## Goal

Build the operator-first expert energy feed that powers two initial surfaces:

- the curator MCP workflow
- the curated reader feed

This milestone is not autonomous news aggregation. It is a phased pipeline that turns expert energy discourse into a reviewed, enriched, operator-shaped feed.

## Operating Model

The working pipeline is:

1. `energy-related posts` — posts from tracked experts that match the energy ontology
2. `candidate posts` — a higher-interest subset selected by deterministic scoring
3. `picked posts` — posts an operator or operator-guided agent chooses to curate
4. `enriched posts` — picked posts that have completed downstream media/source enrichment
5. `served surfaces` — MCP and curated feed responses that expose the picked and enriched results

The durable curation model is intentionally minimal:

- `picked` is the only durable curation state
- `not picked` means no pick record exists
- no reject queue or autonomous approval model is required for v1

## What Already Exists

The milestone should start from the current baseline, not from zero:

- expert registry, ingestion, and deterministic energy-topic matching already exist
- energy-related posts are already stored in D1
- thread-as-document and live embed-content surfacing already exist in the MCP/thread layer
- editorial picks and curated feed infrastructure already exist as the first manual curation layer

The remaining work is to add candidate scoring, lightweight candidate payload persistence, and pick-driven enrichment on top of that baseline.

## Storage Rules

The storage model should stay intentionally narrow:

- retain the existing energy-related post store as the base knowledge layer
- persist additional embed/enrichment payloads only for posts that enter the candidate set
- keep those payloads lightweight: embed JSON, CDN URLs, derived metadata, workflow state
- do not store image or video binaries
- treat Bluesky CDN URLs as the media source of truth

## Phase Plan

### Phase 0: Baseline Already In Place

- ingest expert posts
- classify energy-related posts deterministically
- expose thread/document and embed content through the MCP
- support manual editorial picks and a curated feed

### Phase 1: Ontology Convergence And Runtime Schema Target

**Issues:** `SKY-19`, `SKY-24`

- complete the ontology-level convergence of `energy-news` and `energy-media`
- define one runtime schema target for Skygest codegen and service contracts
- keep ontology source modular if useful, but make the application-facing schema target unified

**Exit condition:** downstream candidate storage and enrichment work depend on one stable runtime schema surface.

### Phase 2: Candidate Scoring And Pick Workflow

**Issue:** `SKY-20`

- compute deterministic candidate scores over the energy-related post set
- expose candidate review through the operator workflow
- persist a single canonical pick record per post when the operator curates it
- use picks as the canonical curation truth; any downstream events are derived from that record

**Exit condition:** the operator can review candidates and mark posts as picked without requiring enrichment to exist first.

### Phase 3: Candidate Payload Persistence

**Issue:** `SKY-23`

- store the lightweight embed and media payloads needed for downstream workflows
- scope that storage to candidate posts and anything later picked from that set
- avoid blanket persistence of all media or all expert posts

**Exit condition:** a picked post can be enriched later without re-fetching fragile live embed state at the moment of enrichment.

### Phase 4: Pick-Driven Enrichment Primitives

**Issue:** `SKY-21`

- trigger enrichment from the canonical pick record
- track workflow status, retries, provenance, and idempotency
- keep enrichment scoped to picked posts, not the full energy-related corpus

**Exit condition:** picking a post can reliably enqueue and track enrichment work.

### Phase 5: Vision And Media Enrichment

**Issue:** `SKY-16`

- analyze charts and other high-value media for picked posts
- fill alt-text gaps where appropriate
- attach source-attribution outputs against the unified runtime schema

**Exit condition:** picked posts can surface chart/media understanding through the MCP and curated feed.

### Phase 6: Provider Registry And Attribution Matching

**Issue:** `SKY-17`

- define the source/provider registry and alias model
- match cited or inferred sources against that registry
- keep this phase focused on cataloging and attribution logic, not live external fetching

**Exit condition:** enriched posts can reference normalized providers and source identities.

### Phase 7: External Adapters And Grounding Surface

**Issue:** `SKY-10`

- add live external adapters on top of the provider registry
- start with GridStatus
- expose grounded context back through MCP/feed surfaces where it materially improves curation

**Exit condition:** the system can attach live data context to selected picked posts using at least one production adapter.

## Dependency Order

The critical path is:

1. `SKY-19` + `SKY-24`
2. `SKY-20`
3. `SKY-23`
4. `SKY-21`
5. `SKY-16`
6. `SKY-17`
7. `SKY-10`

## Non-Goals For This Milestone

- autonomous curation
- binary media storage or media hosting
- enriching every energy-related post
- direct runtime querying against the source ontology
- full claim-verification coverage across every provider

## Milestone Done When

The Expert News Feed milestone is complete when:

- deterministic scoring produces a candidate set from the energy-related expert-post universe
- the operator can pick posts through MCP/admin workflows
- picked posts have stable lightweight payloads available for downstream enrichment
- enrichment and vision results attach to picked posts through a unified runtime schema
- the curated reader feed and the operator MCP both expose the same picked-and-enriched content model
