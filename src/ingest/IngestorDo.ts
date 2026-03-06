import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, Fiber, Layer, Option, Schedule } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { runIngestor } from "./JetstreamIngestor";
import { JetstreamCursorStore } from "./JetstreamCursorStore";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { makeIngestorSupervisor, type IngestorSupervisor } from "./IngestorSupervisor";

export type IngestorRefreshRequest = {
  readonly shard: number;
  readonly forceRefresh?: boolean;
};

export type IngestorRefreshResult = {
  readonly shard: number;
};

export class JetstreamIngestorDoV2 extends DurableObject<EnvBindings> {
  private supervisor: IngestorSupervisor | null = null;
  private ingestor: Effect.Effect<void, unknown> | null = null;
  private ingestorShard: number | null = null;

  constructor(ctx: DurableObjectState, env: EnvBindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_state (id TEXT PRIMARY KEY, cursor INTEGER)"
      );
      this.ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS jetstream_meta (id TEXT PRIMARY KEY, shard INTEGER NOT NULL)"
      );
    });
  }

  private getStoredShard(): number {
    const rows = this.ctx.storage.sql.exec(
      "SELECT shard FROM jetstream_meta WHERE id = 'main'"
    ).toArray();

    const result = rows[0];
    if (typeof result !== "object" || result === null || !("shard" in result)) {
      return 0;
    }

    const shard = result.shard;
    if (typeof shard === "number") {
      return shard;
    }

    const parsed = Number(shard);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private setStoredShard(shard: number): void {
    const safeShard = Number.isFinite(shard) ? Math.max(0, Math.trunc(shard)) : 0;
    this.ctx.storage.sql.exec(
      `INSERT INTO jetstream_meta (id, shard)
       VALUES ('main', ${safeShard})
       ON CONFLICT(id) DO UPDATE SET shard = excluded.shard`
    );
  }

  private buildIngestor(shard: number): Effect.Effect<void, unknown> {
    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(this.env, { required: ["DB", "RAW_EVENTS"] }),
      SqliteClient.layer({ db: this.ctx.storage.sql })
    );
    const appLayer = Layer.mergeAll(
      baseLayer,
      AppConfig.layer.pipe(Layer.provideMerge(baseLayer)),
      JetstreamCursorStore.layer.pipe(Layer.provideMerge(baseLayer))
    );
    const retryPolicy = Schedule.exponential("1 second").pipe(
      Schedule.jittered,
      Schedule.tapOutput((delay) =>
        Effect.logWarning(`ingestor retrying in ${String(delay)}`)
      )
    );

    return runIngestor(shard).pipe(
      Effect.provide(appLayer),
      Effect.tapErrorCause((cause) =>
        Effect.logError(`ingestor failed: ${Cause.pretty(cause)}`)
      ),
      Effect.retry(retryPolicy)
    );
  }

  private async ensureIngestor(
    shard: number,
    options?: { readonly forceRefresh?: boolean }
  ): Promise<void> {
    const shouldReplace =
      options?.forceRefresh === true || this.ingestor === null || this.ingestorShard !== shard;

    if (shouldReplace) {
      const nextIngestor = this.buildIngestor(shard);
      this.ingestor = nextIngestor;
      this.ingestorShard = shard;

      if (this.supervisor) {
        await Effect.runPromise(this.supervisor.replaceIngestor(nextIngestor));
      }
    }

    if (!this.supervisor) {
      this.supervisor = await Effect.runPromise(
        makeIngestorSupervisor(this.ingestor ?? this.buildIngestor(shard))
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

  async refresh(input: IngestorRefreshRequest): Promise<IngestorRefreshResult> {
    const previousShard = this.getStoredShard();
    const rawShard = Number(input.shard ?? previousShard);
    const shard = Number.isFinite(rawShard) ? Math.max(0, Math.trunc(rawShard)) : 0;
    const safeShard = Number.isFinite(shard) ? shard : previousShard;

    this.setStoredShard(safeShard);
    await this.ensureIngestor(safeShard, {
      forceRefresh: input.forceRefresh === true || previousShard !== safeShard
    });

    return { shard: safeShard };
  }
}
