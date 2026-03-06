import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { InvalidShardRequestError } from "../src/domain/bi";
import type { IngestorRefreshRequest, JetstreamIngestorDoV2 } from "../src/ingest/IngestorDo";
import { AppConfig } from "../src/platform/Config";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import { IngestShardRefresher } from "../src/services/IngestShardRefresher";
import { testConfig } from "./support/runtime";

const makeNamespace = (calls: Array<{ readonly name: string; readonly input: IngestorRefreshRequest }>) =>
  ({
    getByName: (name: string) =>
      ({
        refresh: async (input: IngestorRefreshRequest) => {
          calls.push({ name, input });
          return { shard: input.shard };
        }
      })
  }) as unknown as DurableObjectNamespace<JetstreamIngestorDoV2>;

const makeLayer = (
  ingestShardCount: number,
  calls: Array<{ readonly name: string; readonly input: IngestorRefreshRequest }>
) => {
  const env: EnvBindings = {
    DB: {} as D1Database,
    JETSTREAM_INGESTOR: makeNamespace(calls)
  };

  const baseLayer = Layer.mergeAll(
    CloudflareEnv.layer(env, { required: ["DB", "JETSTREAM_INGESTOR"] }),
    Layer.succeed(AppConfig, testConfig({ ingestShardCount }))
  );

  return IngestShardRefresher.layer.pipe(Layer.provide(baseLayer));
};

describe("ingest shard refresher", () => {
  it.effect("uses typed DO RPC to refresh every shard", () => {
    const calls: Array<{ readonly name: string; readonly input: IngestorRefreshRequest }> = [];

    return Effect.gen(function* () {
      const refresher = yield* IngestShardRefresher;
      const refreshed = yield* refresher.refreshAllShards();

      expect(refreshed).toEqual([0, 1, 2]);
      expect(calls).toEqual([
        {
          name: "shard-0",
          input: { shard: 0, forceRefresh: true }
        },
        {
          name: "shard-1",
          input: { shard: 1, forceRefresh: true }
        },
        {
          name: "shard-2",
          input: { shard: 2, forceRefresh: true }
        }
      ]);
    }).pipe(Effect.provide(makeLayer(3, calls)));
  });

  it.effect("rejects invalid shard indexes before invoking the durable object", () => {
    const calls: Array<{ readonly name: string; readonly input: IngestorRefreshRequest }> = [];

    return Effect.gen(function* () {
      const refresher = yield* IngestShardRefresher;
      const error = yield* Effect.flip(refresher.refreshShard(5));

      expect(error).toBeInstanceOf(InvalidShardRequestError);
      expect(calls).toEqual([]);
    }).pipe(Effect.provide(makeLayer(2, calls)));
  });
});
