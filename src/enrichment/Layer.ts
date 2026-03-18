import { D1Client } from "@effect/sql-d1";
import { ConfigProvider, Layer } from "effect";
import {
  CloudflareEnv,
  makeWorkflowEnrichmentEnvLayer,
  type WorkflowEnrichmentEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { CandidatePayloadRepoD1 } from "../services/d1/CandidatePayloadRepoD1";
import { EnrichmentRunsRepoD1 } from "../services/d1/EnrichmentRunsRepoD1";
import { EnrichmentPlanner } from "./EnrichmentPlanner";
import { GeminiVisionServiceLive } from "./GeminiVisionServiceLive";

export const makeWorkflowEnrichmentLayer = (
  env: WorkflowEnrichmentEnvBindings
) => {
  // Build a ConfigProvider from Worker env bindings so Config.string()
  // resolves GOOGLE_API_KEY, GEMINI_VISION_MODEL, etc. at runtime.
  const configLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    )
  );

  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer,
    configLayer
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
  const visionLayer = GeminiVisionServiceLive.pipe(
    Layer.provideMerge(baseLayer)
  );

  return Layer.mergeAll(
    baseLayer,
    workflowEnvLayer,
    payloadsLayer,
    runsLayer,
    plannerLayer,
    visionLayer
  );
};
