import { Effect } from "effect";
import type { ExpertRecord, ExpertSeed, ExpertSeedManifest } from "../domain/bi";
import { ExpertsRepo } from "../services/ExpertsRepo";

const isDefined = <A>(value: A | null): value is A => value !== null;

export const toExpertSeedHandleKey = (handle: string | null | undefined) => {
  const normalized = handle?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
};

const findDuplicateSeedIssues = (
  experts: ReadonlyArray<Pick<ExpertSeed, "did" | "handle">>
) => {
  const seenDids = new Set<string>();
  const duplicateDids = new Set<string>();
  const seenHandles = new Set<string>();
  const duplicateHandles = new Set<string>();

  for (const expert of experts) {
    if (seenDids.has(expert.did)) {
      duplicateDids.add(expert.did);
    } else {
      seenDids.add(expert.did);
    }

    const handleKey = toExpertSeedHandleKey(expert.handle);

    if (handleKey === null) {
      continue;
    }

    if (seenHandles.has(handleKey)) {
      duplicateHandles.add(handleKey);
    } else {
      seenHandles.add(handleKey);
    }
  }

  return [
    ...Array.from(duplicateDids, (did) => `duplicate did "${did}"`),
    ...Array.from(duplicateHandles, (handle) => `duplicate handle "${handle}"`)
  ];
};

export const assertUniqueExpertSeeds = (
  experts: ReadonlyArray<Pick<ExpertSeed, "did" | "handle">>,
  label: string
) => {
  const issues = findDuplicateSeedIssues(experts);

  if (issues.length > 0) {
    throw new Error(`invalid ${label}: ${issues.join(", ")}`);
  }
};

export const assertValidExpertSeedManifest = (
  manifest: ExpertSeedManifest
): ExpertSeedManifest => {
  assertUniqueExpertSeeds(
    manifest.experts,
    `expert seed manifest for domain "${manifest.domain}"`
  );

  return manifest;
};

export const mergeExpertSeedManifest = (
  manifest: ExpertSeedManifest,
  experts: ReadonlyArray<ExpertSeed>
): ExpertSeedManifest => {
  const validManifest = assertValidExpertSeedManifest(manifest);
  assertUniqueExpertSeeds(experts, "resolved expert seeds");

  const seenDids = new Set(validManifest.experts.map((expert) => expert.did));
  const seenHandles = new Set(
    validManifest.experts
      .map((expert) => toExpertSeedHandleKey(expert.handle))
      .filter(isDefined)
  );
  const mergedExperts = [...validManifest.experts];

  for (const expert of experts) {
    const handleKey = toExpertSeedHandleKey(expert.handle);

    if (seenDids.has(expert.did)) {
      continue;
    }

    if (handleKey !== null && seenHandles.has(handleKey)) {
      continue;
    }

    mergedExperts.push(expert);
    seenDids.add(expert.did);

    if (handleKey !== null) {
      seenHandles.add(handleKey);
    }
  }

  return assertValidExpertSeedManifest({
    domain: validManifest.domain,
    experts: mergedExperts
  });
};

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
  assertValidExpertSeedManifest(manifest).experts.map((expert) => ({
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
