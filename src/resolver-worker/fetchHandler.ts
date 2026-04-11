import { toHttpErrorResponse } from "../http/ErrorMapping";
import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { handleResolverRequest } from "../resolver/Router";
import {
  authorizeOperator,
  scheduleDeniedOperatorRequestLog,
  toAuthErrorResponse
} from "../worker/operatorAuth";

const resolverScopes = ["ops:refresh"] as const;
type BackgroundExecutionContext = Pick<ExecutionContext, "waitUntil">;

/**
 * Inner fetch handler for the resolver worker. Kept free of any `cloudflare:workers`
 * imports (which only resolve inside the Workers runtime) so this module stays
 * unit-testable under Bun/Vitest.
 */
export const handleResolverWorkerRequest = async (
  request: Request,
  env: ResolverWorkerEnvBindings,
  ctx?: BackgroundExecutionContext
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
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }

    return handleResolverRequest(request, env);
  }

  return new Response("not found", { status: 404 });
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
  ctx?: BackgroundExecutionContext,
  handler: (
    request: Request,
    env: ResolverWorkerEnvBindings,
    ctx?: BackgroundExecutionContext
  ) => Promise<Response> = handleResolverWorkerRequest
): Promise<Response> => {
  try {
    return await handler(request, env, ctx);
  } catch (error) {
    return toHttpErrorResponse(error, {
      route: "resolver-worker/fetch",
      operation: "ResolverWorker.fetch",
      internalMessage: "internal error",
      logMessage: "resolver worker top-level error"
    });
  }
};
