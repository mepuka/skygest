import { Array, Effect, Layer } from "effect";
import { processPostprocessBatch } from "../postprocess/PostprocessWorker";
import { UsersRepoD1 } from "../services/d1/UsersRepoD1";
import { AccessRepoD1 } from "../services/d1/AccessRepoD1";
import { D1Client } from "@effect/sql-d1";
import type { EnvBindings } from "../platform/Env";
import type { PostprocessMessage } from "../domain/types";

export const queue = (batch: MessageBatch<PostprocessMessage>, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = D1Client.layer({ db: env.DB });
  const appLayer = Layer.mergeAll(UsersRepoD1.layer, AccessRepoD1.layer);
  const messages = Array.map(batch.messages, (msg) => msg.body);
  const ackAll = Effect.forEach(
    batch.messages,
    (msg) => Effect.sync(() => msg.ack()),
    { discard: true }
  );

  return ctx.waitUntil(
    Effect.runPromise(
      processPostprocessBatch(messages).pipe(
        Effect.flatMap(() => ackAll),
        Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
      )
    )
  );
};

export default { queue };
