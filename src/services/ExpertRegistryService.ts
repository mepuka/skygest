import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { AccessIdentity } from "../auth/AuthService";
import { computeShard } from "../bootstrap/ExpertSeeds";
import {
  type AddExpertInput,
  type AdminExpertResult,
  type ExpertListItem,
  type ExpertRecord,
  ExpertNotFoundError,
  HandleResolutionError,
  InvalidShardRequestError,
  type ListExpertsInput,
  ProfileLookupError,
  type RefreshShardsInput,
  type RefreshShardsResult,
  type SetExpertActiveInput,
  type SetExpertActiveResult
} from "../domain/bi";
import { BlueskyApiError, IngestorPingError } from "../domain/errors";
import type { Did } from "../domain/types";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { ExpertsRepo } from "./ExpertsRepo";
import { IngestShardRefresher } from "./IngestShardRefresher";

const toAdminExpertResult = (expert: ExpertRecord): AdminExpertResult => ({
  did: expert.did,
  handle: expert.handle,
  displayName: expert.displayName,
  domain: expert.domain,
  shard: expert.shard,
  active: expert.active,
  source: expert.source
});

const makeAnnotations = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) => {
  const result: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries({
    actorSubject: actor.subject,
    actorEmail: actor.email,
    ...annotations
  })) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }

  return result;
};

const logMutationSuccess = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) =>
  Effect.logInfo("expert registry mutation").pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      outcome: "success"
    }))
  );

const logMutationFailure = (
  actor: AccessIdentity,
  annotations: Record<string, string | number | boolean | null | undefined>
) =>
  Effect.logWarning("expert registry mutation").pipe(
    Effect.annotateLogs(makeAnnotations(actor, {
      ...annotations,
      outcome: "failure"
    }))
  );

export class ExpertRegistryService extends Context.Tag("@skygest/ExpertRegistryService")<
  ExpertRegistryService,
  {
    readonly addExpert: (
      actor: AccessIdentity,
      input: AddExpertInput
    ) => Effect.Effect<
      AdminExpertResult,
      | HandleResolutionError
      | ProfileLookupError
      | InvalidShardRequestError
      | IngestorPingError
      | SqlError
    >;
    readonly setExpertActive: (
      actor: AccessIdentity,
      did: Did,
      input: SetExpertActiveInput
    ) => Effect.Effect<
      SetExpertActiveResult,
      ExpertNotFoundError | InvalidShardRequestError | IngestorPingError | SqlError
    >;
    readonly listExperts: (
      input: ListExpertsInput
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError>;
    readonly refreshShards: (
      actor: AccessIdentity,
      input: RefreshShardsInput
    ) => Effect.Effect<
      RefreshShardsResult,
      InvalidShardRequestError | IngestorPingError
    >;
  }
>() {
  static readonly layer = Layer.effect(
    ExpertRegistryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const bluesky = yield* BlueskyClient;
      const refresher = yield* IngestShardRefresher;

      const shardCount = Math.max(1, Math.trunc(config.ingestShardCount));

      const mapBlueskyError = (
        error: BlueskyApiError,
        didOrHandle: string,
        tag: "resolve" | "profile"
      ) =>
        tag === "resolve"
          ? HandleResolutionError.make({
            didOrHandle,
            message: error.message
          })
          : ProfileLookupError.make({
            didOrHandle,
            message: error.message
          });

      const addExpert = Effect.fn("ExpertRegistryService.addExpert")(function* (
        actor: AccessIdentity,
        input: AddExpertInput
      ) {
        const didOrHandle = input.didOrHandle.trim();
        const domain = input.domain?.trim().length
          ? input.domain.trim()
          : config.defaultDomain;
        const active = input.active ?? true;

        const program = Effect.gen(function* () {
          const resolved = didOrHandle.startsWith("did:")
            ? { did: didOrHandle, handle: null }
            : yield* bluesky.resolveDidOrHandle(didOrHandle).pipe(
              Effect.mapError((error) => mapBlueskyError(error, didOrHandle, "resolve"))
            );
          const profile = yield* bluesky.getProfile(resolved.did).pipe(
            Effect.mapError((error) => mapBlueskyError(error, didOrHandle, "profile"))
          );
          const existing = yield* expertsRepo.getByDid(profile.did);
          const shard = computeShard(profile.did, shardCount);
          const expert: ExpertRecord = {
            did: profile.did,
            handle: profile.handle,
            displayName: profile.displayName,
            description: profile.description,
            domain,
            source: "manual",
            sourceRef: null,
            shard,
            active,
            addedAt: existing?.addedAt ?? Date.now(),
            lastSyncedAt: existing?.lastSyncedAt ?? null
          };

          yield* expertsRepo.upsert(expert);
          yield* refresher.refreshShard(shard);
          yield* logMutationSuccess(actor, {
            action: "add_expert",
            targetDid: expert.did,
            resolvedHandle: expert.handle,
            domain: expert.domain,
            shard: expert.shard
          });

          return toAdminExpertResult(expert);
        });

        return yield* program.pipe(
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: "add_expert",
              didOrHandle,
              domain
            })
          )
        );
      });

      const setExpertActive = Effect.fn("ExpertRegistryService.setExpertActive")(function* (
        actor: AccessIdentity,
        did: Did,
        input: SetExpertActiveInput
      ) {
        const program = Effect.gen(function* () {
          const existing = yield* expertsRepo.getByDid(did);
          if (existing === null) {
            return yield* ExpertNotFoundError.make({ did });
          }

          yield* expertsRepo.setActive(did, input.active);
          yield* refresher.refreshShard(existing.shard);
          yield* logMutationSuccess(actor, {
            action: input.active ? "activate_expert" : "deactivate_expert",
            targetDid: existing.did,
            resolvedHandle: existing.handle,
            domain: existing.domain,
            shard: existing.shard
          });

          return {
            did: existing.did,
            active: input.active,
            shard: existing.shard
          } satisfies SetExpertActiveResult;
        });

        return yield* program.pipe(
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: input.active ? "activate_expert" : "deactivate_expert",
              targetDid: did
            })
          )
        );
      });

      const listExperts = Effect.fn("ExpertRegistryService.listExperts")(function* (
        input: ListExpertsInput
      ) {
        return yield* expertsRepo.list(
          input.domain ?? null,
          input.active ?? null,
          clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        );
      });

      const refreshShards = Effect.fn("ExpertRegistryService.refreshShards")(function* (
        actor: AccessIdentity,
        input: RefreshShardsInput
      ) {
        const program = (input.shard === undefined
          ? refresher.refreshAllShards()
          : refresher.refreshShard(input.shard)).pipe(
          Effect.map((refreshedShards) => ({
            refreshedShards
          } satisfies RefreshShardsResult))
        );

        return yield* program.pipe(
          Effect.tap((result) =>
            logMutationSuccess(actor, {
              action: "refresh_shards",
              shard: input.shard,
              refreshedCount: result.refreshedShards.length
            })
          ),
          Effect.tapError(() =>
            logMutationFailure(actor, {
              action: "refresh_shards",
              shard: input.shard
            })
          )
        );
      });

      return ExpertRegistryService.of({
        addExpert,
        setExpertActive,
        listExperts,
        refreshShards
      });
    })
  );
}
