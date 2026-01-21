import { Effect, Layer } from "effect";
import { DispatchWorker } from "../generator/DispatchWorker";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { D1Client } from "@effect/sql-d1";

export const scheduled = (_event: ScheduledEvent, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["FEED_GEN", "DB"] }),
    D1Client.layer({ db: env.DB })
  );
  const appLayer = UsersRepoD1.layer;

  return ctx.waitUntil(
    Effect.runPromise(
      DispatchWorker.run().pipe(
        Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
      )
    )
  );
};

export default { scheduled };
