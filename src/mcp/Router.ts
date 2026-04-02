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
 * Detect Effect 4's MCP session-miss error in a JSON-RPC response.
 *
 * Effect's McpServer calls `Effect.die(new Error("Mcp-Session-Id does not exist"))`
 * when a non-initialize request arrives without a valid session. The HTTP adapter
 * converts this into an HTTP 200 with a JSON-RPC error containing a Die defect.
 * We detect this specific error structure and convert to HTTP 404 per MCP spec
 * so clients re-initialize.
 *
 * The detection parses the response JSON and checks the `error.data` array for
 * a Die defect with the session-miss message — avoiding false positives from
 * substring matching against tool descriptions or other response content.
 */
const SESSION_MISS_MESSAGE = "Mcp-Session-Id does not exist";

const isSessionMissError = (parsed: unknown): boolean => {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  if (!obj.error || typeof obj.error !== "object") return false;
  const err = obj.error as Record<string, unknown>;
  if (!Array.isArray(err.data)) return false;
  return err.data.some(
    (entry: unknown) =>
      typeof entry === "object" && entry !== null &&
      (entry as Record<string, unknown>)._tag === "Die" &&
      typeof (entry as Record<string, unknown>).defect === "object" &&
      ((entry as Record<string, unknown>).defect as Record<string, unknown>)?.message === SESSION_MISS_MESSAGE
  );
};

const sessionMissTo404 = async (response: Response): Promise<Response> => {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body);
    if (isSessionMissError(parsed)) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Session expired. Please re-initialize." },
          id: null
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
  } catch {
    // Not valid JSON — pass through as-is
  }
  // Re-attach the consumed body to the original response
  return new Response(body, {
    status: response.status,
    headers: response.headers
  });
};

/** @internal Exported for integration testing of session handling */
export const makeCachedMcpHandler = <Env extends object>(
  buildLayer: (env: Env) => QueryLayer
) => {
  const cache = new Map<string, {
    readonly env: Env;
    readonly webHandler: McpWebHandler;
  }>();

  return async (request: Request, env: Env, identity: AccessIdentity): Promise<Response> => {
    const profile = profileForIdentity(identity);
    const cacheKey = profile;

    let entry = cache.get(cacheKey);
    if (!entry || entry.env !== env) {
      if (entry) {
        await entry.webHandler.dispose();
      }

      entry = {
        env,
        webHandler: HttpLayerRouter.toWebHandler(makeMcpLayer(buildLayer(env), profile)) as unknown as McpWebHandler
      };
      cache.set(cacheKey, entry);
    }

    const response = await entry.webHandler.handler(request, operatorIdentityContext(identity));
    return sessionMissTo404(response);
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

const handleCachedMcpRequest = makeCachedMcpHandler(makeQueryLayerWithTrigger);

export const handleMcpRequest = (
  request: Request,
  env: EnvBindings,
  identity: AccessIdentity
) => handleCachedMcpRequest(request, env, identity);
