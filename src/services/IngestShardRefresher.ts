import { Context, Effect, Layer } from "effect";
import { AppConfig } from "../platform/Config";
import { CloudflareEnv } from "../platform/Env";
import { IngestorPingError } from "../domain/errors";
import { InvalidShardRequestError } from "../domain/bi";

export class IngestShardRefresher extends Context.Tag("@skygest/IngestShardRefresher")<
  IngestShardRefresher,
  {
    readonly refreshShard: (
      shard: number
    ) => Effect.Effect<ReadonlyArray<number>, InvalidShardRequestError | IngestorPingError>;
    readonly refreshAllShards: () => Effect.Effect<ReadonlyArray<number>, IngestorPingError>;
  }
>() {
  static readonly layer = Layer.effect(
    IngestShardRefresher,
    Effect.gen(function* () {
      const env = yield* CloudflareEnv;
      const config = yield* AppConfig;
      const namespace = env.JETSTREAM_INGESTOR;

      if (!namespace) {
        return yield* IngestorPingError.make({
          message: "JETSTREAM_INGESTOR binding is missing"
        });
      }

      const shardCount = Math.max(1, Math.trunc(config.ingestShardCount));

      const validateShard = (
        shard: number
      ): Effect.Effect<number, InvalidShardRequestError> => {
        if (Number.isInteger(shard) && shard >= 0 && shard < shardCount) {
          return Effect.succeed(shard);
        }

        return Effect.fail(InvalidShardRequestError.make({
          message: `shard must be between 0 and ${String(shardCount - 1)}`,
          shard
        }));
      };

      const pingShard = (shard: number) =>
        Effect.tryPromise({
          try: async () => {
            const stub = namespace.getByName(`shard-${shard}`);
            const result = await stub.refresh({
              shard,
              forceRefresh: true
            });

            return result.shard;
          },
          catch: (error) =>
            IngestorPingError.make({
              message: error instanceof Error ? error.message : String(error)
            })
        });

      const refreshShard = (shard: number) =>
        validateShard(shard).pipe(
          Effect.flatMap((safeShard) => pingShard(safeShard)),
          Effect.map((refreshedShard) => [refreshedShard] as const)
        );

      const refreshAllShards = () =>
        Effect.forEach(
          Array.from({ length: shardCount }, (_, shard) => shard),
          pingShard
        );

      return IngestShardRefresher.of({
        refreshShard,
        refreshAllShards
      });
    })
  );
}
