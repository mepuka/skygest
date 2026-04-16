# Skygest BI: AI-Assisted Business Intelligence from Bluesky Experts

**Date:** 2026-03-05
**Status:** Draft

## Overview

Skygest BI is a Cloudflare-native, Effect-native platform that collects domain-specific Bluesky posts from curated expert sources, stores them with structured enrichment, and exposes the resulting knowledge base to AI agents and MCP clients.

The first domain is **energy news**: journalists, grid experts, academics, policy analysts, and researchers posting about energy, climate, grid operations, utilities, storage, markets, and related topics.

**Core idea:** Bluesky's open protocol gives us access to real expert commentary in real time. By curating who we listen to and storing what they share, we create high-signal context for briefings, link research, trend analysis, and agentic workflows grounded in human expertise instead of generic web crawl output.

## Design Goals

- **Cloudflare-native**: Workers, Durable Objects, D1, Queues, R2, KV, Agents SDK, and Workflows where each product fits best
- **Effect-native core**: domain logic, repositories, orchestration, validation, and error handling remain in Effect services and layers
- **Secure by default**: read-only query surface separated from authenticated operator mutations
- **Idempotent ingestion**: queue retries and replay must not duplicate records
- **Searchable and composable**: FTS-backed post search plus normalized topic joins
- **Shardable from day one**: no global singleton Durable Object for the Jetstream firehose

## Architecture

Three layers, all on Cloudflare:

### 1. Discovery and Ingestion

- **Jetstream shard Durable Objects** ingest the Bluesky firehose for assigned expert DIDs
- Experts are assigned to shards by deterministic hash, for example `hash(did) % shard_count`
- Each shard opens a Jetstream subscription for `app.bsky.feed.post` using `wantedDids`
- Shards periodically reload active filters from D1 and can also refresh on explicit control messages from the expert registry path
- The design keeps each shard below Jetstream's current `wantedDids` cap and avoids a single global DO bottleneck
- Expert discovery happens through authenticated operator flows: starter pack import, list import, and network expansion
- **skygent CLI** remains the local-only development tool for manual curation and vetting

### 2. Knowledge Store

- **D1** is the system of record for experts, posts, normalized topics, links, briefing artifacts, and hydrated post stats
- **D1 FTS5** powers `search_posts(...)`
- **R2** stores larger fetched artifacts when needed, such as scraped link bodies or exported reports
- **KV** is used only for hot read caching and short-lived control snapshots, not as the source of truth
- Queue consumers are explicitly idempotent so retries do not create duplicate rows

### 3. Agent and Access Surface

- **Read-only MCP server** exposes query tools over the shared knowledge store
- **Authenticated operator API** handles mutations such as adding experts, importing lists, reindexing topics, and manual repair operations
- **Cloudflare Agents SDK** powers scheduled and interactive agents
- **Cloudflare Workflows** handle long-running, multi-step jobs such as large starter-pack imports, stats backfills, and deep link research
- **Queues** handle high-throughput async processing: raw ingest events, enrichment, and post-stats hydration

## Scheduling Boundaries

Use each Cloudflare primitive for one job:

- **Agent schedules**: recurring briefings, recurring expert profile sync, lightweight periodic maintenance
- **Workflows**: multi-step discovery imports, bulk backfills, long-running retries, fan-out/fan-in jobs
- **Queues**: high-throughput event processing and buffering between ingest and write-heavy consumers
- **DO alarms**: keep Jetstream shard supervisors alive and trigger periodic filter refresh

Agent schedule registration must be idempotent. `onStart()` should call an `ensureSchedules` effect that checks existing schedules before creating new ones.

## Data Flow

```text
Jetstream firehose
  -> Jetstream shard DO
  -> DID filter (active experts assigned to shard)
  -> enqueue raw post event with idempotency key
  -> enrichment queue consumer
  -> classify against SKOS topic terms
  -> extract links and write posts/post_topics/links/posts_fts
  -> enqueue stats hydration job for recent posts
  -> stats hydration worker or workflow
  -> write post_stats
  -> read-only MCP / Agents SDK / briefing workflows
```

## Data Model

### D1 Tables

```sql
experts (
  did             TEXT PRIMARY KEY,
  handle          TEXT,
  display_name    TEXT,
  description     TEXT,
  domain          TEXT,     -- e.g. "energy"
  source          TEXT,     -- "manual" | "starter_pack" | "list" | "network"
  source_ref      TEXT,     -- at:// URI or discovery ref
  shard           INTEGER NOT NULL,
  active          INTEGER DEFAULT 1,
  added_at        INTEGER NOT NULL,
  last_synced_at  INTEGER
)

expert_sources (
  uri             TEXT PRIMARY KEY,
  type            TEXT NOT NULL, -- "starter_pack" | "list"
  name            TEXT,
  domain          TEXT NOT NULL,
  last_crawled_at INTEGER
)

posts (
  uri             TEXT PRIMARY KEY, -- at:// URI
  did             TEXT NOT NULL,
  cid             TEXT,
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  indexed_at      INTEGER NOT NULL,
  has_links       INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'active',
  ingest_id       TEXT UNIQUE,      -- idempotency key for queue retries
  FOREIGN KEY (did) REFERENCES experts(did)
)

post_topics (
  post_uri        TEXT NOT NULL,
  topic_slug      TEXT NOT NULL,
  matched_term    TEXT,
  PRIMARY KEY (post_uri, topic_slug),
  FOREIGN KEY (post_uri) REFERENCES posts(uri)
)

links (
  post_uri        TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT,
  description     TEXT,
  domain          TEXT,
  extracted_at    INTEGER NOT NULL,
  PRIMARY KEY (post_uri, url),
  FOREIGN KEY (post_uri) REFERENCES posts(uri)
)

post_stats (
  post_uri        TEXT PRIMARY KEY,
  like_count      INTEGER DEFAULT 0,
  repost_count    INTEGER DEFAULT 0,
  reply_count     INTEGER DEFAULT 0,
  quote_count     INTEGER DEFAULT 0,
  hydrated_at     INTEGER NOT NULL,
  FOREIGN KEY (post_uri) REFERENCES posts(uri)
)

briefings (
  id              TEXT PRIMARY KEY,
  domain          TEXT NOT NULL,
  window_start    INTEGER NOT NULL,
  window_end      INTEGER NOT NULL,
  summary_markdown TEXT NOT NULL,
  source_post_count INTEGER NOT NULL,
  created_at      INTEGER NOT NULL
)
```

### Search Model

`search_posts(...)` is backed by an FTS table, not plain `LIKE` scans:

```sql
CREATE VIRTUAL TABLE posts_fts USING fts5(
  uri UNINDEXED,
  text
);
```

The enrichment write path updates both `posts` and `posts_fts`. Topic filtering is done through `post_topics`, not by indexing JSON arrays stored in a single text column.

### Indexes

- `experts(active, domain, shard)`
- `posts(did, created_at DESC)`
- `posts(created_at DESC)`
- `posts(has_links, created_at DESC)`
- `post_topics(topic_slug, post_uri)`
- `links(domain, extracted_at DESC)`
- `briefings(domain, created_at DESC)`

## Query and Mutation Surfaces

### Read-only MCP Tools

- `search_posts(query, topic?, since?, limit?)`
  Uses FTS plus joins to `post_topics` and `experts`
- `get_recent_posts(topic?, expert_did?, since?, limit?)`
- `get_post_links(domain?, topic?, since?, limit?)`
- `list_experts(domain?, active?)`
- `get_recent_briefings(domain?, limit?)`
- `get_topic_summary(domain, since?)`
  Returns raw material for summarization: recent posts, most-shared links, active experts, and engagement metrics when `post_stats` is available

### Authenticated Operator Surface

These are **not** part of the public read-only MCP endpoint:

- `add_expert(did_or_handle, domain)`
- `import_starter_pack(uri, domain)`
- `import_list(uri, domain)`
- `sync_expert_profiles(domain?)`
- `rebuild_topic_index(domain?)`
- `refresh_shard_filters()`

Preferred design:

- Read-only MCP can be public or separately authenticated depending on product needs
- Write-capable tools live behind an authenticated operator HTTP API or a separate admin MCP server
- `AuthService` validates Cloudflare Access JWTs or OAuth-derived bearer tokens and enforces scopes such as `experts:write`, `sources:import`, and `ops:reindex`
- All operator mutations are audit logged

## Agent Framework

Built on the Cloudflare Agents SDK, but the application core remains Effect-native.

### Runtime Model

- Agent Durable Object classes are thin adapters
- All business logic runs as Effect programs with typed services and tagged errors
- Agent-local SQL stores per-agent state, schedules, and run metadata
- Shared knowledge lives in D1 and is accessed through Effect repositories
- Workflows call the same Effect services as agents and HTTP handlers

### Effect-Native Boundary

Keep SDK-specific code at the edge:

- Agent class methods translate DO lifecycle hooks into Effect programs
- HTTP routers translate request schemas into Effect handlers
- Queue consumers translate message bodies into Effect handlers
- MCP tool adapters translate Effect schemas into tool definitions

The core should not depend on `zod` or `tool()` as first-class modeling primitives. Use Effect `Schema` for validation and domain types, and only add adapter code where a Cloudflare or MCP boundary requires a different schema shape.

### Example Shape

```typescript
class BriefingAgent extends Agent<Env, AgentState> {
  async onStart() {
    await runAgentEffect(this.env, this.sql, AgentSchedules.ensureDailyBriefing);
  }

  async generateBriefing(input: GenerateBriefingInput) {
    return await runAgentEffect(
      this.env,
      this.sql,
      BriefingService.generate(input)
    );
  }
}
```

## Effect Architecture

### Layer Composition

```typescript
const PlatformLayer = Layer.mergeAll(
  CloudflareEnv.layer(env),
  D1Client.layer(env.DB),
  KvCache.layer(env.KV),
  R2Client.layer(env.R2),
  WorkersAi.layer(env.AI),
  AgentSql.layer(sql)
);

const StorageLayer = Layer.mergeAll(
  ExpertsRepoD1.layer,
  PostsRepoD1.layer,
  PostTopicsRepoD1.layer,
  LinksRepoD1.layer,
  PostStatsRepoD1.layer,
  BriefingsRepoD1.layer
);

const IntegrationLayer = Layer.mergeAll(
  BlueskyClient.layer,
  OntologyCatalog.layer,
  JetstreamClient.layer
);

const AppLayer = Layer.mergeAll(
  KnowledgeQueryService.layer,
  ExpertRegistryService.layer,
  TopicClassificationService.layer,
  StatsHydrationService.layer,
  BriefingService.layer,
  DiscoveryService.layer,
  AgentSchedules.layer,
  McpToolService.layer
).pipe(
  Layer.provideMerge(StorageLayer),
  Layer.provideMerge(IntegrationLayer),
  Layer.provideMerge(PlatformLayer)
);
```

### Service Boundaries

Suggested Effect services:

- `ExpertsRepo`
- `ExpertSourcesRepo`
- `PostsRepo`
- `PostTopicsRepo`
- `LinksRepo`
- `PostStatsRepo`
- `BriefingsRepo`
- `OntologyCatalog`
- `BlueskyClient`
- `JetstreamClient`
- `ExpertRegistryService`
- `KnowledgeQueryService`
- `TopicClassificationService`
- `StatsHydrationService`
- `BriefingService`
- `DiscoveryService`
- `McpToolService`
- `AuthService`

### Coding Style

- Use `Schema` for inputs, outputs, and tagged errors
- Use `Effect.fn` for named service methods and entrypoint handlers
- Provide layers once at the edge, not deep inside business logic
- Keep repositories and services dependency-injected through `Context.Tag`
- Use `@effect/vitest` with test layers for unit and slice tests

## Worker Consolidation

### Current

`feed`, `filter`, `generator`, `postprocess`, `dispatch`

### New

**Worker 1: Ingestor** (`wrangler.toml`)

- Jetstream shard DO classes
- Control path for filter refresh and shard maintenance
- Queue producer for raw ingest events
- Queue consumer for enrichment writes and FTS updates
- Optional queue producer for post-stats hydration jobs
- Bindings: D1, Queue(s), DOs, KV optional
- Implementation style: Effect-native end to end

**Worker 2: Knowledge and Agent** (`wrangler.agent.toml`)

- Read-only MCP server
- Authenticated operator API or separate admin MCP
- Agent DO classes such as `BriefingAgent` and `DiscoveryAgent`
- Workflow classes for multi-step imports, backfills, and deep research
- Workers AI binding for inference
- Bindings: D1, KV, R2, AI, DOs, auth secrets
- Implementation style: Effect-native core with thin Agents SDK adapters

### Removed

- `wrangler.filter.toml`
- `wrangler.generator.toml`
- `wrangler.postprocess.toml`
- `wrangler.dispatch.toml`

### New Dependencies

- `agents`
- Cloudflare MCP helper or `@modelcontextprotocol/sdk` at the boundary
- No mandatory `ai` + `zod` dependency in the core design
- If an AI SDK adapter is later needed, isolate it to the agent edge layer

## Codebase Reuse Assessment

### Keep with Small Changes

- `src/ingest/IngestorSupervisor.ts`
- `src/ingest/JetstreamCursorStore.ts`
- `src/auth/AuthService.ts`
- `src/platform/Logging.ts`
- `src/db/migrate.ts`
- `src/domain/errors.ts`

### Refactor

| File | Changes |
|------|---------|
| `src/ingest/IngestorDo.ts` | Refactor into shard-aware Jetstream DO with idempotent alarm lifecycle and filter refresh |
| `src/ingest/JetstreamIngestor.ts` | Add shard-scoped DID filters, control refresh, and raw event idempotency keys |
| `src/filter/FilterWorker.ts` | Replace paper filter with ontology-driven topic classification and link extraction |
| `src/services/PostsRepo.ts` | Rename `PaperPost` to `Post` and model normalized knowledge-base fields |
| `src/services/d1/PostsRepoD1.ts` | Upsert posts, manage FTS sync, and support query joins |
| `src/bluesky/BlueskyClient.ts` | Add profile fetch, starter-pack resolution, list resolution, and post-stats hydration calls |
| `src/platform/Config.ts` | Replace feed-specific config with shard, domain, auth, and API config |
| `src/platform/Env.ts` | Update bindings for new queues, DOs, AI, R2, and auth secrets |
| `src/mcp/Router.ts` | Implement read-only MCP routing and schema-backed tool adapters |
| `src/db/migrations.ts` | Replace current schema with experts, posts, post_topics, links, post_stats, briefings, and FTS tables |

### Add

- `src/services/ExpertsRepo.ts`
- `src/services/ExpertSourcesRepo.ts`
- `src/services/PostTopicsRepo.ts`
- `src/services/LinksRepo.ts`
- `src/services/PostStatsRepo.ts`
- `src/services/BriefingsRepo.ts`
- `src/services/KnowledgeQueryService.ts`
- `src/services/ExpertRegistryService.ts`
- `src/services/TopicClassificationService.ts`
- `src/services/StatsHydrationService.ts`
- `src/services/BriefingService.ts`
- `src/services/DiscoveryService.ts`
- `src/agent/AgentRuntime.ts`
- `src/agent/AgentSchedules.ts`
- `src/http/AdminRouter.ts`
- `src/workflows/`

### Remove

- `src/feed/`
- `src/generator/GeneratorWorker.ts`
- `src/postprocess/PostprocessWorker.ts`
- `src/filters/paperFilter.ts`
- `src/filters/paperPatterns.ts`
- `src/services/InteractionsRepo.ts`
- `src/services/AccessRepo.ts`
- `src/services/AccessWriteResolver.ts`
- `src/services/CandidateSessionsRepo.ts`
- `src/services/kv/CandidateSessionsKv.ts`
- `src/worker/postprocess.ts`
- `src/worker/generator.ts`

## Domain: Energy News Ontology

The energy-news ontology at `/Users/pooks/Dev/ontology_skill/ontologies/energy-news/` provides:

- **SKOS topic taxonomy** for normalized `topic_slug` values
- **Preferred and alternate labels** used by `TopicClassificationService`
- **Reference individuals** that can seed expert discovery and topic mapping

Ontology terms should compile into a deterministic Effect service at build or startup time, not be reparsed ad hoc in request handlers.

## Recommended Implementation Order

1. **Rebuild the schema and repositories**
   Add the new D1 migrations, FTS table, normalized topic tables, and Effect repository layers before changing runtime behavior.
2. **Refactor ingest to idempotent shard-based ingestion**
   Convert the current ingestor DO into shard-aware Jetstream DOs, emit raw events with stable idempotency keys, and make queue consumers safe under retry.
3. **Land the read path first**
   Implement `KnowledgeQueryService`, read-only MCP tools, and cached query endpoints before adding mutation-heavy discovery flows.
4. **Add authenticated operator flows**
   Introduce `ExpertRegistryService`, admin HTTP routes or admin MCP, and shard-filter refresh so expert curation is secure and operationally clear.
5. **Add stats hydration and briefings**
   Implement recent-post stats hydration, `post_stats`, `briefings`, and `BriefingService` once the read model is stable.
6. **Add agents and workflows last**
   Keep the agent DOs and workflow orchestration thin by building them on top of already-tested Effect services instead of letting orchestration define the domain model.

## v1 Scope

### In

- Energy-domain expert ingestion
- Sharded DID-filtered Jetstream ingest
- Effect-native enrichment pipeline
- D1-backed FTS post search
- Normalized topic joins
- Read-only MCP query surface
- Authenticated operator expert-management surface
- Recurring briefing generation
- Post-stats hydration for recent posts

### Out

- Agent-to-agent orchestration
- General chat UI
- Streaming agent responses
- Vector search and embeddings
- Heavy AI enrichment during ingest
- Multi-domain production rollout beyond energy
