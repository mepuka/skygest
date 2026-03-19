# SKY-17 — Source Registry And Attribution Plan

## Goal

Define the normalized source layer that turns loose provider hints, cited URLs, chart source text, and thread context into canonical provider references that later grounding work can trust.

This issue should answer questions like:

- is this chart probably from BC Hydro, BCH, or a specific BC Hydro report family?
- what source is this expert citing or visualizing?
- how confident is the system in that match?
- what evidence supports the match?

## What SKY-17 Is

`SKY-17` is the normalization and matching layer that sits between:

- raw or semi-structured source clues from `SKY-16`
- later live provider adapters in `SKY-10`

It should:

- define the provider/source registry
- define alias and citation matching rules
- normalize loose source clues into canonical references
- persist source-attribution results in a typed form

## What SKY-17 Is Not

`SKY-17` should not own:

- generic run lifecycle or workflow primitives from `SKY-21`
- media understanding or chart extraction from `SKY-16`
- live API calls to providers from `SKY-10`
- feed UI work

## Product Role

The product need here is not just "find a domain name."

Skygest wants to help a reader or journalist move from:

- "this chart looks important"

to:

- "this is probably BC Hydro data"
- "the signal comes from this report family or cited page"
- "here is why the system thinks that"

That is what makes later grounding possible and what makes expert threads more trustworthy to consume.

## Core Decisions

### 1. Normalize before grounding

The source layer should exist independently from live external adapters.

First answer:

- who is the provider?
- what source family is this likely from?

Only after that should live adapters enter the picture.

### 2. Match from multiple evidence channels

The matcher should not rely on only one clue type.

It should be able to use:

- cited URLs and domains
- link card titles
- quote-post text
- thread text
- source lines or labels extracted by vision
- other structured context already stored with the picked post

### 3. Preserve evidence and uncertainty

The output must include:

- the canonical match
- the confidence of the match
- the reason the system matched it
- unresolved alternatives when confidence is weak

### 4. Unify the source models

The current code has overlapping source/provider shapes in different places.

`SKY-17` should consolidate that so the system has one clear provider/source reference model for downstream work.

### 5. Keep the registry curated

This should not become a noisy free-form alias bucket.

The registry should start from a curated seed set of important energy providers and source families and grow deliberately.

## Registry Responsibilities

The registry should support:

- canonical provider id
- provider label
- alias list
- known domains
- known source families or dataset labels
- citation patterns or textual clues where useful
- optional topic or region metadata if later helpful

Examples:

- `bc-hydro`
- aliases: `BC Hydro`, `BCH`
- known domains: `bchydro.com`
- source families: `annual report`, `load report`, `hydro conditions`

## Matching Responsibilities

The matcher should:

- consume loose source clues from the thread, link, and vision layers
- score candidate matches
- choose the best match when confidence is sufficient
- preserve unresolved alternatives when confidence is not sufficient
- emit a typed result for later use by grounding

It should be able to say:

- matched confidently
- matched weakly
- could not match

## Output Requirements

The final `source-attribution` result should be able to hold:

- canonical provider reference
- content source reference when present
- dataset or source-family hint when present
- confidence
- evidence summary
- alternative candidates when unresolved
- processing metadata

This output should be clean enough for downstream use by `SKY-10` and readable enough for operator inspection.

## Relationship To SKY-16

`SKY-16` should produce:

- source clues
- image-derived source text
- uncertainty notes

`SKY-17` should take that material plus stored thread and link context and normalize it into canonical references.

So the relationship is:

- `SKY-16` says what clues exist
- `SKY-17` says what source those clues most likely point to

## Relationship To SKY-10

`SKY-10` should only begin after `SKY-17` can answer:

- which provider is this?
- what source family or dataset is this probably related to?
- how confident is that answer?

Without `SKY-17`, adapter work risks becoming a pile of provider-specific guesses.

## Suggested Implementation Split For Linear

### Slice 1: Provider registry schema + canonical source models

Goal:

- define the core typed provider/source model the rest of the system will use

Scope:

- canonical provider reference shape
- canonical content/source reference shape
- unify overlapping source models
- align storage shape with the runtime schema target

### Slice 2: Initial provider registry seed set + alias/domain corpus

Goal:

- create the first curated registry of important energy providers and source families

Scope:

- seed provider entries
- alias list
- known domains
- known source-family labels
- initial curation process for extending the registry

### Slice 3: Source attribution evidence contract

Goal:

- define how matches explain themselves

Scope:

- confidence fields
- evidence summary fields
- alternative candidate fields
- typed result contract for downstream use

### Slice 4: Attribution matching service and heuristics

Goal:

- turn loose thread, link, and vision clues into ranked canonical matches

Scope:

- URL and domain matching
- alias and title matching
- source-line and text matching
- candidate scoring and selection
- unresolved or weak-match handling

### Slice 5: Source-attribution workflow integration + persistence

Goal:

- connect the matching layer to the enrichment workflow and save the final result

Scope:

- consume source clues from stored enrichments and post context
- run attribution matching inside the enrichment path
- persist the `source-attribution` result to `post_enrichments`

### Slice 6: Provider matching evaluation harness

Goal:

- measure whether the matching rules are good enough on real Skygest examples

Scope:

- canonical threads and representative provider cases
- manual review rubric
- false-positive and false-negative review loop

## Recommended Child Issue Order

1. provider registry schema + canonical source models
2. initial provider registry seed set + alias/domain corpus
3. source attribution evidence contract
4. attribution matching service and heuristics
5. source-attribution workflow integration + persistence
6. provider matching evaluation harness

## Acceptance Criteria

`SKY-17` is done when:

1. the system has one canonical provider/source model
2. a curated provider registry exists with meaningful aliases and domains
3. loose source clues can be matched into typed canonical references
4. matches preserve confidence and evidence
5. weak or ambiguous matches remain clearly unresolved rather than overstated
6. the final `source-attribution` result is written in a form that later grounding can consume

## Summary

`SKY-17` is the layer that turns source hints into source identity.

If it is done well, `SKY-10` becomes straightforward adapter work. If it is skipped or blurred, the later grounding layer will end up guessing blindly and every provider integration will be harder than it needs to be.
