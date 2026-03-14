# Skygest Effect-Native HTTP Refactor Plan

Date: 2026-03-14
Status: Draft

## Purpose

Pause incremental API work and align the next pass with:

- Effect-native HTTP boundaries
- schema-driven parsing and response modeling
- explicit error channels instead of ad hoc `try/catch`
- Cloudflare-native worker/D1 architecture
- stable access patterns for a future frontend API

This document is intentionally about architecture and sequencing, not implementation detail.

## Current Tension

The repo is already strongly Effect-oriented in the domain and service layers, but the HTTP edge is still mostly hand-rolled.

Today, the main gaps are:

- router modules parse `URL`, query params, and JSON bodies manually
- parse failures are often turned into thrown exceptions and recovered with router-local `try/catch`
- route dispatch, auth, runtime management, parsing, and response formatting are mixed together
- the MCP surface is Effect-native enough to work, but admin and ingest paths still behave more like handwritten adapter code than schema-first Effect HTTP
- the emerging REST work in `src/api/` is exploratory and should not be treated as the target architecture

## Review Conclusions

### 1. Use Effect HTTP primitives at the edge

The next refactor should move request parsing and response construction toward `@effect/platform` HTTP primitives:

- use `HttpRouter` / `HttpLayerRouter` for the near-term refactor of existing worker routes
- use `HttpServerRequest.schemaSearchParams`, `HttpRouter.schemaParams`, `HttpRouter.schemaJson`, and related schema helpers for path/query/body decoding
- keep worker `fetch` handlers thin and move route composition into Effect modules

### 2. Be selective about `HttpApi`

`HttpApi` is best when the contract is stable enough that you want:

- one source of truth for request/response schemas
- typed clients
- generated docs / Swagger

Recommendation:

- refactor the existing mixed admin/ingest/API worker to `HttpRouter` first
- once the public read API stabilizes, consider promoting that surface alone to `HttpApi`

This avoids forcing a full-contract rewrite while the frontend API is still being designed.

### 3. Restrict `try/catch` to true foreign boundaries

`try/catch` is still acceptable in a few places:

- final `fetch` / runtime boundaries when converting thrown JS exceptions into HTTP responses
- bridging non-Effect APIs such as `runtime.runPromise*`, `JSON.parse`, `atob`, or Cloudflare APIs that may throw
- rare resource cleanup boundaries

It should not be the normal mechanism for:

- request decoding
- query parameter validation
- domain branching
- repository decoding
- response shaping

Those should move to:

- `Schema.decodeUnknown(...)`
- `Schema.parseJson(...)`
- `Schema.TaggedError`
- `Effect.catchTag` / `Effect.catchTags`
- explicit boundary response mapping

### 4. Keep REST on the existing agent worker

For the planned frontend read API, the cleanest Cloudflare fit remains:

- keep REST on the existing agent worker
- keep ingest orchestration on the existing ingest worker
- keep D1 as the read/query state plane
- do not introduce a new Durable Object for REST

A new worker is only justified if you want materially different:

- auth
- rate limiting
- cache policy
- deployment cadence
- public traffic isolation

### 5. Do not introduce Agents SDK yet

Cloudflare Agents SDK is not the right next move for the current problem.

Use it later if Skygest needs:

- persistent conversational state
- WebSocket-backed agent sessions
- long-lived per-session memory
- scheduled or interactive agent instances with their own state model

Do not use it just to expose a read API over D1.

## Recommended Target Shape

```text
Cloudflare fetch
  -> auth / boundary middleware
  -> Effect HttpRouter (or HttpApi for stabilized public surface)
  -> schema-based path/query/body parsing
  -> Effect service layer
  -> repo layer / D1
  -> typed response + typed error mapping
```

### Edge Rules

- worker `fetch` should dispatch into one Effect app, not hand-route many branches
- auth should be middleware-like, not repeated in every route block
- parsing should happen through schemas close to the route definition
- response envelopes should be modeled once, not improvised per route

### Service Rules

- service tags remain the main orchestration layer
- service methods should expose typed domain results and typed expected errors
- services should not know about raw `Request`, `Response`, or URL parsing

### Repository Rules

- repositories continue to depend on `SqlClient`
- repositories should decode rows through schema helpers without `decodeUnknownSync` wrapped in generic `try/catch` where avoidable
- pagination and query semantics should live in query services / repos, not in the router

## API Design Guidance

### Separate search from chronological feeds

Do not overload the first public read surface into one ambiguous `GET /api/posts`.

Recommended initial split:

- `GET /api/posts/search`
- `GET /api/posts/recent`
- `GET /api/experts/:did/posts`
- `GET /api/links`
- `GET /api/topics`
- `GET /api/topics/:slug`
- `GET /api/topics/:slug/expand`
- `GET /api/posts/:uri/topics`

Reason:

- full-text search and chronological feeds have different ordering and pagination semantics
- pretending they are one endpoint will leak backend complexity into the contract

### Cursor pagination over offset pagination

For D1-backed read paths, use cursor pagination for chronological feeds:

- posts: order by `(created_at DESC, uri ASC)`
- links: order by a stable chronological key plus deterministic tie-breakers

Avoid `OFFSET` for high-volume paths.

### Delay aggregate endpoints until a read model exists

Do not add stats endpoints until the storage model explicitly supports them.

Likely future options:

- dedicated aggregate SQL queries for bounded cases
- precomputed rollup tables
- analytics-specific read models

The current post/topic/link tables are adequate for retrieval, not for a broad analytics surface.

## Anti-Patterns To Remove

### Router-local parsing helpers that throw for control flow

Current pattern:

- parse URL / query / body manually
- throw `TaggedError`
- catch at router boundary

Target:

- decode request components as `Effect`s
- compose failures in the error channel
- map expected errors once at the route or app boundary

### Repeated layer construction inside transport modules

Current pattern:

- routers build their own layer graphs inline

Target:

- shared layer modules for query/admin/ingest concerns
- route modules consume those layers, not define them

### Generic error translation around schema decoding

Current pattern:

- `decodeUnknownSync` inside `Effect.try`

Target:

- `Schema.decodeUnknown(schema)(input)`
- `Effect.mapError(...)`

This keeps schema failures in the typed error channel instead of converting them back from thrown exceptions.

## Cloudflare-Specific Guidance

### D1

- keep read queries deterministic and index-driven
- prefer cursor pagination over offset on user-facing feeds
- use separate query shapes for search vs recent activity
- if public read traffic grows, consider a dedicated read-only worker later, but not before the contract stabilizes

### Durable Objects

Use a new DO only if there is a real coordination boundary, for example:

- per-user live sessions
- conversational state
- live collaborative curation
- rate limiting or lease ownership requiring strong serialization

Do not create a DO just to mediate D1 reads.

### Existing deployment caveat

The March 2026 architecture review already noted a staging mismatch where the agent and ingest workers do not share the same DO namespace.

That is mostly irrelevant for a read-only REST API, but it becomes critical if future agentic write flows are introduced.

## Refactor Sequence

1. Stop treating the current `src/api/` work as authoritative.
2. Extract shared layer construction into dedicated modules.
3. Introduce a single boundary error strategy for HTTP routes.
4. Refactor one surface to schema-first `HttpRouter` patterns.
   Suggested order: public read API first, then admin, then ingest.
5. Move manual parsing to schema-driven route helpers.
6. Replace generic thrown parse errors with typed route/domain errors.
7. Revisit `HttpApi` only after the public API contract stabilizes.

## Open Questions

- Should the public read API share the same auth domain as admin/MCP, or be publicly readable?
- Do link timestamps represent post creation time or extraction time in the intended product model?
- Which endpoints truly need total counts, and which can remain cursor-only?
- Is topic autocomplete needed now, or can ontology browse/expand cover the first frontend iteration?
- When does Skygest actually need agent session state, rather than just a read API plus ingest orchestration?

## Source Notes

Reviewed during this pass:

- local repo architecture in `src/admin/Router.ts`, `src/ingest/Router.ts`, `src/mcp/Router.ts`, `src/platform/EffectRuntime.ts`, `src/platform/Json.ts`, `src/services/d1/schemaDecode.ts`
- Effect Solutions guidance: `basics`, `services-and-layers`, `data-modeling`, `error-handling`
- Effect platform docs on `HttpApi`, `HttpRouter.schemaParams`, `HttpServerRequest.schemaSearchParams`, `Schema.parseJson`, and `Schema.TaggedError`
- Cloudflare skill references for Workers, D1, and Durable Objects
- Cloudflare docs:
  - https://developers.cloudflare.com/workers/
  - https://developers.cloudflare.com/d1/
  - https://developers.cloudflare.com/durable-objects/
  - https://developers.cloudflare.com/agents/
