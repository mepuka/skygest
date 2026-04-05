import { handleAdminRequest } from "../admin/Router";
import { handleApiRequest } from "../api/Router";
import { handleMcpRequest } from "../mcp/Router";
import type { AgentWorkerEnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  isStagingOpsPath,
  logDeniedOperatorRequest,
  notFoundJsonResponse,
  requiredOperatorScopes,
  toAuthErrorResponse
} from "./operatorAuth";

/**
 * Effect's McpServer.layerHttp returns 200 with empty body for JSON-RPC
 * notifications. The MCP spec requires 202 Accepted with no body. This
 * breaks rmcp-based clients (Codex CLI, Goose). Convert the response to
 * be spec-compliant. See: SKY-177
 */
const patchMcpNotificationResponse = async (
  response: Response
): Promise<Response> => {
  if (response.status !== 200) return response;

  const cl = response.headers.get("content-length");
  if (cl !== null && cl !== "0") return response;

  const body = await response.text();
  if (body.length > 0) {
    return new Response(body, { status: 200, headers: response.headers });
  }

  return new Response(null, { status: 202, headers: response.headers });
};

export const fetch = async (request: Request, env: AgentWorkerEnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, env);
  }

  if (url.pathname === "/mcp") {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }
    const response = await handleMcpRequest(request, env, identity);
    return patchMcpNotificationResponse(response);
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    try {
      await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }
    return env.INGEST_SERVICE.fetch(request);
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
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }

    return handleAdminRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export default { fetch };
