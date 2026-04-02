import { ServiceMap, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
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
import { resolveExpertTier } from "../ontology/expertTier";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { withMutationAudit } from "../platform/MutationLog";
import { BlueskyClient } from "../bluesky/BlueskyClient";
import { ExpertsRepo } from "./ExpertsRepo";
import { OntologyCatalog } from "./OntologyCatalog";

const MUTATION_LABEL = "expert registry mutation";

const toAdminExpertResult = (expert: ExpertRecord): AdminExpertResult => ({
  did: expert.did,
  handle: expert.handle,
  displayName: expert.displayName,
  avatar: expert.avatar,
  domain: expert.domain,
  shard: expert.shard,
  active: expert.active,
  source: expert.source,
  tier: expert.tier
});

export class ExpertRegistryService extends ServiceMap.Service<
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
      | DbError
    >;
    readonly setExpertActive: (
      actor: AccessIdentity,
      did: Did,
      input: SetExpertActiveInput
    ) => Effect.Effect<
      SetExpertActiveResult,
      ExpertNotFoundError | SqlError | DbError
    >;
    readonly listExperts: (
      input: ListExpertsInput
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError | DbError>;
    readonly refreshExpertProfile: (
      did: Did
    ) => Effect.Effect<ExpertRecord, ProfileLookupError | SqlError | DbError>;
  }
>()("@skygest/ExpertRegistryService") {
  static readonly layer = Layer.effect(
    ExpertRegistryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const bluesky = yield* BlueskyClient;
      const ontology = yield* OntologyCatalog;

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

      const syncProfileBackedExpert = (options: {
        readonly profile: ExpertRecord["did"] extends infer D ? { readonly did: D; readonly handle: ExpertRecord["handle"]; readonly displayName: ExpertRecord["displayName"]; readonly description: ExpertRecord["description"]; readonly avatar: ExpertRecord["avatar"] } : never;
        readonly domain: string;
        readonly source: ExpertRecord["source"];
        readonly sourceRef: ExpertRecord["sourceRef"];
        readonly active: boolean;
        readonly preserveMetadata: boolean;
      }) =>
        Effect.gen(function* () {
          const { profile } = options;
          const existing = yield* expertsRepo.getByDid(profile.did);
          const shard = existing?.shard ?? computeShard(profile.did, shardCount);
          const tier = resolveExpertTier(profile.handle, ontology.snapshot.authorTiers);
          const expert: ExpertRecord = {
            did: profile.did,
            handle: profile.handle,
            displayName: profile.displayName,
            description: profile.description,
            avatar: profile.avatar,
            domain: options.preserveMetadata && existing ? existing.domain : options.domain,
            source: options.preserveMetadata && existing ? existing.source : options.source,
            sourceRef: options.preserveMetadata && existing ? existing.sourceRef : options.sourceRef,
            shard,
            active: options.preserveMetadata && existing ? existing.active : options.active,
            tier,
            addedAt: existing?.addedAt ?? Date.now(),
            lastSyncedAt: Date.now()
          };

          yield* expertsRepo.upsert(expert);

          return expert;
        });

      const refreshExpertProfile = Effect.fn("ExpertRegistryService.refreshExpertProfile")(function* (
        did: Did
      ) {
        const profile = yield* bluesky.getProfile(did).pipe(
          Effect.mapError((error) =>
            ProfileLookupError.make({
              didOrHandle: did,
              message: error.message
            })
          )
        );
        return yield* syncProfileBackedExpert({
          profile,
          domain: config.defaultDomain,
          source: "manual",
          sourceRef: null,
          active: true,
          preserveMetadata: true
        });
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
          const expert = yield* syncProfileBackedExpert({
            profile,
            domain,
            source: "manual",
            sourceRef: null,
            active,
            preserveMetadata: false
          });

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

      return {
        addExpert,
        setExpertActive,
        listExperts,
        refreshExpertProfile
      };
    })
  );
}
