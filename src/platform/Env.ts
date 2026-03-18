import { Array, Context, Effect, Layer, Option, Schema } from "effect";
import type { IngestRunParams } from "../domain/polling";
import type { EnrichmentRunParams } from "../domain/enrichmentRun";

export class EnvError extends Schema.TaggedError<EnvError>()("EnvError", {
  missing: Schema.String
}) {}

export interface EnvBindings {
  readonly PUBLIC_BSKY_API?: string;
  readonly INGEST_SHARD_COUNT?: string;
  readonly DEFAULT_DOMAIN?: string;
  readonly MCP_LIMIT_DEFAULT?: string;
  readonly MCP_LIMIT_MAX?: string;
  readonly OPERATOR_AUTH_MODE?: string;
  readonly OPERATOR_SECRET?: string;
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly EDITORIAL_DEFAULT_EXPIRY_HOURS?: string;
  readonly CURATION_MIN_SIGNAL_SCORE?: string;
  readonly INGEST_RUN_WORKFLOW?: Workflow<IngestRunParams>;
  readonly ENRICHMENT_RUN_WORKFLOW?: Workflow<EnrichmentRunParams>;
  readonly EXPERT_POLL_COORDINATOR?: DurableObjectNamespace;
  readonly ONTOLOGY_KV?: KVNamespace;
  readonly DB: D1Database;
}

export interface AgentWorkerEnvBindings extends EnvBindings {
  readonly INGEST_SERVICE: Fetcher;
}

export type WorkflowIngestEnvBindings = EnvBindings & {
  readonly INGEST_RUN_WORKFLOW: Workflow<IngestRunParams>;
  readonly EXPERT_POLL_COORDINATOR: DurableObjectNamespace;
};

export type WorkflowEnrichmentEnvBindings = EnvBindings & {
  readonly ENRICHMENT_RUN_WORKFLOW: Workflow<EnrichmentRunParams>;
};

export class WorkflowIngestEnv extends Context.Tag("@skygest/WorkflowIngestEnv")<
  WorkflowIngestEnv,
  WorkflowIngestEnvBindings
>() {}

export class WorkflowEnrichmentEnv extends Context.Tag("@skygest/WorkflowEnrichmentEnv")<
  WorkflowEnrichmentEnv,
  WorkflowEnrichmentEnvBindings
>() {}

const defaultRequired = [
  "DB"
] as const satisfies ReadonlyArray<keyof EnvBindings>;

type EnvRequirementOptions = {
  readonly required?: ReadonlyArray<keyof EnvBindings>;
};

export class CloudflareEnv extends Context.Tag("@skygest/CloudflareEnv")<
  CloudflareEnv,
  EnvBindings
>() {
  static layer = (env: EnvBindings, options?: EnvRequirementOptions) => Layer.effect(
    CloudflareEnv,
    Effect.gen(function* () {
      const required = options?.required ?? defaultRequired;
      const missing = Array.findFirst(required, (key) => env[key] == null);

      return yield* Option.match(missing, {
        onNone: () => Effect.succeed(env),
        onSome: (key) => Effect.fail(EnvError.make({ missing: String(key) }))
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
    throw EnvError.make({ missing: String(key) });
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
