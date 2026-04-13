> **Archived 2026-04-13.** This plan predates the 2026-04-12 resolver cutover and describes an architecture that no longer matches `main`. See `docs/architecture/system-context.md`, `docs/architecture/product-alignment.md`, and `docs/plans/2026-04-13-product-loop-cleanup-and-ship.md` for the current story.

---

# Skygest SaaS Architecture Research

**Date:** 2026-01-24
**Status:** Research Phase
**Purpose:** Design an agent-first API SaaS for custom Bluesky feed creation

## Executive Summary

This document captures research findings from a multi-agent panel that analyzed 15+ architecture and design books to inform the design of an agentic feed-builder SaaS platform. The platform will:

1. **Enable agents to build custom Bluesky feeds** - Users deploy local AI agents (e.g., Claude Code) that iteratively refine feed rules via our API
2. **Capture interaction data** - Store all API interactions and refinements as training data
3. **Monetize via ad injection** - Free tier feeds include targeted advertisements
4. **Run on Cloudflare** - Pure Effect TypeScript on Workers, D1, KV, Queues, and Durable Objects

---

## Table of Contents

1. [Current Codebase Analysis](#1-current-codebase-analysis)
2. [Bluesky Feed Ecosystem Research](#2-bluesky-feed-ecosystem-research)
3. [Event-Driven Architecture Patterns](#3-event-driven-architecture-patterns)
4. [Domain Modeling Patterns](#4-domain-modeling-patterns)
5. [API Design for Agent Sessions](#5-api-design-for-agent-sessions)
6. [Data-Intensive Patterns (DDIA)](#6-data-intensive-patterns-ddia)
7. [Effect/Functional Patterns](#7-effectfunctional-patterns)
8. [DSL Design for Filters](#8-dsl-design-for-filters)
9. [Proposed Bounded Contexts](#9-proposed-bounded-contexts)
10. [Open Questions](#10-open-questions)

---

## 1. Current Codebase Analysis

### Existing Architecture

The current `skygest-cloudflare` codebase is a working Bluesky feed generator with:

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Jetstream Ingestor** | Durable Object + WebSocket | Subscribes to Bluesky firehose, persists cursor |
| **Filter Worker** | Queue Consumer | Applies paper-detection algorithm to posts |
| **Generator Worker** | Queue Consumer | Builds personalized feeds per user |
| **Feed Worker** | HTTP Worker | Serves `getFeedSkeleton` to Bluesky clients |
| **Postprocess Worker** | Queue Consumer | Logs user access patterns |
| **Dispatch Worker** | Cron Trigger | Triggers feed generation for active users |

### Current Data Flow

```
Bluesky Jetstream (WebSocket)
        │
        ▼
┌─────────────────────┐
│ JetstreamIngestorDO │  Durable Object with SQLite cursor
└─────────┬───────────┘
          │ RawEventBatch
          ▼
┌─────────────────────┐
│   Filter Worker     │  Queue: raw-events
│   Paper Detection   │
└─────────┬───────────┘
          │ Posts saved to D1
          ▼
┌─────────────────────┐
│  Dispatch Worker    │  Cron: */20 min
│  Trigger FeedGen    │
└─────────┬───────────┘
          │ FeedGenMessage
          ▼
┌─────────────────────┐
│  Generator Worker   │  Queue: feed-gen
│  Build User Feeds   │
└─────────┬───────────┘
          │ Cache to KV
          ▼
┌─────────────────────┐
│    Feed Worker      │  HTTP: /xrpc/app.bsky.feed.*
│    Serve Skeleton   │
└─────────────────────┘
```

### Current Domain Types

```typescript
// Branded types for type safety
const Did = Schema.String.pipe(Schema.pattern(/^did:/), Schema.brand("Did"))
const AtUri = Schema.String.pipe(Schema.pattern(/^at:\/\//), Schema.brand("AtUri"))

// Core events
const RawEvent = Schema.Struct({
  kind: Schema.Literal("commit"),
  operation: Schema.Union(Schema.Literal("create"), Schema.Literal("update"), Schema.Literal("delete")),
  collection: Schema.String,
  did: Did,
  uri: AtUri,
  cid: Schema.optional(Schema.String),
  record: Schema.optional(Schema.Unknown),
  timeUs: Schema.Number
})

// Tagged errors
class AuthError extends Schema.TaggedError<AuthError>()("AuthError", { message: Schema.String }) {}
class DbError extends Schema.TaggedError<DbError>()("DbError", { message: Schema.String }) {}
```

### Effect Patterns Already in Use

- **Context.Tag** for service interfaces
- **Layer composition** for dependency injection
- **Schema.TaggedError** for typed errors
- **Effect streams** via effect-jetstream
- **Supervisor pattern** for Durable Object lifecycle

---

## 2. Bluesky Feed Ecosystem Research

### How Feed Generators Work

1. User requests feed via Bluesky app using AT-URI (e.g., `at://did:plc:abc123/app.bsky.feed.generator/my-feed`)
2. AppView resolves AT-URI to find Feed Generator's DID document
3. AppView sends `getFeedSkeleton` request to service endpoint
4. Feed Generator returns skeleton (list of post URIs)
5. AppView hydrates posts with content/engagement data
6. Hydrated feed delivered to user

**Key insight:** Feed generators only store and return post IDs, not full post data.

### Primary API: `app.bsky.feed.getFeedSkeleton`

```typescript
// Request
GET /xrpc/app.bsky.feed.getFeedSkeleton
  ?feed=at://did:example/app.bsky.feed.generator/my-feed
  &limit=50
  &cursor=1683654690921::bafyreia3tbsfxe

// Response
{
  "cursor": "1683654690922::bafyreib4tbsfxf",
  "feed": [
    { "post": "at://did:example/app.bsky.feed.post/abc123" },
    { "post": "at://did:example/app.bsky.feed.post/def456" }
  ]
}
```

### Data Sources

**Jetstream** (simplified firehose):
- Public instances: `wss://jetstream1.us-east.bsky.network/subscribe`
- ~850 MB/day for all posts (vs 232 GB/day full firehose)
- Supports filtering by collection and DID
- Provides cursor-based replay

### Existing Feed Builders

| Service | Approach | Differentiation Opportunity |
|---------|----------|---------------------------|
| SkyFeed | Visual block-based UI | Agent-first API, not GUI |
| Bluesky Feed Creator | Simple keyword search | Complex rule composition |
| Contrails | Search API queries | Real-time stream processing |
| Official Starter Kit | Manual code | DSL + iterative refinement |

---

## 3. Event-Driven Architecture Patterns

*Source: Fundamentals of Software Architecture, The Art of Immutable Architecture, DDIA*

### Event Sourcing

**Core Concept:** Store all state changes as immutable events.

```typescript
// Events are named in past tense
type AgentEvent =
  | { _tag: "SessionStarted"; at: Date; config: AgentConfig }
  | { _tag: "FilterRefined"; at: Date; oldFilter: Filter; newFilter: Filter }
  | { _tag: "FeedPublished"; at: Date; feedUri: AtUri }
  | { _tag: "SessionCompleted"; at: Date }

// Current state = fold over events
const computeState = (events: AgentEvent[]): AgentSessionState =>
  events.reduce(applyEvent, initialState)
```

**Benefits for agent API:**
- Complete audit trail of all agent refinements
- Replay capability for debugging
- Training data naturally captured as event stream

### CQRS (Command Query Responsibility Segregation)

**Separate write and read models:**

| Aspect | Write Model | Read Model |
|--------|-------------|------------|
| Purpose | Capture intent | Serve queries |
| Optimization | Append-only, transactional | Denormalized, indexed |
| Example | Event log in D1 | Feed cache in KV |

```typescript
// Command: async, imperative
type RefineFilter = (sessionId: SessionId, newFilter: Filter) => Effect<void, ValidationError>

// Query: sync, declarative
type GetFeedPreview = (sessionId: SessionId, limit: number) => Effect<FeedItem[], NotFoundError>
```

### Idempotency

**Critical for agent retries:**

```typescript
// Include idempotency key with each command
interface RefineFilterCommand {
  idempotencyKey: string  // e.g., "session-123-refinement-7"
  sessionId: SessionId
  filter: Filter
}

// Check before processing
const processCommand = (cmd: RefineFilterCommand) =>
  checkAlreadyProcessed(cmd.idempotencyKey).pipe(
    Effect.flatMap((processed) =>
      processed
        ? Effect.succeed(void 0)  // Skip duplicate
        : executeAndRecord(cmd)
    )
  )
```

### Saga Pattern for Multi-Step Workflows

**Agent feed publication workflow:**

```
1. ValidateFeed ──success──▶ 2. RegisterWithBluesky ──success──▶ 3. ActivateFeed
       │                            │                                    │
       ▼ failure                    ▼ failure                           ▼ failure
    Return error              Compensate: none needed            Compensate: Deregister
```

---

## 4. Domain Modeling Patterns

*Source: Domain Modeling Made Functional, Algebra Driven Design*

### Entities vs Value Objects

| Concept | Identity | Mutability | Example |
|---------|----------|------------|---------|
| **Entity** | Has intrinsic ID | Properties change over time | User (DID), Feed (FeedId) |
| **Value Object** | Defined by attributes | Immutable | FilterRule, AdSlotConfig |

### Recommended Domain Model

```typescript
// === Users (Entity) ===
interface User {
  readonly did: Did                    // Immutable identity
  readonly handle: Handle              // Can change
  readonly createdAt: Date
}

// Mutable properties as separate facts
interface UserSubscription {
  readonly user: Did
  readonly tier: SubscriptionTier
  readonly validUntil: Date
  readonly prior: UserSubscription | null  // Version chain
}

type SubscriptionTier =
  | { _tag: "Free" }
  | { _tag: "Pro"; monthlyQuota: number }
  | { _tag: "Enterprise"; customLimits: EnterpriseLimits }

// === Feeds (Aggregate Root) ===
interface Feed {
  readonly feedId: FeedId
  readonly owner: Did                  // Reference to User
  readonly name: FeedName
  readonly description: string
  readonly rules: FilterRule[]         // Owned children
  readonly createdAt: Date
  readonly publishedAt: Date | null
}

// Feed states as state machine
type FeedState =
  | { _tag: "Draft"; draft: DraftFeed }
  | { _tag: "Published"; published: PublishedFeed }
  | { _tag: "Suspended"; reason: string }

// === Agent Sessions (Saga) ===
interface AgentSession {
  readonly sessionId: SessionId
  readonly user: Did
  readonly feed: FeedId
  readonly state: AgentSessionState
  readonly events: AgentEvent[]        // Event sourcing
}

type AgentSessionState =
  | { _tag: "Initializing"; config: AgentConfig }
  | { _tag: "Running"; startedAt: Date; lastActivity: Date }
  | { _tag: "Paused"; pausedAt: Date; reason: string }
  | { _tag: "Failed"; error: AgentError; retryCount: number }
  | { _tag: "Completed"; result: AgentResult }
```

### Make Illegal States Unrepresentable

```typescript
// Can't publish feed without rules
interface PublishedFeed {
  readonly feedId: FeedId
  readonly rules: NonEmptyArray<ValidatedFilterRule>  // Guaranteed non-empty
  readonly publishedAt: Date
}

// Verified email required for paid tier
type VerifiedUser = Brand<User, "EmailVerified">
type PaidSubscription = {
  user: VerifiedUser
  tier: "Pro" | "Enterprise"
}
```

---

## 5. API Design for Agent Sessions

*Source: The Art of Immutable Architecture, Practical Process Automation*

### Long-Running Session Pattern

**Key insight:** Agent sessions should NOT block threads. Persist state between interactions.

```typescript
// Session state persisted to D1
interface PersistedSession {
  sessionId: string
  userId: string
  feedId: string
  state: JsonEncodedState
  lastActivity: number
  events: JsonEncodedEvent[]
}

// Wake on events, not polling
type SessionTrigger =
  | { type: "UserCommand"; command: AgentCommand }
  | { type: "Timer"; scheduledAt: Date }
  | { type: "ExternalCallback"; source: string }
```

### Proposed API Endpoints

```typescript
// === Session Management ===
POST   /api/sessions                    // Create session, returns sessionId
GET    /api/sessions/:id                // Get session state
DELETE /api/sessions/:id                // End session

// === Feed Configuration (within session) ===
GET    /api/sessions/:id/feed           // Get current feed config
PUT    /api/sessions/:id/feed/rules     // Replace filter rules
PATCH  /api/sessions/:id/feed/rules     // Add/modify rules
POST   /api/sessions/:id/feed/validate  // Validate without saving

// === Preview & Testing ===
POST   /api/sessions/:id/preview        // Get sample posts matching current rules
POST   /api/sessions/:id/test           // Test specific post against rules
GET    /api/sessions/:id/stats          // Get filter hit rates

// === Publication ===
POST   /api/sessions/:id/publish        // Publish feed to Bluesky
DELETE /api/sessions/:id/publication    // Unpublish feed

// === History & Replay ===
GET    /api/sessions/:id/history        // Get refinement history
POST   /api/sessions/:id/rollback/:eventId  // Rollback to previous state
```

### Rate Limiting by Tier

| Tier | Sessions/Day | Requests/Min | History Retention |
|------|-------------|--------------|-------------------|
| Free | 3 | 20 | 7 days |
| Pro | Unlimited | 100 | 90 days |
| Enterprise | Unlimited | 500 | Unlimited |

### Multi-Tenant Architecture

```typescript
// Environment-based isolation
interface Environment {
  environmentId: string
  tier: SubscriptionTier
  limits: {
    queriesPerDay: number
    sessionsPerDay: number
    historyRetentionDays: number
  }
}

// All data scoped by tenant
interface TenantScopedQuery<T> {
  tenantId: string
  query: T
}
```

---

## 6. Data-Intensive Patterns (DDIA)

*Source: Designing Data Intensive Applications*

### Twitter Timeline Fan-Out

**The pattern that scales:**

```sql
-- Conceptual materialized view
SELECT follows.follower_id AS timeline_id,
       array_agg(posts.* ORDER BY posts.timestamp DESC)
FROM posts
JOIN follows ON follows.followee_id = posts.author_did
GROUP BY follows.follower_id
```

**Application to Skygest:**

| Event | Action |
|-------|--------|
| New post arrives | Fan out to all matching feed caches |
| User creates feed | Pre-compute initial feed |
| User modifies rules | Invalidate and regenerate cache |
| User deletes feed | Remove cache entry |

### Derived Data for ML Training

```
Agent Interaction
        │
        ▼
┌─────────────────────┐
│   Audit Worker      │  Append to R2 (raw JSONL)
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Batch Job         │  Scheduled: daily
│   Feature Extract   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Training Dataset  │  R2: structured parquet
└─────────────────────┘
```

**Interaction log schema:**

```typescript
interface AgentInteractionLog {
  timestamp: number
  sessionId: string
  tenantId: string
  eventType: "QuerySubmitted" | "ResultsReturned" | "RefinementApplied" | "FeedPublished"
  payload: {
    query?: string
    filters?: FilterRule[]
    resultCount?: number
    feedback?: "positive" | "negative"
  }
}
```

### Ad Injection via Stream-Table Join

```
Feed Request
     │
     ├──▶ Fetch user segment from KV (pre-computed)
     │
     ├──▶ Fetch feed posts from cache
     │
     ├──▶ For positions [5, 15, 25...]:
     │       └── Lookup pre-ranked ad for segment
     │       └── Insert into feed array
     │
     └──▶ Return merged feed
```

**Ad placement as immutable fact:**

```typescript
interface AdPlacement {
  placementId: PlacementId
  feedId: FeedId
  requestId: FeedRequestId
  adId: AdId
  position: number
  servedAt: Date
  viewedAt: Date | null
  clickedAt: Date | null
}
```

---

## 7. Effect/Functional Patterns

*Source: Functional Design and Architecture, Domain Modeling Made Functional*

### Service Composition with Layers

```typescript
// Define service interface
class FilterValidation extends Context.Tag("FilterValidation")<
  FilterValidation,
  {
    readonly validate: (filter: FilterRule) => Effect<ValidatedFilter, ValidationError>
  }
>() {}

// Implement with Layer
const FilterValidationLive = Layer.succeed(FilterValidation, {
  validate: (filter) =>
    validateSyntax(filter).pipe(
      Effect.flatMap(validateSemantics),
      Effect.mapError((e) => new ValidationError({ reason: e.message }))
    )
})

// Compose layers
const AppLayer = Layer.mergeAll(
  FilterValidationLive,
  FeedServiceLive,
  AgentSessionServiceLive
)
```

### Typed Error Handling

```typescript
// Domain errors
class ValidationError extends Schema.TaggedError<ValidationError>()("ValidationError", {
  field: Schema.String,
  reason: Schema.String
}) {}

class QuotaExceededError extends Schema.TaggedError<QuotaExceededError>()("QuotaExceededError", {
  limit: Schema.Number,
  current: Schema.Number
}) {}

class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()("SessionNotFoundError", {
  sessionId: Schema.String
}) {}

// Union type for workflow errors
type AgentSessionError = ValidationError | QuotaExceededError | SessionNotFoundError

// Explicit error channel in function signatures
const refineFilter = (
  sessionId: SessionId,
  filter: FilterRule
): Effect<void, AgentSessionError, FilterValidation | AgentSessionRepo> => // ...
```

### Testing via Layer Substitution

```typescript
// Test layer with fake implementation
const FilterValidationTest = Layer.succeed(FilterValidation, {
  validate: (filter) => Effect.succeed({ ...filter, _validated: true } as ValidatedFilter)
})

// Failing test layer
const FilterValidationFailing = Layer.succeed(FilterValidation, {
  validate: (_) => Effect.fail(new ValidationError({ field: "test", reason: "forced failure" }))
})

// Test
describe("refineFilter", () => {
  it("succeeds with valid filter", async () => {
    const result = await refineFilter(sessionId, validFilter).pipe(
      Effect.provide(FilterValidationTest),
      Effect.provide(AgentSessionRepoTest),
      Effect.runPromise
    )
    expect(result).toBeDefined()
  })
})
```

---

## 8. DSL Design for Filters

*Source: Algebra Driven Design, Pragmatic Type-Level Design*

### Filter Algebra (Boolean Algebra)

```typescript
// Core filter ADT
type PostFilter =
  | { _tag: "Always" }
  | { _tag: "Never" }
  | { _tag: "And"; filters: PostFilter[] }
  | { _tag: "Or"; filters: PostFilter[] }
  | { _tag: "Not"; filter: PostFilter }
  // Domain-specific predicates
  | { _tag: "TextMatches"; regex: string }
  | { _tag: "HasKeyword"; keywords: string[]; matchAll: boolean }
  | { _tag: "FromAuthor"; authors: Did[] }
  | { _tag: "ExcludeAuthor"; authors: Did[] }
  | { _tag: "HasTag"; tags: string[] }
  | { _tag: "HasMedia"; types?: MediaType[] }
  | { _tag: "IsReply" }
  | { _tag: "PostedAfter"; timestamp: number }
  | { _tag: "PostedBefore"; timestamp: number }
  | { _tag: "HasLabel"; labels: string[] }

// Boolean combinators
const always = (): PostFilter => ({ _tag: "Always" })
const never = (): PostFilter => ({ _tag: "Never" })
const and = (...filters: PostFilter[]): PostFilter => ({ _tag: "And", filters })
const or = (...filters: PostFilter[]): PostFilter => ({ _tag: "Or", filters })
const not = (filter: PostFilter): PostFilter => ({ _tag: "Not", filter })

// Domain combinators
const hasKeyword = (...keywords: string[]): PostFilter =>
  ({ _tag: "HasKeyword", keywords, matchAll: false })
const fromAuthor = (...authors: Did[]): PostFilter =>
  ({ _tag: "FromAuthor", authors })
const hasMedia = (...types: MediaType[]): PostFilter =>
  ({ _tag: "HasMedia", types })
```

### Interpreter (Filter Evaluation)

```typescript
const matches = (filter: PostFilter, post: Post): boolean => {
  switch (filter._tag) {
    case "Always": return true
    case "Never": return false
    case "And": return filter.filters.every((f) => matches(f, post))
    case "Or": return filter.filters.some((f) => matches(f, post))
    case "Not": return !matches(filter.filter, post)
    case "TextMatches": return new RegExp(filter.regex).test(post.text)
    case "HasKeyword":
      return filter.matchAll
        ? filter.keywords.every((k) => post.text.toLowerCase().includes(k.toLowerCase()))
        : filter.keywords.some((k) => post.text.toLowerCase().includes(k.toLowerCase()))
    case "FromAuthor": return filter.authors.includes(post.author)
    case "ExcludeAuthor": return !filter.authors.includes(post.author)
    case "HasTag": return filter.tags.some((t) => post.tags.includes(t))
    case "HasMedia":
      return filter.types
        ? post.media.some((m) => filter.types!.includes(m.type))
        : post.media.length > 0
    case "IsReply": return post.replyTo !== undefined
    case "PostedAfter": return post.timestamp > filter.timestamp
    case "PostedBefore": return post.timestamp < filter.timestamp
    case "HasLabel": return filter.labels.some((l) => post.labels.includes(l))
  }
}
```

### Scoring Rules (Monoid Pattern)

```typescript
type ScoreRule =
  | { _tag: "Base"; score: number }
  | { _tag: "IfMatches"; condition: PostFilter; score: number }
  | { _tag: "Sum"; rules: ScoreRule[] }
  | { _tag: "Max"; rules: ScoreRule[] }
  | { _tag: "Multiply"; factor: number; rule: ScoreRule }
  | { _tag: "FromEngagement" }
  | { _tag: "RecencyBoost"; halfLifeMs: number }

// Scoring is a Monoid (associative with identity)
const emptyScore: ScoreRule = { _tag: "Base", score: 0 }
const combineScores = (a: ScoreRule, b: ScoreRule): ScoreRule =>
  ({ _tag: "Sum", rules: [a, b] })

// Evaluate score
const computeScore = (rule: ScoreRule, post: Post): number => {
  switch (rule._tag) {
    case "Base": return rule.score
    case "IfMatches": return matches(rule.condition, post) ? rule.score : 0
    case "Sum": return rule.rules.reduce((acc, r) => acc + computeScore(r, post), 0)
    case "Max": return Math.max(...rule.rules.map((r) => computeScore(r, post)))
    case "Multiply": return rule.factor * computeScore(rule.rule, post)
    case "FromEngagement": return post.likes + post.reposts * 2 + post.replies * 0.5
    case "RecencyBoost":
      const age = Date.now() - post.timestamp
      return Math.pow(0.5, age / rule.halfLifeMs) * 100
  }
}
```

### Complete Agent Filter Configuration

```typescript
interface AgentFilterConfig {
  name: string
  description: string

  // Stage 1: Include/Exclude
  include: PostFilter      // Posts must match to be considered
  exclude: PostFilter      // Posts matching are dropped

  // Stage 2: Scoring
  scoring: ScoreRule

  // Stage 3: Limits
  maxResults?: number
  minScore?: number
}

// Example configuration
const techNewsConfig: AgentFilterConfig = {
  name: "Tech News",
  description: "Curated technology content",

  include: or(
    hasKeyword("typescript", "rust", "golang"),
    hasTag("programming", "tech")
  ),

  exclude: or(
    excludeAuthor("did:plc:spammer123"),
    hasKeyword("crypto", "nft", "giveaway")
  ),

  scoring: {
    _tag: "Sum",
    rules: [
      { _tag: "Base", score: 100 },
      { _tag: "IfMatches", condition: hasMedia("image"), score: 50 },
      { _tag: "IfMatches", condition: { _tag: "IsReply" }, score: -30 },
      { _tag: "Multiply", factor: 1.5, rule: { _tag: "FromEngagement" } },
      { _tag: "RecencyBoost", halfLifeMs: 3600000 }
    ]
  },

  maxResults: 50,
  minScore: 100
}
```

---

## 9. Proposed Bounded Contexts

Based on domain modeling research, the system should be divided into these bounded contexts:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Public API Gateway                        │
└─────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐    ┌───────────────────┐    ┌─────────────────┐
│   Identity    │    │  Feed Management  │    │   Agent API     │
│   Context     │    │     Context       │    │    Context      │
├───────────────┤    ├───────────────────┤    ├─────────────────┤
│ • User DIDs   │    │ • Feed configs    │    │ • Sessions      │
│ • Auth/JWT    │    │ • Filter rules    │    │ • Commands      │
│ • API keys    │    │ • Publication     │    │ • Previews      │
│ • Quotas      │    │ • Validation      │    │ • Refinements   │
└───────────────┘    └───────────────────┘    └─────────────────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐    ┌───────────────────┐    ┌─────────────────┐
│    Feed       │    │   Advertising     │    │    Analytics    │
│  Generation   │    │     Context       │    │    Context      │
├───────────────┤    ├───────────────────┤    ├─────────────────┤
│ • Jetstream   │    │ • Ad inventory    │    │ • Interaction   │
│ • Filtering   │    │ • Targeting       │    │   logs          │
│ • Caching     │    │ • Placement       │    │ • ML training   │
│ • Serving     │    │ • Reporting       │    │ • Metrics       │
└───────────────┘    └───────────────────┘    └─────────────────┘
```

### Context Communication

| From | To | Mechanism | Data |
|------|-----|-----------|------|
| Identity | All | Sync query | User, Subscription |
| Agent API | Feed Management | Command | FilterConfig |
| Feed Management | Feed Generation | Event | FeedPublished |
| Feed Generation | Analytics | Event | FeedServed |
| Analytics | Advertising | Batch | UserSegments |
| Advertising | Feed Generation | Sync query | AdForSegment |

---

## 10. Open Questions

### Architecture Approach

**Decision needed:** How to approach the transformation from current codebase?

| Option | Pros | Cons |
|--------|------|------|
| **Extend existing** | Proven infrastructure, faster to market | May inherit limitations |
| **Fresh design** | Clean slate, optimized for new requirements | More work, risk |
| **Hybrid** | Best of both, keep proven components | Complexity in boundaries |

### Technical Questions

1. **Durable Objects vs D1 for session state?**
   - DO: Lower latency, automatic consistency
   - D1: Better for queries, easier backup

2. **Real-time preview via WebSocket or polling?**
   - WebSocket: Better UX, more complex
   - Polling: Simpler, higher latency

3. **Ad inventory source?**
   - Build own ad network?
   - Integrate with existing (Google, etc.)?
   - Start with sponsored posts from Bluesky ecosystem?

4. **Filter DSL: JSON vs custom syntax?**
   - JSON: Easy to generate/parse
   - Custom DSL: More expressive for humans

### Business Questions

1. What's the minimum viable free tier to attract users?
2. How to prevent abuse (spam feeds, ad fraud)?
3. Privacy implications of storing agent interactions?
4. Compliance requirements (GDPR, etc.)?

---

## References

### Books Consulted

1. **Designing Data Intensive Applications** - Kleppmann
2. **Domain Modeling Made Functional** - Wlaschin
3. **Algebra Driven Design** - Maguire
4. **The Art of Immutable Architecture** - Perry
5. **Fundamentals of Software Architecture** - Richards & Ford
6. **Functional Design and Architecture** - Granin
7. **Pragmatic Type-Level Design** - Granin
8. **Practical Process Automation** - Ruecker
9. **The Pragmatic Programmer** - Hunt & Thomas
10. **Thinking in Systems** - Meadows

### Bluesky/AT Protocol

- [Bluesky Custom Feeds Documentation](https://docs.bsky.app/docs/starter-templates/custom-feeds)
- [Official Feed Generator Starter Kit](https://github.com/bluesky-social/feed-generator)
- [Jetstream Documentation](https://docs.bsky.app/blog/jetstream)
- [AT Protocol Specification](https://atproto.com/specs/atp)

### Effect TypeScript

- [Effect Documentation](https://effect.website)
- [Effect GitHub Repository](https://github.com/Effect-TS/effect)
- `.reference/effect/` - Local Effect source reference

---

## Next Steps

1. **Decide on architecture approach** (extend/fresh/hybrid)
2. **Design detailed bounded context APIs**
3. **Create implementation plan with phases**
4. **Set up development environment for new components**
