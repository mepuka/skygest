import { Array, Context, Effect, Layer, Option, Schema } from "effect";

export class EnvError extends Schema.TaggedError<EnvError>()("EnvError", {
  missing: Schema.String
}) {}

export interface EnvBindings {
  readonly FEED_DID: string;
  readonly ALG_FEED_DID?: string;
  readonly PUBLIC_BSKY_API?: string;
  readonly JETSTREAM_ENDPOINT?: string;
  readonly FOLLOW_LIMIT?: string;
  readonly FEED_LIMIT?: string;
  readonly CONSENT_THRESHOLD?: string;
  readonly DB: D1Database;
  readonly FEED_CACHE: KVNamespace;
  readonly RAW_EVENTS: Queue;
  readonly FEED_GEN: Queue;
  readonly POSTPROCESS: Queue;
  readonly JETSTREAM_INGESTOR: DurableObjectNamespace;
}

const defaultRequired = [
  "FEED_DID",
  "DB",
  "FEED_CACHE",
  "RAW_EVENTS",
  "FEED_GEN",
  "POSTPROCESS",
  "JETSTREAM_INGESTOR"
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
