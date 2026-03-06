import { Effect } from "effect";
import type { ExpertRecord, ExpertSeedManifest } from "../domain/bi";
import { ExpertsRepo } from "../services/ExpertsRepo";

export const computeShard = (did: string, shardCount: number) => {
  const safeShardCount = Math.max(1, shardCount);
  let hash = 0;
  for (const char of did) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % safeShardCount;
};

export const materializeExperts = (
  manifest: ExpertSeedManifest,
  shardCount: number,
  addedAt: number
): ReadonlyArray<ExpertRecord> =>
  manifest.experts.map((expert) => ({
    did: expert.did,
    handle: expert.handle ?? null,
    displayName: expert.displayName ?? null,
    description: expert.description ?? null,
    domain: manifest.domain,
    source: expert.source,
    sourceRef: expert.sourceRef ?? null,
    shard: computeShard(expert.did, shardCount),
    active: expert.active,
    addedAt,
    lastSyncedAt: null
  }));

export const bootstrapExperts = Effect.fn("bootstrapExperts")(function* (
  manifest: ExpertSeedManifest,
  shardCount: number,
  addedAt = Date.now()
) {
  const expertsRepo = yield* ExpertsRepo;
  const experts = materializeExperts(manifest, shardCount, addedAt);
  yield* expertsRepo.upsertMany(experts);

  return {
    domain: manifest.domain,
    count: experts.length
  };
});
