import { D1Client } from "@effect/sql-d1";
import { Layer } from "effect";
import {
  CloudflareEnv,
  makeWorkflowEnrichmentEnvLayer,
  type WorkflowEnrichmentEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { CandidatePayloadRepoD1 } from "../services/d1/CandidatePayloadRepoD1";
import { EnrichmentRunsRepoD1 } from "../services/d1/EnrichmentRunsRepoD1";
import { EnrichmentPlanner } from "./EnrichmentPlanner";

export const makeWorkflowEnrichmentLayer = (
  env: WorkflowEnrichmentEnvBindings
) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const workflowEnvLayer = makeWorkflowEnrichmentEnvLayer(env);
  const payloadsLayer = CandidatePayloadRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const runsLayer = EnrichmentRunsRepoD1.layer.pipe(
    Layer.provideMerge(baseLayer)
  );
  const plannerLayer = EnrichmentPlanner.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(baseLayer, payloadsLayer)
    )
  );

  return Layer.mergeAll(
    baseLayer,
    workflowEnvLayer,
    payloadsLayer,
    runsLayer,
    plannerLayer
  );
};
