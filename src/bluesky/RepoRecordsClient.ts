import { Cache, Clock, ServiceMap, Duration, Effect, Option, Result, Layer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import { BlueskyClient } from "./BlueskyClient";
import { BlueskyApiError } from "../domain/errors";
import type {
  ExpertSyncStateRecord,
  ListRecordsResult,
  RepoListRecordsInput
} from "../domain/polling";
import type { Did } from "../domain/types";
import { ExpertSyncStateRepo } from "../services/ExpertSyncStateRepo";

const PDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type RepoServiceResolution = {
  readonly serviceUrl: string;
  readonly source: "hint" | "remote";
};

const defaultSyncState = (did: Did): ExpertSyncStateRecord => ({
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
  lastError: null
});

const hasFreshPdsHint = (
  state: ExpertSyncStateRecord | null,
  now: number
): state is ExpertSyncStateRecord & { readonly pdsUrl: string; readonly pdsVerifiedAt: number } =>
  state !== null &&
  state.pdsUrl !== null &&
  state.pdsVerifiedAt !== null &&
  now - state.pdsVerifiedAt < PDS_CACHE_TTL_MS;

const shouldRefreshRepoEndpoint = (error: BlueskyApiError) =>
  error.status === 404 || error.status === undefined;

export class RepoRecordsClient extends ServiceMap.Service<
  RepoRecordsClient,
  {
    readonly listRecords: (
      input: RepoListRecordsInput
    ) => Effect.Effect<ListRecordsResult, BlueskyApiError | SqlError | DbError>;
    readonly invalidateRepo: (repo: Did) => Effect.Effect<void>;
  }
>()("@skygest/RepoRecordsClient") {
  static readonly layer = Layer.effect(
    RepoRecordsClient,
    Effect.gen(function* () {
      const bluesky = yield* BlueskyClient;
      const syncStateRepo = yield* ExpertSyncStateRepo;

      const resolveRemotely = Effect.fn("RepoRecordsClient.resolveRemotely")(function* (
        repo: Did
      ) {
        const now = yield* Clock.currentTimeMillis;
        const state = yield* syncStateRepo.getByDid(repo);
        const serviceUrl = yield* bluesky.resolveRepoService(repo);
        const nextState: ExpertSyncStateRecord = {
          ...(state ?? defaultSyncState(repo)),
          pdsUrl: serviceUrl,
          pdsVerifiedAt: now
        };

        yield* syncStateRepo.upsert(nextState);

        return {
          serviceUrl,
          source: "remote" as const
        } satisfies RepoServiceResolution;
      });

      const repoServiceCache = yield* Cache.make({
        capacity: 2048,
        timeToLive: Duration.millis(PDS_CACHE_TTL_MS),
        lookup: (repo: Did) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const state = yield* syncStateRepo.getByDid(repo);

            if (hasFreshPdsHint(state, now)) {
              return {
                serviceUrl: state.pdsUrl,
                source: "hint" as const
              } satisfies RepoServiceResolution;
            }

            return yield* resolveRemotely(repo);
          })
      });

      const refreshRepoService = Effect.fn("RepoRecordsClient.refreshRepoService")(function* (
        repo: Did
      ) {
        const resolution = yield* resolveRemotely(repo);
        yield* Cache.set(repoServiceCache, repo, resolution);
        return resolution;
      });

      const resolveForRequest = Effect.fn("RepoRecordsClient.resolveForRequest")(function* (
        repo: Did
      ) {
        const resolution = yield* Cache.get(repoServiceCache, repo);
        return {
          resolution,
          usedCachedOrHinted: resolution.source === "hint"
        };
      });

      const invalidateRepo = Effect.fn("RepoRecordsClient.invalidateRepo")(function* (repo: Did) {
        yield* Cache.invalidate(repoServiceCache, repo);
      });

      const listRecords = Effect.fn("RepoRecordsClient.listRecords")(function* (
        input: RepoListRecordsInput
      ) {
        const { resolution, usedCachedOrHinted } = yield* resolveForRequest(input.repo);

        const runListRecords = (serviceUrl: string) =>
          bluesky.listRecordsAtService({
            ...input,
            serviceUrl
          });

        return yield* runListRecords(resolution.serviceUrl).pipe(
          Effect.catchTag("BlueskyApiError", (error) =>
            usedCachedOrHinted && shouldRefreshRepoEndpoint(error)
              ? invalidateRepo(input.repo).pipe(
                  Effect.andThen(refreshRepoService(input.repo)),
                  Effect.flatMap((refreshed) => runListRecords(refreshed.serviceUrl))
                )
              : Effect.fail(error)
          )
        );
      });

      return {
        listRecords,
        invalidateRepo
      };
    })
  );
}
