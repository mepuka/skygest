import { McpServer } from "effect/unstable/ai";
import * as HttpLayerRouter from "effect/unstable/http/HttpRouter";
import { ServiceMap, Effect, Layer } from "effect";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { makeQueryLayer } from "../edge/Layer";
import type { EnvBindings } from "../platform/Env";
import { CurationService } from "../services/CurationService";
import { EditorialService } from "../services/EditorialService";
import { EnrichmentTriggerClient } from "../services/EnrichmentTriggerClient";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { PostEnrichmentReadService } from "../services/PostEnrichmentReadService";
import { GLOSSARY_CONTENT } from "./glossary";
import { ReadOnlyPromptsLayer, WorkflowPromptsLayer } from "./prompts";
import { toolkitWithDisplayText } from "./registerToolkitWithDisplayText.ts";
import {
  ReadOnlyMcpToolkit,
  ReadOnlyMcpHandlers,
  CurationWriteMcpToolkit,
  CurationWriteMcpHandlers,
  EditorialWriteMcpToolkit,
  EditorialWriteMcpHandlers,
  WorkflowWriteMcpToolkit,
  WorkflowWriteMcpHandlers
} from "./Toolkit";
import { profileForIdentity, type McpCapabilityProfile } from "./RequestAuth";
import type { AccessIdentity } from "../auth/AuthService";
import { OperatorIdentity, operatorIdentityContext } from "../http/Identity";

const GlossaryResource = McpServer.resource({
  uri: "skygest://glossary",
  name: "Domain Glossary",
  description:
    "Definitions of key terms, entities, and enums used across all tools",
  mimeType: "text/markdown",
  content: Effect.succeed(GLOSSARY_CONTENT)
});

type QueryLayer = Layer.Layer<KnowledgeQueryService | EditorialService | CurationService | BlueskyClient | PostEnrichmentReadService, any, never>;

const mcpServerLayer = McpServer.layerHttp({
  name: "skygest-bi-mcp",
  version: "0.1.0",
  path: "/mcp"
}).pipe(Layer.provideMerge(HttpLayerRouter.layer));

const makeMcpLayer = (
  queryLayer: QueryLayer,
  profile: McpCapabilityProfile
) => {
  const toolkitAndHandlers = (() => {
    switch (profile) {
      case "read-only":
        return toolkitWithDisplayText(ReadOnlyMcpToolkit).pipe(
          Layer.provideMerge(ReadOnlyMcpHandlers.pipe(Layer.provideMerge(queryLayer)))
        );
      case "curation-write":
        return toolkitWithDisplayText(CurationWriteMcpToolkit).pipe(
          Layer.provideMerge(CurationWriteMcpHandlers.pipe(Layer.provideMerge(queryLayer)))
        );
      case "editorial-write":
        return toolkitWithDisplayText(EditorialWriteMcpToolkit).pipe(
          Layer.provideMerge(EditorialWriteMcpHandlers.pipe(Layer.provideMerge(queryLayer)))
        );
      case "workflow-write":
        return toolkitWithDisplayText(WorkflowWriteMcpToolkit).pipe(
          Layer.provideMerge(WorkflowWriteMcpHandlers.pipe(Layer.provideMerge(queryLayer)))
        );
    }
  })();

  const promptsLayer = (profile === "workflow-write"
    ? WorkflowPromptsLayer
    : ReadOnlyPromptsLayer) as Layer.Layer<never, never, never>;

  return toolkitAndHandlers.pipe(
    Layer.provideMerge(GlossaryResource),
    Layer.provideMerge(promptsLayer),
    Layer.provideMerge(mcpServerLayer)
  );
};

export const handleMcpRequestWithLayer = async (
  request: Request,
  layer: QueryLayer,
  identity: AccessIdentity = { subject: null, email: null, scopes: ["mcp:read"] }
): Promise<Response> => {
  const profile = profileForIdentity(identity);
  const webHandler = HttpLayerRouter.toWebHandler(makeMcpLayer(layer, profile));

  try {
    return await webHandler.handler(request, operatorIdentityContext(identity));
  } finally {
    await webHandler.dispose();
  }
};

/**
 * Create a persistent MCP handler that keeps the web handler alive across
 * requests. This is required because the MCP server tracks sessions — the
 * session created during `initialize` must be available for subsequent
 * `tools/list`, `tools/call`, etc. requests.
 */
export const createPersistentMcpHandler = (
  layer: QueryLayer,
  identity: AccessIdentity = { subject: null, email: null, scopes: ["mcp:read"] }
) => {
  const profile = profileForIdentity(identity);
  const webHandler = HttpLayerRouter.toWebHandler(makeMcpLayer(layer, profile));
  const context = operatorIdentityContext(identity);

  return {
    handler: (request: Request) => webHandler.handler(request, context),
    dispose: () => webHandler.dispose()
  };
};

/** Web handler shape with an explicit context parameter for OperatorIdentity */
type McpWebHandler = {
  readonly handler: (request: globalThis.Request, context: ServiceMap.ServiceMap<OperatorIdentity>) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

/**
 * Peek at a cloned request body to determine if this is an MCP "initialize" request.
 */
const isInitializeRequest = async (request: Request): Promise<boolean> => {
  const clone = request.clone();
  try {
    const body = await clone.json() as Record<string, unknown>;
    return body.method === "initialize";
  } catch {
    return false;
  }
};

/**
 * Build a new Request with the `mcp-session-id` header replaced.
 * Uses body passthrough to avoid consuming the original stream.
 */
const substituteSessionHeader = (request: Request, sessionId: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("mcp-session-id", sessionId);

  return new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: "half"
  });
};

/**
 * Create a warm MCP session by sending a synthetic initialize + notifications/initialized
 * handshake. Returns the new session ID, or null if the handshake fails.
 */
const createWarmSession = async (
  webHandler: McpWebHandler,
  url: string,
  context: ServiceMap.ServiceMap<OperatorIdentity>
): Promise<string | null> => {
  const initReq = new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "initialize",
      id: 0,
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "skygest-warm-proxy", version: "0.1.0" }
      }
    })
  });

  const initResp = await webHandler.handler(initReq, context);
  if (initResp.status !== 200) return null;

  const sessionId = initResp.headers.get("mcp-session-id");
  if (!sessionId) return null;

  // Complete the handshake with notifications/initialized
  const notifyReq = new Request(url, {
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
  await webHandler.handler(notifyReq, context);

  return sessionId;
};

/**
 * Build a 404 response indicating the session could not be recovered.
 */
const sessionExpiredResponse = (): Response =>
  new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Session expired. Please re-initialize." },
      id: null
    }),
    { status: 404, headers: { "content-type": "application/json" } }
  );

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
        webHandler: HttpLayerRouter.toWebHandler(makeMcpLayer(buildLayer(env), profile)) as unknown as McpWebHandler,
        warmSessionId: null
      };
      cache.set(cacheKey, entry);
    }

    const context = operatorIdentityContext(identity);

    // Path 1: Client-initiated initialize — forward directly, capture session ID
    if (await isInitializeRequest(request.clone())) {
      const response = await entry.webHandler.handler(request, context);
      const sid = response.headers.get("mcp-session-id");
      if (sid) {
        entry.warmSessionId = sid;
      }
      return response;
    }

    // Path 2: We already have a warm session — substitute header and forward
    if (entry.warmSessionId) {
      return entry.webHandler.handler(
        substituteSessionHeader(request, entry.warmSessionId),
        context
      );
    }

    // Path 3: No warm session yet — create one on-demand, then replay the request
    // Clone the request BEFORE any body consumption so we can replay it
    const replay = request.clone();

    const warmSid = await createWarmSession(
      entry.webHandler,
      request.url,
      context
    );
    if (!warmSid) {
      return sessionExpiredResponse();
    }
    entry.warmSessionId = warmSid;

    return entry.webHandler.handler(
      substituteSessionHeader(replay, warmSid),
      context
    );
  };
};

/**
 * Build a query layer that includes the EnrichmentTriggerClient when the env
 * exposes an INGEST_SERVICE fetcher binding (agent worker only).
 */
const makeQueryLayerWithTrigger = (env: EnvBindings): QueryLayer => {
  const base = makeQueryLayer(env);
  const fetcher = (env as unknown as Record<string, unknown>)["INGEST_SERVICE"] as Fetcher | undefined;
  const secret = env.OPERATOR_SECRET;

  if (fetcher && secret) {
    return Layer.provideMerge(
      EnrichmentTriggerClient.layerFromFetcher(fetcher, secret),
      base
    ) as unknown as QueryLayer;
  }

  return base;
};

const handleCachedMcpRequest = makeCachedMcpHandler(
  makeQueryLayerWithTrigger,
  (env) => env.OPERATOR_SECRET ?? "default"
);

export const handleMcpRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) => handleCachedMcpRequest(request, env, identity);
