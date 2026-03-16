import { handleAdminRequest } from "../admin/Router";
import { handleApiRequest } from "../api/Router";
import { handleMcpRequest } from "../mcp/Router";
import type { AgentWorkerEnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  isSharedSecretMode,
  isStagingOpsPath,
  logDeniedOperatorRequest,
  notFoundJsonResponse,
  requiredOperatorScopes,
  toAuthErrorResponse
} from "./operatorAuth";

export const fetch = async (request: Request, env: AgentWorkerEnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApiRequest(request, env);
  }

  if (url.pathname === "/mcp") {
    try {
      await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }

    return handleMcpRequest(request, env);
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
    if (isStagingOpsPath(url.pathname) && !isSharedSecretMode(env)) {
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
