import { Deferred, Duration, Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { RepoRecordsClient } from "../src/bluesky/RepoRecordsClient";
import { BlueskyApiError } from "../src/domain/errors";
import type {
  ExpertSyncStateRecord,
  ListRecordsResult as ListRecordsResultShape,
  ServiceListRecordsInput
} from "../src/domain/polling";
import { ListRecordsResult } from "../src/domain/polling";
import { Did } from "../src/domain/types";
import { ExpertSyncStateRepo } from "../src/services/ExpertSyncStateRepo";

const PDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const decodeDid = Schema.decodeUnknownSync(Did);
const repo = decodeDid("did:plc:expert-a");

const defaultSyncState = (
  did: typeof repo,
  overrides: Partial<ExpertSyncStateRecord> = {}
): ExpertSyncStateRecord => ({
  did,
  pdsUrl: null,
  pdsVerifiedAt: null,
  headUri: null,
  headRkey: null,
  headCreatedAt: null,
  lastPolledAt: null,
  lastCompletedAt: null,
  backfillCursor: null,
  backfillStatus: "idle",
  lastError: null,
  ...overrides
});

const makeSyncStateLayer = (states: Iterable<ExpertSyncStateRecord> = []) => {
  const store = new Map(Array.from(states, (state) => [state.did, state] as const));

  return {
    store,
    layer: Layer.succeed(ExpertSyncStateRepo, {
      getByDid: (did) => Effect.succeed(store.get(did) ?? null),
      upsert: (state) =>
        Effect.sync(() => {
          store.set(state.did, state);
        })
    })
  };
};

const makeBlueskyLayer = (options?: {
  readonly resolveRepoService?: (
    did: string
  ) => Effect.Effect<string, BlueskyApiError>;
  readonly listRecordsAtService?: (
    input: ServiceListRecordsInput
  ) => Effect.Effect<ListRecordsResultShape, BlueskyApiError>;
}) =>
  Layer.succeed(BlueskyClient, {
    resolveDidOrHandle: () => Effect.die("unexpected resolveDidOrHandle"),
    getProfile: () => Effect.die("unexpected getProfile"),
    getFollows: () => Effect.die("unexpected getFollows"),
    resolveRepoService: options?.resolveRepoService ?? (() => Effect.die("unexpected resolveRepoService")),
    listRecordsAtService: options?.listRecordsAtService ?? (() => Effect.die("unexpected listRecordsAtService")),
    getPostThread: () => Effect.die("unexpected getPostThread"),
    getPosts: () => Effect.die("unexpected getPosts")
  });

const makeRepoRecordsLayer = (
  blueskyLayer: Layer.Layer<BlueskyClient>,
  syncStateLayer: Layer.Layer<ExpertSyncStateRepo>
) => {
  const baseLayer = Layer.mergeAll(blueskyLayer, syncStateLayer);

  return Layer.mergeAll(
    baseLayer,
    RepoRecordsClient.layer.pipe(Layer.provideMerge(baseLayer))
  );
};

const listRepoRecords = Effect.gen(function* () {
  const client = yield* RepoRecordsClient;
  return yield* client.listRecords({
    repo,
    collection: "app.bsky.feed.post",
    limit: 100,
    reverse: true
  });
});

describe("RepoRecordsClient", () => {
  it.effect("uses a fresh D1 hint without resolving the repo service remotely", () =>
    Effect.gen(function* () {
      const syncState = makeSyncStateLayer([
        defaultSyncState(repo, {
          pdsUrl: "https://hint.example.com",
          pdsVerifiedAt: 0
        })
      ]);
      let resolveCalls = 0;
      const listCalls: Array<string> = [];
      const layer = makeRepoRecordsLayer(
        makeBlueskyLayer({
          resolveRepoService: () =>
            Effect.sync(() => {
              resolveCalls += 1;
              return "https://remote.example.com";
            }),
          listRecordsAtService: ({ serviceUrl }) =>
            Effect.sync(() => {
              listCalls.push(serviceUrl);
              return {
                records: [],
                cursor: null
              };
            })
        }),
        syncState.layer
      );

      const result = yield* listRepoRecords.pipe(Effect.provide(layer));

      expect(result.records).toEqual([]);
      expect(resolveCalls).toBe(0);
      expect(listCalls).toEqual(["https://hint.example.com"]);
      expect(syncState.store.get(repo)?.pdsUrl).toBe("https://hint.example.com");
      expect(syncState.store.get(repo)?.pdsVerifiedAt).toBe(0);
    })
  );

  it("normalizes missing cursors from Bluesky list-record responses to null", () => {
    const decode = Schema.decodeUnknownSync(ListRecordsResult);
    const result = decode({ records: [] });

    expect(result.cursor).toBeNull();
  });

  it.effect("resolves stale hints remotely and persists the fresh service URL", () =>
    Effect.gen(function* () {
      yield* TestClock.adjust(Duration.millis(PDS_CACHE_TTL_MS + 1));

      const syncState = makeSyncStateLayer([
        defaultSyncState(repo, {
          pdsUrl: "https://stale.example.com",
          pdsVerifiedAt: 0
        })
      ]);
      let resolveCalls = 0;
      const layer = makeRepoRecordsLayer(
        makeBlueskyLayer({
          resolveRepoService: () =>
            Effect.sync(() => {
              resolveCalls += 1;
              return "https://fresh.example.com";
            }),
          listRecordsAtService: ({ serviceUrl }) =>
            Effect.succeed({
              records: [],
              cursor: null
            }).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  expect(serviceUrl).toBe("https://fresh.example.com");
                })
              )
            )
        }),
        syncState.layer
      );

      yield* listRepoRecords.pipe(Effect.provide(layer));

      expect(resolveCalls).toBe(1);
      expect(syncState.store.get(repo)?.pdsUrl).toBe("https://fresh.example.com");
      expect(syncState.store.get(repo)?.pdsVerifiedAt).toBe(PDS_CACHE_TTL_MS + 1);
    })
  );

  it.effect("deduplicates concurrent service resolution for the same repo", () =>
    Effect.gen(function* () {
      const syncState = makeSyncStateLayer();
      const gate = yield* Deferred.make<void>();
      const started = yield* Deferred.make<void>();
      let resolveCalls = 0;
      let listCalls = 0;
      const layer = makeRepoRecordsLayer(
        makeBlueskyLayer({
          resolveRepoService: () =>
            Effect.gen(function* () {
              resolveCalls += 1;
              yield* Deferred.complete(started, Effect.void);
              yield* Deferred.await(gate);
              return "https://fresh.example.com";
            }),
          listRecordsAtService: () =>
            Effect.sync(() => {
              listCalls += 1;
              return {
                records: [],
                cursor: null
              };
            })
        }),
        syncState.layer
      );

      const fiber = yield* Effect.all([listRepoRecords, listRepoRecords], {
        concurrency: "unbounded"
      }).pipe(
        Effect.provide(layer),
        Effect.forkChild
      );

      yield* Deferred.await(started);

      expect(resolveCalls).toBe(1);

      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(fiber);

      expect(resolveCalls).toBe(1);
      expect(listCalls).toBe(2);
      expect(syncState.store.get(repo)?.pdsUrl).toBe("https://fresh.example.com");
    })
  );

  it.effect("invalidates cached stale endpoints, re-resolves once, and retries", () =>
    Effect.gen(function* () {
      const syncState = makeSyncStateLayer([
        defaultSyncState(repo, {
          pdsUrl: "https://stale.example.com",
          pdsVerifiedAt: 0
        })
      ]);
      let resolveCalls = 0;
      const listCalls: Array<string> = [];
      const layer = makeRepoRecordsLayer(
        makeBlueskyLayer({
          resolveRepoService: () =>
            Effect.sync(() => {
              resolveCalls += 1;
              return "https://fresh.example.com";
            }),
          listRecordsAtService: ({ serviceUrl }) =>
            Effect.sync(() => {
              listCalls.push(serviceUrl);
            }).pipe(
              Effect.andThen(
                serviceUrl === "https://stale.example.com"
                  ? Effect.fail(
                      new BlueskyApiError({
                        message: "not found",
                        status: 404
                      })
                    )
                  : Effect.succeed({
                      records: [],
                      cursor: null
                    })
              )
            )
        }),
        syncState.layer
      );

      yield* listRepoRecords.pipe(Effect.provide(layer));

      expect(resolveCalls).toBe(1);
      expect(listCalls).toEqual([
        "https://stale.example.com",
        "https://fresh.example.com"
      ]);
      expect(syncState.store.get(repo)?.pdsUrl).toBe("https://fresh.example.com");
    })
  );
});
