import { Array, Context, Effect, Layer, Option } from "effect";

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

export class CloudflareEnv extends Context.Tag("@skygest/CloudflareEnv")<
  CloudflareEnv,
  EnvBindings
>() {
  static layer = (env: EnvBindings) => Layer.effect(
    CloudflareEnv,
    Effect.sync(() => {
      const required = [
        "FEED_DID",
        "DB",
        "FEED_CACHE",
        "RAW_EVENTS",
        "FEED_GEN",
        "POSTPROCESS",
        "JETSTREAM_INGESTOR"
      ] as const satisfies ReadonlyArray<keyof EnvBindings>;
      const missing = Array.findFirst(required, (key) => env[key] == null);

      return Option.match(missing, {
        onNone: () => env,
        onSome: (key) => {
          throw new Error(`Missing ${key}`);
        }
      });
    })
  );
}
