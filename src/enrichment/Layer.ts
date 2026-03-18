import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import {
  CloudflareEnv,
  makeWorkflowEnrichmentEnvLayer,
  type WorkflowEnrichmentEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { EnrichmentRunsRepoD1 } from "../services/d1/EnrichmentRunsRepoD1";

export const makeWorkflowEnrichmentLayer = (
  env: WorkflowEnrichmentEnvBindings
) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const workflowEnvLayer = makeWorkflowEnrichmentEnvLayer(env);
  const runsLayer = EnrichmentRunsRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );

  return Layer.mergeAll(
    baseLayer,
    workflowEnvLayer,
    runsLayer
  );
};
