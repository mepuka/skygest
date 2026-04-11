import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import {
  internalServerError,
  type HttpErrorEnvelope
} from "../domain/api";
import {
  handleEnrichmentRequest,
  startEnrichmentEffect
} from "../enrichment/Router";
import { makeWorkflowEnrichmentLayer } from "../enrichment/Layer";
import { EnrichmentRunWorkflow } from "../enrichment/EnrichmentRunWorkflow";
import {
  httpErrorStatus,
  isHttpEnvelope,
  toHttpErrorResponse
} from "../http/ErrorMapping";
import { handleIngestRequest, makeWorkflowIngestLayer } from "../ingest/Router";
import { ExpertPollCoordinatorDo, ExpertPollCoordinatorDoIsolated } from "../ingest/ExpertPollCoordinatorDo";
import { IngestRunWorkflow } from "../ingest/IngestRunWorkflow";
import { IngestWorkflowLauncher } from "../ingest/IngestWorkflowLauncher";
import type { WorkflowFilterEnvBindings } from "../platform/Env";
import {
  runScopedWithRuntime,
  withManagedRuntime
} from "../platform/EffectRuntime";
import { makeEffectRpc } from "../platform/Rpc";
import type { StartEnrichmentRpcInput } from "../services/EnrichmentTriggerClient";
import {
  authorizeOperator,
  requiredOperatorScopes,
  scheduleDeniedOperatorRequestLog,
  toAuthErrorResponse
} from "./operatorAuth";

type BackgroundExecutionContext = Pick<ExecutionContext, "waitUntil">;

const enrichmentRpc = makeEffectRpc(makeWorkflowEnrichmentLayer);

const toRpcHttpError = (error: unknown): HttpErrorEnvelope =>
  isHttpEnvelope(error)
    ? error
    : internalServerError("internal error");

export class EnrichmentEntrypoint extends WorkerEntrypoint<WorkflowFilterEnvBindings> {
  startEnrichment(input: StartEnrichmentRpcInput) {
    return enrichmentRpc.run(
      this.env,
      startEnrichmentEffect(
        {
          postUri: input.postUri,
          enrichmentType: input.enrichmentType,
          ...(input.schemaVersion === undefined
            ? {}
            : { schemaVersion: input.schemaVersion })
        },
        input.requestedBy ?? "operator"
      ),
      (error) => {
        const envelope = toRpcHttpError(error);
        return {
          message: envelope.message,
          status: httpErrorStatus(envelope)
        };
      }
    );
  }
}

export const handleFilterWorkerRequest = async (
  request: Request,
  env: WorkflowFilterEnvBindings,
  ctx?: BackgroundExecutionContext
) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  if (url.pathname.startsWith("/admin/ingest/")) {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }
    return handleIngestRequest(request, env, identity);
  }

  if (url.pathname.startsWith("/admin/enrichment/")) {
    let identity;
    try {
      identity = await authorizeOperator(request, env, requiredOperatorScopes(request));
    } catch (error) {
      scheduleDeniedOperatorRequestLog(request, error, ctx);
      return toAuthErrorResponse(error);
    }
    return handleEnrichmentRequest(request, env, identity);
  }

  return new Response("not found", { status: 404 });
};

export const handleFetchWithBoundary = async (
  request: Request,
  env: WorkflowFilterEnvBindings,
  ctx?: BackgroundExecutionContext,
  handler: (
    request: Request,
    env: WorkflowFilterEnvBindings,
    ctx?: BackgroundExecutionContext
  ) => Promise<Response> = handleFilterWorkerRequest
): Promise<Response> => {
  try {
    return await handler(request, env, ctx);
  } catch (error) {
    return toHttpErrorResponse(error, {
      route: "worker/filter",
      operation: "IngestWorker.fetch",
      internalMessage: "internal error",
      logMessage: "ingest worker top-level error"
    });
  }
};

export const fetch = (
  request: Request,
  env: WorkflowFilterEnvBindings,
  ctx?: ExecutionContext
) =>
  handleFetchWithBoundary(request, env, ctx, handleFilterWorkerRequest);

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
