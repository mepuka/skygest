import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { makeCachedMcpHandler } from "../src/mcp/Router";
import type { AccessIdentity } from "../src/auth/AuthService";
import { runMigrations } from "../src/db/migrate";
import {
  makeBiLayer,
  seedKnowledgeBase,
  withTempSqliteFile,
  workflowIdentity,
  readOnlyIdentity
} from "./support/runtime";

const MCP_URL = "https://test.local/mcp";

const makeJsonRpcRequest = (
  method: string,
  params?: unknown,
  id?: number | string | null,
  sessionId?: string
) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const body: Record<string, unknown> = { jsonrpc: "2.0", method };
  if (params !== undefined) body.params = params;
  if (id !== undefined) body.id = id;

  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
};

const makeInitRequest = (clientName: string, id: number = 1) =>
  makeJsonRpcRequest("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: clientName, version: "1.0" }
  }, id);

const makeInitializedNotify = (sessionId: string) =>
  makeJsonRpcRequest("notifications/initialized", undefined, undefined, sessionId);

const makeToolsListRequest = (sessionId?: string, id: number = 10) =>
  makeJsonRpcRequest("tools/list", {}, id, sessionId);

describe("MCP session proxy (makeCachedMcpHandler)", () => {
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

  it.live("serves tool calls after client initializes", () =>
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

        // Initialize
        const initResp = await handler(
          makeInitRequest("test-client"),
          env,
          workflowIdentity
        );
        expect(initResp.status).toBe(200);

        const sessionId = initResp.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();

        // Send initialized notification
        await handler(
          makeInitializedNotify(sessionId!),
          env,
          workflowIdentity
        );

        // Tool call with session ID should work
        const toolResp = await handler(
          makeToolsListRequest(sessionId!),
          env,
          workflowIdentity
        );
        expect(toolResp.status).toBe(200);
        const toolBody = await toolResp.json() as { result: { tools: unknown[] } };
        expect(toolBody.result.tools.length).toBeGreaterThan(0);
      })
    )
  );

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
        // Stale session ID from a previous isolate — proxy creates warm session
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

        // New env object — handler rebuilds, proxy creates warm session transparently
        const env2 = { marker: "env2" };
        const coldResp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
        expect(coldResp.status).toBe(200);
      })
    )
  );

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

        // Read-only profile has no explicit session — proxy creates warm session
        const readOnlyResp = await handler(makeToolsListRequest(undefined), env, readOnlyIdentity);
        expect(readOnlyResp.status).toBe(200);

        // Verify profile isolation: workflow sees curate_post, read-only does not
        const workflowTools = await handler(makeToolsListRequest(workflowSession), env, workflowIdentity);
        const workflowBody = await workflowTools.json() as { result: { tools: Array<{ name: string }> } };
        const workflowToolNames = workflowBody.result.tools.map(t => t.name);
        expect(workflowToolNames).toContain("curate_post");

        const readOnlyTools = await handler(makeToolsListRequest(undefined), env, readOnlyIdentity);
        const readOnlyBody = await readOnlyTools.json() as { result: { tools: Array<{ name: string }> } };
        const readOnlyToolNames = readOnlyBody.result.tools.map(t => t.name);
        expect(readOnlyToolNames).not.toContain("curate_post");
      })
    )
  );

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
        const initResp = await handler(makeInitRequest("real-client"), env1, workflowIdentity);
        expect(initResp.status).toBe(200);
        const sessionId = initResp.headers.get("mcp-session-id")!;
        await handler(makeInitializedNotify(sessionId), env1, workflowIdentity);
        const okResp = await handler(makeToolsListRequest(sessionId), env1, workflowIdentity);
        expect(okResp.status).toBe(200);
        // Simulate isolate eviction
        const env2 = { marker: "env2" };
        const recoveredResp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
        expect(recoveredResp.status).toBe(200);
        const followUp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
        expect(followUp.status).toBe(200);
      })
    )
  );
});
