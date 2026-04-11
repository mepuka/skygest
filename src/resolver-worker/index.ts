import type { ResolverWorkerEnvBindings } from "../platform/Env";
import { DataRefResolverWorkflow } from "./DataRefResolverWorkflow";
import {
  handleFetchWithBoundary,
  handleResolverWorkerRequest
} from "./fetchHandler";

export const fetch = (
  request: Request,
  env: ResolverWorkerEnvBindings
): Promise<Response> =>
  handleFetchWithBoundary(request, env, handleResolverWorkerRequest);

export { DataRefResolverWorkflow };

export default {
  fetch
};
