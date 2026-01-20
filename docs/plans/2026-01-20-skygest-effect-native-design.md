# Skygest Effect-Native Implementation Design

Date: 2026-01-20
Status: Draft (validated in brainstorm)

## Purpose
Deep-dive design pass for a fully Effect-native Cloudflare implementation, aligned with Effect platform APIs, effect-jetstream, and Effect SQL integrations.

## Design Decisions (Locked)
- MCP server built on `HttpRouter` / `HttpApp` with `HttpApp.toWebHandler`.
- Jetstream ingestion via `effect-jetstream` inside a Durable Object.
- Embeddings generated in the Filter Worker (not the DO).
- Candidate-session fences stored in KV with 15-minute TTL.
- Queue consumers process per-message with explicit `retry()` backoff.

## Runtime Architecture (Effect-First)
- All entrypoints are thin adapters to Effect programs.
- Each Worker builds a `Layer` graph and runs a declarative Effect program.
- `Effect.fn` is used for named business functions; `Effect.gen` for sequencing.
- Configuration is provided via `Schema.Config`-validated config layers.

## HTTP + MCP Layer
- MCP server uses `HttpRouter` routes and `HttpServerRequest.schemaBodyJson` for input parsing.
- Responses are `HttpServerResponse.json` or `HttpServerResponse.stream` (SSE).
- `HttpApp.toWebHandler` exposes the Effect app as Cloudflare `fetch`.

## Durable Object (Jetstream)
- DO hosts a `ManagedRuntime` with Jetstream `Layer` and repo layers.
- Constructor uses `blockConcurrencyWhile` for migrations and cursor restore.
- `Jetstream.stream` -> `Stream.filter` -> `Stream.groupedWithin` -> Queue send.
- DO remains minimal: no heavy computation; reconnects handled by Jetstream schedule.

## Data Access Layer
- Repositories depend on `SqlClient` from `@effect/sql`.
- Workers use `@effect/sql-d1`; DO uses `@effect/sql-sqlite-do`.
- Repo methods return `Schema`-validated domain models.
- Errors are `Schema.TaggedError` with narrow surface (`DbError`, `NotFound`, etc).

## Queue Consumers
- Queue handler runs an Effect `processBatch` program.
- Each message is decoded with `Schema` and processed independently.
- Failures map to `msg.retry({ delaySeconds })` with exponential backoff.
- Idempotency via `INSERT OR IGNORE` and unique IDs in D1.

## Embeddings + Vectorize
- Filter Worker generates embeddings and writes vector IDs into D1.
- Vectorize failures do not block post ingestion; vectors can be backfilled.
- MCP uses Vectorize only for semantic query tools.

## Candidate Sessions (Hallucination Firewall)
- `get_candidate_pool` writes a KV lease: `candidates:{did}:{profile}:{session}`.
- TTL: 15 minutes.
- Lease payload is a compact URI set or bloom-style summary.
- `publish_curated_feed` rejects outputs not present in lease.

## Error Handling & Resilience
- External calls use `Effect.retry` + `Effect.timeout` and narrow error types.
- Jetstream errors are logged; stream continues via built-in retry schedule.
- Queue consumers isolate failure per message to avoid full batch retry.

## Testing
- Service layers are replaceable with `Layer.succeed` test doubles.
- Tool handlers tested as pure Effect programs.
- HTTP integration tests use `HttpApp.toWebHandler` with synthetic Requests.

## Open Items
- Decide MVP scope for Vectorize usage (default off vs on).
- Choose KV payload format for candidate-session fences (set vs bloom).
- Determine backfill strategy for missing embeddings.

