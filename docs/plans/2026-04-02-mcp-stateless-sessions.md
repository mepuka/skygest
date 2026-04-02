# MCP Stateless Session Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the MCP server work on stateless Cloudflare Workers by converting Effect 4's session-miss errors into spec-correct HTTP 404 responses that trigger client re-initialization.

**Architecture:** Don't manage sessions ourselves at all. Let Effect track its own sessions in-memory (supporting multiple concurrent clients per profile). When an isolate recycles and sessions are lost, detect the session error in the response and convert it to HTTP 404. Per MCP spec, clients MUST re-initialize on 404. No session caching, no injection, no synthetic initializes.

**Tech Stack:** Effect 4, Cloudflare Workers, MCP Streamable HTTP transport (2025-03-26 spec)

**Linear:** SKY-135

---

## Design

### The problem

Effect 4's `McpServer.layerHttp` stores sessions in an in-memory `Map`. When a Cloudflare Worker isolate recycles (cold start), this map is empty. Clients send their old `Mcp-Session-Id` header, Effect can't find it, and calls `Effect.die(new Error("Mcp-Session-Id does not exist"))`.

### What actually happens on session miss

Verified via curl: the die gets converted by Effect's HTTP adapter into an **HTTP 200** response with a JSON-RPC error body:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "_tag": "Cause",
    "code": 0,
    "message": "[{\"_tag\":\"Die\",\"defect\":{\"message\":\"Mcp-Session-Id does not exist\",...}}]",
    "data": [{"_tag": "Die", "defect": {"message": "Mcp-Session-Id does not exist"}}]
  }
}
```

This is wrong per MCP spec — it should be HTTP 404 so clients know to re-initialize.

### The fix

Intercept responses in `makeCachedMcpHandler`. After Effect's handler returns:

1. If the response body contains the session-miss error signature → return HTTP 404
2. Otherwise → return the response as-is

This is purely additive — we wrap the existing handler's response, don't touch its input, don't manage sessions, don't inject headers. Effect continues to manage its own session map normally. Multiple clients per profile work because Effect maintains per-session entries internally.

### What happens on cold start

1. Client sends `tools/call` with stale `Mcp-Session-Id`
2. Effect can't find session → returns JSON-RPC error with "Mcp-Session-Id does not exist"
3. Our wrapper detects this → returns HTTP 404
4. Client (per MCP spec) re-initializes → sends `initialize` request
5. Effect creates a new session → returns 200 with fresh `Mcp-Session-Id`
6. Client sends `initialized` notification → proceeds normally

### What we don't do

- No session ID caching (Effect owns session state)
- No session ID injection (client sends its own)
- No synthetic initializes (client handshake is always real)
- No global session variables (no P1 multi-client collision)
- No try/catch on handler exceptions (no P2 missed catch path)

---

## Task 1: Response Wrapper in `makeCachedMcpHandler`

**Files:**
- Modify: `src/mcp/Router.ts`

**Step 1: Add session-miss detection helper**

```ts
const MCP_SESSION_MISS = "Mcp-Session-Id does not exist";

const isSessionMissResponse = async (response: Response): Promise<{
  isMiss: boolean;
  body: string;
}> => {
  const body = await response.text();
  return {
    isMiss: body.includes(MCP_SESSION_MISS),
    body
  };
};
```

**Step 2: Wrap the handler return in `makeCachedMcpHandler`**

Replace the final line of the handler function:

```ts
// Before:
return entry.webHandler.handler(request, operatorIdentityContext(identity));

// After:
const response = await entry.webHandler.handler(request, operatorIdentityContext(identity));

// Detect session-miss errors from Effect's MCP server and convert to
// HTTP 404 per MCP spec. Clients MUST re-initialize on 404.
const { isMiss, body } = await isSessionMissResponse(response);
if (isMiss) {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session expired. Please re-initialize." },
      id: null
    }),
    { status: 404, headers: { "content-type": "application/json" } }
  );
}

// Return original response with body re-attached (we consumed it for inspection)
return new Response(body, {
  status: response.status,
  headers: response.headers
});
```

**Step 3: Run tsc**

```bash
bunx tsc --noEmit
```

**Step 4: Run existing tests**

```bash
bun run test tests/mcp.test.ts
```

Existing tests use `createPersistentMcpHandler` (always initialized) — should pass unchanged.

**Step 5: Commit**

```bash
git commit -m "fix(mcp): convert session-miss to HTTP 404 for stateless Workers (SKY-135)"
```

---

## Task 2: Integration Tests for `makeCachedMcpHandler`

**Files:**
- Create: `tests/mcp-session.test.ts`

Tests exercise the real `makeCachedMcpHandler` production path.

**Setup:** Create a test version of `makeCachedMcpHandler` using the test query layer (same pattern as `makeImportTestLayer` in import tests).

**Test 1: Cold start returns 404 for tool call without prior initialize**

```ts
it("returns 404 when no session exists (cold start)", async () => {
  const handler = makeTestCachedHandler();
  const response = await handler(
    makeJsonRpcRequest("tools/list", {}, 1),
    env, identity
  );
  expect(response.status).toBe(404);
  const body = await response.json();
  expect(body.error.message).toContain("re-initialize");
});
```

**Test 2: Initialize → tool call succeeds**

```ts
it("serves tool calls after client initializes", async () => {
  const handler = makeTestCachedHandler();

  // Initialize
  const initResp = await handler(
    makeJsonRpcRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0" }
    }, 1),
    env, identity
  );
  expect(initResp.status).toBe(200);
  const sessionId = initResp.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();

  // Send initialized notification
  await handler(
    makeJsonRpcRequest("notifications/initialized", undefined, undefined, sessionId!),
    env, identity
  );

  // Tool call with session ID should work
  const toolResp = await handler(
    makeJsonRpcRequest("tools/list", {}, 2, sessionId!),
    env, identity
  );
  expect(toolResp.status).toBe(200);
});
```

**Test 3: Multiple clients on same profile have independent sessions**

```ts
it("supports multiple clients on same profile", async () => {
  const handler = makeTestCachedHandler();

  // Client A initializes
  const respA = await handler(makeInitRequest("client-a"), env, identity);
  const sessionA = respA.headers.get("mcp-session-id")!;
  await handler(makeInitializedNotify(sessionA), env, identity);

  // Client B initializes (same profile)
  const respB = await handler(makeInitRequest("client-b"), env, identity);
  const sessionB = respB.headers.get("mcp-session-id")!;
  await handler(makeInitializedNotify(sessionB), env, identity);

  // Both sessions should work independently
  expect(sessionA).not.toBe(sessionB);
  const toolRespA = await handler(makeToolsListRequest(sessionA), env, identity);
  const toolRespB = await handler(makeToolsListRequest(sessionB), env, identity);
  expect(toolRespA.status).toBe(200);
  expect(toolRespB.status).toBe(200);
});
```

**Test 4: Handler rebuild (env change) loses sessions → 404**

```ts
it("returns 404 after handler rebuild (env change)", async () => {
  const handler = makeTestCachedHandler();

  // Initialize and verify working
  const initResp = await handler(makeInitRequest("test"), env1, identity);
  const sessionId = initResp.headers.get("mcp-session-id")!;
  await handler(makeInitializedNotify(sessionId), env1, identity);
  const okResp = await handler(makeToolsListRequest(sessionId), env1, identity);
  expect(okResp.status).toBe(200);

  // New env object — handler rebuilds, sessions lost
  const env2 = { ...env1 };
  const coldResp = await handler(makeToolsListRequest(sessionId), env2, identity);
  expect(coldResp.status).toBe(404);

  // Re-initialize works
  const reInitResp = await handler(makeInitRequest("test"), env2, identity);
  expect(reInitResp.status).toBe(200);
});
```

**Test 5: Stale session ID from different handler returns 404**

```ts
it("returns 404 for stale session ID (simulating isolate recycle)", async () => {
  const handler = makeTestCachedHandler();

  // Simulate a stale session ID from a previous isolate
  const staleResp = await handler(
    makeToolsListRequest("stale-uuid-from-previous-isolate"),
    env, identity
  );
  expect(staleResp.status).toBe(404);
});
```

**Step 5: Run all tests**

```bash
bun run test
```

**Step 6: Commit**

```bash
git commit -m "test(mcp): integration tests for stateless cached handler (SKY-135)"
```

---

## Task 3: Deploy and Verify

**Step 1: Deploy agent worker to staging**

```bash
export $(grep -v '^#' .env.staging | xargs)
bunx wrangler deploy --config wrangler.agent.toml --env staging
```

**Step 2: Test cold-start behavior via curl**

```bash
# Tool call without initialize → should get 404
curl -s -o /dev/null -w "%{http_code}" -X POST "$SKYGEST_STAGING_BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SKYGEST_OPERATOR_SECRET" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 404

# Initialize → should get 200 with mcp-session-id
curl -s -D - -X POST "$SKYGEST_STAGING_BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SKYGEST_OPERATOR_SECRET" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":2}' | head -10
# Expected: 200, mcp-session-id header present
```

**Step 3: Reconnect Claude Code MCP**

```
/mcp reconnect skygest-staging
```

Call `search_posts`, `list_topics`, `list_curation_candidates` to verify full tool access.

---

## Verification Checklist

1. `bunx tsc --noEmit` — zero errors
2. `bun run test` — all tests pass (existing + 5 new session tests)
3. Cold start: tool call without initialize returns HTTP 404 (not 200 with JSON-RPC error)
4. Client initialize → tool calls work with returned session ID
5. Multiple clients on same profile: independent sessions, no collision
6. Handler rebuild (env change): old sessions return 404, re-initialize works
7. Stale session ID: returns 404
8. Claude Code connects and uses all MCP tools on staging after reconnect
9. REST API (`/api/*`) unaffected
