import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import {
  makeCachedMcpHandler,
  type McpInitializePayload,
  type McpSessionStore
} from "../src/mcp/Router";
import { encodeJsonString } from "../src/platform/Json";
import {
  makeBiLayer,
  seedKnowledgeBase,
  withDataRefQueryService,
  withTempSqliteFile,
  workflowIdentity,
  readOnlyIdentity
} from "./support/runtime";

const MCP_URL = "https://test.local/mcp";

type TestEnv = {
  readonly marker: string;
};

const makeInitializePayload = (clientName: string): McpInitializePayload => ({
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: clientName, version: "1.0" }
});

const makeJsonRpcRequest = (
  method: string,
  params?: unknown,
  id?: number | string | null,
  sessionId?: string
) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

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
  makeJsonRpcRequest("initialize", makeInitializePayload(clientName), id);

const makeInitializedNotify = (sessionId: string) =>
  makeJsonRpcRequest("notifications/initialized", undefined, undefined, sessionId);

const makeToolsListRequest = (sessionId?: string, id: number = 10) =>
  makeJsonRpcRequest("tools/list", {}, id, sessionId);

const makeMemorySessionStore = <Env extends object>() => {
  const store = new Map<string, { initializePayload: McpInitializePayload }>();
  const sessionStore: McpSessionStore<Env> = {
    load: async (_env, sessionId) => store.get(sessionId) ?? null,
    save: async (_env, sessionId, session) => {
      store.set(sessionId, session);
    }
  };

  return { store, sessionStore };
};

const unusedBuildLayer = () =>
  null as unknown as ReturnType<typeof makeBiLayer>;

const makeProxyAwareWebHandler = (mode: "healthy" | "broken-init" = "healthy") =>
  (env: TestEnv) => {
    const sessions = new Map<string, McpInitializePayload>();
    let nextSessionId = 1;

    return {
      handler: async (request: Request) => {
        const body = await request.json() as Record<string, unknown>;
        const method = typeof body.method === "string" ? body.method : null;

        if (method === "initialize") {
          if (mode === "broken-init") {
            return new Response(
              encodeJsonString({
                jsonrpc: "2.0",
                id: body.id ?? null,
                result: { ok: true }
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" }
              }
            );
          }

          const payload = body.params as McpInitializePayload;
          const sessionId = `${env.marker}-backend-${nextSessionId++}`;
          sessions.set(sessionId, payload);

          return new Response(
            encodeJsonString({
              jsonrpc: "2.0",
              id: body.id ?? null,
              result: { ok: true }
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "mcp-session-id": sessionId
              }
            }
          );
        }

        if (method === "notifications/initialized") {
          return new Response("", { status: 200 });
        }

        const sessionId = request.headers.get("mcp-session-id");
        const payload = sessionId === null ? null : sessions.get(sessionId) ?? null;
        if (payload === null) {
          return new Response(
            encodeJsonString({
              jsonrpc: "2.0",
              id: body.id ?? null,
              error: { code: -32000, message: "missing session" }
            }),
            {
              status: 404,
              headers: { "content-type": "application/json" }
            }
          );
        }

        return new Response(
          encodeJsonString({
            jsonrpc: "2.0",
            id: body.id ?? null,
            result: {
              backendSessionId: sessionId,
              clientName: payload.clientInfo.name
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      },
      dispose: async () => {}
    };
  };

const readToolNames = async (response: Response) => {
  const body = await response.json() as { result: { tools: Array<{ name: string }> } };
  return body.result.tools.map((tool) => tool.name);
};

const readProxyResult = async (response: Response) =>
  await response.json() as {
    result: {
      backendSessionId: string;
      clientName: string;
    };
  };

describe("MCP session proxy (real server)", () => {
  it.live("creates a shared warm session on cold start for callers without a session", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          (_env: TestEnv) => withDataRefQueryService(makeBiLayer({ filename })),
          (env) => env.marker
        );

        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
        );

        const response = await handler(
          makeToolsListRequest(undefined),
          { marker: "env1" },
          workflowIdentity
        );

        expect(response.status).toBe(200);
        expect((await readToolNames(response)).length).toBeGreaterThan(0);
      })
    )
  );

  it.live("serves tool calls after the client initializes", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          (_env: TestEnv) => withDataRefQueryService(makeBiLayer({ filename })),
          (env) => env.marker
        );

        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
        );

        const env = { marker: "env1" };
        const initResp = await handler(
          makeInitRequest("test-client"),
          env,
          workflowIdentity
        );
        expect(initResp.status).toBe(200);

        const sessionId = initResp.headers.get("mcp-session-id");
        expect(sessionId).toBeTruthy();

        await handler(
          makeInitializedNotify(sessionId!),
          env,
          workflowIdentity
        );

        const toolResp = await handler(
          makeToolsListRequest(sessionId!),
          env,
          workflowIdentity
        );
        expect(toolResp.status).toBe(200);
        expect((await readToolNames(toolResp)).length).toBeGreaterThan(0);
      })
    )
  );

  it.live("returns 404 for a stale session when no persisted initialize payload exists", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          (_env: TestEnv) => withDataRefQueryService(makeBiLayer({ filename })),
          (env) => env.marker
        );

        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
        );

        const response = await handler(
          makeToolsListRequest("stale-uuid-from-previous-isolate"),
          { marker: "env1" },
          workflowIdentity
        );

        expect(response.status).toBe(404);
      })
    )
  );

  it.live("recovers a persisted client session after the handler rebuilds", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const { sessionStore } = makeMemorySessionStore<TestEnv>();
        const handler = makeCachedMcpHandler(
          (_env: TestEnv) => withDataRefQueryService(makeBiLayer({ filename })),
          (env) => env.marker,
          { sessionStore }
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

        const env2 = { marker: "env2" };
        const recoveredResp = await handler(
          makeToolsListRequest(sessionId),
          env2,
          workflowIdentity
        );
        expect(recoveredResp.status).toBe(200);
      })
    )
  );

  it.live("keeps anonymous warm sessions separate per capability profile", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const handler = makeCachedMcpHandler(
          (_env: TestEnv) => withDataRefQueryService(makeBiLayer({ filename })),
          (env) => env.marker
        );

        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(makeBiLayer({ filename })))
        );

        const env = { marker: "env1" };
        const workflowResp = await handler(
          makeToolsListRequest(undefined),
          env,
          workflowIdentity
        );
        const readOnlyResp = await handler(
          makeToolsListRequest(undefined),
          env,
          readOnlyIdentity
        );

        expect(workflowResp.status).toBe(200);
        expect(readOnlyResp.status).toBe(200);

        const workflowToolNames = await readToolNames(workflowResp);
        const readOnlyToolNames = await readToolNames(readOnlyResp);
        expect(workflowToolNames).toContain("curate_post");
        expect(workflowToolNames).toContain("bulk_curate");
        expect(readOnlyToolNames).not.toContain("curate_post");
        expect(readOnlyToolNames).not.toContain("bulk_curate");
      })
    )
  );
});

describe("MCP session proxy semantics", () => {
  it("keeps initialized clients isolated from later initializes", async () => {
    const handler = makeCachedMcpHandler(
      unusedBuildLayer,
      (env: TestEnv) => env.marker,
      { makeWebHandler: makeProxyAwareWebHandler() }
    );

    const env = { marker: "env1" };
    const clientAInit = await handler(makeInitRequest("client-a"), env, workflowIdentity);
    const clientBInit = await handler(makeInitRequest("client-b"), env, workflowIdentity);
    const clientASession = clientAInit.headers.get("mcp-session-id")!;
    const clientBSession = clientBInit.headers.get("mcp-session-id")!;

    const clientAResult = await readProxyResult(
      await handler(makeToolsListRequest(clientASession), env, workflowIdentity)
    );
    const clientBResult = await readProxyResult(
      await handler(makeToolsListRequest(clientBSession), env, workflowIdentity)
    );

    expect(clientAResult.result.clientName).toBe("client-a");
    expect(clientBResult.result.clientName).toBe("client-b");
  });

  it("does not let a real initialize replace the anonymous warm session", async () => {
    const handler = makeCachedMcpHandler(
      unusedBuildLayer,
      (env: TestEnv) => env.marker,
      { makeWebHandler: makeProxyAwareWebHandler() }
    );

    const env = { marker: "env1" };

    const anonymousBefore = await readProxyResult(
      await handler(makeToolsListRequest(undefined), env, workflowIdentity)
    );
    expect(anonymousBefore.result.clientName).toBe("skygest-warm-proxy");

    const initResp = await handler(makeInitRequest("real-client"), env, workflowIdentity);
    const realSessionId = initResp.headers.get("mcp-session-id")!;

    const anonymousAfter = await readProxyResult(
      await handler(makeToolsListRequest(undefined), env, workflowIdentity)
    );
    const realClient = await readProxyResult(
      await handler(makeToolsListRequest(realSessionId), env, workflowIdentity)
    );

    expect(anonymousAfter.result.clientName).toBe("skygest-warm-proxy");
    expect(realClient.result.clientName).toBe("real-client");
  });

  it("rebuilds the exact client session after handler restart", async () => {
    const { sessionStore } = makeMemorySessionStore<TestEnv>();
    const handler = makeCachedMcpHandler(
      unusedBuildLayer,
      (env: TestEnv) => env.marker,
      {
        makeWebHandler: makeProxyAwareWebHandler(),
        sessionStore
      }
    );

    const env1 = { marker: "env1" };
    const initResp = await handler(makeInitRequest("persisted-client"), env1, workflowIdentity);
    const externalSessionId = initResp.headers.get("mcp-session-id")!;

    const recovered = await readProxyResult(
      await handler(
        makeToolsListRequest(externalSessionId),
        { marker: "env2" },
        workflowIdentity
      )
    );

    expect(recovered.result.clientName).toBe("persisted-client");
    expect(recovered.result.backendSessionId.startsWith("env2-backend-")).toBe(true);
  });

  it("returns 404 when persisted session recovery cannot create a backend session", async () => {
    const { sessionStore } = makeMemorySessionStore<TestEnv>();
    await sessionStore.save(
      { marker: "env1" },
      "stale-session",
      { initializePayload: makeInitializePayload("broken-client") }
    );

    const handler = makeCachedMcpHandler(
      unusedBuildLayer,
      (env: TestEnv) => env.marker,
      {
        makeWebHandler: makeProxyAwareWebHandler("broken-init"),
        sessionStore
      }
    );

    const response = await handler(
      makeToolsListRequest("stale-session"),
      { marker: "env1" },
      workflowIdentity
    );

    expect(response.status).toBe(404);
  });
});
