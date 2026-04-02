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

describe("MCP stateless session handling (makeCachedMcpHandler)", () => {
  it.live("returns 404 when no session exists (cold start)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          () => makeBiLayer({ filename })
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

        expect(response.status).toBe(404);
        const body = await response.json() as { error: { message: string } };
        expect(body.error.message).toContain("re-initialize");
      })
    )
  );

  it.live("serves tool calls after client initializes", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          () => makeBiLayer({ filename })
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

  it.live("returns 404 for stale session ID (simulating isolate recycle)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          () => makeBiLayer({ filename })
        );

        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
        );

        const env = { marker: "env1" };
        // Stale session ID from a previous isolate
        const response = await handler(
          makeToolsListRequest("stale-uuid-from-previous-isolate"),
          env,
          workflowIdentity
        );

        expect(response.status).toBe(404);
      })
    )
  );

  it.live("returns 404 after handler rebuild (env change)", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          () => makeBiLayer({ filename })
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

        // New env object — handler rebuilds, sessions lost
        const env2 = { marker: "env2" };
        const coldResp = await handler(makeToolsListRequest(sessionId), env2, workflowIdentity);
        expect(coldResp.status).toBe(404);

        // Re-initialize with new env works
        const reInitResp = await handler(makeInitRequest("test"), env2, workflowIdentity);
        expect(reInitResp.status).toBe(200);
      })
    )
  );

  it.live("maintains separate sessions per capability profile", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          () => makeBiLayer({ filename })
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

        // Read-only profile has NO session — should 404
        const readOnlyResp = await handler(makeToolsListRequest(undefined), env, readOnlyIdentity);
        expect(readOnlyResp.status).toBe(404);

        // Initialize read-only profile separately
        const readOnlyInit = await handler(makeInitRequest("readonly-client"), env, readOnlyIdentity);
        const readOnlySession = readOnlyInit.headers.get("mcp-session-id")!;
        await handler(makeInitializedNotify(readOnlySession), env, readOnlyIdentity);

        // Both profiles work independently
        const workflowResp2 = await handler(makeToolsListRequest(workflowSession), env, workflowIdentity);
        const readOnlyResp2 = await handler(makeToolsListRequest(readOnlySession), env, readOnlyIdentity);
        expect(workflowResp2.status).toBe(200);
        expect(readOnlyResp2.status).toBe(200);
      })
    )
  );
});
