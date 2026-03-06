import { Array, Context, Effect, Layer, Option, Schema } from "effect";
import type { JetstreamIngestorDoV2 } from "../ingest/IngestorDo";

export class EnvError extends Schema.TaggedError<EnvError>()("EnvError", {
  missing: Schema.String
}) {}

export interface EnvBindings {
  readonly PUBLIC_BSKY_API?: string;
  readonly JETSTREAM_ENDPOINT?: string;
  readonly INGEST_SHARD_COUNT?: string;
  readonly DEFAULT_DOMAIN?: string;
  readonly MCP_LIMIT_DEFAULT?: string;
  readonly MCP_LIMIT_MAX?: string;
  readonly OPERATOR_AUTH_MODE?: string;
  readonly OPERATOR_SECRET?: string;
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
  readonly DB: D1Database;
  readonly RAW_EVENTS?: Queue;
  readonly JETSTREAM_INGESTOR?: DurableObjectNamespace<JetstreamIngestorDoV2>;
}

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
