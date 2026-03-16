import { McpServer } from "@effect/ai";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import { Effect, Layer } from "effect";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { makeQueryLayer } from "../edge/Layer";
import type { EnvBindings } from "../platform/Env";
import { EditorialService } from "../services/EditorialService";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { GLOSSARY_CONTENT } from "./glossary";
import { PromptsLayer } from "./prompts";
import { toolkitWithDisplayText } from "./registerToolkitWithDisplayText.ts";
import { KnowledgeMcpHandlers, KnowledgeMcpToolkit } from "./Toolkit";

const GlossaryResource = McpServer.resource({
  uri: "skygest://glossary",
  name: "Domain Glossary",
  description:
    "Definitions of key terms, entities, and enums used across all tools",
  mimeType: "text/markdown",
  content: Effect.succeed(GLOSSARY_CONTENT)
});

const makeMcpLayer = (
  queryLayer: Layer.Layer<KnowledgeQueryService | EditorialService | BlueskyClient, any, never>
): Layer.Layer<HttpLayerRouter.HttpRouter, any, never> =>
  toolkitWithDisplayText(KnowledgeMcpToolkit).pipe(
    Layer.provideMerge(
      KnowledgeMcpHandlers.pipe(Layer.provideMerge(queryLayer))
    ),
    Layer.provideMerge(GlossaryResource),
    Layer.provideMerge(PromptsLayer),
    Layer.provideMerge(
      McpServer.layerHttpRouter({
        name: "skygest-bi-mcp",
        version: "0.1.0",
        path: "/mcp"
      }).pipe(Layer.provideMerge(HttpLayerRouter.layer))
    )
  );

export const handleMcpRequestWithLayer = async (
  request: Request,
  layer: Layer.Layer<KnowledgeQueryService | EditorialService | BlueskyClient, any, never>
): Promise<Response> => {
  const webHandler = HttpLayerRouter.toWebHandler(makeMcpLayer(layer));

  try {
    return await webHandler.handler(request, undefined as never);
  } finally {
    await webHandler.dispose();
  }
};

const makeCachedMcpHandler = <Env extends object>(
  buildLayer: (env: Env) => Layer.Layer<KnowledgeQueryService | EditorialService | BlueskyClient, any, never>
) => {
  let cached: {
    readonly env: Env;
    readonly webHandler: ReturnType<typeof HttpLayerRouter.toWebHandler>;
  } | null = null;

  return async (request: Request, env: Env): Promise<Response> => {
    if (cached === null || cached.env !== env) {
      if (cached !== null) {
        await cached.webHandler.dispose();
      }

      cached = {
        env,
        webHandler: HttpLayerRouter.toWebHandler(makeMcpLayer(buildLayer(env)))
      };
    }

    return cached.webHandler.handler(request, undefined as never);
  };
};

const handleCachedMcpRequest = makeCachedMcpHandler(makeQueryLayer);

export const handleMcpRequest = (
  request: Request,
  env: EnvBindings
) => handleCachedMcpRequest(request, env);
