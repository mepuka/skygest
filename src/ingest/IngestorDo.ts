import { Effect } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { runIngestor } from "./JetstreamIngestor";
import { CloudflareEnv, EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";

export class JetstreamIngestorDo {
  private readonly ctx: DurableObjectState;
  private readonly env: EnvBindings;

  constructor(ctx: DurableObjectState, env: EnvBindings) {
    this.ctx = ctx;
    this.env = env;
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)"
      );
    });
  }

  async fetch(): Promise<Response> {
    this.ctx.waitUntil(
      Effect.runPromise(
        runIngestor.pipe(
          Effect.provide(CloudflareEnv.layer(this.env)),
          Effect.provide(AppConfig.layer),
          Effect.provide(SqliteClient.layer({ db: this.ctx.storage.sql }))
        )
      )
    );

    return new Response("ok");
  }
}
