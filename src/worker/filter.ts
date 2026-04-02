import { Effect } from "effect";
import { handleEnrichmentRequest } from "../enrichment/Router";
import { EnrichmentRunWorkflow } from "../enrichment/EnrichmentRunWorkflow";
import { handleIngestRequest, makeWorkflowIngestLayer } from "../ingest/Router";
import { ExpertPollCoordinatorDo, ExpertPollCoordinatorDoIsolated } from "../ingest/ExpertPollCoordinatorDo";
import { IngestRunWorkflow } from "../ingest/IngestRunWorkflow";
import { IngestWorkflowLauncher } from "../ingest/IngestWorkflowLauncher";
import type { WorkflowFilterEnvBindings } from "../platform/Env";
import {
  runScopedWithRuntime,
  withManagedRuntime
} from "../platform/EffectRuntime";
import {
  authorizeOperator,
  logDeniedOperatorRequest,
  requiredOperatorScopes,
  toAuthErrorResponse
} from "./operatorAuth";

export const fetch = async (request: Request, env: WorkflowFilterEnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }
    return handleIngestRequest(request, env, identity);
  }

  if (url.pathname.startsWith("/admin/enrichment/")) {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      await logDeniedOperatorRequest(request, error);
      return toAuthErrorResponse(error);
    }
    return handleEnrichmentRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export const scheduled = async (
  _controller: ScheduledController,
  env: WorkflowFilterEnvBindings,
  ctx: ExecutionContext
) => {
  const layer = makeWorkflowIngestLayer(env);

  const task = withManagedRuntime(layer, (runtime) =>
    runScopedWithRuntime(
      runtime,
      IngestWorkflowLauncher.use( (launcher) =>
        launcher.startCronHeadSweep(_controller.scheduledTime)
      ),
      { operation: "IngestWorker.scheduled" }
    )
  );

  ctx.waitUntil(task);
  await task;
};

export {
  EnrichmentRunWorkflow,
  ExpertPollCoordinatorDo,
  ExpertPollCoordinatorDoIsolated,
  IngestRunWorkflow
};

export default {
  fetch,
  scheduled
};
