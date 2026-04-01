# MCP Workflow Completeness Implementation Plan

**Goal:** Close the MCP workflow gap so an LLM can complete the full brief pipeline through MCP alone: discover candidates → evaluate → curate (Candidate → Enriching) → verify readiness (Enriching → Reviewable) → accept brief (Reviewable → Accepted).

**Pipeline vocabulary:** See `docs/plans/2026-03-31-canonical-domain-model.md` for the canonical object and state definitions used throughout this plan.

## Revised Architecture

The earlier draft had two structural problems:

1. It tried to thread caller identity into a cached MCP layer, which would have reused the first caller's identity on later requests.
2. It treated enrichment payloads and enrichment run state as separate one-off implementations, which made readiness ambiguous and duplicated validation logic.

This cleaned-up plan fixes both.

### Design decisions

- Keep MCP handler caching **env-scoped only**. Do not bake caller identity into cached layers or cached web handlers.
- Reuse the existing `OperatorIdentity` request context from `src/http/Identity.ts`. Do not introduce a second identity tag for MCP.
- Add an MCP request classifier at the `/mcp` HTTP boundary. It inspects the JSON-RPC envelope (`tools/list`, `tools/call`, `prompts/list`, `prompts/get`) before dispatch.
- Build **capability-specific MCP handler variants** and cache them by env + capability profile:
  - `read-only`
  - `curation-write`
  - `editorial-write`
  - `workflow-write`
- Pass the per-request operator identity via the `context` argument to `webHandler.handler(...)`, and update `src/mcp/registerToolkitWithDisplayText.ts` so it merges registration-time context with request-time context instead of freezing the registration context.
- Extract the enrichment normalization logic from `src/api/Router.ts` into a shared read-model helper so API and MCP return the same validated enrichment objects.
- Introduce a richer enrichment readiness model:
  - `none`
  - `pending`
  - `complete`
  - `failed`
  - `needs-review`
- Fix the existing `/admin/ops/stats` scope hole while touching route auth.

### Capability rules

- `read-only`
  - current read tools
  - `get_post_enrichments`
  - existing read prompts only
- `curation-write`
  - read-only surface
  - `curate_post`
- `editorial-write`
  - read-only surface
  - `submit_editorial_pick`
- `workflow-write`
  - read-only surface
  - `curate_post`
  - `submit_editorial_pick`
  - `curate-session`

This makes tool and prompt discovery scope-aware without caching per-user identity.

## Issue Map

| Issue | Title | Type | Depends On |
|-------|-------|------|------------|
| SKY-29 | MCP boundary auth + capability-aware handler routing | feat | — |
| SKY-76 | Request-scoped actor context + write-capable MCP toolkits | feat | SKY-29 |
| SKY-77 | Brief and claim read model exposure | feat | SKY-29 |
| SKY-81 | Candidate readiness surfacing in review queue | feat | SKY-78 |
| SKY-79 | Domain glossary and ontology alignment | feat | SKY-29, SKY-76, SKY-77 |
| SKY-82 | Verification prompt packs | feat | SKY-29, SKY-76 |

## Task 1: MCP Boundary Auth and Capability Routing (SKY-29)

**Outcome:** `/mcp` remains a single route, but dispatch becomes per-request and scope-aware without leaking identity across requests.

**Files:**
- Create: `src/mcp/RequestAuth.ts`
- Modify: `src/mcp/Router.ts`
- Modify: `src/mcp/registerToolkitWithDisplayText.ts`
- Modify: `src/worker/feed.ts`
- Modify: `src/worker/operatorAuth.ts`
- Test: `tests/mcp-router-auth.test.ts`
- Test: `tests/operator-auth.test.ts`
- Test: `tests/feed.test.ts`

### Implementation

1. Add a small JSON-RPC request classifier in `src/mcp/RequestAuth.ts`.

   It should:

   - decode the subset of envelopes the server needs for authorization:
     - `tools/list`
     - `tools/call`
     - `prompts/list`
     - `prompts/get`
   - expose:
     - `classifyMcpRequest(request)`
     - `requiredMcpScopes(classification)`
     - `capabilityProfileFor(identity, classification)`

2. Keep `/mcp` authenticated at the HTTP boundary with `mcp:read`, but add per-request scope checks before dispatch for write operations.

   Scope rules:

   - `tools/call` + `curate_post` -> `curation:write`
   - `tools/call` + `submit_editorial_pick` -> `editorial:write`
   - `prompts/get` + `curate-session` -> both `curation:write` and `editorial:write`
   - `tools/list` and `prompts/list` -> no extra scope requirement, but choose a scoped capability profile

3. Update `src/mcp/Router.ts` so it caches handlers by `env + capability profile`, not by caller identity.

   Shape:

   - `readOnly`
   - `curationWrite`
   - `editorialWrite`
   - `workflowWrite`

4. Pass `operatorIdentityContext(identity)` to `webHandler.handler(request, context)` in the MCP router, the same way admin routing already does.

5. Update `src/mcp/registerToolkitWithDisplayText.ts` so it preserves request-time context.

   The current wrapper captures registration context once and re-provides it during tool execution. That must change to:

   - capture registration context once
   - merge it with the current runtime/request context at tool execution time

   This is the key change that lets MCP tool handlers read `OperatorIdentity` safely on a cached handler.

6. Add explicit denied-write logging for MCP tool and prompt calls.

   Do not rely on the route-level `"mcp_read"` action alone. Log:

   - MCP method
   - tool or prompt name
   - required scope(s)
   - operator subject/email when available

7. Fix `/admin/ops/stats` in `src/worker/operatorAuth.ts` to require `ops:read`.

### Tests

Add `tests/mcp-router-auth.test.ts` covering:

- read-only identity sees only read tools
- curation-only identity sees `curate_post` but not `submit_editorial_pick`
- editorial-only identity sees `submit_editorial_pick` but not `curate_post`
- workflow identity sees both write tools and `curate-session`
- missing scope returns 403 on `tools/call`
- denied write does not mutate DB state

Update `tests/operator-auth.test.ts`:

- `/admin/ops/stats` requires `ops:read`

Update `tests/feed.test.ts`:

- `/mcp` path passes the authorized identity to MCP routing
- unauthorized and forbidden cases still return the correct HTTP status

## Task 2: Request-Scoped Actor Context and Write Toolkits (SKY-76)

**Outcome:** Write tools use the current operator as the actor for pipeline transitions (Candidate → Enriching, Reviewable → Accepted). Tool visibility is handled by the capability router rather than by runtime scope checks inside cached handlers.

**Files:**
- Modify: `src/mcp/Toolkit.ts`
- Modify: `src/mcp/Router.ts`
- Modify: `src/mcp/OutputSchemas.ts`
- Modify: `src/mcp/Fmt.ts`
- Modify: `src/domain/editorial.ts`
- Modify: `src/mcp/glossary.ts`
- Test: `tests/mcp.test.ts`
- Test: `tests/mcp-write-tools.test.ts`
- Test: `tests/support/runtime.ts`

### Implementation

1. Remove the plan's `McpIdentity.ts` idea entirely.

   Tool handlers should use `OperatorIdentity` from request context when they need the actor string:

   - `identity.email ?? identity.subject ?? "mcp-operator"`

2. Split MCP toolkits by capability profile.

   Suggested structure in `src/mcp/Toolkit.ts`:

   - `ReadOnlyKnowledgeMcpToolkit`
   - `CurationWriteToolkit`
   - `EditorialWriteToolkit`
   - `WorkflowWriteToolkit`

   Keep shared tool definitions in one place; only the composed toolkit variants differ.

3. Re-enable `curate_post` in the curation and workflow toolkits.

4. Add `submit_editorial_pick` to the editorial and workflow toolkits.

5. Keep actor lookup inside handlers, but remove the previous draft's `requireMcpScope(...)` logic from tool execution.

   Scope enforcement now happens in Task 1 at the request boundary. Tool handlers should be simple business calls again.

6. Add an MCP-friendly input schema for `submit_editorial_pick`.

   Keep it in `src/domain/editorial.ts`, but make it clear that this is an MCP transport input:

   - `score` accepts string or number
   - `expiresInHours` accepts string or number

7. Update `formatCuratePostResult` and `formatSubmitPickResult` in `src/mcp/Fmt.ts`.

### Tests

Update `tests/support/runtime.ts`:

- allow the MCP test client to call `handleMcpRequestWithLayer(...)` with an identity context
- provide helpers for read-only, curation, editorial, and workflow identities

Update `tests/mcp.test.ts`:

- stop hard-coding a single global tool count
- assert tool lists by capability profile

Add `tests/mcp-write-tools.test.ts`:

- `curate_post` records the correct curator from the current identity
- `submit_editorial_pick` records the correct curator from the current identity

## Task 3: Brief and Claim Read Model Exposure (SKY-77)

**Outcome:** MCP and public API use the same validated enrichment read model. The MCP tool exposes enrichment readiness so agents can determine whether a candidate is Reviewable (enrichment complete) or still Enriching (pending/failed/needs-review).

**Files:**
- Create: `src/enrichment/PostEnrichmentReadModel.ts`
- Create: `src/services/PostEnrichmentReadService.ts`
- Modify: `src/domain/enrichment.ts`
- Modify: `src/mcp/Toolkit.ts`
- Modify: `src/mcp/OutputSchemas.ts`
- Modify: `src/mcp/Fmt.ts`
- Modify: `src/services/EnrichmentRunsRepo.ts`
- Modify: `src/services/d1/EnrichmentRunsRepoD1.ts`
- Modify: `src/edge/Layer.ts`
- Modify: `src/api/Router.ts`
- Test: `tests/mcp-enrichments.test.ts`
- Test: `tests/post-enrichment-read-model.test.ts`

### Domain changes

In `src/domain/enrichment.ts`, add:

- `GetPostEnrichmentsInput`
- `EnrichmentReadiness = "none" | "pending" | "complete" | "failed" | "needs-review"`
- `PostEnrichmentRunSummary`
- `GetPostEnrichmentsOutput`

Suggested shape:

```ts
{
  postUri: AtUri,
  readiness: EnrichmentReadiness,
  enrichments: ReadonlyArray<PostEnrichmentResult>,
  latestRuns: ReadonlyArray<{
    enrichmentType: EnrichmentKind,
    status: EnrichmentRunStatus,
    phase: EnrichmentRunPhase,
    lastProgressAt: number | null,
    finishedAt: number | null
  }>
}
```

### Shared read model

Extract the validation now buried in `src/api/Router.ts` into `src/enrichment/PostEnrichmentReadModel.ts`.

That module should own:

- decode stored `CandidatePayloadRecord.enrichments`
- reject malformed payloads
- reject payloads whose internal `kind` disagrees with stored `enrichmentType`
- compute readiness from:
  - validated payload enrichments
  - latest enrichment run state

### Readiness rules

Use these precedence rules:

1. if validated enrichments exist -> `complete`
2. else if any latest run is `needs-review` -> `needs-review`
3. else if any latest run is `failed` -> `failed`
4. else if any latest run is `queued` or `running` -> `pending`
5. else -> `none`

This prevents `needs-review` from being mislabeled as `complete`.

### Service changes

Add `PostEnrichmentReadService` to centralize the read path.

It should:

- depend on `CandidatePayloadService`
- depend on `EnrichmentRunsRepo` when available
- use `Effect.serviceOption(EnrichmentRunsRepo)` so environments without the workflow binding still work
- expose:
  - `getPost(postUri)`
  - `summarizePosts(postUris)`

### Repo changes

Extend `EnrichmentRunsRepo` with a post-oriented read method, for example:

- `listLatestByPostUris(postUris: ReadonlyArray<AtUri>)`

Implement it in `src/services/d1/EnrichmentRunsRepoD1.ts` using the existing `post_uri, enrichment_type, started_at DESC` index.

### MCP tool

Add `get_post_enrichments` to the read-only toolkit surface.

The handler should call `PostEnrichmentReadService.getPost(...)`, not `CandidatePayloadService` directly.

### API reuse

Update `src/api/Router.ts` so `/api/posts/:uri/enrichments` also uses `PostEnrichmentReadService`.

This removes the duplicate normalization logic and keeps API + MCP aligned.

### Tests

Add `tests/post-enrichment-read-model.test.ts` covering:

- valid stored payload -> returned as typed enrichment
- invalid stored payload -> filtered out
- `enrichmentType` / payload.kind mismatch -> filtered out
- pending run with no payload -> `pending`
- failed run with no payload -> `failed`
- `needs-review` run -> `needs-review`
- payload present and run absent -> `complete`

Add `tests/mcp-enrichments.test.ts` covering:

- MCP tool returns `readiness`
- MCP tool returns `latestRuns`
- MCP tool display text distinguishes pending/failed/none/complete

## Task 4: Candidate Readiness Surfacing in Review Queue (SKY-81)

**Outcome:** `list_curation_candidates` shows pipeline readiness (Enriching/Reviewable/Failed) derived from the shared read model, not from ad hoc SQL that can drift from payload truth. Agents can triage candidates by whether they are ready for the Reviewable → Accepted transition.

**Files:**
- Modify: `src/domain/curation.ts`
- Modify: `src/services/CurationService.ts`
- Modify: `src/mcp/Fmt.ts`
- Test: `tests/curation-enrichment-status.test.ts`
- Test: `tests/curation.test.ts`

### Implementation

1. Extend `CurationCandidateOutput` with:

- `enrichmentReadiness: EnrichmentReadiness`

2. Do **not** add a one-off SQL join inside `CurationRepoD1.ts`.

The previous draft's `LEFT JOIN post_enrichment_runs ...` would have:

- mislabeled `needs-review` as `complete`
- disagreed with payload-based enrichment truth
- duplicated read-model logic

3. Instead, update `CurationService.listCandidates(...)` to:

- fetch candidates from `CurationRepo.listCandidates(...)`
- call `PostEnrichmentReadService.summarizePosts(postUris)`
- merge readiness into the returned candidate objects

4. Update `formatCurationCandidates(...)` to include readiness when not `none`.

### Tests

Add cases for:

- curated candidate with active run -> `pending`
- candidate with validated enrichment payload -> `complete`
- candidate with `needs-review` run -> `needs-review`
- candidate with failed run and no payload -> `failed`
- candidate with no run and no payload -> `none`

## Task 5: Glossary Alignment and Verification Prompt Packs (SKY-79, SKY-82)

**Outcome:** MCP prompts and glossary use the brief pipeline vocabulary consistently. Prompts guide agents through pipeline transitions (Candidate → Enriching → Reviewable → Accepted) using the canonical stage names. Glossary documents all pipeline stages, readiness values, and write tool semantics.

**Files:**
- Modify: `src/mcp/prompts.ts`
- Modify: `src/mcp/glossary.ts`
- Modify: `tests/mcp.test.ts`

### Prompt changes

1. Add `curate-session` prompt (SKY-82).

   The prompt must use pipeline vocabulary throughout:
   - "Discover candidates" not "find posts"
   - "Advance to Enriching" not "curate the post"
   - "Verify Reviewable" not "check enrichment"
   - "Accept the brief" not "submit editorial pick"

   Workflow steps should reference transitions:
   - DISCOVER: find candidates (Discovered → Candidate already happened via flagging)
   - EVALUATE: read thread, assess quality
   - CURATE: `curate_post` (Candidate → Enriching)
   - VERIFY: `get_post_enrichments` (wait for Enriching → Reviewable)
   - ACCEPT: `submit_editorial_pick` (Reviewable → Accepted)

2. Make `hours` optional.

   Use `Schema.optional(FlexibleNumber...)` or `Schema.optional(Schema.String...)`. Do not repeat the current bug where the prompt says it defaults to 24 but the schema still requires it.

3. Expose `curate-session` only in the `workflow-write` profile.

4. Update `curate-digest` so it uses pipeline vocabulary.

   - If on read-only profile: "produce brief recommendations only — accepting briefs requires the workflow-write profile"
   - If on workflow-write profile: use write tools with pipeline stage names

### Glossary changes (SKY-79)

Update the glossary to document the brief pipeline:

- **Pipeline stages:** Discovered, Candidate, Enriching, Reviewable, Accepted, Rejected, Retracted, Expired
- **Enrichment readiness:** none, pending, complete, failed, needs-review
- **Write tools:** `curate_post` (Candidate → Enriching/Rejected), `submit_editorial_pick` (Reviewable → Accepted)
- **Read tools:** `get_post_enrichments` (inspect enrichment state and readiness)
- **Display IDs:** `[C#]` for curation candidates, enrichment readiness markers
- **Decision audit:** all transitions logged to `curation_decisions` with actor and timestamp

### Verification notes

Do not promise one global tool count anymore. Counts are now profile-specific.

Expected tool counts after rollout:

- read-only: 13
- curation-write: 14
- editorial-write: 14
- workflow-write: 15

Expected prompt counts after rollout:

- read-only: 3
- workflow-write: 4

## Verification Checklist

Before the work is considered done:

1. `bun run typecheck`
2. `bun run test tests/operator-auth.test.ts tests/feed.test.ts tests/mcp.test.ts tests/mcp-router-auth.test.ts tests/mcp-write-tools.test.ts tests/mcp-enrichments.test.ts tests/post-enrichment-read-model.test.ts tests/curation-enrichment-status.test.ts`
3. `bun run test`
4. Verify read-only MCP clients do **not** see write tools in `tools/list`
5. Verify curation/editorial/workflow identities see the correct scoped tool and prompt sets
6. Verify denied MCP write attempts return 403 and emit denied-operation logs with the tool/prompt name
7. Verify `/admin/ops/stats` now requires `ops:read`
8. Verify `get_post_enrichments` distinguishes:
   - no enrichment
   - pending
   - failed
   - needs-review
   - complete
9. Verify `list_curation_candidates(status: "curated")` shows the same readiness the shared enrichment read model computes

## Explicitly Out of Scope

- batch editorial mutations
- predicate dry-run tools
- lock/lease mechanics for multi-operator curation sessions
- analytics dashboards for MCP usage
