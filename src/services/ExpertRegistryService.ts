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
  type ListExpertsInput,
  ProfileLookupError,
  type SetExpertActiveInput,
  type SetExpertActiveResult
} from "../domain/bi";
import { BlueskyApiError } from "../domain/errors";
import type { Did } from "../domain/types";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { withMutationAudit } from "../platform/MutationLog";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { ExpertsRepo } from "./ExpertsRepo";

const MUTATION_LABEL = "expert registry mutation";

const toAdminExpertResult = (expert: ExpertRecord): AdminExpertResult => ({
  did: expert.did,
  handle: expert.handle,
  displayName: expert.displayName,
  domain: expert.domain,
  shard: expert.shard,
  active: expert.active,
  source: expert.source
});

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
      | SqlError
    >;
    readonly setExpertActive: (
      actor: AccessIdentity,
      did: Did,
      input: SetExpertActiveInput
    ) => Effect.Effect<
      SetExpertActiveResult,
      ExpertNotFoundError | SqlError
    >;
    readonly listExperts: (
      input: ListExpertsInput
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError>;
  }
>() {
  static readonly layer = Layer.effect(
    ExpertRegistryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const bluesky = yield* BlueskyClient;

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

          return toAdminExpertResult(expert);
        });

        return yield* program.pipe(
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: "add_expert",
            annotations: {
              didOrHandle,
              domain
            },
            onSuccess: (expert) => ({
              targetDid: expert.did,
              resolvedHandle: expert.handle,
              shard: expert.shard
            })
          })
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

          return {
            did: existing.did,
            active: input.active,
            shard: existing.shard
          } satisfies SetExpertActiveResult;
        });

        return yield* program.pipe(
          withMutationAudit({
            label: MUTATION_LABEL,
            actor,
            action: input.active ? "activate_expert" : "deactivate_expert",
            annotations: {
              targetDid: did
            },
            onSuccess: (result) => ({
              active: result.active,
              shard: result.shard
            })
          })
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

      return ExpertRegistryService.of({
        addExpert,
        setExpertActive,
        listExperts
      });
    })
  );
}
