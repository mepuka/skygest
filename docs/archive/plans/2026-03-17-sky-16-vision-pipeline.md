# SKY-16 — Vision Pipeline Plan

## Goal

Define the implementation shape for the vision lane that turns picked posts with images or charts into structured, explainable media understanding.

This issue is where Skygest learns to answer:

- what does this image or chart show?
- what are the visible trends, labels, and key takeaways?
- what should the synthetic alt text be if the original is missing or weak?
- what source clues are visible or strongly suggested?

## What SKY-16 Is

`SKY-16` is the first real feature lane that runs on top of the enrichment primitives from `SKY-21`.

It should:

- analyze picked posts with visual media
- produce structured asset-level understanding
- preserve evidence and uncertainty
- write a vision result that later source matching can consume

## What SKY-16 Is Not

`SKY-16` should not own:

- generic run lifecycle plumbing from `SKY-21`
- canonical provider matching from `SKY-17`
- live external grounding from `SKY-10`
- autonomous curation or broad corpus-wide processing

## Product Role

This issue exists because the highest-density signal in Skygest is trapped inside images.

The product docs point to three concrete needs:

- readers need dense charts and screenshots to become legible quickly
- journalists need usable source clues and evidence they can follow
- experts need their original work represented faithfully rather than flattened into vague summaries

That means the output of `SKY-16` must be:

- asset-level, not flat
- evidence-aware
- confidence-aware
- useful on its own even before canonical provider matching exists

## Dependencies

`SKY-16` should assume these are in place or nearly in place:

- `SKY-21` enrichment primitives
- `SKY-23` durable candidate/picked payload storage
- `SKY-24` unified runtime schema target
- `SKY-19` media ontology groundwork
- `SKY-2` multimodal embed surfacing

## Core Decisions

### 1. Asset-first output model

Many picked posts will contain multiple charts or images. The vision lane should process each asset independently and only then synthesize a post-level result.

The current flat vision shape is too lossy for that.

### 2. Flash-first execution

Default lane:

- `gemini-2.5-flash`

Optional escalation lane:

- stronger retry only for hard or high-value failures

The vision pipeline should not default to the expensive lane.

### 3. Structured output only

The model output should always be constrained to a typed JSON shape and validated before it is stored.

### 4. Observation separate from inference

The output should distinguish:

- clearly visible facts
- likely interpretations
- likely source clues
- insufficient evidence

This is essential for later source normalization and grounding.

### 5. Synthetic alt text is a product output

Alt-text gap filling is not a side effect. It is one of the main reasons this lane exists.

## Vision Workflow Stages

### Stage 1: Asset selection

Take the execution plan from `SKY-21` and identify which media assets should be processed.

Examples:

- image embeds
- media-rich quote posts
- screenshot-heavy threads

### Stage 2: Asset preparation

For each asset:

- establish a stable asset key
- fetch or reference the media
- resize or normalize when helpful for cost control
- retain original alt text if it exists

### Stage 3: Gemini vision call

Ask the model for structured output that covers:

- media type
- chart type when applicable
- title or visible headline if present
- axes, series, trends, and key values when visible
- synthetic alt text
- source clues visible in the image
- uncertainty notes

### Stage 4: Quality gate

Before the result is accepted:

- validate shape
- reject empty or shallow output
- classify the result as usable, weak, or insufficient
- optionally retry with a tighter prompt
- optionally escalate selected failures

### Stage 5: Post-level synthesis

Once all assets are processed:

- produce a post-level summary of what the assets contribute
- preserve the link from summary statements back to the individual assets
- preserve source clues and uncertainty

### Stage 6: Persistence

Write the final vision result into `post_enrichments` and leave enough structure for `SKY-17` to consume later.

## Output Requirements

The vision result should be able to power:

- richer MCP responses
- thread detail views with chart understanding
- later source attribution
- future grounding readiness

At minimum the output should capture:

- asset list
- per-asset media understanding
- synthetic alt text
- key findings
- source clues
- confidence or quality markers
- model and processing metadata

## Suggested Implementation Split For Linear

### Slice 1: Vision enrichment schema + asset model

Goal:

- move from a flat one-result shape to an asset-oriented vision output shape

Scope:

- per-asset output contract
- post-level synthesis contract
- source clue and confidence fields
- compatibility with `post_enrichments`

### Slice 2: Gemini vision client + structured response contract

Goal:

- integrate Gemini for server-side multimodal analysis with a stable typed contract

Scope:

- Gemini client service
- request construction for image/chart analysis
- structured JSON output handling
- model metadata capture

### Slice 3: Vision asset execution in the enrichment workflow

Goal:

- connect the planned assets from `SKY-21` to actual model execution and persistence

Scope:

- fetch or prepare each image asset
- run per-asset processing
- assemble post-level synthesis
- write the final `vision` enrichment payload

### Slice 4: Vision quality gate + bounded escalation

Goal:

- keep bad or shallow model output from being treated as product truth

Scope:

- schema validation
- usable versus weak versus insufficient classification
- bounded retry policy
- optional escalation lane for selected failures

### Slice 5: Canonical thread evaluation harness

Goal:

- measure whether the vision pipeline is actually good enough on the product’s known test cases

Scope:

- run the 7 canonical threads through the pipeline
- define a simple manual quality rubric
- capture regressions in chart understanding, alt text usefulness, and source clue quality

## Recommended Child Issue Order

1. vision schema + asset model
2. Gemini client + structured response contract
3. vision execution in workflow
4. quality gate + escalation
5. canonical evaluation harness

## Acceptance Criteria

`SKY-16` is done when:

1. picked posts with images can be processed through the enrichment workflow
2. multi-image posts retain per-asset outputs
3. synthetic alt text is generated when needed
4. visible chart structure and key findings are captured in a typed result
5. source clues are preserved with uncertainty rather than overstated as facts
6. weak or malformed outputs are filtered or retried instead of silently stored
7. the canonical thread set is usable as an evaluation set for quality checks

## Summary

`SKY-16` should be treated as the media-understanding lane of the enrichment system.

It sits on top of `SKY-21`, produces the evidence-bearing output that `SKY-17` needs, and should be judged by one standard above all others:

does it make dense expert media materially easier to understand without pretending to know more than it actually does?
