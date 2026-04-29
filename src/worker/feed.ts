import { ConfigProvider, Effect } from "effect";
import { handleAdminRequest } from "../admin/Router";
import { handleApiRequest } from "../api/Router";
import { handleDataLayerRequest } from "../data-layer/Router";
import { toHttpErrorResponse } from "../http/ErrorMapping";
import { handleMcpRequest } from "../mcp/Router";
import { AppConfig } from "../platform/Config";
import type { AgentWorkerEnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  isStagingOpsPath,
  notFoundJsonResponse,
  requiredOperatorScopes,
  scheduleDeniedOperatorRequestLog,
  toAuthErrorResponse
} from "./operatorAuth";

/**
 * JSON-RPC notifications have `method` but no `id`. Return true when the
 * request body parses as a notification so we can rewrite the response to
 * 202 without buffering normal (potentially streamed) responses. See: SKY-177
 */
const isJsonRpcNotification = async (request: Request): Promise<boolean> => {
  try {
    const clone = request.clone();
    const body = await clone.json() as { id?: unknown; method?: unknown };
    return body.method !== undefined && body.id === undefined;
  } catch {
    return false;
  }
};

type BackgroundExecutionContext = Pick<ExecutionContext, "waitUntil">;

export const handleFeedRequest = async (
  request: Request,
  env: AgentWorkerEnvBindings,
  ctx?: BackgroundExecutionContext
) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    const provider = ConfigProvider.fromUnknown(
      Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    );
    const result = await Effect.runPromise(
      Effect.result(AppConfig.validateWorker(provider))
    );
    if (result._tag === "Success") {
      return new Response("ok");
    }
    return new Response(
      JSON.stringify({ status: "unhealthy", error: result.failure.summary }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, env);
  }

  if (url.pathname === "/mcp") {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }
    const notification = await isJsonRpcNotification(request);
    const response = await handleMcpRequest(request, env, identity);
    if (notification) {
      return new Response(null, { status: 202, headers: response.headers });
    }
    return response;
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    try {
      await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }
    return env.INGEST_SERVICE.fetch(request);
  }

  if (url.pathname.startsWith("/admin/data-layer/")) {
    let identity;

    try {
      identity = await authorizeOperator(
        request,
        env,
        requiredOperatorScopes(request)
      );
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }

    return handleDataLayerRequest(request, env, identity);
  }

  if (url.pathname.startsWith("/admin")) {
    if (isStagingOpsPath(url.pathname) && env.ENABLE_STAGING_OPS !== "true") {
      return notFoundJsonResponse();
    }

    let identity;

    try {
      identity = await authorizeOperator(
        request,
        env,
        requiredOperatorScopes(request)
      );
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }

    return handleAdminRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export const handleFetchWithBoundary = async (
  request: Request,
  env: AgentWorkerEnvBindings,
  ctx?: BackgroundExecutionContext,
  handler: (
    request: Request,
    env: AgentWorkerEnvBindings,
    ctx?: BackgroundExecutionContext
  ) => Promise<Response> = handleFeedRequest
): Promise<Response> => {
  try {
    return await handler(request, env, ctx);
  } catch (error) {
    return toHttpErrorResponse(error, {
      route: "worker/feed",
      operation: "AgentWorker.fetch",
      internalMessage: "internal error",
      logMessage: "agent worker top-level error"
    });
  }
};

export const fetch = (
  request: Request,
  env: AgentWorkerEnvBindings,
  ctx?: ExecutionContext
) =>
  handleFetchWithBoundary(request, env, ctx, handleFeedRequest);

export default { fetch };
