import { Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import type { ExpertRecord } from "../src/domain/bi";
import { BlueskyApiError, PollerBusyError } from "../src/domain/errors";
import { Did } from "../src/domain/types";
import { ExpertPoller } from "../src/ingest/ExpertPoller";
import { PollCoordinator } from "../src/ingest/PollCoordinator";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { IngestLeaseRepo } from "../src/services/IngestLeaseRepo";

const decodeDid = Schema.decodeUnknownSync(Did);

const expertA: ExpertRecord = {
  did: decodeDid("did:plc:expert-a"),
  handle: "expert-a.test",
  displayName: "Expert A",
  description: null,
  domain: "energy",
  source: "manual" as const,
  sourceRef: null,
  shard: 0,
  active: true,
  addedAt: 1,
  lastSyncedAt: null
};

const expertB: ExpertRecord = {
  did: decodeDid("did:plc:expert-b"),
  handle: "expert-b.test",
  displayName: "Expert B",
  description: null,
  domain: "energy",
  source: "manual" as const,
  sourceRef: null,
  shard: 0,
  active: true,
  addedAt: 2,
  lastSyncedAt: null
};

const makeExpertsRepoLayer = () =>
  Layer.succeed(ExpertsRepo, {
    upsert: () => Effect.void,
    upsertMany: () => Effect.void,
    getByDid: (did: string) => Effect.succeed([expertA, expertB].find((expert) => expert.did === did) ?? null),
    setActive: () => Effect.void,
    setLastSyncedAt: () => Effect.void,
    listActive: () => Effect.succeed([expertA, expertB]),
    listActiveByShard: () => Effect.succeed([]),
    list: () => Effect.succeed([])
  });

describe("PollCoordinator", () => {
  it.live("returns PollerBusyError when the lease cannot be acquired", () =>
    Effect.promise(async () => {
      const baseLayer = Layer.mergeAll(
        makeExpertsRepoLayer(),
        Layer.succeed(IngestLeaseRepo, {
          tryAcquire: () => Effect.succeed(false),
          renew: () => Effect.succeed(true),
          release: () => Effect.void
        }),
        Layer.succeed(ExpertPoller, {
          poll: () => Effect.die("unexpected poll")
        })
      );
      const layer = Layer.mergeAll(
        baseLayer,
        PollCoordinator.layer.pipe(Layer.provideMerge(baseLayer))
      );

      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.flatMap(PollCoordinator, (coordinator) =>
              coordinator.run({ mode: "head" })
            ).pipe(Effect.provide(layer))
          )
        )
      );

      expect(error).toBeInstanceOf(PollerBusyError);
    })
  );

  it.live("aggregates expert poll results and records failures", () =>
    Effect.promise(async () => {
      let released = 0;
      let renewals = 0;
      const baseLayer = Layer.mergeAll(
        makeExpertsRepoLayer(),
        Layer.succeed(IngestLeaseRepo, {
          tryAcquire: () => Effect.succeed(true),
          renew: () =>
            Effect.sync(() => {
              renewals += 1;
              return true;
            }),
          release: () =>
            Effect.sync(() => {
              released += 1;
            })
        }),
        Layer.succeed(ExpertPoller, {
          poll: (expert: ExpertRecord) =>
            expert.did === expertA.did
              ? Effect.succeed({
                pagesFetched: 2,
                postsSeen: 5,
                postsStored: 3,
                postsDeleted: 1
              })
              : Effect.fail(
                BlueskyApiError.make({
                  message: "boom",
                  status: 503
                })
              )
        })
      );
      const layer = Layer.mergeAll(
        baseLayer,
        PollCoordinator.layer.pipe(Layer.provideMerge(baseLayer))
      );

      const summary = await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(PollCoordinator, (coordinator) =>
            coordinator.run({ mode: "head" })
          ).pipe(Effect.provide(layer))
        )
      );

      expect(summary.expertsTotal).toBe(2);
      expect(summary.expertsSucceeded).toBe(1);
      expect(summary.expertsFailed).toBe(1);
      expect(summary.pagesFetched).toBe(2);
      expect(summary.postsSeen).toBe(5);
      expect(summary.postsStored).toBe(3);
      expect(summary.postsDeleted).toBe(1);
      expect(summary.failures).toEqual([
        {
          did: expertB.did,
          message: "boom"
        }
      ]);
      expect(renewals).toBe(2);
      expect(released).toBe(1);
    })
  );
});
