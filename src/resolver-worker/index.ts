import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { handleResolverRequest } from "../resolver/Router";
import { DataRefResolverWorkflow } from "./DataRefResolverWorkflow";
import {
  authorizeOperator,
  logDeniedOperatorRequest,
  toAuthErrorResponse
} from "../worker/operatorAuth";

const resolverScopes = ["ops:refresh"] as const;

export const fetch = async (
  request: Request,
  env: ResolverWorkerEnvBindings
) => {
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

export { DataRefResolverWorkflow };

export default {
  fetch
};
