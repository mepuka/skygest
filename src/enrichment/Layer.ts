import { D1Client } from "@effect/sql-d1";
import { ConfigProvider, Layer } from "effect";
import { AppConfig } from "../platform/Config";
import {
  CloudflareEnv,
  makeWorkflowEnrichmentEnvLayer,
  type WorkflowEnrichmentEnvBindings
} from "../platform/Env";
import { Logging } from "../platform/Logging";
import { CandidatePayloadRepoD1 } from "../services/d1/CandidatePayloadRepoD1";
import { EnrichmentRunsRepoD1 } from "../services/d1/EnrichmentRunsRepoD1";
import { ProviderRegistry } from "../services/ProviderRegistry";
import { EnrichmentPlanner } from "./EnrichmentPlanner";
import { EnrichmentRepairService } from "./EnrichmentRepairService";
import { SourceAttributionExecutor } from "./SourceAttributionExecutor";
import { EnrichmentWorkflowLauncher } from "./EnrichmentWorkflowLauncher";
import { GeminiVisionServiceLive } from "./GeminiVisionServiceLive";
import { SourceAttributionMatcher } from "../source/SourceAttributionMatcher";
import { VisionEnrichmentExecutor } from "./VisionEnrichmentExecutor";

export const makeWorkflowEnrichmentLayer = (
  env: WorkflowEnrichmentEnvBindings
) => {
  const requiredBindings = ["DB"] as const;

  // Build a ConfigProvider from Worker env bindings so Config.string()
  // resolves GOOGLE_API_KEY, GEMINI_VISION_MODEL, etc. at runtime.
  const configLayer = ConfigProvider.layer(
    ConfigProvider.fromUnknown(
      Object.fromEntries(
        Object.entries(env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string"
        )
      )
    )
  );

  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: requiredBindings }),
    D1Client.layer({ db: env.DB }),
    Logging.layer,
    configLayer
  );
  const appConfigLayer = AppConfig.layer.pipe(
    Layer.provideMerge(baseLayer)
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
  const launcherLayer = EnrichmentWorkflowLauncher.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(baseLayer, workflowEnvLayer, runsLayer)
    )
  );
  const repairLayer = EnrichmentRepairService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(workflowEnvLayer, runsLayer)
    )
  );
  const providerRegistryLayer = ProviderRegistry.layer;
  const visionServiceLayer = GeminiVisionServiceLive.pipe(
    Layer.provideMerge(baseLayer)
  );
  const visionExecutorLayer = VisionEnrichmentExecutor.layer.pipe(
    Layer.provideMerge(visionServiceLayer)
  );
  const sourceMatcherLayer = SourceAttributionMatcher.layer.pipe(
    Layer.provideMerge(providerRegistryLayer)
  );
  const sourceExecutorLayer = SourceAttributionExecutor.layer.pipe(
    Layer.provideMerge(sourceMatcherLayer)
  );
  const coreLayer = Layer.mergeAll(
    baseLayer,
    appConfigLayer,
    workflowEnvLayer,
    payloadsLayer,
    runsLayer,
    plannerLayer,
    launcherLayer,
    repairLayer,
    providerRegistryLayer,
    visionServiceLayer,
    visionExecutorLayer,
    sourceMatcherLayer,
    sourceExecutorLayer
  );

  return coreLayer;
};
