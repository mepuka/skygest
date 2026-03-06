import { McpServer } from "@effect/ai";
import * as HttpApp from "@effect/platform/HttpApp";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import { D1Client } from "@effect/sql-d1";
import { Effect, Layer } from "effect";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { Logging } from "../platform/Logging";
import { KnowledgeQueryService } from "../services/KnowledgeQueryService";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { ExpertsRepoD1 } from "../services/d1/ExpertsRepoD1";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";
import { KnowledgeMcpHandlers, KnowledgeMcpToolkit } from "./Toolkit";

const makeQueryLayer = (env: EnvBindings) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const repositoryLayer = Layer.mergeAll(
    OntologyCatalog.layer,
    ExpertsRepoD1.layer.pipe(Layer.provideMerge(baseLayer)),
    KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer))
  );
  const configLayer = AppConfig.layer.pipe(Layer.provideMerge(baseLayer));

  return Layer.mergeAll(
    repositoryLayer,
    configLayer,
    KnowledgeQueryService.layer.pipe(
      Layer.provideMerge(Layer.mergeAll(repositoryLayer, configLayer))
    )
  );
};

const makeMcpLayer = (
  queryLayer: Layer.Layer<KnowledgeQueryService, any, never>
): Layer.Layer<HttpLayerRouter.HttpRouter, any, never> =>
  McpServer.toolkit(KnowledgeMcpToolkit).pipe(
    Layer.provideMerge(
      KnowledgeMcpHandlers.pipe(Layer.provideMerge(queryLayer))
    ),
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
  layer: Layer.Layer<KnowledgeQueryService, any, never>
): Promise<Response> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const router = yield* HttpLayerRouter.HttpRouter;
        const handler = HttpApp.toWebHandler(router.asHttpEffect());
        return yield* Effect.promise(() => handler(request));
      }).pipe(Effect.provide(makeMcpLayer(layer)))
    )
  );

export const handleMcpRequest = async (request: Request, env: EnvBindings): Promise<Response> =>
  handleMcpRequestWithLayer(request, makeQueryLayer(env));
