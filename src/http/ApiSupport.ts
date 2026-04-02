import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { type ServiceMap, Layer } from "effect";
import { badRequestError } from "../domain/api";
import { encodeJsonString } from "../platform/Json";

type WebHandler = ReturnType<typeof HttpRouter.toWebHandler>;

const isDecodeErrorBody = (
  value: unknown
): value is { readonly _tag: "HttpApiDecodeError"; readonly message: string } =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as Record<string, unknown>)._tag === "HttpApiDecodeError" &&
  "message" in value &&
  typeof (value as Record<string, unknown>).message === "string";

const normalizeBadRequestResponse = async (
  response: Response
): Promise<Response> => {
  if (response.status !== 400) {
    return response;
  }

  const body = await response.clone().json().catch(() => null);
  if (!isDecodeErrorBody(body)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");

  return new Response(
    encodeJsonString(badRequestError(body.message)),
    {
      status: 400,
      headers
    }
  );
};

export const handleWithApiLayer = async (
  request: Request,
  layer: Layer.Layer<any, any, never>,
  context?: ServiceMap.ServiceMap<never>
): Promise<Response> => {
  const webHandler = HttpRouter.toWebHandler(layer as any);

  try {
    return await normalizeBadRequestResponse(
      await webHandler.handler(request, context)
    );
  } finally {
    await webHandler.dispose();
  }
};

export const makeCachedApiHandler = <Env>(
  buildLayer: (env: Env) => Layer.Layer<any, any, never>
) => {
  let cached: {
    readonly env: Env;
    readonly webHandler: WebHandler;
  } | null = null;

  return async (
    request: Request,
    env: Env,
    context?: ServiceMap.ServiceMap<never>
  ): Promise<Response> => {
    if (cached === null || cached.env !== env) {
      if (cached !== null) {
        await cached.webHandler.dispose();
      }

      cached = {
        env,
        webHandler: HttpRouter.toWebHandler(buildLayer(env) as any)
      };
    }

    return normalizeBadRequestResponse(
      await cached.webHandler.handler(request, context as ServiceMap.ServiceMap<unknown>)
    );
  };
};
