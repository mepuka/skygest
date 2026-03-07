import { Cache, Clock, Context, Duration, Effect, Either, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
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

export class RepoRecordsClient extends Context.Tag("@skygest/RepoRecordsClient")<
  RepoRecordsClient,
  {
    readonly listRecords: (
      input: RepoListRecordsInput
    ) => Effect.Effect<ListRecordsResult, BlueskyApiError | SqlError>;
    readonly invalidateRepo: (repo: Did) => Effect.Effect<void>;
  }
>() {
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
        yield* repoServiceCache.set(repo, resolution);
        return resolution;
      });

      const resolveForRequest = Effect.fn("RepoRecordsClient.resolveForRequest")(function* (
        repo: Did
      ) {
        const cachedOrLoaded = yield* repoServiceCache.getEither(repo);

        if (Either.isLeft(cachedOrLoaded)) {
          return {
            resolution: cachedOrLoaded.left,
            usedCachedOrHinted: true
          };
        }

        return {
          resolution: cachedOrLoaded.right,
          usedCachedOrHinted: cachedOrLoaded.right.source === "hint"
        };
      });

      const invalidateRepo = Effect.fn("RepoRecordsClient.invalidateRepo")(function* (repo: Did) {
        yield* repoServiceCache.invalidate(repo);
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
                  Effect.zipRight(refreshRepoService(input.repo)),
                  Effect.flatMap((refreshed) => runListRecords(refreshed.serviceUrl))
                )
              : Effect.fail(error)
          )
        );
      });

      return RepoRecordsClient.of({
        listRecords,
        invalidateRepo
      });
    })
  );
}
