import { Effect, Layer } from "effect";
import { GeneratorWorker } from "../generator/GeneratorWorker";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { AppConfig } from "../platform/Config";
import { FeedCacheKv } from "../services/kv/FeedCacheKv";
import { PostsRepoD1 } from "../services/d1/PostsRepoD1";
import { layer as BlueskyClientLayer } from "../bluesky/BlueskyClient";
import { D1Client } from "@effect/sql-d1";
import type { FeedGenMessage } from "../domain/types";

export const queue = (batch: MessageBatch<FeedGenMessage>, env: EnvBindings, ctx: ExecutionContext) => {
  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["FEED_DID", "FEED_CACHE", "DB"] }),
    D1Client.layer({ db: env.DB })
  );
  const configLayer = AppConfig.layer;
  const blueskyLayer = BlueskyClientLayer.pipe(Layer.provide(configLayer));
  const appLayer = Layer.mergeAll(
    configLayer,
    FeedCacheKv.layer,
    PostsRepoD1.layer,
    blueskyLayer
  );

  return ctx.waitUntil(
    Promise.all(
      batch.messages.map(async (msg) => {
        await Effect.runPromise(
          GeneratorWorker.process(msg.body).pipe(
            Effect.provide(appLayer.pipe(Layer.provideMerge(baseLayer)))
          )
        );
        msg.ack();
      })
    )
  );
};

export default { queue };
