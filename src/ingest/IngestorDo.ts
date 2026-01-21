import { DurableObject } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { runIngestor } from "./JetstreamIngestor";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";

const ALARM_INTERVAL_MS = 10_000; // Wake every 10 seconds to keep WebSocket alive

export class JetstreamIngestorDoV2 extends DurableObject<EnvBindings> {
  private isRunning = false;

  constructor(ctx: DurableObjectState, env: EnvBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)"
      );
    });
  }

  private async startIngestor(): Promise<void> {
    if (this.isRunning) {
      console.log("Ingestor already running, skipping");
      return;
    }

    this.isRunning = true;
    console.log("Starting ingestor...");

    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(this.env),
      SqliteClient.layer({ db: this.ctx.storage.sql })
    );
    const appLayer = Layer.mergeAll(
      AppConfig.layer,
      JetstreamCursorStore.layer
    );

    try {
      await Effect.runPromise(
        runIngestor.pipe(Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer))))
      );
    } catch (error) {
      console.error("Ingestor error:", error);
    } finally {
      this.isRunning = false;
      console.log("Ingestor stopped");
    }
  }

  override async fetch(): Promise<Response> {
    // Schedule alarm to keep DO alive
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null) {
      await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      console.log("Alarm scheduled");
    }

    // Start ingestor in background
    this.ctx.waitUntil(this.startIngestor());

    return new Response("ok");
  }

  override async alarm(): Promise<void> {
    console.log("Alarm fired, keeping DO alive");
    // Reschedule alarm to keep the DO alive
    await this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);

    // If ingestor stopped, restart it
    if (!this.isRunning) {
      console.log("Restarting stopped ingestor");
      this.ctx.waitUntil(this.startIngestor());
    }
  }
}
