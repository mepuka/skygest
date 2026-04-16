# MCP Session Proxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the MCP server transparently survive CF Worker isolate eviction so clients never see session errors — working around Claude Code's known inability to re-initialize ([#9608](https://github.com/anthropics/claude-code/issues/9608), [#17412](https://github.com/anthropics/claude-code/issues/17412), [#27142](https://github.com/anthropics/claude-code/issues/27142)).

**Architecture:** Session proxy. Maintain one "warm" session per capability profile in the handler cache. On every non-initialize request, replace the client's `mcp-session-id` header with the cached warm session before forwarding. If no warm session exists (first request after handler build), create one on-demand. The client's session ID becomes irrelevant — we always substitute.

**Tech Stack:** Effect 4, Cloudflare Workers, MCP Streamable HTTP transport

**Assumptions:**
- This MCP server has exactly one client per profile (Claude Code). Multi-client session isolation is not a concern. If this changes, the proxy would need per-client warm sessions keyed by a client identifier.
- The server does not gate behavior on the client's negotiated protocol version or capabilities. Effect's McpServer negotiates the latest supported version regardless of what the client requests, and capabilities are server-announced. A synthetic `initialize` with default params produces identical server behavior to a real client `initialize`.

---

## Background: How Effect's McpServer manages sessions

**Sessions are a plain `Map()` inside `McpServer.run()` (McpServer.js:193).** No pluggable storage, no config options.

**Session keys:** `crypto.randomUUID()` strings (McpServer.js:733).

**Session values:** The client's `initialize` params (protocol version, capabilities, clientInfo) (McpServer.js:734).

**Session lifetime:** Sessions persist in the Map until the isolate dies. There is no expiration or TTL on `clientSessions`. (The 10s `RcMap` TTL at line 224 is on a separate internal fiber map, not the session Map.)

**Session lookup (McpServer.js:856-862):**
```js
const getInitializedClient = (sessions, clientId, headers) => {
  const sessionId = headers["mcp-session-id"];
  if (sessionId === undefined) {
    return sessions.get(String(clientId)); // "0", "1"... never matches UUID key
  }
  return sessions.get(sessionId);
};
```

Both no-header and stale-header produce `undefined` → `Effect.die(new Error("Mcp-Session-Id does not exist"))` (line 234). These cases are indistinguishable to our code.

**Initialize handler (McpServer.js:730-741):** Creates UUID, stores `clientSessions.set(sessionId, params)`, attaches `mcp-session-id` response header.

**Our current handling (`src/mcp/Router.ts`):** `isSessionMissError` detects the Die defect. `sessionMissTo404` consumes the response body, checks for session miss, converts to HTTP 404. `makeCachedMcpHandler` caches one `McpWebHandler` per capability profile, rebuilds when env key changes.

---

## Design

### Cache entry

Each entry in `makeCachedMcpHandler`'s cache gains a `warmSessionId` field:

```ts
const cache = new Map<string, {
  readonly envKey: string;
  readonly webHandler: McpWebHandler;
  warmSessionId: string | null;
}>();
```

`warmSessionId` starts as `null` on handler build.

### Request flow

```
incoming request
  │
  ├─ is `initialize`?
  │   yes → forward as-is → capture session ID from response → store as warmSessionId → return
  │
  ├─ have warmSessionId?
  │   yes → clone request → substitute mcp-session-id header → forward → return
  │          (no session-miss check — warm sessions don't expire, only die with isolate)
  │
  └─ no warmSessionId (first non-init request after build)
      → clone original request (body is consumed once, need it for replay)
      → createWarmSession (synthetic initialize + notifications/initialized)
      → if failed → return 404
      → store warmSessionId
      → build new request from cloned body with warm session header → forward → return
```

Key points:
- **No retry loop.** `createWarmSession` is called at most once. If it fails, return 404.
- **No session-miss detection on forwarded responses.** Sessions don't expire (no TTL on `clientSessions`). The only way a warm session becomes invalid is handler rebuild, which resets `warmSessionId` to `null`.
- **Request body cloning.** On the no-warm-session path, the original request body is needed for replay after warm session creation. Clone the request before consuming it. Use `Request.clone()` which Bun supports for this purpose.
- **Initialize requests bypass the proxy.** They go straight through to Effect's handler. The response's `mcp-session-id` becomes the new warm session. This means if Claude Code ever does re-initialize, we pick it up cleanly.

### What gets removed

- `sessionMissTo404` — replaced by the proxy. Dead code.
- The `SESSION_MISS_MESSAGE` constant and the response-body parsing in `sessionMissTo404` — no longer needed since we don't check responses for session miss post-forwarding.
- Keep `isSessionMissError` — useful for the `createWarmSession` fallback path if we ever need it for diagnostics.

Actually, we still need `isSessionMissError` + `checkSessionMiss` for one case: if `createWarmSession` itself returns a session-miss (should be impossible, but defense). Keep it.

---

### Task 1: Write failing test for proxy recovery

**Files:**
- Modify: `tests/mcp-session.test.ts`

**Step 1: Add the test**

```ts
it.live("transparently proxies stale session through warm session after isolate recycle", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env1 = { marker: "env1" };

      // Client initializes normally
      const initResp = await handler(makeInitRequest("real-client"), env1, workflowIdentity);
      expect(initResp.status).toBe(200);
      const sessionId = initResp.headers.get("mcp-session-id")!;
      await handler(makeInitializedNotify(sessionId), env1, workflowIdentity);

      // Session works
      const okResp = await handler(makeToolsListRequest(sessionId), env1, workflowIdentity);
      expect(okResp.status).toBe(200);

      // Simulate isolate eviction — env changes, handler rebuilds
      const env2 = { marker: "env2" };

      // Client sends stale session — proxy should auto-recover
      const recoveredResp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
      expect(recoveredResp.status).toBe(200);

      // Subsequent calls should also work without per-request overhead
      const followUp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
      expect(followUp.status).toBe(200);
    })
  )
);
```

**Step 2: Run to verify failure**

Run: `bun run test -- tests/mcp-session.test.ts`
Expected: FAIL — gets 404 on the `env2` call.

**Step 3: Commit**

```bash
git add tests/mcp-session.test.ts
git commit -m "test(mcp): add failing test for session proxy recovery"
```

---

### Task 2: Implement session proxy in `makeCachedMcpHandler`

**Files:**
- Modify: `src/mcp/Router.ts`

**Step 1: Add helper functions**

Add these above `makeCachedMcpHandler`:

```ts
/** Peek at a request body to check if it's a JSON-RPC `initialize` call.
 *  Takes a **cloned** request (caller must clone before passing). */
const isInitializeRequest = async (request: Request): Promise<boolean> => {
  try {
    const body = await request.json() as Record<string, unknown>;
    return body.method === "initialize";
  } catch {
    return false;
  }
};

/** Build a new Request with the mcp-session-id header replaced.
 *  Passes through the body as a ReadableStream without consuming it. */
const substituteSessionHeader = (request: Request, sessionId: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("mcp-session-id", sessionId);
  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    // @ts-expect-error — Bun supports duplex on Request constructor
    duplex: "half"
  });
};

/** Create a warm session by sending a synthetic initialize + initialized notification.
 *  Returns the session ID on success, null on failure. */
const createWarmSession = async (
  webHandler: McpWebHandler,
  url: string,
  context: ServiceMap.ServiceMap<OperatorIdentity>
): Promise<string | null> => {
  const initRequest = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      id: `_warm_${Date.now()}`,
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "skygest-session-proxy", version: "1.0" }
      }
    })
  });

  const initResponse = await webHandler.handler(initRequest, context);
  if (!initResponse.ok) return null;

  const sessionId = initResponse.headers.get("mcp-session-id");
  if (!sessionId) return null;

  // MCP spec requires notifications/initialized after initialize
  const notifyRequest = new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-session-id": sessionId
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
  });
  await webHandler.handler(notifyRequest, context);

  return sessionId;
};

const sessionExpiredResponse = () =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session expired. Please re-initialize." },
      id: null
    }),
    { status: 404, headers: { "content-type": "application/json" } }
  );
```

**Step 2: Rewrite `makeCachedMcpHandler`**

Replace the existing `makeCachedMcpHandler` (lines 178-208) with:

```ts
/** @internal Exported for integration testing of session handling */
export const makeCachedMcpHandler = <Env extends object>(
  buildLayer: (env: Env) => QueryLayer,
  envKey: (env: Env) => string = () => "default"
) => {
  const cache = new Map<string, {
    readonly envKey: string;
    readonly webHandler: McpWebHandler;
    warmSessionId: string | null;
  }>();

  return async (request: Request, env: Env, identity: AccessIdentity): Promise<Response> => {
    const profile = profileForIdentity(identity);
    const cacheKey = profile;
    const currentEnvKey = envKey(env);

    let entry = cache.get(cacheKey);
    if (!entry || entry.envKey !== currentEnvKey) {
      if (entry) {
        await entry.webHandler.dispose();
      }
      entry = {
        envKey: currentEnvKey,
        webHandler: HttpLayerRouter.toWebHandler(
          makeMcpLayer(buildLayer(env), profile)
        ) as unknown as McpWebHandler,
        warmSessionId: null
      };
      cache.set(cacheKey, entry);
    }

    const context = operatorIdentityContext(identity);

    // --- Initialize requests: pass through, capture warm session ---
    const peekClone = request.clone();
    if (await isInitializeRequest(peekClone)) {
      const response = await entry.webHandler.handler(request, context);
      if (response.ok) {
        const newSessionId = response.headers.get("mcp-session-id");
        if (newSessionId) {
          entry.warmSessionId = newSessionId;
        }
      }
      return response;
    }

    // --- Non-initialize: proxy through warm session ---

    if (entry.warmSessionId) {
      // Have warm session — substitute header and forward
      const proxied = substituteSessionHeader(request, entry.warmSessionId);
      return entry.webHandler.handler(proxied, context);
    }

    // No warm session — create one, then replay the original request.
    // Clone first: createWarmSession doesn't touch `request`, but the
    // replay below needs the body which is a one-shot ReadableStream.
    const replaySource = request.clone();

    const warmSessionId = await createWarmSession(
      entry.webHandler,
      request.url,
      context
    );

    if (!warmSessionId) {
      return sessionExpiredResponse();
    }

    entry.warmSessionId = warmSessionId;

    // Replay original request with the new warm session
    const replayed = substituteSessionHeader(replaySource, warmSessionId);
    return entry.webHandler.handler(replayed, context);
  };
};
```

**Step 3: Remove `sessionMissTo404`**

Delete the `sessionMissTo404` function (lines 153-175 in the original file). It is no longer called. Keep `isSessionMissError` and the `SESSION_MISS_MESSAGE` constant — they are still useful for diagnostics and could be used if we later add logging on warm-session creation.

Actually, `isSessionMissError` is no longer called by any code path in the new flow. Remove it along with `sessionMissTo404` and `SESSION_MISS_MESSAGE`. If we need diagnostics later, we can add logging directly in `createWarmSession`.

**Step 4: Run tests**

Run: `bun run test -- tests/mcp-session.test.ts`
Expected: The new proxy recovery test passes. Some existing tests now fail because they expect 404 (will fix in Task 3).

**Step 5: Commit**

```bash
git add src/mcp/Router.ts
git commit -m "feat(mcp): session proxy — warm session substitution for isolate resilience"
```

---

### Task 3: Update all existing tests for proxy behavior

**Files:**
- Modify: `tests/mcp-session.test.ts`

Four existing tests need updates. All cases that previously returned 404 now return 200 because the proxy creates or substitutes warm sessions.

**Step 1: Update "returns 404 when no session exists (cold start)" → "creates warm session on cold start"**

Previously at line 50-74. The request has no `mcp-session-id` header. The proxy creates a warm session and proxies the request.

```ts
it.live("creates warm session on cold start (no prior initialize)", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env = { marker: "env1" };
      const response = await handler(
        makeToolsListRequest(undefined),
        env,
        workflowIdentity
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { result: { tools: unknown[] } };
      expect(body.result.tools.length).toBeGreaterThan(0);
    })
  )
);
```

**Step 2: Update "returns 404 for stale session ID" → "proxies stale session ID"**

Previously at line 121-144.

```ts
it.live("proxies stale session ID through warm session (isolate recycle)", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env = { marker: "env1" };
      const response = await handler(
        makeToolsListRequest("stale-uuid-from-previous-isolate"),
        env,
        workflowIdentity
      );

      expect(response.status).toBe(200);
      const body = await response.json() as { result: { tools: unknown[] } };
      expect(body.result.tools.length).toBeGreaterThan(0);
    })
  )
);
```

**Step 3: Update "returns 404 after handler rebuild" → "proxies through new warm session after rebuild"**

Previously at line 146-178.

```ts
it.live("proxies through new warm session after handler rebuild (env change)", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env1 = { marker: "env1" };

      // Initialize and verify working
      const initResp = await handler(makeInitRequest("test"), env1, workflowIdentity);
      const sessionId = initResp.headers.get("mcp-session-id")!;
      await handler(makeInitializedNotify(sessionId), env1, workflowIdentity);

      const okResp = await handler(makeToolsListRequest(sessionId), env1, workflowIdentity);
      expect(okResp.status).toBe(200);

      // New env — handler rebuilds, old session is stale
      const env2 = { marker: "env2" };
      const recoveredResp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
      expect(recoveredResp.status).toBe(200);
    })
  )
);
```

**Step 4: Update "maintains separate sessions per capability profile"**

Previously at line 180-219. Line 203-205 expects 404 for read-only with no session. Under the proxy, this becomes 200.

```ts
it.live("maintains separate warm sessions per capability profile", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env = { marker: "env1" };

      // Initialize as workflow-write profile
      const initResp = await handler(makeInitRequest("workflow-client"), env, workflowIdentity);
      const workflowSession = initResp.headers.get("mcp-session-id")!;
      await handler(makeInitializedNotify(workflowSession), env, workflowIdentity);

      // Workflow profile works
      const workflowResp = await handler(makeToolsListRequest(workflowSession), env, workflowIdentity);
      expect(workflowResp.status).toBe(200);

      // Read-only profile has NO session — proxy creates warm session automatically
      const readOnlyResp = await handler(makeToolsListRequest(undefined), env, readOnlyIdentity);
      expect(readOnlyResp.status).toBe(200);

      // Read-only sees fewer tools than workflow
      const workflowTools = (await (await handler(
        makeToolsListRequest(workflowSession), env, workflowIdentity
      )).json() as { result: { tools: { name: string }[] } }).result.tools;

      const readOnlyTools = (await readOnlyResp.json() as { result: { tools: { name: string }[] } }).result.tools;

      // Workflow profile has write tools (curate_post, start_enrichment, etc.)
      // Read-only does not
      const workflowToolNames = workflowTools.map(t => t.name);
      const readOnlyToolNames = readOnlyTools.map(t => t.name);
      expect(workflowToolNames).toContain("curate_post");
      expect(readOnlyToolNames).not.toContain("curate_post");
    })
  )
);
```

**Step 5: Run full test suite**

Run: `bun run test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add tests/mcp-session.test.ts
git commit -m "test(mcp): update all session tests for proxy behavior"
```

---

### Task 4: Add test — real initialize replaces warm session

Verify that when a real client `initialize` arrives, it replaces the synthetic warm session. This is important for correctness — if Claude Code ever does reconnect properly, we should use its real session.

**Files:**
- Modify: `tests/mcp-session.test.ts`

**Step 1: Write the test**

```ts
it.live("real client initialize replaces synthetic warm session", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      await Effect.runPromise(
        seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
      );

      const env = { marker: "env1" };

      // First request is tools/list with no session — triggers synthetic warm session
      const coldResp = await handler(makeToolsListRequest(undefined), env, workflowIdentity);
      expect(coldResp.status).toBe(200);

      // Now client sends a real initialize
      const initResp = await handler(makeInitRequest("real-client"), env, workflowIdentity);
      expect(initResp.status).toBe(200);
      const realSessionId = initResp.headers.get("mcp-session-id")!;
      await handler(makeInitializedNotify(realSessionId), env, workflowIdentity);

      // Subsequent calls with any session ID should work — warm session was updated
      const resp1 = await handler(makeToolsListRequest(realSessionId), env, workflowIdentity);
      expect(resp1.status).toBe(200);

      const resp2 = await handler(makeToolsListRequest("totally-different-id"), env, workflowIdentity);
      expect(resp2.status).toBe(200);

      const resp3 = await handler(makeToolsListRequest(undefined), env, workflowIdentity);
      expect(resp3.status).toBe(200);
    })
  )
);
```

**Step 2: Run test**

Run: `bun run test -- tests/mcp-session.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/mcp-session.test.ts
git commit -m "test(mcp): verify real initialize replaces synthetic warm session"
```

---

### Task 5: Add test — no infinite loop on warm session creation failure

Verify the handler completes promptly even if the underlying layer is in a bad state.

**Files:**
- Modify: `tests/mcp-session.test.ts`

**Step 1: Write the test**

```ts
it.live("completes promptly when warm session creation fails", () =>
  Effect.promise(() =>
    withTempSqliteFile(async (filename) => {
      const handler = makeCachedMcpHandler(
        (env: { marker: string }) => makeBiLayer({ filename }),
        (env) => env.marker
      );

      // Intentionally skip seedKnowledgeBase — the layer may still
      // initialize, but this proves the handler doesn't hang.

      const env = { marker: "env1" };
      const start = Date.now();
      const response = await handler(
        makeToolsListRequest("stale-session"),
        env,
        workflowIdentity
      );
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5000);
      // Either warm session succeeds (200) or fails gracefully (404)
      expect([200, 404]).toContain(response.status);
    })
  )
);
```

**Step 2: Run test**

Run: `bun run test -- tests/mcp-session.test.ts`
Expected: PASS (likely 200 since the layer initializes even without seed data)

**Step 3: Commit**

```bash
git add tests/mcp-session.test.ts
git commit -m "test(mcp): verify no hang on warm session creation"
```

---

### Task 6: Clean up dead code

**Files:**
- Modify: `src/mcp/Router.ts`

**Step 1: Remove dead functions**

Delete `SESSION_MISS_MESSAGE`, `isSessionMissError`, and `sessionMissTo404`. These are no longer called by any code path. The proxy handles all session management via warm sessions.

If any of these are exported (check `@internal` tags), verify no other file imports them. `isSessionMissError` is not exported. `sessionMissTo404` is not exported. `makeCachedMcpHandler` is exported (used by tests) — keep it.

**Step 2: Run full test suite**

Run: `bun run test`
Expected: All pass. No other file imports the removed functions.

**Step 3: Commit**

```bash
git add src/mcp/Router.ts
git commit -m "refactor(mcp): remove dead sessionMissTo404 — replaced by session proxy"
```

---

### Task 7: Deploy and verify on staging

**Step 1: Push and deploy the agent worker**

```bash
git push origin main
bunx wrangler deploy --config wrangler.agent.toml --env staging
```

**Step 2: Verify session resilience**

1. Call an MCP tool via Claude Code staging — should work.
2. Redeploy the agent worker (kills isolate): `bunx wrangler deploy --config wrangler.agent.toml --env staging`
3. Immediately call an MCP tool again — should work without 404 or restart.
4. Call multiple tools in sequence — should all work (warm session reused).

**Step 3: Update Linear**

File issue or add to existing tracking.

---

## Edge cases

| Scenario | Behavior | Why |
|---|---|---|
| Client sends `initialize` (first connect) | Pass through, capture as warm session | Real client params preserved |
| Client sends `tools/list` with no header (cold start) | Create warm session, proxy through it | No-header indistinguishable from stale |
| Client sends `tools/list` with stale header (isolate eviction) | Substitute warm session, forward | Core fix |
| Client sends `tools/list` with valid warm session header | Substitute (same ID), forward | No-op substitution, correct behavior |
| Warm session creation fails (broken layer) | Return 404, no retry | Single attempt, no loop |
| Client sends `initialize` after synthetic warm session | Replace warm session with real one | Real params take precedence |
| Multiple profiles (read-only + workflow) | Each has independent warm session | Separate cache entries per profile |
| Handler rebuilds (env change) | Warm session reset to null, created on next request | Clean slate |

## Files summary

| File | Change |
|---|---|
| `src/mcp/Router.ts` | Add `isInitializeRequest`, `substituteSessionHeader`, `createWarmSession`, `sessionExpiredResponse`. Add `warmSessionId` to cache entries. Rewrite `makeCachedMcpHandler` with proxy logic. Remove `SESSION_MISS_MESSAGE`, `isSessionMissError`, `sessionMissTo404`. |
| `tests/mcp-session.test.ts` | Update 4 existing tests (404 → 200 with proxy). Add 3 new tests (proxy recovery, real init replaces warm, no-hang guard). |
