import { Effect, Layer } from "effect";
import { DispatchWorker } from "../generator/DispatchWorker";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { D1Client } from "@effect/sql-d1";

export const scheduled = (_event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["FEED_GEN", "DB"] }),
    D1Client.layer({ db: env.DB }),
    Logging.layer
  );
  const appLayer = UsersRepoD1.layer;

  return ctx.waitUntil(
    Promise.all([
      // Restart the ingestor to keep it alive
      fetch("https://skygest-feed.kokokessy.workers.dev/internal/ingest/start", { method: "POST" })
        .then(() => console.log("Ingestor pinged"))
        .catch((e) => console.error("Ingestor ping failed:", e)),
      // Run the dispatch
      Effect.runPromise(
        DispatchWorker.run().pipe(
          Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
        )
      )
    ])
  );
};

export default { scheduled };
