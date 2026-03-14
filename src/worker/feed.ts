import { handleAdminRequest } from "../admin/Router";
import { handleApiRequest } from "../api/Router";
import { ExpertPollCoordinatorDo } from "../ingest/ExpertPollCoordinatorDo";
import { IngestRunWorkflow } from "../ingest/IngestRunWorkflow";
import { handleIngestRequest } from "../ingest/Router";
import { handleMcpRequest } from "../mcp/Router";
import type { WorkflowIngestEnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  isSharedSecretMode,
  isStagingOpsPath,
  logDeniedOperatorRequest,
  notFoundJsonResponse,
  requiredOperatorScopes,
  toAuthErrorResponse
} from "./operatorAuth";

export const fetch = async (request: Request, env: WorkflowIngestEnvBindings) => {
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

    return handleIngestRequest(request, env, identity);
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

export { ExpertPollCoordinatorDo, IngestRunWorkflow };

export default { fetch };
