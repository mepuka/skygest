import { Effect, Layer } from "effect";
import { DispatchWorker } from "../generator/DispatchWorker";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { IngestorPingError } from "../domain/errors";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { D1Client } from "@effect/sql-d1";

export const scheduled = (_event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["FEED_GEN", "DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const appLayer = UsersRepoD1.layer;
  const pingIngestor = Effect.tryPromise({
    try: () => fetch("https://skygest-feed.kokokessy.workers.dev/internal/ingest/start", { method: "POST" }),
    catch: (error) => IngestorPingError.make({ message: String(error) })
  }).pipe(
    Effect.tap((response) =>
      Effect.logInfo("Ingestor pinged").pipe(
        Effect.annotateLogs({ status: response.status })
      )
    ),
    Effect.catchAll((error) =>
      Effect.logWarning("Ingestor ping failed").pipe(
        Effect.annotateLogs({ error: error.message }),
        Effect.asVoid
      )
    ),
    Effect.asVoid
  );
  const dispatch = DispatchWorker.run().pipe(
    Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
  );

  return ctx.waitUntil(
    Effect.runPromise(
      Effect.all([pingIngestor, dispatch], { concurrency: "unbounded", discard: true })
    )
  );
};

export default { scheduled };
