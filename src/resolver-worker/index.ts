import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { DataRefResolverWorkflow } from "./DataRefResolverWorkflow";
import {
  handleFetchWithBoundary,
  handleResolverWorkerRequest
} from "./fetchHandler";

export const fetch = (
  request: Request,
  env: ResolverWorkerEnvBindings,
  ctx?: ExecutionContext
): Promise<Response> =>
  handleFetchWithBoundary(request, env, ctx, handleResolverWorkerRequest);

export { DataRefResolverWorkflow };

export default {
  fetch
};
