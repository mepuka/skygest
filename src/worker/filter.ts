import { Effect } from "effect";
import { processBatch } from "../filter/FilterWorker";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { D1Client } from "@effect/sql-d1";
import { EnvBindings } from "../platform/Env";

export const queue = (batch: MessageBatch, env: EnvBindings, ctx: ExecutionContext) =>
  ctx.waitUntil(
    Promise.all(
      batch.messages.map(async (msg) => {
        await Effect.runPromise(
          processBatch(msg.body).pipe(
            Effect.provide(PostsRepoD1.layer),
            Effect.provide(D1Client.layer({ db: env.DB }))
          )
        );
        msg.ack();
      })
    )
  );
