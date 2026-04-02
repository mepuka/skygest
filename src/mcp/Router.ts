import { McpServer } from "effect/unstable/ai";
import * as HttpLayerRouter from "effect/unstable/http/HttpRouter";
import { Context, Effect, Layer } from "effect";
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

const mcpServerLayer = McpServer.layerHttpRouter({
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

  const promptsLayer: Layer.Layer<never, never, never> = profile === "workflow-write"
    ? WorkflowPromptsLayer
    : ReadOnlyPromptsLayer;

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

/** Web handler shape with an explicit context parameter for OperatorIdentity */
type McpWebHandler = {
  readonly handler: (request: globalThis.Request, context: Context.Context<OperatorIdentity>) => Promise<Response>;
  readonly dispose: () => Promise<void>;
};

const makeCachedMcpHandler = <Env extends object>(
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

    return entry.webHandler.handler(request, operatorIdentityContext(identity));
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
