# Effect-Native Multi-Signal Entity Matching

> Revised design for Skygest's deterministic entity-linking and disambiguation work, based on the current matcher code, the source-attribution roadmap, and Effect's own service and data-structure patterns.

**Date**: 2026-03-19

---

## 1. Executive Summary

This document replaces the earlier "generic matcher framework" framing with a narrower, more practical design:

1. **The core problem is deterministic reference reconciliation against a curated registry.**
2. **The shared kernel should stay small.** Share evidence accumulation and single-winner resolution where that is actually common, but do not force the topic matcher and source-attribution matcher into one universal engine.
3. **The matching rules should be mostly pure functions.** Effect services belong at the dependency boundary, not inside the rule engine.
4. **Internal matching types should be richer than the persisted schema.** Use fully typed tagged unions for signals and resolution internally, then project to smaller serialized shapes at the boundary.
5. **Use Effect data structures where they help the model.** `HashMap` for indexed accumulation, `Chunk` for ordered evidence, `Option` for absence, and `_tag`-based unions for internal state.
6. **For now, only the source-attribution matcher should be refactored into this shape.** The ontology matcher is already small and pure, and it has a different resolution policy.

---

## 2. What Problem Are We Solving?

The underlying operation is:

> Deterministic multi-signal reference reconciliation against a curated registry.

In computer-science terms, this is closest to:

- record linkage / entity resolution
- named entity linking against a knowledge base
- authority control / catalog reconciliation

But Skygest is solving a constrained variant:

- one side is a curated registry
- the other side is a messy observation
- classification is deterministic, not probabilistic
- ambiguity is explicit
- the matcher must be auditable

That puts the shape closer to a **rule-based reconciliation kernel** than to search ranking or machine-learning entity linking.

### Stable invariants

Any matcher in this family should preserve these invariants:

1. **Registry immutability**. Matching never mutates the registry.
2. **Determinism**. Same input and same registry snapshot always give the same result.
3. **Signal independence during extraction**. Signal extractors do not depend on each other firing.
4. **Explicit ambiguity**. Ties should remain ties unless the domain defines a real tie-break rule.
5. **Domain-owned resolution policy**. The shared kernel must not erase the fact that different matchers resolve differently.

---

## 3. What We Are Not Building

This refactor should **not** build:

- a universal matcher framework shared equally by the topic matcher and the source-attribution matcher
- a probabilistic scoring system
- a generic registry API that collapses all domain-specific lookups into `findByKey`
- a service per signal extractor
- a deeply layered graph for an otherwise local in-memory decision problem

The current topic matcher and source matcher do not share enough behavior to justify that level of abstraction today.

### Why not one framework for both matchers?

The two existing matchers share a family resemblance, but not a single runtime contract:

- The ontology matcher is **multi-label**. Each topic is evaluated independently and any topic with evidence can match.
- The source-attribution matcher is **single-winner-or-ambiguous**. It chooses zero or one provider at the post level.

That means the shared layer should stop at:

- evidence production
- evidence grouping
- optional single-winner resolution helpers

Everything after that remains domain-specific.

---

## 4. Design Goals

The revised design should optimize for:

1. **Purity in the core**. The rule engine should be pure and easily unit-testable.
2. **Full type safety**. Signals, evidence, and resolution should be statically modeled, not hidden behind loose string maps.
3. **Effect-native boundaries**. Services and layers should be used to acquire dependencies and build immutable lookup views, not to host every branch of the algorithm.
4. **Incremental growth**. Adding the remaining source-attribution signals should require appending extractors, not rewriting the matcher service.
5. **Clear internal vs external models**. Internal matching state can be richer than the serialized contract.
6. **No accidental ontology drift**. Source-attribution-specific ideas like `contentSource`, `socialProvenance`, and `sourceFamily` should not leak into the generic kernel.

---

## 5. Effect-Inspired Design Principles

This design is informed by the shape of Effect's own code and guidance:

- `Context.Tag` and `Layer.effect` are used to build services at the boundary.
- Effect services are constructors for reusable capabilities, not a reason to make pure logic artificially effectful.
- Effect's collections use immutable public values with controlled mutation builders internally, for example `HashMap.beginMutation` / `endMutation` and `HashMap.mutate`.
- Effect models optionality explicitly with `Option`, not loose `null`.
- Effect's internal state machines and data models rely heavily on `_tag`-based unions and small total helper functions.

### Concrete patterns worth copying

1. **Immutable public values, local mutation for builders**
   - `HashMap` and `Chunk` are immutable from the outside.
   - Local builder-style mutation is allowed where it improves efficiency and does not escape the function.

2. **Tagged unions for internal states**
   - Use `_tag` for internal resolution and signal types.
   - Keep stringly-typed `"matched" | "ambiguous" | "none"` only at serialization boundaries if needed.

3. **Total helpers for partial operations**
   - Parse and lookup helpers should return `Option`, not rely on unchecked exceptions.

4. **Thin service wrappers**
   - Acquire dependencies once.
   - Convert them into plain lookup values.
   - Call pure matcher functions.

---

## 6. Recommended Architecture

The right split is:

```
domain schemas / persisted contracts
            +
pure matching kernel
            +
domain-specific source-attribution rules
            +
thin Effect service adapter
```

### 6.1 Layer 1: Generic matching kernel

This is the smallest piece that should be shared.

It owns:

- evidence type shape
- evidence accumulation into buckets keyed by entity
- single-winner resolution helper for domains that need it

It does **not** own:

- provider-specific signal definitions
- source-family refinement
- content-source selection
- social provenance
- ontology ambiguity suppression
- persistence schemas

### 6.2 Layer 2: Source-attribution domain matcher

This owns:

- source-attribution input type
- provider signal union
- extractor list
- provider-specific resolution policy
- source-family refinement
- content-source assembly
- social-provenance assembly

### 6.3 Layer 3: Effect service adapter

This owns:

- acquiring `ProviderRegistry`
- optionally acquiring future publication lookup services
- exposing one `match` entrypoint to workflows

It should not host the rule engine itself.

---

## 7. Generic Kernel Design

The kernel should use plain TypeScript types plus Effect collections, not schemas, because this is internal algorithmic state rather than a wire or persistence contract.

## 7.1 Core types

```ts
import { Chunk, HashMap, Option } from "effect"

export type RankedSignal = {
  readonly _tag: string
  readonly rank: number
}

export type Evidence<EntityId, Signal extends RankedSignal> = {
  readonly entityId: EntityId
  readonly signal: Signal
}

export type EvidenceBucket<EntityId, Signal extends RankedSignal> = {
  readonly entityId: EntityId
  readonly bestRank: number
  readonly evidence: Chunk.Chunk<Evidence<EntityId, Signal>>
}

export type EvidenceIndex<EntityId, Signal extends RankedSignal> =
  HashMap.HashMap<EntityId, EvidenceBucket<EntityId, Signal>>

export type SingleResolution<EntityId, Signal extends RankedSignal> =
  | {
      readonly _tag: "Unmatched"
    }
  | {
      readonly _tag: "Matched"
      readonly winner: EvidenceBucket<EntityId, Signal>
    }
  | {
      readonly _tag: "Ambiguous"
      readonly candidates: Chunk.Chunk<EvidenceBucket<EntityId, Signal>>
    }
```

### Why this shape?

- `rank` lives on the signal value, not in a separate global table.
- Evidence is typed by domain-specific signal unions.
- Buckets cache `bestRank` so resolution does not repeatedly rescan evidence.
- `HashMap` and `Chunk` provide immutable semantics with efficient local building.
- Internal resolution uses `_tag`, which is closer to Effect's own internal modeling.

## 7.2 Generic extractor shape

```ts
export interface SignalExtractor<Input, Lookup, EntityId, Signal extends RankedSignal> {
  readonly _tag: "SignalExtractor"
  readonly signalTag: Signal["_tag"]
  readonly rank: Signal["rank"]
  readonly run: (
    input: Input,
    lookup: Lookup
  ) => Chunk.Chunk<Evidence<EntityId, Signal>>
}
```

Important notes:

- Extractors are **plain values**, not services.
- They are pure and synchronous.
- They do not know about other extractors.
- They do not resolve winners.

## 7.3 Evidence accumulation

The kernel should expose a pure accumulator:

```ts
export const collectEvidence = <Input, Lookup, EntityId, Signal extends RankedSignal>(
  input: Input,
  lookup: Lookup,
  extractors: Chunk.Chunk<SignalExtractor<Input, Lookup, EntityId, Signal>>
): EvidenceIndex<EntityId, Signal> => {
  const empty = HashMap.empty<EntityId, EvidenceBucket<EntityId, Signal>>()

  return HashMap.mutate(empty, (index) => {
    for (const extractor of extractors) {
      for (const item of extractor.run(input, lookup)) {
        const nextBucket = Option.match(HashMap.get(index, item.entityId), {
          onNone: () => ({
            entityId: item.entityId,
            bestRank: item.signal.rank,
            evidence: Chunk.of(item)
          }),
          onSome: (existing) => ({
            entityId: existing.entityId,
            bestRank: Math.min(existing.bestRank, item.signal.rank),
            evidence: Chunk.append(existing.evidence, item)
          })
        })

        HashMap.set(index, item.entityId, nextBucket)
      }
    }
  })
}
```

This follows the same public-immutable / local-mutation pattern used throughout Effect collections.

## 7.4 Single-winner resolver

The kernel should include one small resolver helper for single-winner domains:

```ts
export const resolveUniqueBest = <EntityId, Signal extends RankedSignal>(
  index: EvidenceIndex<EntityId, Signal>
): SingleResolution<EntityId, Signal> => {
  if (HashMap.isEmpty(index)) {
    return { _tag: "Unmatched" }
  }

  const buckets = Chunk.fromIterable(HashMap.values(index))
  const bestRank = Chunk.reduce(buckets, Number.POSITIVE_INFINITY, (acc, bucket) =>
    Math.min(acc, bucket.bestRank)
  )

  const top = Chunk.filter(buckets, (bucket) => bucket.bestRank === bestRank)

  if (Chunk.length(top) === 1) {
    return { _tag: "Matched", winner: Chunk.unsafeGet(top, 0) }
  }

  return { _tag: "Ambiguous", candidates: top }
}
```

This is the right level of generic sharing today.

---

## 8. Source Attribution On Top Of The Kernel

The source-attribution matcher should use the kernel, but its public and internal models remain source-specific.

## 8.1 Domain input model

The matcher input should move into `src/domain`, not live as a local interface inside the service.

Example:

```ts
export const SourceAttributionMatcherInput = Schema.Struct({
  post: Schema.Struct({
    did: Did,
    text: Schema.String,
    handle: Schema.NullOr(Schema.String)
  }),
  links: Schema.Array(PlannedLinkForAttribution),
  linkCards: Schema.Array(PlannedLinkCardForAttribution),
  vision: Schema.NullOr(VisionEnrichmentForAttribution)
})
```

This keeps the rule engine on typed data and removes inline casts like `did as Did`.

## 8.2 Source-attribution signal union

The source-attribution matcher should model provider signals as a tagged union with literal ranks:

```ts
export type ProviderSignal =
  | {
      readonly _tag: "SourceLineAlias"
      readonly rank: 1
      readonly sourceText: string
      readonly assetKey: string
    }
  | {
      readonly _tag: "SourceLineDomain"
      readonly rank: 2
      readonly sourceText: string
      readonly domain: string
      readonly assetKey: string
    }
  | {
      readonly _tag: "ChartTitleAlias"
      readonly rank: 3
      readonly title: string
      readonly matchedAlias: string
      readonly assetKey: string
    }
  | {
      readonly _tag: "LinkDomain"
      readonly rank: 4
      readonly url: string
      readonly domain: string
    }
  | {
      readonly _tag: "EmbedLinkDomain"
      readonly rank: 5
      readonly url: string
      readonly domain: string
    }
  | {
      readonly _tag: "VisibleUrlDomain"
      readonly rank: 6
      readonly url: string
      readonly assetKey: string
    }
  | {
      readonly _tag: "PostTextMention"
      readonly rank: 7
      readonly matchedAlias: string
    }
```

### Why this is better than `signal + raw: Record<string, string>`

- each signal carries only fields that actually belong to it
- rank cannot drift away from signal identity
- later refinements can pattern-match on `_tag`
- conversion to debug/persistence output becomes an explicit projection

## 8.3 Internal source-attribution result

```ts
export type SourceAttributionMatch = {
  readonly providerMatches: EvidenceIndex<ProviderId, ProviderSignal>
  readonly providerResolution: SingleResolution<ProviderId, ProviderSignal>
  readonly contentSource: Option.Option<ContentSourceReference>
  readonly socialProvenance: Option.Option<SocialProvenance>
}
```

This is the internal result.

The persisted API-facing shape can remain the current smaller model:

- selected provider or null
- contentSource or null
- socialProvenance or null
- optional projected debug evidence if SKY-45 chooses to expose it

This document refers to that boundary shape as `ProjectedSourceAttributionResult`.

That distinction matters. The internal core should not be constrained by the current wire shape.

---

## 9. Lookup Views And Service Boundaries

## 9.1 What the matcher should receive

The pure source matcher should not depend on an Effect service. It should depend on a plain lookup value:

```ts
export type ProviderLookup = {
  readonly providers: Chunk.Chunk<ProviderRegistryEntry>
  readonly findByAlias: (alias: string) => Option.Option<ProviderRegistryEntry>
  readonly findByDomain: (domain: string) => Option.Option<ProviderRegistryEntry>
  readonly findBySourceFamily: (
    sourceFamily: string
  ) => Chunk.Chunk<ProviderRegistryEntry>
}
```

This is the important boundary:

- services are for acquisition
- lookup views are for pure algorithms

## 9.2 What the Effect service should do

The `SourceAttributionMatcher` service should remain, but as a thin adapter:

```ts
export class SourceAttributionMatcher extends Context.Tag(
  "@skygest/SourceAttributionMatcher"
)<SourceAttributionMatcher, {
  readonly match: (
    input: SourceAttributionMatcherInput
  ) => Effect.Effect<ProjectedSourceAttributionResult>
}>() {
  static readonly layer = Layer.effect(
    SourceAttributionMatcher,
    Effect.gen(function* () {
      const registry = yield* ProviderRegistry
      const lookup = toProviderLookup(registry)

      const match = Effect.fn("SourceAttributionMatcher.match")(function* (input) {
        return projectSourceAttributionResult(
          matchSourceAttribution(input, lookup)
        )
      })

      return SourceAttributionMatcher.of({ match })
    })
  )
}
```

Important design points:

- use `layer`, not `live`, to match the rest of the repo
- the service method itself stays `Effect`, so workflows have a stable entrypoint
- the rule engine remains pure
- no per-lookup `yield*` inside matching loops

## 9.3 Provider registry service shape

Preferred design:

```ts
class ProviderRegistry extends Context.Tag("@skygest/ProviderRegistry")<
  ProviderRegistry,
  {
    readonly lookup: ProviderLookup
    readonly manifest: ProviderRegistryManifest
  }
>() {}
```

If changing the registry service is too disruptive immediately, the matcher layer can build `ProviderLookup` from the existing service once and use that pure snapshot internally.

---

## 10. Content Source And Social Provenance Stay Separate

These are not provider-signal extractors.

They should stay as pure domain-specific helpers:

- `choosePrimaryContentSource(input): Option<ContentSourceReference>`
- `buildSocialProvenance(input): Option<SocialProvenance>`

This keeps the source-attribution matcher aligned with the domain model:

- provider = originator
- contentSource = shared page
- socialProvenance = posting account

None of those should be hidden inside a generic kernel.

---

## 11. Total Helpers Instead Of Local Exception Control Flow

Partial helpers such as URL parsing should be total and explicit.

Instead of local `try/catch` in helper functions, prefer a small total helper:

```ts
const parseHostname = Option.liftThrowable((url: string) => new URL(url).hostname)

const parseNormalizedDomain = (url: string): Option.Option<string> =>
  Option.map(parseHostname(url), normalizeDomain)
```

This is closer to the rest of Effect's style:

- absence becomes `Option`
- no implicit exceptional control flow
- pure helpers remain pure

At the persistence or API boundary, `Option` can be projected to `null`.

---

## 12. Data Structures To Use

### Use `HashMap`

Use `HashMap.HashMap<EntityId, EvidenceBucket<...>>` for evidence indexes.

Why:

- entity-keyed accumulation is the core operation
- immutable API
- controlled local mutation is available via `HashMap.mutate`
- fits Effect's own internal implementation style

### Use `Chunk`

Use `Chunk.Chunk` for:

- extractor lists
- evidence lists
- candidate lists in ambiguous results

Why:

- ordered and immutable
- cheap append/concat semantics
- widely used in Effect internals for batched ordered data

### Use `Option`

Use `Option` internally for:

- lookup misses
- optional content source
- optional social provenance
- optional canonical source-family refinement

Why:

- internal absence stays explicit
- null conversion happens only at the outer edge

### Keep plain objects for stable read models

Do **not** over-abstract stable read models like `ContentSourceReference` or `ProviderReference`.

Those are domain read models and should stay simple.

---

## 13. What Should Be Shared With The Topic Matcher?

Only a small amount should be shared now:

1. vocabulary:
   - evidence
   - registry lookup
   - resolution
2. generic single-winner resolver helper, if another single-winner matcher needs it
3. collection and builder style

What should **not** be shared yet:

- one universal matcher interface
- one universal registry abstraction
- one universal result type
- one universal resolution policy

The ontology matcher is already small and pure. Rewriting it into the same shape now would be symmetry work, not problem-solving.

---

## 14. Proposed File Layout

```text
src/
  matching/
    core.ts               // generic Evidence, EvidenceIndex, resolver helpers
    collections.ts        // accumulation helpers using HashMap + Chunk
  domain/
    sourceMatching.ts     // SourceAttributionMatcherInput schema
  source/
    signals/
      linkDomain.ts
      embedLinkDomain.ts
      postTextMention.ts
      sourceLineAlias.ts
      sourceLineDomain.ts
      chartTitleAlias.ts
      visibleUrlDomain.ts
    SourceAttributionMatch.ts        // ProviderSignal union + internal result types
    SourceAttributionRules.ts        // pure matchSourceAttribution(...)
    SourceAttributionProject.ts      // internal result -> persisted/debug shape
    contentSource.ts
    normalize.ts
    SourceAttributionMatcher.ts      // thin Context.Tag service adapter
```

### Why this layout?

- generic code is isolated in `src/matching`
- source-attribution specifics stay in `src/source`
- domain schemas stay in `src/domain`
- the service file becomes small again

---

## 15. Refactor Plan

### Phase A — Introduce the pure kernel

- Add generic `Evidence`, `EvidenceBucket`, `EvidenceIndex`, and `SingleResolution` types.
- Add `collectEvidence` and `resolveUniqueBest`.
- Do not change public matcher behavior yet.

### Phase B — Move source-attribution internals to typed unions

- Add `ProviderSignal` tagged union.
- Add typed extractor values for the existing three phase-1 signals.
- Convert current `MatchEvidence` output to a projection, not the internal source of truth.

### Phase C — Thin the service

- Move `MatcherInput` into `src/domain`.
- Introduce pure `matchSourceAttribution(input, lookup)`.
- Keep `SourceAttributionMatcher` as the Effect adapter.

### Phase D — Add remaining vision signals

- Add the remaining extractors when SKY-49 pins the vision contract.
- Add source-family refinement as a post-resolution step.

### Phase E — Re-evaluate shared kernel scope

- Only after the source matcher is feature-complete, revisit whether the ontology matcher should share more than vocabulary and helpers.

---

## 16. Testing Strategy

The test split should mirror the architecture:

### Pure kernel tests

- `collectEvidence`
- `resolveUniqueBest`
- signal extractor unit tests
- source-family refinement
- content-source helper
- social-provenance helper

These should need no layers.

### Service adapter tests

- `SourceAttributionMatcher.layer`
- integration with `ProviderRegistry`
- future publication resolver integration

These should be a smaller set of Effect tests.

This gives the best balance:

- high coverage of rules
- low layer setup cost
- clear failure localization

---

## 17. Final Recommendation

If this were being implemented as an Effect library module, the maintainer-style design would be:

1. **A small pure matching kernel**
2. **A domain-specific signal union**
3. **Plain extractor values**
4. **A pure resolver**
5. **Explicit `Option`-based helper boundaries**
6. **A thin `Context.Tag` service**
7. **No premature universal framework**

That design is sophisticated enough to scale, but still simple enough to read and test.

It also matches the actual pressure in this codebase:

- the source-attribution matcher is growing and benefits from extraction
- the ontology matcher is stable and should not be rewritten for symmetry
- the service boundary should stay in Effect
- the rule engine should become plain typed code

---

## 18. References

### Local code reviewed

- `src/source/SourceAttributionMatcher.ts`
- `src/source/contentSource.ts`
- `src/source/normalize.ts`
- `src/ontology/matcher.ts`
- `src/services/ProviderRegistry.ts`

### Effect source reviewed

- `node_modules/effect/src/HashMap.ts`
- `node_modules/effect/src/Chunk.ts`
- `node_modules/effect/src/Option.ts`
- `node_modules/effect/src/Context.ts`
- `node_modules/effect/src/Layer.ts`
- `node_modules/effect/src/internal/hashMap.ts`
- `node_modules/effect/src/internal/blockedRequests.ts`

### Effect guidance reviewed

- `effect-solutions show services-and-layers`
- `effect-solutions show error-handling`
- `effect-solutions show testing`

### Background references

- Fellegi, I. P., and Sunter, A. B. "A Theory for Record Linkage." *Journal of the American Statistical Association*, 1969.
- Entity-linking literature on candidate generation plus disambiguation against curated knowledge bases.
