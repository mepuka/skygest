import { Effect } from "effect";
import { makeWorkflowIngestLayer } from "../ingest/Router";
import { ExpertPollCoordinatorDo } from "../ingest/ExpertPollCoordinatorDo";
import { IngestRunWorkflow } from "../ingest/IngestRunWorkflow";
import { IngestWorkflowLauncher } from "../ingest/IngestWorkflowLauncher";
import type { WorkflowIngestEnvBindings } from "../platform/Env";
import {
  runScopedWithRuntime,
  withManagedRuntime
} from "../platform/EffectRuntime";

export const fetch = async (request: Request, env: WorkflowIngestEnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  return new Response("not found", { status: 404 });
};

export const scheduled = async (
  _controller: ScheduledController,
  env: WorkflowIngestEnvBindings,
  ctx: ExecutionContext
) => {
  const layer = makeWorkflowIngestLayer(env);

  const task = withManagedRuntime(layer, (runtime) =>
    runScopedWithRuntime(
      runtime,
      Effect.flatMap(IngestWorkflowLauncher, (launcher) =>
        launcher.startCronHeadSweep(_controller.scheduledTime)
      ),
      { operation: "IngestWorker.scheduled" }
    )
  );

  ctx.waitUntil(task);
  await task;
};

export { ExpertPollCoordinatorDo, IngestRunWorkflow };

export default {
  fetch,
  scheduled
};
