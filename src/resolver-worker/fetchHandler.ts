import { internalServerError } from "../domain/api";
import { encodeJsonString, stringifyUnknown } from "../platform/Json";
import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { handleResolverRequest } from "../resolver/Router";
import {
  authorizeOperator,
  logDeniedOperatorRequest,
  toAuthErrorResponse
} from "../worker/operatorAuth";

const resolverScopes = ["ops:refresh"] as const;

/**
 * Inner fetch handler for the resolver worker. Kept free of any `cloudflare:workers`
 * imports (which only resolve inside the Workers runtime) so this module stays
 * unit-testable under Bun/Vitest.
 */
export const handleResolverWorkerRequest = async (
  request: Request,
  env: ResolverWorkerEnvBindings
): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname === "/v1/resolve/health") {
    return handleResolverRequest(request, env);
  }

  if (url.pathname.startsWith("/v1/resolve/")) {
    try {
      await authorizeOperator(request, env, resolverScopes);
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }

    return handleResolverRequest(request, env);
  }

  return new Response("not found", { status: 404 });
};

/**
 * Sanitized 500 response for any unhandled error that escapes the inner
 * handler (layer construction failure, top-level Effect runtime failure,
 * unexpected throw). Logs the raw error for diagnostics but returns a
 * scrubbed envelope so internal details never leak to the caller.
 */
const toInternalServerErrorResponse = (error: unknown): Response => {
  // Workers Logs requires structured JSON on a single line.
  console.error(
    encodeJsonString({
      message: "resolver worker top-level error",
      error: stringifyUnknown(error)
    })
  );

  return new Response(
    encodeJsonString(internalServerError("internal error")),
    {
      status: 500,
      headers: {
        "content-type": "application/json"
      }
    }
  );
};

/**
 * Top-level error boundary wrapping the resolver worker fetch handler.
 * Exported for direct unit testing of the sanitized-error path. Any
 * unhandled error thrown by `handler` is routed through the sanitized
 * envelope rather than escaping to the Workers runtime (which would
 * otherwise emit a raw 500 leaking internal details).
 */
export const handleFetchWithBoundary = async (
  request: Request,
  env: ResolverWorkerEnvBindings,
  handler: (
    request: Request,
    env: ResolverWorkerEnvBindings
  ) => Promise<Response> = handleResolverWorkerRequest
): Promise<Response> => {
  try {
    return await handler(request, env);
  } catch (error) {
    return toInternalServerErrorResponse(error);
  }
};
