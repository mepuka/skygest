# SKY-43 — Provider / Source Model Proposal

## Why This Slice Exists

`SKY-43` is the point where Skygest decides what a "source" actually is in the system.

Right now the code already has overlapping source concepts:

- `ProviderReference` and `SourceReference` in `src/domain/media.ts`
- `ImageSource`, `ContentSource`, and `DataSource` in `src/domain/enrichment.ts`

That is workable for early experiments, but it is not a good base for source attribution, matching, or grounding.

If the team wants to simplify the ontology and the domain model, this is the right slice to do it.

## Proposal Summary

Use a small, explicit model with three distinct concepts:

1. **Provider**
   - the canonical organization or data producer
   - examples: ERCOT, BC Hydro, EIA

2. **Content Source**
   - the concrete page, article, report, or document being cited
   - examples: a Utility Dive article, a BC Hydro annual report page, a PDF report URL

3. **Social Provenance**
   - the person or account that posted or shared the chart, screenshot, or media
   - examples: a Bluesky author DID / handle

Recommendation:

- keep these three concepts separate
- treat **provider** as the main canonical object
- treat **content source** as a lightweight cited artifact
- treat **social provenance** as provenance, not as provider attribution

## Review Outcome

This proposal was reviewed against the current code and issue stack.

Confirmed:

- the three-concept split is already implicit in the code, just not organized cleanly
- `sourceFamily` should remain a lightweight optional hint in this slice
- moving source types out of `media.ts` is low risk because the current types there are not used downstream
- `source-attribution` should be allowed to carry provider, content source, and social provenance at the same time
- confidence and evidence should remain deferred to `SKY-45`

Implementation note:

- the semantic rename from `datasetLabel` to `sourceFamily` should be treated as forward-only
- this is low risk because no source-attribution executor is writing real records yet

## Simplification Recommendation

The simplest useful model is:

- one canonical provider reference type
- one content source reference type
- one social provenance type
- one optional provider sub-hint for dataset or source family

Do **not** create a large ontology of separate first-class runtime objects for:

- provider
- dataset
- source family
- publication
- domain alias
- citation pattern

Those can exist in the registry or seed data internally, but downstream code should not need all of them as separate public-facing runtime concepts.

Recommendation:

- keep the downstream runtime model small
- keep the registry internals richer than the runtime result shape
- expose only what matching, persistence, and later grounding actually need

## Recommended Domain Shape

### 1. Canonical Provider Reference

This should become the shared provider shape used by attribution and later grounding.

Recommended fields:

- `providerId`
- `providerLabel`
- `sourceFamily`

Notes:

- `providerId` should be the stable canonical id, such as `ercot` or `bc-hydro`
- `providerLabel` is the human-readable display label
- `sourceFamily` should stay optional and lightweight in this slice
- `sourceFamily` should be a hint like `"load report"` or `"annual report"`, not a whole second ontology yet

### 2. Content Source Reference

This should represent the concrete page or artifact being cited.

Recommended fields:

- `url`
- `title`
- `domain`
- `publication`

Notes:

- this is not the same thing as the provider
- a content source may cite or summarize provider data without being the provider
- this should stay simple and URL-centered

### 3. Social Provenance

This should represent who posted or shared the media or thread content.

Recommended fields:

- `did`
- `handle`

Notes:

- this is useful provenance
- this is not canonical provider attribution
- it should not be overloaded to mean "data source"

## Recommended Refactor Direction

### Move source concepts out of `media.ts`

`ProviderReference` and `SourceReference` are not really media concepts.

Recommendation:

- move these into a dedicated source domain file
- keep `media.ts` focused on chart and image understanding

This is the cleanest way to reduce conceptual drift.

### Replace ad hoc source shapes in `enrichment.ts`

`ContentSource` and `DataSource` should stop being one-off structs defined only inside the enrichment payload.

Recommendation:

- make `source-attribution` reuse the shared source domain types
- avoid keeping two parallel source models alive

### Keep `ImageSource` only if the product still wants provenance

`ImageSource` is useful only if the product wants to answer:

- who posted this chart?
- who shared this screenshot?

It should not be treated as part of canonical provider matching.

Recommendation:

- either rename it to something like `socialProvenance`
- or keep the concept but clearly separate it from provider and content source attribution

## What SKY-43 Should Change

`SKY-43` should:

- define the shared provider/source domain types
- move source/provider concepts into a dedicated source domain area
- reconcile the overlapping current shapes
- make `source-attribution` depend on the shared source types instead of one-off local structs

`SKY-43` should not:

- add matching heuristics
- add confidence scoring
- add evidence summaries
- add alternative candidate handling
- add workflow execution logic
- add registry seed content

## What Should Wait For Later Slices

### SKY-44

Use `SKY-44` to populate the actual registry:

- providers
- aliases
- domains
- source-family labels

### SKY-45

Use `SKY-45` to define how attribution explains itself:

- confidence
- evidence summary
- unresolved alternatives

### SKY-46

Use `SKY-46` to actually do the matching.

## Proposed Handling Of `source-attribution`

Recommendation for the direction of the enrichment payload:

- let the payload hold:
  - optional provider reference
  - optional content source reference
  - optional social provenance
  - processing metadata

Do **not** force the system to choose only one.

That lets Skygest represent cases like:

- "this post cites a Utility Dive article"
- "the underlying provider is probably ERCOT"
- "the chart was posted by this expert account"

all at the same time.

That is closer to how real source attribution works in practice.

## Team Decisions To Confirm

These are the decisions worth explicitly confirming with the team before implementation:

1. Should Skygest treat provider, content source, and social provenance as three separate things?
   - recommendation: yes

2. Should dataset or source-family remain a lightweight optional hint in this slice, instead of becoming its own first-class runtime object?
   - recommendation: yes

3. Should `media.ts` stop owning provider/source shapes?
   - recommendation: yes

4. Should `source-attribution` be allowed to carry both a cited content source and a canonical provider at once?
   - recommendation: yes

5. Should confidence and evidence wait until `SKY-45` instead of being folded into `SKY-43`?
   - recommendation: yes

## Bottom Line

The best simplification is not to make the model more abstract.

The best simplification is to make the model more honest:

- one concept for the provider
- one concept for the cited content
- one concept for social provenance
- one small optional hint for source family

That gives the later matching and grounding work a clean foundation without over-building the ontology too early.
