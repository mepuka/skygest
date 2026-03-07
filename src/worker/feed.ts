import { Effect } from "effect";
import { handleAdminRequest } from "../admin/Router";
import { handleIngestRequest } from "../ingest/Router";
import { handleMcpRequest } from "../mcp/Router";
import type { EnvBindings } from "../platform/Env";
import {
  authorizeOperator,
  isSharedSecretMode,
  isStagingOpsPath,
  logDeniedAdminMutation,
  requiredAdminScopes,
  toAuthErrorResponse
} from "./operatorAuth";

export const fetch = async (request: Request, env: EnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname === "/mcp") {
    try {
      await Effect.runPromise(authorizeOperator(request, env));
    } catch (error) {
      return toAuthErrorResponse(error);
    }

    return handleMcpRequest(request, env);
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    let identity;

    try {
      identity = await Effect.runPromise(
        authorizeOperator(request, env, requiredAdminScopes(request))
      );
    } catch (error) {
      await logDeniedAdminMutation(request, error);
      return toAuthErrorResponse(error);
    }

    return handleIngestRequest(request, env, identity);
  }

  if (url.pathname.startsWith("/admin")) {
    if (isStagingOpsPath(url.pathname) && !isSharedSecretMode(env)) {
      return new Response("not found", { status: 404 });
    }

    let identity;

    try {
      identity = await Effect.runPromise(
        authorizeOperator(request, env, requiredAdminScopes(request))
      );
    } catch (error) {
      await logDeniedAdminMutation(request, error);
      return toAuthErrorResponse(error);
    }

    return handleAdminRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export default { fetch };
