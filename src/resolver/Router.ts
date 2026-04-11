import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import { Effect, Layer, Schema } from "effect";
import {
  ApiErrorSchemas,
  badRequestError,
  notFoundError,
  serviceUnavailableError
} from "../domain/api";
import {
  EnrichmentPayloadMissingError,
  EnrichmentPostContextMissingError,
  EnrichmentSchemaDecodeError,
  ResolverSourceAttributionMissingError,
  ResolverWorkflowLaunchError
} from "../domain/errors";
import {
  ResolveBulkRequest,
  ResolveBulkResponse,
  ResolvePostRequest,
  ResolvePostResponse
} from "../domain/resolution";
import {
  getStringField,
  isTaggedError,
  withHttpErrorMapping
} from "../http/ErrorMapping";
import { handleWithApiLayer, makeCachedApiHandler } from "../http/ApiSupport";
import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { ResolverService } from "./ResolverService";
import { makeResolverLayer } from "./Layer";

const ResolverHealthResponse = Schema.Struct({
  status: Schema.Literal("ok")
});

const ResolverApi = HttpApi.make("resolver")
  .add(
    HttpApiGroup.make("health")
      .add(
        HttpApiEndpoint.get("get", "/v1/resolve/health", {
          disableCodecs: true,
          success: ResolverHealthResponse,
          error: ApiErrorSchemas
        })
      )
  )
  .add(
    HttpApiGroup.make("resolve")
      .add(
        HttpApiEndpoint.post("post", "/v1/resolve/post", {
          disableCodecs: true,
          payload: ResolvePostRequest,
          success: ResolvePostResponse,
          error: ApiErrorSchemas
        })
      )
      .add(
        HttpApiEndpoint.post("bulk", "/v1/resolve/bulk", {
          disableCodecs: true,
          payload: ResolveBulkRequest,
          success: ResolveBulkResponse,
          error: ApiErrorSchemas
        })
      )
  );

const withResolverErrors = <A, R>(
  route: string,
  effect: Effect.Effect<A, unknown, R>
) =>
  withHttpErrorMapping(effect, {
    route,
    classify: (error) => {
      if (
        error instanceof ResolverSourceAttributionMissingError ||
        isTaggedError(error, "ResolverSourceAttributionMissingError") ||
        error instanceof EnrichmentPayloadMissingError ||
        isTaggedError(error, "EnrichmentPayloadMissingError") ||
        error instanceof EnrichmentPostContextMissingError ||
        isTaggedError(error, "EnrichmentPostContextMissingError")
      ) {
        const postUri = getStringField(error, "postUri");
        return notFoundError(
          postUri === undefined
            ? "resolver post context not found"
            : `resolver post context not found: ${postUri}`
        );
      }

      if (
        error instanceof EnrichmentSchemaDecodeError ||
        isTaggedError(error, "EnrichmentSchemaDecodeError")
      ) {
        return badRequestError(
          getStringField(error, "message") ?? "invalid resolver input"
        );
      }

      if (
        error instanceof ResolverWorkflowLaunchError ||
        isTaggedError(error, "ResolverWorkflowLaunchError")
      ) {
        return serviceUnavailableError(
          "failed to queue resolver workflow",
          true
        );
      }

      return undefined;
    }
  });

const ResolverHandlers = Layer.mergeAll(
  HttpApiBuilder.group(ResolverApi, "health", (handlers) =>
    handlers.handle("get", () =>
      Effect.succeed({
        status: "ok"
      } as const)
    )
  ),
  HttpApiBuilder.group(ResolverApi, "resolve", (handlers) =>
    handlers
      .handle("post", ({ payload }) =>
        withResolverErrors(
          "/v1/resolve/post",
          ResolverService.use((resolver) => resolver.resolvePost(payload))
        )
      )
      .handle("bulk", ({ payload }) =>
        withResolverErrors(
          "/v1/resolve/bulk",
          ResolverService.use((resolver) => resolver.resolveBulk(payload))
        )
      )
  )
);

const makeResolverApiLayer = (serviceLayer: Layer.Layer<any, any, never>) => {
  const handlersLayer = ResolverHandlers.pipe(
    Layer.provideMerge(serviceLayer)
  );

  return HttpApiBuilder.layer(ResolverApi).pipe(
    Layer.provideMerge(handlersLayer)
  );
};

const handleCachedResolverRequest = makeCachedApiHandler(
  (env: ResolverWorkerEnvBindings) =>
    makeResolverApiLayer(makeResolverLayer(env))
);

export const handleResolverRequestWithLayer = (
  request: Request,
  layer: Layer.Layer<any, any, never>
) =>
  handleWithApiLayer(
    request,
    makeResolverApiLayer(layer)
  );

export const handleResolverRequest = (
  request: Request,
  env: ResolverWorkerEnvBindings
) => handleCachedResolverRequest(request, env);
