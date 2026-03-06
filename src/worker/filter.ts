import { Cause, Effect, Layer } from "effect";
import { D1Client } from "@effect/sql-d1";
import { processBatch } from "../filter/FilterWorker";
import { JetstreamIngestorDoV2 } from "../ingest/IngestorDo";
import { CloudflareEnv, type EnvBindings } from "../platform/Env";
import { Logging } from "../platform/Logging";
import { OntologyCatalog } from "../services/OntologyCatalog";
import { KnowledgeRepoD1 } from "../services/d1/KnowledgeRepoD1";
import type { RawEventBatch } from "../domain/types";

export { JetstreamIngestorDoV2 };

const makeQueueLayer = (env: EnvBindings) =>
  (() => {
    const baseLayer = Layer.mergeAll(
      CloudflareEnv.layer(env, { required: ["DB", "RAW_EVENTS"] }),
      D1Client.layer({ db: env.DB }),
      Logging.layer
    );

    return Layer.mergeAll(
      OntologyCatalog.layer,
      KnowledgeRepoD1.layer.pipe(Layer.provideMerge(baseLayer))
    );
  })();

export const fetch = async (request: Request, env: EnvBindings) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return new Response("ok");
  }

  return new Response("not found", { status: 404 });
};

const processMessage = (
  layer: Layer.Layer<any, any, never>,
  queueName: string,
  message: Message<RawEventBatch>
) =>
  processBatch(message.body).pipe(
    Effect.tap(() => Effect.sync(() => message.ack())),
    Effect.catchAllCause((cause) =>
      Effect.logError("raw event batch failed").pipe(
        Effect.annotateLogs({
          queue: queueName,
          messageId: message.id,
          attempts: message.attempts,
          cause: Cause.pretty(cause)
        }),
        Effect.zipRight(Effect.sync(() => message.retry())),
        Effect.asVoid
      )
    )
  );

export const queue = async (
  batch: MessageBatch<RawEventBatch>,
  env: EnvBindings,
  _ctx: ExecutionContext
) => {
  const layer = makeQueueLayer(env);

  await Effect.runPromise(
    Effect.forEach(
      batch.messages,
      (message) => processMessage(layer, batch.queue, message),
      { concurrency: "unbounded", discard: true }
    ).pipe(Effect.provide(layer))
  );
};

export default {
  fetch,
  queue
};
