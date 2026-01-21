import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Fiber, Layer, Option, Schedule } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { runIngestor } from "./JetstreamIngestor";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { makeIngestorSupervisor, type IngestorSupervisor } from "./IngestorSupervisor";

const ALARM_INTERVAL_MS = 20_000;

export class JetstreamIngestorDoV2 extends DurableObject<EnvBindings> {
  private supervisor: IngestorSupervisor | null = null;
  private readonly ingestor: Effect.Effect<void>;

  constructor(ctx: DurableObjectState, env: EnvBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)"
      );
    });
    this.ingestor = this.buildIngestor();
  }

  private buildIngestor(): Effect.Effect<void> {
    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(this.env),
      SqliteClient.layer({ db: this.ctx.storage.sql })
    );
    const appLayer = Layer.mergeAll(
      AppConfig.layer,
      JetstreamCursorStore.layer
    );
    const retryPolicy = Schedule.exponential("1 second").pipe(
      Schedule.jittered,
      Schedule.tapOutput((delay) =>
        Effect.logWarning(`ingestor retrying in ${String(delay)}`)
      )
    );

    return runIngestor.pipe(
      Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer))),
      Effect.tapErrorCause((cause) =>
        Effect.logError(`ingestor failed: ${Cause.pretty(cause)}`)
      ),
      Effect.retry(retryPolicy)
    );
  }

  private async ensureIngestor(): Promise<void> {
    if (!this.supervisor) {
      this.supervisor = await Effect.runPromise(
        makeIngestorSupervisor(this.ingestor)
      );
    }

    const started = await Effect.runPromise(
      this.supervisor.ensureRunning.pipe(Effect.tap(() => Effect.yieldNow))
    );
    if (Option.isSome(started)) {
      this.ctx.waitUntil(
        Effect.runPromise(Fiber.join(started.value))
      );
    }
  }

  private scheduleAlarm(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  override async fetch(): Promise<Response> {
    await this.scheduleAlarm();
    await this.ensureIngestor();

    return new Response("ok");
  }

  override async alarm(): Promise<void> {
    await this.scheduleAlarm();
    await this.ensureIngestor();
  }
}
