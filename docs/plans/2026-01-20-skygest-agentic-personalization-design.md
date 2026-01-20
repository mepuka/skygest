# Skygest Agentic Personalization MVP Design

Date: 2026-01-20
Status: Draft (validated in brainstorm)

## Goals
- Let a user create a feed profile and see it live in Bluesky via a single Cloudflare service endpoint.
- Let a user fork an external feed, hydrate post content, and re-rank it locally with their agent.
- Capture curation events as structured training data (RLHF-style) with minimal latency impact.

## Non-Goals (MVP)
- Full on-platform ranking logic (ranking stays with the user’s agent).
- Complex workflow orchestration or long-running batch analytics.
- Advanced multi-tenant sharding or migration tooling.

## MVP Scope (Decisions)
- Split pipeline architecture (MCP Worker + ingestion/filter workers + D1/KV/Vectorize).
- Multi-profile feeds per user (profile slug determines feed variant).
- External feed fork with full hydration via Bluesky APIs, with caps:
  - Max 25 hydrations
  - Max 50 total API calls
  - 5s time budget per MCP request

## Architecture Overview
- **Ingestion**: Jetstream Durable Object maintains a WebSocket to firehose and emits batches to a Queue. A filter worker normalizes posts and writes to D1. Optional embeddings are written to Vectorize.
- **MCP Bridge**: A Cloudflare Worker exposes JSON-RPC/SSE tools for candidate retrieval and feed publishing.
- **Storage**: D1 for structured data, KV for feed skeletons and cached follows, Vectorize for semantic vectors, optional R2 for large payloads.

## Core Components
- **Ingestor DO**: Streams firehose, batches events to Queue, stores cursor in DO SQLite.
- **Filter Worker**: Filters and normalizes posts, writes to D1, updates tag index.
- **MCP Worker**: Implements tool APIs, enforces hallucination firewall, writes to KV and D1.
- **D1**: Source of truth for posts, profiles, preferences, and curation events.
- **KV**: Low-latency feed skeleton cache and follow-list cache.
- **Vectorize (optional in MVP)**: Semantic search and steering.

## Data Model (D1)
- `posts`: uri, cid, author_did, text_content, facets, created_at, vector_id
- `post_tags`: post_uri, tag (for fast hashtag queries)
- `curation_profiles`: profile_id, user_did, slug, name, source_config, created_at
- `user_preferences`: rule_id, user_did, type, target, weight, last_updated
- `curation_events`: event_id, user_did, session_id, intent_prompt, input_uris, output_uris, rejection_mask, agent_reasoning, timestamp
- `candidate_sessions`: session_id, user_did, profile_id, input_uris, created_at, expires_at

KV keys:
- `feed:{did}:{slug}` -> ordered URIs for live feed
- `follows:{did}` -> cached follow DIDs

## MCP Toolset (MVP)
- `get_candidate_pool({ limit, sources, semantic_query? })`
  - Sources: GRAPH, HASHTAG, LIST, FEED
  - Returns hydrated post objects with provenance.
- `publish_curated_feed({ feed_uris, provenance_trace })`
  - Validates URIs against recent `candidate_sessions` (hallucination firewall).
  - Writes KV feed and logs `curation_events`.
- `sync_preferences({ new_rules })`
  - Writes rules to `user_preferences` for future filtering and scoring.

## Candidate Sources & Hydration
- **GRAPH**: D1 query by follows; follows cached in KV.
- **HASHTAG**: D1 query via `post_tags` index.
- **LIST**: Bluesky list API -> member DIDs -> D1 query by author.
- **FEED**: External feed skeleton -> hydrate missing post text via Bluesky API.
- **Hydration caps**: 25 hydrations, 50 API calls, 5s budget, partial return when hit.
- Cache hydrated content into D1 (and optional KV) to reduce repeat fetches.

## Feed Publishing & RLHF Capture
- `publish_curated_feed` writes ordered URIs to KV with TTL.
- Writes `curation_events` with input/output lists and optional reasoning summary.
- `candidate_sessions` provide a short-lived whitelist of candidate URIs per tool call.

## Error Handling & Limits
- Queue consumers are idempotent (INSERT OR IGNORE).
- External feed/hydration failures fall back to D1-only candidates.
- Per-request caps enforce Cloudflare CPU and API limits.

## Security & Privacy
- API keys scoped to user DID for MCP access.
- Only agent-provided intent summaries are stored (not raw user prompts).
- Opt-out handled via `user_preferences` flags and exclusion in analytics.

## Observability
- Structured logs for tool calls, hydration counts, and queue processing.
- Metrics: candidate latency, hydration hit rate, queue depth, cache hit rate.

## Testing (MVP)
- Unit tests for tool input validation and hallucination firewall.
- Integration tests for candidate sources and hydration caps.
- Load test for `get_candidate_pool` with external feed fork.

## Open Questions
- Vectorize use in MVP vs phase 2.
- Retention window for `candidate_sessions` and `curation_events`.
- Rate limits for API keys and per-profile usage.

## Next Steps
- Confirm Vectorize usage in MVP.
- Define schema migrations and binding names.
- Draft implementation plan and begin module scaffolding.
