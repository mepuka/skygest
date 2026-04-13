import { Array, ServiceMap, Effect, Layer, Option, Schema } from "effect";
import type { EnrichmentRunParams } from "../domain/enrichmentRun";
import type { IngestRunParams } from "../domain/polling";
import type { ResolverBinding } from "../resolver/Client";
import type { EnrichmentTriggerBinding } from "../services/EnrichmentTriggerClient";

export class EnvError extends Schema.TaggedErrorClass<EnvError>()("EnvError", {
  missing: Schema.String
}) {}

type Simplify<A> = { [K in keyof A]: A[K] };

interface AppConfigEnv {
  readonly OPERATOR_SECRET?: string;
  readonly EDITORIAL_DEFAULT_EXPIRY_HOURS?: string;
  readonly CURATION_MIN_SIGNAL_SCORE?: string;
}

interface SharedRuntimeEnv {
  readonly DB: D1Database;
  readonly ONTOLOGY_KV?: KVNamespace;
  readonly TRANSCRIPTS_BUCKET?: R2Bucket;
  readonly PUBLIC_BSKY_API?: string;
  readonly INGEST_SHARD_COUNT?: string;
  readonly DEFAULT_DOMAIN?: string;
  readonly MCP_LIMIT_DEFAULT?: string;
  readonly MCP_LIMIT_MAX?: string;
  readonly ENABLE_STAGING_OPS?: "true";
  readonly ENABLE_DATA_REF_RESOLUTION?: "true";
  readonly GEMINI_VISION_MODEL?: string;
}

type IngestWorkflowBinding = Workflow<IngestRunParams>;
type EnrichmentWorkflowBinding = Workflow<EnrichmentRunParams>;
type ExpertPollCoordinatorNamespace = DurableObjectNamespace;
type IngestServiceBinding = EnrichmentTriggerBinding & Fetcher;

export type EnvBindings = Simplify<
  SharedRuntimeEnv &
    AppConfigEnv & {
      readonly INGEST_SERVICE?: IngestServiceBinding;
      readonly RESOLVER?: ResolverBinding;
      readonly INGEST_RUN_WORKFLOW?: IngestWorkflowBinding;
      readonly ENRICHMENT_RUN_WORKFLOW?: EnrichmentWorkflowBinding;
      readonly EXPERT_POLL_COORDINATOR?: ExpertPollCoordinatorNamespace;
    }
>;

export type AgentWorkerEnvBindings = Simplify<
  EnvBindings & {
    readonly INGEST_SERVICE: IngestServiceBinding;
  }
>;

export type WorkflowIngestEnvBindings =
  Simplify<
    EnvBindings & {
      readonly INGEST_RUN_WORKFLOW: IngestWorkflowBinding;
      readonly EXPERT_POLL_COORDINATOR: ExpertPollCoordinatorNamespace;
    }
  >;

export type WorkflowEnrichmentEnvBindings =
  Simplify<
    EnvBindings & {
      readonly ENRICHMENT_RUN_WORKFLOW: EnrichmentWorkflowBinding;
    }
  >;

export type ResolverWorkerEnvBindings =
  Simplify<EnvBindings>;

export type WorkflowFilterEnvBindings =
  Simplify<
    WorkflowIngestEnvBindings & {
      readonly ENRICHMENT_RUN_WORKFLOW: EnrichmentWorkflowBinding;
    }
  >;

export class WorkflowIngestEnv extends ServiceMap.Service<
  WorkflowIngestEnv,
  WorkflowIngestEnvBindings
>()("@skygest/WorkflowIngestEnv") {}

export class WorkflowEnrichmentEnv extends ServiceMap.Service<
  WorkflowEnrichmentEnv,
  WorkflowEnrichmentEnvBindings
>()("@skygest/WorkflowEnrichmentEnv") {}

const defaultRequired = [
  "DB"
] as const satisfies ReadonlyArray<keyof EnvBindings>;

type EnvRequirementOptions = {
  readonly required?: ReadonlyArray<keyof EnvBindings>;
};

export class CloudflareEnv extends ServiceMap.Service<
  CloudflareEnv,
  EnvBindings
>()("@skygest/CloudflareEnv") {
  static layer = (env: EnvBindings, options?: EnvRequirementOptions) => Layer.effect(
    CloudflareEnv,
    Effect.gen(function* () {
      const required = options?.required ?? defaultRequired;
      const missing = Array.findFirst(required, (key) => env[key] == null);

      return yield* Option.match(missing, {
        onNone: () => Effect.succeed(env),
        onSome: (key) => Effect.fail(new EnvError({ missing: String(key) }))
      });
    })
  );
}

export const requireEnvBinding = <K extends keyof EnvBindings>(
  env: EnvBindings,
  key: K
): NonNullable<EnvBindings[K]> => {
  const value = env[key];

  if (value == null) {
    throw new EnvError({ missing: String(key) });
  }

  return value as NonNullable<EnvBindings[K]>;
};

export const requireWorkflowIngestEnv = (
  env: EnvBindings
): WorkflowIngestEnvBindings => ({
  ...env,
  INGEST_RUN_WORKFLOW: requireEnvBinding(env, "INGEST_RUN_WORKFLOW"),
  EXPERT_POLL_COORDINATOR: requireEnvBinding(env, "EXPERT_POLL_COORDINATOR")
});

export const requireWorkflowEnrichmentEnv = (
  env: EnvBindings
): WorkflowEnrichmentEnvBindings => ({
  ...env,
  ENRICHMENT_RUN_WORKFLOW: requireEnvBinding(env, "ENRICHMENT_RUN_WORKFLOW")
});

export const makeWorkflowIngestEnvLayer = (env: WorkflowIngestEnvBindings) =>
  Layer.succeed(WorkflowIngestEnv, env);

export const makeWorkflowEnrichmentEnvLayer = (
  env: WorkflowEnrichmentEnvBindings
) => Layer.succeed(WorkflowEnrichmentEnv, env);
