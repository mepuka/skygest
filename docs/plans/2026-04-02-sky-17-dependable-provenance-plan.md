# SKY-17 — Dependable Source Attribution Plan

## Objective

Finish `SKY-17` by making source attribution dependable enough to support later grounding work.

That means:

- provider matches are accurate on real Skygest examples
- ambiguous or weak cases stay explicit
- operators can inspect why the system matched or failed to match
- tuning is driven by a repeatable corpus, not one-off fixes

## Current State

What is already solid:

- the provider/content-source/social-provenance model exists
- the deterministic matcher exists
- source attribution is wired into the enrichment workflow
- image posts correctly wait for vision before attribution runs
- publication resolution is materially stronger than provider matching
- the new `SKY-48` eval loop gives us a small locked baseline

What is still weak:

- the provider registry is still small for the real corpus
- staging evidence shows low provider coverage on mixed real posts
- the main operator-facing surfaces mostly show top-line status, not evidence
- there is no attribution-specific trust or promotion policy for downstream use
- the live matcher behavior has drifted a bit beyond the original seven-signal design

## The Real Problem

`SKY-17` is not one problem. It is four tightly linked problems:

1. Coverage problem
   The registry does not yet cover enough of the real providers appearing in Skygest threads.

2. Proof problem
   Until recently, we had rule tests but not a real repeatable corpus review loop for attribution quality.

3. Visibility problem
   The system stores candidate and evidence detail, but most inspection surfaces collapse that into a simple provider line.

4. Trust problem
   Source attribution currently persists deterministic results, but there is no explicit rule for when a match is strong enough to power downstream grounding.

If we only add providers, we improve recall a bit but do not solve proof, visibility, or trust.

## Principles

1. Keep the current ontology split.
   Provider, content source, and social provenance stay separate.

2. Tune against real examples.
   Rule changes and registry growth must be justified by corpus outcomes, not intuition.

3. Optimize for false-positive control first.
   A missed provider is cheaper than a wrong provider when this will later drive grounding.

4. Make the lane inspectable before making it broader.
   If operators cannot see why a match happened, tuning will stay ad hoc.

5. Lock the signal contract.
   The implementation and the eval set need to agree on which signals are officially in play.

## What We Need To Resolve

### 1. Turn `SKY-48` into a real corpus, not just a smoke baseline

The current 10-case loop is a good start, but it is still too small to guide `SKY-17`.

Needed:

- expand the eval corpus using the known staging sample set and canonical threads
- label cases by expected outcome:
  - matched
  - ambiguous
  - unmatched
  - content-source-only
- track why a miss happened:
  - registry missing
  - rule missing
  - vision missing/weak
  - intentionally unresolved

Target:

- at least 40 to 60 real post-shaped examples before we call the lane dependable

### 2. Audit and lock the signal contract

The current code uses more than the original seven ranked signals.

Needed:

- decide whether `organizationMentions` and `logoText` stay live
- if they stay, document them and add them to the eval corpus
- if they do not stay, remove or gate them until proven

This is important because unmeasured weak signals are exactly how deterministic systems become quietly unreliable.

### 3. Build registry growth from observed misses

Registry expansion should be driven by real unresolved examples, not generic energy coverage.

First-wave candidates from current evidence:

- BC Hydro
- Hydro-Québec
- Manitoba Hydro
- Statistics Canada / related Canadian statistical sources when truly acting as originators
- ENTSO-E
- CAISO where still missing in real examples
- other observed primary originators from staging review

Important constraint:

- platforms like GridStatus remain content sources, not providers

### 4. Improve operator visibility into attribution decisions

We do not need a big new UI for `SKY-17`, but we do need better inspection.

Needed:

- MCP/operator formatting should show:
  - resolution
  - matched provider
  - top candidate set
  - strongest evidence signals
  - content source
  - social provenance
- review output should make false positives, ambiguous ties, and unresolved cases obvious

This is the minimum needed to make tuning disciplined.

### 5. Define downstream trust criteria

Not every matched result should automatically be treated as equally safe for `SKY-10`.

Needed:

- define what counts as a grounding-eligible attribution
- likely require:
  - `resolution = matched`
  - no competing tied candidate
  - strongest evidence from a sufficiently strong signal tier
  - optional source-family refinement when available

This does not need a new public API surface. It needs a clear internal rule so later adapter work does not treat every match as equally trustworthy.

## Recommended Execution Plan

### Phase 1 — Inspection And Corpus

Goal:

- make the current lane measurable and inspectable

Work:

- sync local `main` with merged `SKY-48`
- create a dedicated `sky-17/provenance-hardening` worktree
- expand the attribution eval corpus from the staging 38-post sample and canonical threads
- add corpus labels for provider/content-source/publication expectations
- improve operator/MCP formatting for candidate and evidence inspection

Success:

- we can rerun the corpus and see exactly where the lane fails

### Phase 2 — Contract And Registry Hardening

Goal:

- remove ambiguity about what the matcher is allowed to use

Work:

- audit signal drift against the design docs
- either formalize or remove the extra weak vision signals
- categorize every current miss as registry, rule, or vision problem
- do the first measured registry expansion wave from real misses only

Success:

- the registry is driven by observed corpus gaps, not speculation
- the matcher and the eval harness are measuring the same contract

### Phase 3 — Matcher Tuning

Goal:

- improve match quality without overclaiming

Work:

- tune alias/domain/source-family behavior using the expanded corpus
- tighten ambiguous-case handling where necessary
- add regression cases for every fixed false positive or recovered miss
- keep unresolved cases explicit instead of forcing winners

Success:

- false positives are eliminated on the locked corpus
- ambiguous cases stay ambiguous for the correct candidates

### Phase 4 — Grounding Readiness Gate

Goal:

- make `SKY-17` safe to hand off to `SKY-10`

Work:

- define a simple internal rule for grounding eligibility
- verify that the eligible subset is precise enough for adapter work
- document the handoff contract clearly

Success:

- `SKY-10` can depend on the attribution lane without treating every persisted result as equally trustworthy

## Working Success Metrics

These are the targets I would use to decide whether `SKY-17` is actually done enough:

- zero known false positives on the locked attribution corpus
- ambiguous cases preserve the correct candidate set
- provider precision on matched cases is high enough to trust for downstream grounding
- unresolved cases are explainable, not silent failures
- operators can inspect why a match happened without reading raw stored payloads

## Immediate Next Steps

1. Create a `sky-17` worktree for provenance hardening.
2. Pull the 38-post staging sample into a checked-in attribution corpus.
3. Add inspection output for top candidates and strongest evidence.
4. Classify every miss into registry, rule, or upstream vision weakness.
5. Use that classification to drive the first registry and matcher tuning pass.

## Bottom Line

The real solution for `SKY-17` is not “add more providers.”

It is:

- measured corpus expansion
- explicit signal-contract control
- better operator visibility
- registry growth from observed misses
- a clear rule for what downstream systems are allowed to trust

That gives us a provenance lane we can actually prove, not one that only looks complete because the code path exists.
