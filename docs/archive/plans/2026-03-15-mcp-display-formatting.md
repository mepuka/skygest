# MCP Display Formatting and Text Payload Plan

Date: 2026-03-15
Status: Revised for one-pass implementation

## Goal

Implement compact MCP result displays end-to-end so that:

- MCP success payloads carry a structured `_display` field at the MCP boundary
- MCP `content[0].text` uses that compact display text instead of mirrored JSON
- `structuredContent` remains the full machine-readable object
- shared domain and HTTP schemas stay unchanged

This document supersedes the earlier structured-only `_display` plan. The transport text path is now part of the same rollout.

## Current State

Today the local `@effect/ai` MCP server serializes successful tool calls as:

- `structuredContent = result.encodedResult`
- `content[0].text = JSON.stringify(result.encodedResult)`

That behavior lives in the stock toolkit registration path in [`node_modules/@effect/ai/src/McpServer.ts`](/Users/pooks/Dev/skygest-cloudflare/node_modules/@effect/ai/src/McpServer.ts). In this repo the MCP router uses that stock path directly in [`src/mcp/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Router.ts).

Because of that, adding `_display` to handler results alone does not make the text payload compact. It only makes the structured payload larger.

## Desired Result

For successful MCP tool calls:

- `structuredContent` stays the full encoded object, including `_display`
- `content[0].text` becomes:
  - `encodedResult._display` when present
  - otherwise `JSON.stringify(encodedResult)` as a fallback

For failed MCP tool calls:

- keep the current behavior
- `structuredContent` remains the error object when available
- `content[0].text` remains `JSON.stringify(error)`

That gives compact human/LLM-facing text while preserving structured decoding for local clients.

## Constraints

- `_display` is an MCP concern, not a shared domain schema concern
- public/admin HTTP schemas in [`src/domain/api.ts`](/Users/pooks/Dev/skygest-cloudflare/src/domain/api.ts) must not change
- current MCP tools must keep their structured result shapes
- local consumers that decode MCP results should keep working via `structuredContent`
- error-path behavior should stay unchanged unless explicitly revisited later
- output should stay ASCII-only

## Compatibility Risk

Changing MCP `content[0].text` from JSON to compact text can break any client that parses the text channel as JSON.

Local repo consumers are in better shape because [`decodeCallToolResultWith`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Client.ts) prefers `structuredContent` before falling back to text. But that only remains safe if:

- MCP-side decoders use the MCP-specific success schemas
- `structuredContent` stays present and decodable

So the rollout order matters: update wrappers and local decoders before flipping the text payload path.

## Scope

### In scope

- MCP-specific success schemas with `_display`
- formatter module for all current read-only MCP success payloads
- custom MCP toolkit registration that emits compact success text
- router changes to use that custom registration path
- test updates for raw transport behavior and local decoding

### Out of scope

- failure payload redesign
- REST/API formatting changes
- session-persistent IDs
- adding a new curated-feed MCP tool

## Current MCP Surface

The current read-only MCP toolkit exposes:

- `search_posts`
- `get_recent_posts`
- `get_post_links`
- `list_experts`
- `list_topics`
- `get_topic`
- `expand_topics`
- `explain_post_topics`
- `list_editorial_picks`

`list_editorial_picks` is the only editorial MCP tool today. Curated-feed formatter work is out of scope unless a new MCP tool is added separately.

## Display Contract

- `_display` is required on MCP success wrappers
- structured fields remain the source of truth for follow-up actions
- item IDs are per-response, not session-scoped
- displays should be stable and deterministic in tests

Recommended ID prefixes:

- posts: `[P1]`, `[P2]`
- links: `[L1]`, `[L2]`
- experts: `[E1]`, `[E2]`
- topics: `[T1]`, `[T2]`
- topic matches: `[M1]`, `[M2]`
- editorial picks: `[K1]`, `[K2]`

Per-tool follow-up keys:

- posts: `items[n].uri`
- links: `items[n].postUri` or `items[n].url`
- experts: `items[n].did`
- topic lists and expansion results: `items[n].slug`
- topic explanations: top-level `postUri` plus `items[n].topicSlug`
- editorial picks: `items[n].postUri`

## Phase 0: Freeze the Boundary

### Task 0.1: Freeze success transport behavior

Document and implement this exact contract:

- success `structuredContent` is the full encoded object
- success `content[0].text` is `_display` when available, otherwise JSON fallback
- failure `content[0].text` remains JSON

Done when:

- the implementation and tests both encode this contract
- the plan no longer treats `_display` as structured-only metadata

### Task 0.2: Freeze the schema boundary

Keep shared domain outputs in:

- [`src/domain/bi.ts`](/Users/pooks/Dev/skygest-cloudflare/src/domain/bi.ts)
- [`src/domain/editorial.ts`](/Users/pooks/Dev/skygest-cloudflare/src/domain/editorial.ts)

unchanged.

Define MCP-only success wrappers instead, near the MCP transport layer.

Done when:

- `_display` does not leak into REST/public/admin response schemas
- local MCP clients decode MCP-specific schemas rather than shared base schemas

### Task 0.3: Freeze the consumer migration order

Make the rollout explicit:

1. add formatter module
2. add MCP-specific success schemas
3. update handlers to include `_display`
4. update local MCP decoders to the new wrappers
5. switch the text payload path

Done when:

- the repo no longer depends on JSON text fallback for normal MCP success decoding

## Formatter Rules

### Shared rules

- keep formatters pure in `src/mcp/Fmt.ts`
- use `@effect/printer`
- use ASCII-only separators such as `|`, `-`, `:`
- use deterministic timestamps such as `YYYY-MM-DD` or `YYYY-MM-DD HH:MMZ`
- collapse whitespace before truncation
- prefer stable fixed-width-ish layouts over relative-time strings

### Posts

- prefer `snippet` when present, otherwise use collapsed `text`
- show handle when present, otherwise a DID prefix
- include tier and timestamp
- include topics only when non-empty

### Links

- show domain, title, and timestamp
- keep `url` and `postUri` in structured data only

### Experts

- prefer `displayName (@handle)` when both exist
- fallback order: handle, then DID prefix
- include domain, tier, and inactive marker when relevant

### Topics

- `list_topics(view: "facets")` should render canonical topics using the actual topic fields
- `list_topics(view: "concepts")` should show concept slug plus canonical topic association when present
- `get_topic` should render a single-item summary using label, slug, kind, description if present, terms, parents, and children
- `expand_topics` should include `mode`, `inputSlugs`, `resolvedSlugs`, `canonicalTopicSlugs`, and then the rendered topic rows

### Topic explanations

- `explain_post_topics` should show label, slug, signal, matched term or value, and score when present

### Editorial picks

- show score, category, curator, picked date, reason, and post URI

## Patch Plan

### 1. Add formatter module

Create [`src/mcp/Fmt.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Fmt.ts) with:

- `formatPosts(items)`
- `formatLinks(items)`
- `formatExperts(items)`
- `formatTopics(items, view)`
- `formatTopic(item)`
- `formatExpandedTopics(result)`
- `formatExplainedPostTopics(result)`
- `formatEditorialPicks(items)`

Support helpers:

- `render(doc)`
- `collapse(text)`
- `truncate(text, max)`
- `formatTimestamp(epochMs)`
- `personLabel(handle, displayName, did)`

Implementation note:

- `@effect/printer` is present in `bun.lock` but not explicitly declared in [`package.json`](/Users/pooks/Dev/skygest-cloudflare/package.json). Preflight this dependency before wiring the transport change.

### 2. Add MCP-only success schemas

Create [`src/mcp/OutputSchemas.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/OutputSchemas.ts).

Define wrappers by extending the existing outputs with required `_display: Schema.String`:

- `KnowledgePostsMcpOutput`
- `KnowledgeLinksMcpOutput`
- `ExpertListMcpOutput`
- `OntologyTopicsMcpOutput`
- `OntologyTopicMcpOutput`
- `ExpandedTopicsMcpOutput`
- `ExplainPostTopicsMcpOutput`
- `EditorialPicksMcpOutput`

These should wrap current domain outputs rather than modifying them.

### 3. Wire `_display` into MCP handlers

Update [`src/mcp/Toolkit.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Toolkit.ts):

- switch tool `success` schemas to the MCP-specific wrappers
- preserve the current structured result shape
- append `_display` in each handler

Patterns:

```ts
Effect.map((items) => ({
  items,
  _display: formatPosts(items)
}))
```

```ts
Effect.map((result) => ({
  ...result,
  _display: formatExpandedTopics(result)
}))
```

Rules:

- do not build one-off strings inline in the toolkit
- do not drop fields such as `mode`, `resolvedSlugs`, `postUri`, or `topicSlug`
- keep display composition inside `Fmt.ts`

### 4. Add custom toolkit registration for display text

Create a local MCP registration module, for example:

- [`src/mcp/registerToolkitWithDisplayText.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/registerToolkitWithDisplayText.ts)

This should be a local copy/adaptation of the stock `registerToolkit` path from [`node_modules/@effect/ai/src/McpServer.ts`](/Users/pooks/Dev/skygest-cloudflare/node_modules/@effect/ai/src/McpServer.ts), with only the success `CallToolResult` text-generation branch changed.

Success branch target behavior:

```ts
const structured =
  typeof result.encodedResult === "object" ? result.encodedResult : undefined

const text =
  structured &&
  typeof structured === "object" &&
  "_display" in structured &&
  typeof structured._display === "string"
    ? structured._display
    : JSON.stringify(result.encodedResult)
```

Then return:

```ts
new CallToolResult({
  isError: false,
  structuredContent: structured,
  content: [{ type: "text", text }]
})
```

Keep the failure branch unchanged.

### 5. Switch the router to the custom MCP registration path

Update [`src/mcp/Router.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Router.ts):

- replace `McpServer.toolkit(KnowledgeMcpToolkit)` with the local display-aware toolkit layer
- keep the rest of the layer assembly unchanged

Target effect:

- tools are still registered through `McpServer`
- only the success text payload path changes

### 6. Update local MCP consumers to MCP-specific schemas

Update any local MCP decode sites that currently use shared base schemas, including:

- [`src/ops/StagingOperatorClient.ts`](/Users/pooks/Dev/skygest-cloudflare/src/ops/StagingOperatorClient.ts)
- [`tests/mcp.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/mcp.test.ts)
- [`tests/staging-ops.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/staging-ops.test.ts)

Switch those decoders to the MCP-specific wrappers so they decode `structuredContent` successfully without depending on text JSON fallback.

### 7. Optional hardening in the MCP client helper

[`src/mcp/Client.ts`](/Users/pooks/Dev/skygest-cloudflare/src/mcp/Client.ts) can remain structurally the same, because it already prefers `structuredContent`.

Optional follow-up hardening:

- add a clearer error message when structured decoding fails and text is no longer JSON
- optionally add a strict helper for MCP success wrappers to make that expectation explicit in tests

This is not required for the first transport flip.

## Testing Plan

### A. Formatter unit tests

Create [`tests/mcp-fmt.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/mcp-fmt.test.ts).

Cover:

- empty-state outputs
- representative populated outputs for posts, links, experts, topics, explanations, and picks
- deterministic timestamps
- ID assignment
- ASCII-only output expectations for representative cases

Prefer substring assertions over brittle full snapshots unless the format stabilizes enough to snapshot intentionally.

### B. Transport unit tests

Add focused tests around the new registration helper or its text-selection helper.

At minimum verify:

- success with `_display` uses `_display` as text
- success without `_display` falls back to JSON text
- failure still uses JSON text

If practical, expose a tiny helper such as `successTextFromEncodedResult` for direct unit testing.

### C. MCP integration tests

Update [`tests/mcp.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/mcp.test.ts).

Required coverage:

- one post-list tool: `search_posts` or `get_recent_posts`
- one link tool: `get_post_links`
- one expert tool: `list_experts`
- one topic list tool: `list_topics`
- one topic detail tool: `get_topic`
- one topic envelope tool: `expand_topics`
- one explanation tool: `explain_post_topics`
- one editorial tool: `list_editorial_picks`

For at least one success tool, assert all of:

- `result.structuredContent` exists
- `result.structuredContent._display` exists
- `result.content[0].text === result.structuredContent._display`
- `decodeCallToolResultWith(McpWrapperSchema)(result)` succeeds

For at least one failure case, assert:

- `result.isError === true`
- `result.content[0].text` is still JSON-shaped

### D. Local consumer regression tests

Update [`tests/staging-ops.test.ts`](/Users/pooks/Dev/skygest-cloudflare/tests/staging-ops.test.ts) to ensure the staging client still works once text payloads are no longer JSON.

The important regression is:

- `StagingOperatorClient` continues to decode through `structuredContent` using the MCP wrapper schemas

### E. Manual and staging verification

Use the existing repo ops flow:

1. `bun run ops stage prepare --env <env> --base-url <url>`
2. `bun run ops stage smoke --env <env> --base-url <url>`
3. `bun run ops stage smoke-search --env <env> --base-url <url>`

Then run targeted MCP checks.

Verify structured content:

```bash
curl -s -X POST "$BASE_URL/mcp" \
  -H "x-skygest-operator-secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_posts","arguments":{"query":"solar"}}}' \
  | jq -r '.result.structuredContent._display'
```

Verify compact text payload:

```bash
curl -s -X POST "$BASE_URL/mcp" \
  -H "x-skygest-operator-secret: $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_posts","arguments":{"query":"solar"}}}' \
  | jq -r '.result.content[0].text'
```

Expected:

- output begins with compact display text such as `[P1]`
- output is not the full JSON object mirror

Also spot-check:

- `expand_topics`
- `explain_post_topics`
- `list_editorial_picks`

Do not assume the JSON-RPC response is array-shaped. The repo client accepts either a single object or an array, so manual verification should target the single-response shape first.

## Acceptance Criteria

- every MCP success tool returns a wrapper schema with `_display`
- every local MCP consumer is updated to decode those wrapper schemas
- success `structuredContent` preserves the full encoded object
- success `content[0].text` uses `_display` when present
- failure `content[0].text` remains JSON
- shared domain and HTTP schemas remain unchanged
- local MCP decoding and staging smoke flows still pass

## Follow-up Work

Potential later follow-ups:

- redesign failure-path text formatting
- add a stricter client helper that requires `structuredContent`
- add a dedicated MCP smoke command for display formatting
- upstream the display-aware registration hook if `@effect/ai` exposes one later
