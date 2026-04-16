# SKY-21 — Enrichment Pipeline Primitives

## Goal

Define the reusable infrastructure pattern for:

`picked post -> enrichment run -> structured result stored alongside the post`

`SKY-21` is not the vision feature itself. It is the primitive layer that makes all post-pick enrichments possible in a consistent way.

This issue exists to answer one architectural question cleanly:

> once a post is picked, what is the canonical way to trigger, track, retry, and complete enrichment work?

## Why This Needs To Exist Separately

Today the repo has:

- ingest workflow orchestration
- candidate/picked payload persistence
- manual curation
- per-kind enrichment result storage

What it does not yet have is a generic post-pick enrichment runtime.

Without `SKY-21`, every later feature would have to invent its own answer to:

- how a run starts
- where run status lives
- how duplicate work is prevented
- how retries work
- how operators can inspect failures
- how results are attached back to the picked post

That would make `SKY-16`, `SKY-17`, and `SKY-10` inconsistent and harder to operate.

## Product Role

This primitive layer supports the product promise without taking over editorial judgment.

- curation remains human-directed
- the pick record remains the source of truth
- enrichment happens only after a pick
- the workflow enriches the picked post; it does not decide whether the post is important

## Scope

`SKY-21` should include:

- the trigger model from pick to enrichment run
- the generic run record and state machine
- workflow launch and lifecycle tracking
- idempotency rules
- input assembly from stored payloads
- enrichment planning and routing into later lanes
- generic persistence hooks for enrichment results
- retry, failure, and recovery rules
- operator-visible status and debugging surfaces

`SKY-21` should not include:

- Gemini prompt design
- chart extraction logic
- source registry matching rules
- live external data adapters
- feed UI behavior

## Architectural Decision

The default runtime model should be:

`pick record -> create enrichment run -> start Cloudflare Workflow -> load stored payload -> plan work -> execute enrichment lane -> save result -> complete run`

Recommended platform split:

- `Cloudflare Workflow` orchestrates one enrichment run
- `D1` stores run state and final normalized outputs
- `R2` stores raw provider responses and large audit/debug artifacts
- `AI Gateway` fronts model calls when present

Optional:

- `Queue` can sit in front for backfills, delayed retries, or bursts
- `Durable Object` can be added later only if provider pacing or serialization becomes a real problem

For the normal manual pick flow, workflow creation can happen directly after the pick action. A queue is not required as the control plane.

## Core Responsibilities

### 1. Canonical trigger model

The only canonical trigger is the persisted pick record.

Rules:

- no enrichment trigger for unpicked posts
- no separate curated-event truth system
- no direct trigger from raw media discovery

### 2. Canonical run model

Each enrichment run needs one durable home for status, phase, timing, and errors.

This is the missing primitive today.

### 3. Canonical input assembly

All downstream enrichment lanes should start from the same assembled input packet built from durable stored state:

- picked post payload
- thread text and metadata
- embed/media payload
- quote/link context when present
- schema and prompt version info

### 4. Canonical planning step

The primitive layer should decide which enrichment lane needs to run for a picked post.

Examples:

- chart images -> vision lane
- link-heavy post -> source-attribution lane
- quoted post with media -> mixed planning path

This planning step should be explicit and inspectable, not a black-box agent loop.

### 5. Canonical completion model

Every later enrichment feature should complete in the same way:

- write normalized result
- update run state
- preserve evidence and error context
- leave a clear terminal status

## Data Model

### New table: `post_enrichment_runs`

This table should exist alongside `post_payloads` and `post_enrichments`.

Suggested fields:

- `id`
- `workflow_instance_id`
- `post_uri`
- `enrichment_type`
- `schema_version`
- `triggered_by`
- `requested_by`
- `status`
- `phase`
- `attempt_count`
- `model_lane`
- `prompt_version`
- `input_fingerprint`
- `started_at`
- `finished_at`
- `last_progress_at`
- `result_written_at`
- `error`

Notes:

- `status` is the coarse state
- `phase` is the current workflow step family
- `attempt_count` tracks retries within the same logical run
- `input_fingerprint` helps explain whether two runs used meaningfully different inputs

## Result storage remains where it is

`post_enrichments` should remain the home for latest successful enrichment outputs by kind.

That means:

- `post_enrichment_runs` tracks the lifecycle of work
- `post_enrichments` stores the durable product-facing result

This separation is the core primitive being introduced.

## State Model

### Status

Recommended run statuses:

- `queued`
- `running`
- `complete`
- `failed`
- `needs_review`

### Phase

Recommended generic phases:

- `queued`
- `assembling`
- `planning`
- `executing`
- `validating`
- `persisting`
- `complete`
- `failed`
- `needs_review`

The phase model should stay generic enough that `SKY-16`, `SKY-17`, and later enrichments can reuse it.

## Idempotency Rules

The issue definition already sets the intended dedupe rule:

`(post_uri, enrichment_type, schema_version)`

That should remain the logical idempotency key for v1.

Implications:

- a second trigger for the same post, same enrichment kind, and same schema version should not start duplicate active work
- retries should update the same logical run rather than creating silent duplicates
- a schema version bump is the clean way to force a fresh run

Additional fields such as `prompt_version`, `model_lane`, and `input_fingerprint` should still be recorded for observability, but they should not replace the main dedupe key in v1.

## Workflow Contract

The workflow input should stay minimal and stable.

Suggested workflow input:

- `postUri`
- `enrichmentType`
- `schemaVersion`
- `triggeredBy`
- `requestedBy`

Everything else should be loaded from durable storage inside the workflow.

That keeps retries and replays stable and avoids large or fragile event payloads.

## Stage Breakdown

### Stage A: Run creation

Responsibilities:

- validate trigger input
- derive idempotency key
- create queued run if absent
- create workflow instance

Output:

- stable run record and workflow instance id

### Stage B: Input assembly

Responsibilities:

- load picked payload row
- confirm capture stage is `picked`
- load existing enrichments if relevant
- assemble post/thread/link/quote/media context

Failure behavior:

- fail cleanly if no picked payload exists
- do not fall back to live Bluesky fetches as the normal path

### Stage C: Planning

Responsibilities:

- decide whether the requested enrichment should run
- decide which assets or contexts are in scope
- produce the execution plan consumed by later enrichment logic

Important boundary:

This stage decides what work to do. It should not contain the feature-specific logic for how vision or attribution is performed.

### Stage D: Execution handoff

Responsibilities:

- call the feature-specific enrichment lane
- record progress before and after handoff
- capture failure envelopes in a generic format

In `SKY-21`, this can be a stubbed or minimal lane so the primitive path exists before `SKY-16` is complete.

### Stage E: Validation and persistence

Responsibilities:

- validate the returned payload shape
- write final successful enrichment output
- update timestamps
- transition run to terminal state

### Stage F: Recovery and retry

Responsibilities:

- increment attempt count
- retry bounded transient failures
- mark `needs_review` when the system cannot proceed safely
- leave enough context for an operator or repair job to understand what happened

## Service Boundaries

`SKY-21` should add or formalize the following services:

### `EnrichmentRunsRepo`

Responsibilities:

- create queued run if absent
- get run by id
- list recent/running runs
- mark phase transitions
- mark progress
- mark complete
- mark failed
- mark needs review

### `EnrichmentWorkflowLauncher`

Responsibilities:

- validate request
- create run record
- launch workflow
- recover cleanly if workflow creation fails

### `EnrichmentPlanner`

Responsibilities:

- assemble durable input context
- route by post/embed/media shape
- return a normalized execution plan

This planner is still part of the primitive layer because every later enrichment depends on it.

## Env And Worker Shape

This should mirror the ingest architecture rather than being bolted into it.

Expected additions:

- new workflow binding for enrichment runs
- new workflow env type
- enrichment workflow export from the Worker entry
- optional admin route for manual start or retry

The goal is parallel structure:

- ingest path remains ingest
- enrichment path becomes enrichment

Shared D1 and service layers can still be reused.

## Operator And Debug Surfaces

`SKY-21` should make enrichment visible enough to operate.

Minimum operator needs:

- inspect a run by id
- see status, phase, attempt count, and last progress
- see terminal error summary
- retry or rerun with intent

This does not require a full UI in `SKY-21`, but the data and service shape should support it.

## Recovery Model

The primitive layer should assume that some runs will fail mid-flight.

Minimum recovery expectations:

- workflow creation failure marks the run failed
- transient execution failure increments attempt count
- terminal validation failure does not silently write bad output
- stale or abandoned runs can be detected by status plus `last_progress_at`

If ingest has a repair pattern worth reusing, enrichment should mirror that design rather than inventing a different failure model.

## Acceptance Criteria

`SKY-21` is done when:

1. picking a post can deterministically create or reuse an enrichment run
2. the run is tracked independently from the final enrichment payload
3. the workflow loads its own durable input from D1
4. the workflow can enter and leave generic phases cleanly
5. a successful run writes a normalized enrichment result back alongside the picked post
6. a failed run records enough state for inspection and retry
7. duplicate triggers do not create duplicate active work for the same logical key

## Recommended Split In Linear

I do not think `SKY-21` should stay as one undifferentiated implementation issue.

It is better treated as a parent infrastructure issue with a few tightly scoped technical follow-ons.

### Keep `SKY-21` as the parent issue

`SKY-21` should continue to describe the full primitive capability:

- trigger model
- run model
- workflow orchestration
- routing and persistence contract

### Suggested child issues

#### 1. Enrichment run domain + D1 migration

Scope:

- `post_enrichment_runs` schema
- domain models for status and phase
- D1 repo for lifecycle transitions

Why split:

- isolated data-model and persistence work
- easiest first PR

#### 2. Enrichment workflow launcher + worker binding

Scope:

- new workflow binding in env
- workflow entrypoint export
- launcher service
- create-run then launch pattern

Why split:

- isolates Cloudflare wiring from downstream logic

#### 3. Enrichment planner + input assembly

Scope:

- load picked payloads
- assemble thread/media/link/quote context
- generic routing to requested enrichment kind

Why split:

- this is the reusable heart of later enrichments
- it is bigger than "just part of launcher wiring"

#### 4. Enrichment run inspection + recovery hooks

Scope:

- list/get running or recent runs
- retry and terminal-state handling
- repair/review affordances
- logging and audit hooks

Why split:

- keeps operational quality from being bolted on later

## Recommendation

Treat `SKY-21` as a parent issue with four technical implementation issues beneath it.

That gives a clean order:

1. run domain and migration
2. workflow wiring
3. planner and input assembly
4. inspection and recovery

Then `SKY-16` can build on top of that primitive layer without dragging orchestration details into the vision implementation.

## Summary

`SKY-21` should establish one reusable answer to:

- how enrichment starts
- how enrichment is tracked
- how enrichment loads durable input
- how enrichment finishes
- how enrichment fails safely

If that is done well, the later feature issues become straightforward feature lanes instead of architecture debates.
