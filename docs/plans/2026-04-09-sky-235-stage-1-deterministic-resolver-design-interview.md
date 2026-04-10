# SKY-235 Slice 2a: Stage 1 Deterministic Resolver Design Interview

## Goal

Lock the implementation design for the pure Stage 1 deterministic resolver before writing the kernel, so Slice 2a can move into implementation with a stable contract, a stable eval loop, and clear seams for later Stage 2 work.

## Provenance

- Design interview session ID: `019d7439-e53e-7980-8c1e-f6fa88db5ec5`
- Local transcript reviewed from:
  - `/Users/pooks/.codex/sessions/2026/04/09/rollout-2026-04-09T16-50-44-019d7439-e53e-7980-8c1e-f6fa88db5ec5.jsonl`
- Primary design sources reviewed during the interview:
  - `SKY-235` Linear issue
  - April 9, 2026 resolution-flow architecture doc
  - April 8, 2026 data-layer design doc
  - existing repo patterns in `src/source/`, `src/matching/`, `src/domain/data-layer/`, `src/services/`, `src/bluesky/`, and `eval/source-attribution/`
  - local Effect reference source under `.reference/effect/packages/effect/src/`

## Status

The design interview is now closed. All substantive branches discussed in the session and the follow-up turns in this thread are locked for Slice 2a.

## Locked Decisions

### 1. Stage 1 kernel contract

1. Stage 1 returns a Stage-1-specific algorithm result, not persisted `Candidate` records.
2. Stage 1 stays multi-match internally even though the current SKY-215 corpus is one canonical candidate per post.
3. Stage 1 matches at the direct grain only. A Distribution hit stays a Distribution hit; do not auto-fill parent Dataset or Agent fields.
4. Same-entity, same-grain hits merge into one accepted Stage 1 match with accumulated evidence and the strongest rank.
5. If multiple same-grain targets remain equally valid, Stage 1 emits no accepted match for that branch and records an ambiguity residual instead.
6. Stage 1 uses ordinal rank such as `bestRank`, not a fake decimal confidence score.
7. Evidence attaches directly to each match. Any flattened evidence trace is a derived reporting view, not the primary contract.
8. Stage 1 preserves unconsumed semantic text signals as residuals even when a definitive source-level match already exists.
9. Signal priority is winner selection within a grain, not a global early-exit rule. Lower-priority signals can still add corroborating evidence.
10. Series resolution is out of scope for Slice 2a. The Stage 1 report should show Series as deferred to Stage 2.

### 2. Stage 1 internal model

1. Internal accepted matches are a tagged union by grain, not a generic optional-field object.
2. Exported match, evidence, residual, and result contracts should be Effect Schemas.
3. The hot accumulator and merge logic should stay as plain internal TypeScript over Effect collections, not schema-heavy plumbing.
4. Internal `MatchKey` should be typed, not a composite string key.
5. Use a tiny `Data.struct`-style value for `MatchKey` so `HashMap` gets structural equality and hashing automatically.
6. Residuals should be a tagged union by residual kind, not a generic blob with a string source field.

### 3. Registry design

1. `DataLayerRegistry` lookups should stay strongly typed by intent.
2. Only `byCanonicalUri(...)` should return a broad entity union.
3. Agent label matching should use a derived normalized index from `name` and `alternateNames`, not a new `"alias-label"` alias scheme.
4. `references/cold-start/` is the source of truth for Slice 2a, not a separate `config/data-layer/test-registry.json`.
5. The file-backed loader should read all cold-start entity kinds that belong to the future registry model.
6. The Stage 1 registry should only build the lookup indices needed for the Stage 1 slice right now.
7. The registry architecture should follow the checked-in-data -> pure prepare function -> thin service wrapper pattern.
8. The file-backed implementation and future D1-backed implementation should share the same registry interface seam.
9. For Slice 2a, the file-backed registry should load directly from the cold-start directories at runtime rather than from a compiled snapshot.
10. The file-backed loader should fail fast on malformed JSON, schema mismatch, duplicate canonical ID, or broken reference in `references/cold-start/`.
11. Loader validation should collect all schema and integrity problems it finds, then fail once with a typed diagnostic result plus one formatted diagnostic report.
12. Schema decode failures should use Effect Schema parse-result formatting utilities so the failure tree is readable.
13. Prepared exact-match indices should reject normalized collisions up front rather than letting runtime lookups become nondeterministic.

### 4. Normalization and matching rules

1. Shared normalization should only contain generic canonicalization rules.
2. Signal-specific parsers and extractors should stay lane-local.
3. Distribution URL matching should ignore query strings and fragments for the actual Distribution lookup.
4. The raw URL should still be preserved for structured identifier extraction.
5. The resolver should reuse the small generic bucket-and-order kernel in `src/matching/core.ts` where it helps, but should not be abstracted into a universal matching framework.
6. Canonical outward ordering should be modeled with Effect `Order` combinators rather than ad hoc comparator logic.
7. Accepted matches should sort by grain priority `Distribution -> Dataset -> Agent -> Variable`, then by `bestRank`, then by canonical entity ID.
8. Evidence should remain in discovery order.
9. Residuals should sort by residual kind and then by discovery order.

### 5. Inputs and context

1. `postContext` should be its own narrow resolution-specific schema, not the full enrichment plan.
2. For Slice 2a, `postContext` should include only the raw post-level inputs Stage 1 still needs beyond `vision` and `sourceAttribution`.
3. Concretely, that means the Stage 1 `postContext` stays limited to `postUri`, `text`, `links`, `linkCards`, plus the coverage indicator below.
4. `postContext` should explicitly include `threadCoverage`.
5. Slice 2a stays `focus-only`.
6. A future `threadCoverage: "author-thread"` mode is a deliberate follow-up seam.
7. In that future mode, Stage 1 may borrow same-author follow-up thread links and text as extra context, but accepted matches still attach to the original focus post.

### 6. Eval harness and report

1. The eval harness should default to a local exported snapshot, not a live staging fetch on every run.
2. Live staging fetch should exist only as an explicit refresh path.
3. The local snapshot should store the raw inputs the kernel consumes: `vision`, `sourceAttribution`, and narrow `postContext`.
4. The eval should compare ground truth and resolver output as per-post, per-grain direct reference sets.
5. The Stage 1 report should lead with failing posts rather than aggregate metrics.
6. Each failing post view should show expected per-grain refs, actual per-grain refs, accepted matches, and residuals.
7. The report should classify misses and unresolved branches into actionable buckets such as `registry-gap`, `parser-or-normalization-gap`, `stage1-ambiguity`, and `deferred-to-stage2`.

## Important User Clarifications

These points came from the user during the interview and should be treated as design constraints:

1. Favor real code reuse, especially around shared normalization and reusable Effect-native abstractions.
2. Keep the kernel transparent. Avoid fake confidence metrics and other made-up scoring.
3. The pure function is the core deliverable. It should be the stable kernel that the team can iterate on quickly through evals.
4. Preserve inspectability. The report should make misses easy to diagnose and improve in cycles.
5. `references/cold-start/` is where additional hand-crafted canonical examples will be added during eval and improvement iterations.
6. Thread handling is a real concern, especially when a chart appears in one post and the direct source link appears in a same-author follow-up post. That concern is acknowledged now and intentionally deferred behind the `threadCoverage` seam.
7. Loader validation should return a typed diagnostic shape, not just throw an opaque string.
8. Sorting should be modeled declaratively with Effect `Order` utilities.

## Effect Patterns Surfaced During The Source Dive

These were the most relevant Effect-native patterns surfaced during the subagent review of the local Effect source:

1. `HashMap.modifyAt`, `HashMap.values`, and `HashMap.reduce` are the main accumulation primitives to lean on.
2. `Chunk.mapAccum`, `Chunk.sortWith`, `Chunk.dedupe`, `Chunk.append`, and `Chunk.appendAll` are useful for ordered evidence collection and residual threading.
3. `Option.match`, `Option.firstSomeOf`, `Option.fromNullishOr`, `Option.map`, `Option.flatMap`, and `Option.liftPredicate` fit the signal parsing flow.
4. `Match.valueTags` is a good fit for exhaustive branching on tagged unions when it improves clarity.
5. Boundary contracts should stay in `Schema.Struct` and `Schema.Union`.
6. The resolver core should remain plain functions over Effect collections; the Effect service layer should stay thin.

## Open Questions

None at the Slice 2a design level. The interview is complete.

## Success Conditions

Slice 2a is ready to implement against this design when all of the following hold:

1. A pure `runStage1(...)` kernel exists and is the main implementation unit.
2. A prepared data-layer registry exists as a pure lookup value built from `references/cold-start/`.
3. The Effect service wrapper is thin and only injects the prepared registry into the pure kernel.
4. Stage 1 exports schema-backed result types for matches, evidence, residuals, and the overall result.
5. The eval harness runs against a local snapshot of raw consumed inputs.
6. The report is failing-post-first and includes actionable miss buckets.
7. Stage 1 does not invent fake IDs, fake timestamps, or fake decimal confidence scores.
8. Stage 1 explicitly preserves residuals needed for targeted Stage 2 follow-up.
9. The file-backed loader returns a typed validation diagnostic on failure and formats schema decode issues using Effect Schema parse-result utilities.
10. Stage 1 outward ordering is stable and declarative rather than left to downstream consumers.

## Appendix A: Exact Decision Prompts Reviewed From The Transcript

These are the exact decision prompts reviewed from the session transcript. Status values here reflect the outcome after reading the user’s replies in the transcript plus the current thread.

1. `For Slice 2a, should Stage 1 return a Stage-1-specific match record that wraps a partial canonical candidate shape plus confidence and evidence, instead of trying to make raw Candidate[] carry temporary IDs, timestamps, and ranking data this early?`
   - Status: locked yes
2. `Should DataLayerRegistry keep lookups strongly typed by intent, so byAlias("Variable", ...) returns a Variable, byHostname(...) and byUrlPrefix(...) return Distributions, byProviderAgent(...) returns an Agent, and only byCanonicalUri(...) returns a broad union?`
   - Status: locked yes
3. `Should we make that split explicit for the resolver too: put only generic canonicalization rules in a shared normalization core, and keep signal-specific parsers and extractors local to each lane?`
   - Status: locked yes
4. `Should Slice 2a keep Stage 1 as a multi-match output even though the current SKY-215 corpus is one persisted candidate per post?`
   - Status: locked yes
5. `Should Stage 1 ignore query strings and fragments for Distribution URL matching, while still preserving the full raw URL for the structured-identifier pass when parameters or fragments carry useful codes?`
   - Status: locked yes
6. `When multiple Stage 1 signals hit the same entity at the same grain, should we merge them into one Stage 1 match with accumulated evidence and the best rank, instead of emitting duplicate matches?`
   - Status: locked yes
7. `Does that still hold, or has your thinking changed? Specifically: if Stage 1 matches a Distribution, should it keep that as a Distribution-only match, instead of automatically filling the parent Dataset and Agent fields from the catalog chain?`
   - Status: locked yes
8. `For Stage 1’s internal abstraction, should we model matches as a tagged union by grain, like DistributionMatch | DatasetMatch | AgentMatch | VariableMatch, each with its own typed payload and evidence, rather than one generic object full of optional referenced*Id fields?`
   - Status: locked yes
9. `For the internal HashMap bucket key, should we use a typed pair like MatchKey { grain, id } instead of encoding it into a composite string such as "Distribution\0<id>"?`
   - Status: locked yes
10. `Should we split Stage 1 the same way: define the exported match/evidence/residual/result contracts as Effect Schemas in src/resolution/Stage1Schemas.ts, while keeping the accumulator state and bucket-merging logic as plain internal TypeScript over HashMap and Chunk?`
    - Status: locked yes
11. `For the exported Stage 1 match contract, should we expose the strongest signal as a discrete bestRank/confidenceRank field rather than inventing a normalized 0..1 confidence score?`
    - Status: locked yes
12. `Should the exported Stage 1 result attach evidence directly to each match, and treat any flattened evidenceTrace view as a derived reporting shape rather than a primary contract field?`
    - Status: locked yes
13. `When Stage 1 finds multiple equally valid targets at the same grain, should it emit no match for that branch and instead record a typed ambiguity residual that includes the tied candidates and their evidence?`
    - Status: locked yes
14. `For the Stage 1 eval harness, should we compare ground truth and resolver output as per-post sets of direct-grain references, like “Agent IDs present,” “Distribution IDs present,” “Dataset IDs present,” and “Variable IDs present,” rather than trying to compare whole candidate-shaped records?`
    - Status: locked yes
15. `Should the internal MatchKey be a tiny Data.struct-style value like { grain, entityId }, so HashMap gets structural equality and hashing automatically, instead of us hand-rolling key hashing or backsliding to encoded strings?`
    - Status: locked yes
16. `Should the exported Stage 1 residual contract be a tagged union by residual kind, like UnmatchedSourceLineResidual, TitleResidual, AxisLabelResidual, PostTextResidual, and AmbiguousCandidatesResidual, instead of one generic residual object with a string source field?`
    - Status: locked yes
17. `Should Stage 1 always preserve those semantic text signals as residuals when they are present and unconsumed by Stage 1, even if the same post already got a definitive Distribution or Agent match?`
    - Status: locked yes
18. `Should Stage 1 treat signal priority as “winner selection within a grain,” not as a global early-exit rule? In other words: weaker lanes can still add corroborating evidence to an existing same-grain match, but they should not override it or create a second accepted same-grain match unless that turns into an ambiguity residual.`
    - Status: locked yes
19. `For Stage 1, should postContext be its own narrow resolution-specific schema that includes only the raw post-level signals Stage 1 still needs beyond vision and sourceAttribution such as post text, stored links, and link cards, instead of reusing the full enrichment execution plan?`
    - Status: locked yes
20. `Does that still hold for Stage 1? Specifically, should we reuse and lightly extend src/matching/core.ts for generic bucket accumulation and ordering, while keeping the resolver’s signal extraction, typed match union, and residual logic in src/resolution/ rather than “abstracting” them into a shared matcher framework?`
    - Status: locked yes
21. `Does this still hold, or has your thinking changed? Specifically: should Stage 1’s Agent name matching use a derived normalized label index built from name + alternateNames, instead of adding "alias-label" to the canonical AliasScheme enum?`
    - Status: locked yes
22. `Does the separate config/data-layer/test-registry.json still make sense, or should Slice 2a treat references/cold-start/ as the source of truth and build the in-memory Stage 1 registry from those existing checked-in entities?`
    - Status: locked yes
23. `Should Series stay out of Stage 1 for Slice 2a, with the eval harness still reporting Series separately as a baseline “not attempted yet” lane rather than pretending Stage 1 should resolve it now?`
    - Status: locked yes
24. `For the eval output, should we show Series as an explicit “deferred to Stage 2” lane in the Stage 1 report, instead of showing it as ordinary Stage 1 recall?`
    - Status: locked yes
25. `Should postContext for Slice 2a include only postUri, text, links, and linkCards, and leave thread/quote/embed metadata out unless we find a concrete Stage 1 rule that actually needs it?`
    - Status: locked yes
26. `For Slice 2a, should we keep Stage 1 populated with focus-only context for now, but make postContext explicitly carry a threadCoverage field so the contract already has room for a later "author-thread" mode without redesigning Stage 1?`
    - Status: locked yes
27. `Should Slice 2a follow that same three-layer pattern for the data-layer registry: references/cold-start/ as checked-in source data, a pure prepareDataLayerRegistry(...) function that builds all derived indices, and then a thin DataLayerRegistry Effect service that just exposes the prepared lookup?`
    - Status: locked yes
28. `For Slice 2a, should we implement both runStage1(...) as the primary pure function and a tiny Stage1Resolver service that just injects the prepared DataLayerRegistry and calls that function, or do you want to keep this slice strictly at the pure-function layer only?`
    - Status: locked yes
29. `For the file-backed Slice 2a registry, should we load directly from the existing references/cold-start/ directories at runtime, instead of first compiling them into one derived snapshot file?`
    - Status: locked yes
30. `Should DataLayerRegistry expose a dedicated Agent-name lookup like byAgentLabel(...), built from normalized name + alternateNames, instead of trying to route those matches through generic byAlias(...)?`
    - Status: locked yes
31. `For Slice 2a, should the file-backed loader read all cold-start entity kinds that belong to the future registry model, but only build the Stage 1 lookup indices for the subset we actually use right now?`
    - Status: locked yes
32. `For Slice 2a, should the eval harness default to a local exported snapshot of the 289 posts’ vision/source-attribution inputs, with staging fetch as an explicit refresh step rather than something every eval run does?`
    - Status: locked yes
33. `For the local Stage 1 snapshot, should we store the raw inputs the kernel actually consumes, meaning vision, sourceAttribution, and narrow postContext, rather than storing a preassembled Stage1Input or any already-projected comparison sets?`
    - Status: locked yes
34. `Should the baseline Stage 1 report be organized primarily by failing posts, with each post showing expected per-grain refs, actual per-grain refs, accepted matches, and residuals, and then only secondarily roll up precision/recall totals?`
    - Status: locked yes
35. `Should the report classify every miss or unresolved branch into one actionable bucket such as registry-gap, parser-or-normalization-gap, stage1-ambiguity, or deferred-to-stage2, instead of only dumping the raw residual content?`
    - Status: locked yes
36. `Should we explicitly defer thread-unit resolution to a follow-up slice, with the future rule being: threadCoverage: "author-thread" means Stage 1 can borrow extra links/text from same-author follow-up posts in the same thread, but any accepted matches still belong to the original focus post rather than becoming thread-level records?`
    - Status: locked yes
37. `For the Slice 2a file-backed data-layer loader, should startup fail immediately on any malformed JSON, schema mismatch, duplicate canonical ID, or broken reference in references/cold-start/, instead of loading a partial registry and only warning?`
    - Status: locked yes
38. `For the Slice 2a file-backed loader, should validation collect all schema and integrity problems across the cold-start files and then fail once with one formatted diagnostic report, instead of stopping on the first bad file?`
    - Status: locked yes
39. `For the prepared data-layer registry, should we reject any normalized exact-match collision up front, such as two Agents normalizing to the same label, two Distributions normalizing to the same host-plus-path key, or two aliases collapsing to the same exact lookup key, instead of letting Stage 1 see a nondeterministic lookup?`
    - Status: locked yes
40. `For Stage 1’s canonical outward ordering, should we sort accepted matches by grain priority Distribution -> Dataset -> Agent -> Variable, then by bestRank, then by canonical entity ID, while keeping evidence in discovery order and sorting residuals by residual kind plus discovery order?`
    - Status: locked yes
