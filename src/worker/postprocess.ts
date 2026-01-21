import { Effect, Layer } from "effect";
import { processPostprocess } from "../postprocess/PostprocessWorker";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";
import type { EnvBindings } from "../platform/Env";
import type { PostprocessMessage } from "../domain/types";

export const queue = (batch: MessageBatch<PostprocessMessage>, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = D1Client.layer({ db: env.DB });
  const appLayer = Layer.mergeAll(UsersRepoD1.layer, AccessRepoD1.layer);

  return ctx.waitUntil(
    Promise.all(
      batch.messages.map(async (msg) => {
        await Effect.runPromise(
          processPostprocess(msg.body).pipe(
            Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
          )
        );
        msg.ack();
      })
    )
  );
};

export default { queue };
