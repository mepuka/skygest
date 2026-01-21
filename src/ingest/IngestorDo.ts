import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { runIngestor } from "./JetstreamIngestor";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";

export class JetstreamIngestorDo extends DurableObject<EnvBindings> {
  constructor(ctx: DurableObjectState, env: EnvBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)"
      );
    });
  }

  override async fetch(): Promise<Response> {
    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(this.env),
      SqliteClient.layer({ db: this.ctx.storage.sql })
    );
    const appLayer = Layer.mergeAll(
      AppConfig.layer,
      JetstreamCursorStore.layer
    );

    this.ctx.waitUntil(
      Effect.runPromise(
        runIngestor.pipe(Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer))))
      )
    );

    return new Response("ok");
  }
}
