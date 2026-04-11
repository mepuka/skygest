import { Array, ServiceMap, Effect, Layer, Option, Schema } from "effect";

export class EnvError extends Schema.TaggedErrorClass<EnvError>()("EnvError", {
  missing: Schema.String
}) {}

type Simplify<A> = { [K in keyof A]: A[K] };

interface AppConfigEnv {
  readonly OPERATOR_SECRET?: string;
  readonly EDITORIAL_DEFAULT_EXPIRY_HOURS?: string;
  readonly CURATION_MIN_SIGNAL_SCORE?: string;
}

type AllWorkerBindings =
  & WorkerConfiguration.IngestEnv
  & WorkerConfiguration.AgentEnv
  & WorkerConfiguration.ResolverEnv
  & AppConfigEnv;

type WithRequiredBindings<K extends keyof AllWorkerBindings> = Simplify<
  Pick<AllWorkerBindings, "DB" | K> &
    Partial<Omit<AllWorkerBindings, "DB" | K>>
>;

export type EnvBindings = Simplify<
  Pick<AllWorkerBindings, "DB"> &
    Partial<Omit<AllWorkerBindings, "DB">>
>;

export type AgentWorkerEnvBindings = WithRequiredBindings<"INGEST_SERVICE">;

export type WorkflowIngestEnvBindings =
  & WithRequiredBindings<"INGEST_RUN_WORKFLOW">
  & Pick<AllWorkerBindings, "EXPERT_POLL_COORDINATOR">;

export type WorkflowEnrichmentEnvBindings =
  WithRequiredBindings<"ENRICHMENT_RUN_WORKFLOW">;

export type ResolverWorkerEnvBindings =
  WithRequiredBindings<"RESOLVER_RUN_WORKFLOW">;

export type WorkflowFilterEnvBindings =
  & WorkflowIngestEnvBindings
  & WorkflowEnrichmentEnvBindings;

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
