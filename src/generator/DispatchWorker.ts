import { Array, Effect, Schema } from "effect";
import { CloudflareEnv } from "../platform/Env";
import { UsersRepo } from "../services/UsersRepo";
import { DbError, QueueError } from "../domain/errors";
import { Did, FeedGenMessage } from "../domain/types";

const batchSize = 20;

const decodeDids = (dids: ReadonlyArray<string>) =>
  Schema.decodeUnknown(Schema.Array(Did))(dids).pipe(
    Effect.mapError((error) => DbError.make({ message: String(error) }))
  );

const sendMessage = (message: FeedGenMessage) =>
  Effect.gen(function* () {
    const env = yield* CloudflareEnv;
    yield* Effect.tryPromise({
      try: () => env.FEED_GEN.send(message, { contentType: "json" }),
      catch: (error) => QueueError.make({ message: String(error) })
    });
  });

export const DispatchWorker = {
  run: Effect.fn("DispatchWorker.run")(function* () {
    const users = yield* UsersRepo;
    const dids = yield* users.listActive().pipe(Effect.flatMap(decodeDids));
    const batches = Array.chunksOf(dids, batchSize);

    const messages = Array.map(batches, (usersBatch, index) =>
      ({
        users: usersBatch,
        batchId: index + 1,
        generateAgg: index === 0
      }) satisfies FeedGenMessage
    );

    yield* Effect.forEach(messages, sendMessage, {
      concurrency: 3,
      discard: true
    });
  })
};
