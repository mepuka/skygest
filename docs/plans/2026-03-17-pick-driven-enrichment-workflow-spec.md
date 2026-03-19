# Pick-Driven Enrichment Workflow Spec

## Goal

Define the workflow model for turning a manually picked expert post into durable, explainable enrichment that helps operators, readers, and journalists understand the post, trust its claims, and trace the likely underlying sources.

This spec is the architectural bridge between:

- `SKY-21` enrichment pipeline primitives
- `SKY-16` vision pipeline
- `SKY-17` source registry and attribution matching
- `SKY-10` external grounding adapters

## Product Basis

This workflow is not generic "image captioning" or autonomous content summarization.

From the current product vision, jobs-to-be-done, and proto-personas, Skygest is trying to do five things at once:

1. preserve the original expert discourse rather than flattening it into a summary
2. make dense charts and screenshots understandable when alt text is missing or weak
3. help a user quickly understand why a thread matters
4. help a user trace claims back to likely primary or canonical sources
5. build toward later grounding against live external data

The workflow therefore has to satisfy three distinct user needs:

- `Newsletter Nadia` needs the chart or media to become legible quickly
- `Journalist Jade` needs a usable source trail and evidence she can trust
- `Expert Eli` needs his original work preserved faithfully rather than abstracted away

This leads to one central rule:

> enrichment must show its work, not just produce conclusions

## Operating Principles

### 1. Pick-driven, not corpus-wide

The workflow starts only from the canonical pick record.

- no blanket enrichment of all energy-related posts
- no parallel curated-event source of truth
- no enrichment trigger based only on media presence

### 2. Asset-first, not post-flat

Many high-value threads contain multiple images or charts. The workflow must reason over individual assets first and only then produce a post-level synthesis.

### 3. Evidence before inference

The system must separate:

- what is directly visible in the media
- what is stated in the post or linked context
- what is inferred by the model

Every important output should preserve where it came from.

### 4. Confidence-aware outputs

The workflow should not treat all model output as equally trustworthy.

It must distinguish at least:

- `high confidence`
- `medium confidence`
- `low confidence`
- `insufficient evidence`

Low-confidence outputs should remain visible as hints, not silently promoted to facts.

### 5. Bounded agentic behavior

The workflow can include reasoning, branching, retries, and escalation, but it should remain explicit and inspectable.

- named stages
- deterministic triggers
- narrow retries
- clear stop conditions

This should be a structured reasoning pipeline, not an open-ended autonomous loop.

### 6. Preserve original expert material

Skygest should keep the original post, thread, links, quoted context, and media as the primary artifact. Enrichment exists alongside that material and should never replace it.

## Recommended Cloudflare Shape

For normal picked-post enrichment:

`pick record -> enrichment workflow instance -> D1 result rows + R2 raw artifacts`

Recommended platform split:

- `Cloudflare Workflow` is the orchestrator for one enrichment run
- `D1` stores run state and normalized enrichment outputs
- `R2` stores raw provider responses, prompt snapshots, and other large audit/debug artifacts
- `AI Gateway` sits in front of Gemini for logging, policy, rate control, and fallback support

Optional components:

- `Queue` in front of workflow creation for backfills, re-runs, or burst protection
- `Durable Object` only if provider pacing or per-tenant serialization becomes necessary

For the manual picked-post path, the normal trigger can go straight from the pick event into workflow creation. A queue should not be the core orchestrator.

## Workflow Family

The cleanest model is a workflow family, not one giant workflow that owns every downstream concern forever.

### Workflow roles

1. `EnrichmentWorkflow`
   - owns the lifecycle of one pick-derived enrichment run
   - plans which enrichments to execute
   - coordinates retries, escalation, and final status

2. `VisionEnrichment`
   - understands images/charts/screenshots at the asset level
   - fills alt-text gaps
   - extracts visible source clues and chart structure

3. `SourceAttribution`
   - matches evidence and source clues against the provider/source registry
   - produces canonical source references for downstream grounding

4. `Grounding`
   - later phase
   - pulls live or reference data from external providers only after sources are normalized

In v1, `EnrichmentWorkflow` plus `VisionEnrichment` is enough. `SourceAttribution` can begin as a follow-on stage or child workflow once `SKY-17` lands.

## End-to-End Flow

### Stage 0: Trigger and Dedupe

Input: canonical pick record and post URI

Responsibilities:

- derive one stable run key from `(post_uri, enrichment_kind, schema_version)`
- create or reuse the enrichment run record
- avoid duplicate concurrent runs for the same version

Output:

- queued enrichment run with deterministic identity

### Stage 1: Input Assembly

Load all durable context needed for reasoning:

- picked post payload
- embed/media payload
- thread text and thread metadata
- quote-post context if present
- link card metadata if present
- original alt text if present
- relevant schema and prompt versions

Rules:

- always load from stored payloads first
- do not depend on live Bluesky state for core enrichment correctness

Output:

- one assembled reasoning packet for the run

### Stage 2: Enrichment Planning

Decide what should happen for this picked post.

Examples:

- image thread with multiple charts -> run asset-by-asset vision
- screenshot with good alt text already present -> still run vision, but treat alt text as evidence
- link card only -> skip vision, later route to source matching
- quote-post with chart in quoted content -> include quote context in reasoning

Output:

- planned enrichment lanes
- ordered asset list
- per-asset context

This stage should remain rule-based or lightly model-assisted. The planner should not invent new work types at runtime.

### Stage 3: Asset Preparation

Prepare each asset for model analysis.

Responsibilities:

- identify each media asset separately
- capture stable asset keys
- fetch or reference the media source
- optionally resize or normalize for cost control
- preserve any source-adjacent context for that asset

Output:

- prepared asset jobs ready for vision analysis

### Stage 4: Vision Understanding

For each asset, ask Gemini to produce structured understanding.

The model should return:

- what kind of media this is
- what is visibly depicted
- chart structure if applicable
- key values, trends, or notable takeaways if clearly visible
- synthetic alt text when original alt text is missing or poor
- source clues visible in the image
- uncertainty notes

Important rule:

- the model should separate direct observations from likely interpretations

Output:

- one structured result per asset

### Stage 5: Validation and Quality Gate

Before treating a model response as usable enrichment:

- validate it against the schema
- reject malformed or obviously incomplete output
- check for missing critical fields
- score whether the result is usable, weak, or insufficient

Possible actions:

- accept
- retry with a tighter prompt
- retry with a stronger model for selected high-value failures
- stop and record insufficient evidence

This is the core quality gate for the whole enrichment system.

### Stage 6: Post-Level Synthesis

Once per-asset results exist, synthesize post-level understanding.

Responsibilities:

- aggregate multiple asset results
- summarize the role each asset plays in the thread
- surface thread-level source hints
- preserve which conclusions came from which asset

This stage should not erase per-asset detail. The post-level view is a summary layer over the asset-level record.

### Stage 7: Source Attribution

Match likely sources against the canonical registry.

Inputs:

- asset-level source clues
- thread text
- quoted-post text
- link domains and titles
- existing provider alias rules

Outputs:

- canonical provider matches
- source-family matches where possible
- confidence and evidence for each match
- unresolved source hints when matching is inconclusive

This stage is where "BC Hydro" versus "BCH" versus a specific report family should be normalized. It should not call live provider APIs.

### Stage 8: Grounding Eligibility

Not every enriched post should proceed to live grounding.

The workflow should decide whether a post is ready for later grounding based on:

- source match confidence
- whether the claimed domain is supported by existing adapters
- whether the extracted data is specific enough to ground

Output:

- ready for grounding
- not ready yet
- needs human review

### Stage 9: Persistence and Completion

Write:

- final normalized enrichment output
- run metadata and status
- evidence references
- raw audit artifacts outside the final payload

Then mark the run:

- complete
- complete with low-confidence hints
- failed
- needs operator review

## Reasoning Requirements

The user-story and product docs imply several reasoning requirements that should be first-class in the workflow.

### A. Chart legibility

The workflow must help answer:

- what am I looking at?
- what is the main trend or argument?
- what key values are actually visible?

This is the Nadia requirement.

### B. Citation usefulness

The workflow must help answer:

- where did this chart likely come from?
- what source names, logos, domains, or report titles are present?
- what evidence supports that guess?

This is the Jade requirement.

### C. Faithful preservation

The workflow must avoid:

- compressing a multi-chart thread into one vague statement
- turning weak guesses into strong claims
- losing the distinction between the expert's argument and the system's enrichment

This is the Eli requirement.

### D. Thread-context reasoning

For many posts, the image alone is not enough.

The workflow must be able to combine:

- what is in the image
- what the author says in surrounding thread text
- what is referenced in quote-posts
- what appears in attached link cards

### E. Stop-condition reasoning

The workflow should know when to stop.

Examples:

- source cannot be matched with enough confidence
- chart values are too small or ambiguous to extract reliably
- image is decorative rather than informational

In those cases, it should record the uncertainty and exit cleanly instead of hallucinating.

## Confidence and Evidence Model

The system should store conclusions in a way that makes downstream trust decisions possible.

At minimum, each important conclusion should carry:

- `confidence`
- `basis`
- `evidence`
- `notes`

Suggested interpretation:

- `basis = visible_media` when directly supported by the image
- `basis = post_text` when supported by the author's text
- `basis = linked_context` when supported by quote/link metadata
- `basis = inferred` when the model is making a best-effort guess

Examples:

- "line chart comparing hydro import/export volumes" -> likely `visible_media`
- "probable source: BC Hydro annual report" -> likely `inferred` unless explicitly visible
- "province names visible in legend" -> `visible_media`

This distinction is essential if later grounding logic is going to trust or reject candidate sources.

## Retry and Escalation Policy

The system should not jump to the strongest model by default.

Recommended policy:

1. first pass with `gemini-2.5-flash`
2. retry with a tighter prompt if output is malformed or obviously shallow
3. escalate only selected failures to a stronger lane
4. stop after bounded retries and record the failure mode

Escalation should be reserved for:

- canonical test threads
- high-value chart-rich posts
- cases where source attribution materially affects downstream usefulness

## Human Review Hooks

The current product model is human-directed curation, not autonomous publishing. The workflow should preserve that operating model.

Recommended hooks:

- operator-visible run status
- explicit "needs review" terminal state
- optional future pause point for high-value ambiguous cases

Human review should be introduced selectively, not inserted into every run.

## Data Model Requirements

### 1. Enrichment run tracking

The repo needs a durable run record separate from the final saved enrichment payload.

Suggested responsibilities for `post_enrichment_runs`:

- identity and dedupe
- workflow status
- timestamps and attempt counts
- model/prompt/schema versions
- failure envelopes
- progress and terminal state

### 2. Asset-level enrichment shape

The current system should not assume a single chart or a single vision result per post.

The final enrichment shape should support:

- multiple assets
- per-asset outputs
- post-level synthesis
- source clues per asset

### 3. Evidence-bearing source matches

Source matches should preserve:

- canonical provider reference
- match confidence
- evidence snippets or reasons
- unresolved alternatives when confidence is weak

### 4. Versioning

Every run should be tied to:

- schema version
- prompt version
- model lane
- input fingerprint

This is necessary for safe re-runs and later quality evaluation.

## Success Criteria

The workflow is successful when a picked post can reliably produce enrichment that lets a downstream surface answer:

- what is this chart or media saying?
- why does this thread matter?
- what source is this probably based on?
- how confident is the system in that source guess?

For the canonical test set, success means:

- chart-heavy threads become readable without requiring the consumer to run vision live
- source hints are preserved with evidence and uncertainty
- multi-image threads retain asset-level detail
- low-confidence cases remain clearly marked rather than overstated

## Non-Goals

This spec does not require:

- autonomous curation
- blanket enrichment of all expert posts
- binary media storage as product truth
- open-ended autonomous agent loops
- direct live grounding inside the initial vision pass

## Suggested Implementation Breakdown For Linear

These should be treated as implementation slices under the existing milestone path, not as unrelated work.

### Slice 1: Enrichment run model and workflow wiring

Parent fit:

- `SKY-21`

Scope:

- run table and repo
- workflow binding and launcher
- idempotent run creation
- terminal states and progress tracking

### Slice 2: Asset-oriented enrichment schema

Parent fit:

- `SKY-24` or `SKY-16`, depending on where schema work is being finalized

Scope:

- multi-asset vision output shape
- post-level synthesis shape
- confidence and evidence fields

### Slice 3: Input assembly and planning stage

Parent fit:

- `SKY-21`

Scope:

- load stored payloads and thread context
- route by embed/media type
- build per-asset jobs

### Slice 4: Gemini vision execution lane

Parent fit:

- `SKY-16`

Scope:

- Gemini client integration
- structured output contract
- per-asset chart/media understanding
- synthetic alt-text generation

### Slice 5: Validation, scoring, and escalation policy

Parent fit:

- `SKY-16`

Scope:

- schema validation
- usable versus weak result classification
- bounded retries
- optional stronger-model escalation lane

### Slice 6: Source clue extraction and matching handoff

Parent fit:

- `SKY-16` leading into `SKY-17`

Scope:

- capture visible and textual source clues
- preserve evidence and uncertainty
- write handoff payload for registry matching

### Slice 7: Provider registry matching

Parent fit:

- `SKY-17`

Scope:

- alias matching
- canonical provider/source references
- evidence-bearing attribution results

### Slice 8: Grounding eligibility and adapter handoff

Parent fit:

- `SKY-10`

Scope:

- readiness rules for live grounding
- adapter invocation contract
- deferred grounding states

### Slice 9: Audit artifacts and observability

Parent fit:

- `SKY-21`

Scope:

- raw artifact storage
- workflow logs and traces
- model usage visibility
- review/debug surfaces

### Slice 10: Canonical evaluation harness

Parent fit:

- `SKY-16`

Scope:

- 7 canonical threads as evaluation set
- manual quality rubric
- regression checks for enrichment quality

## Recommended Delivery Order

1. run model and workflow wiring
2. asset-oriented schema
3. input assembly and planning
4. Gemini vision lane
5. validation and escalation
6. source clue handoff
7. provider matching
8. grounding readiness
9. audit and observability
10. ongoing evaluation harness

## Summary

The right model for Skygest is a pick-driven, workflow-centered enrichment pipeline that:

- begins from human curation
- reasons over each media asset explicitly
- separates observation from inference
- preserves confidence and evidence
- stores results in a form that later source normalization and grounding can trust

That keeps the system aligned with the product promise: preserve expert discourse, make dense media legible, and connect expert claims back to real sources without pretending the model knows more than it does.
