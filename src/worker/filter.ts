import { Effect, Layer } from "effect";
import { processBatch } from "../filter/FilterWorker";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { D1Client } from "@effect/sql-d1";
import type { EnvBindings } from "../platform/Env";
import type { RawEventBatch } from "../domain/types";

export const queue = (batch: MessageBatch<RawEventBatch>, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(
      batch.messages.map(async (msg) => {
        const baseLayer = D1Client.layer({ db: env.DB });
        const appLayer = PostsRepoD1.layer.pipe(Layer.provideMerge(baseLayer));

        await Effect.runPromise(
          processBatch(msg.body).pipe(Effect.provide(appLayer))
        );
        msg.ack();
      })
    )
  );

export default { queue };
