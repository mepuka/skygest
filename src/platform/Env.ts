import { Context, Layer } from "effect";

export interface EnvBindings {
  readonly FEED_DID: string;
  readonly JETSTREAM_ENDPOINT: string;
  readonly DB: D1Database;
  readonly RAW_EVENTS: Queue;
  readonly JETSTREAM_INGESTOR: DurableObjectNamespace;
}

export class CloudflareEnv extends Context.Tag("@skygest/CloudflareEnv")<
  CloudflareEnv,
  EnvBindings
>() {
  static layer = (env: EnvBindings) => Layer.succeed(CloudflareEnv, env);
}
