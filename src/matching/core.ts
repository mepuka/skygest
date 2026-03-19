import { Chunk, HashMap, Option, Order } from "effect";

export type RankedSignal = {
  readonly signal: string;
  readonly rank: number;
};

export type Evidence<EntityId, Signal extends RankedSignal> = {
  readonly entityId: EntityId;
  readonly signal: Signal;
};

export type EvidenceBucket<EntityId, Signal extends RankedSignal> = {
  readonly entityId: EntityId;
  readonly bestRank: number;
  readonly evidence: Chunk.Chunk<Evidence<EntityId, Signal>>;
};

export type EvidenceIndex<EntityId, Signal extends RankedSignal> = HashMap.HashMap<
  EntityId,
  EvidenceBucket<EntityId, Signal>
>;

export type SingleResolution<EntityId, Signal extends RankedSignal> =
  | {
      readonly _tag: "Unmatched";
    }
  | {
      readonly _tag: "Matched";
      readonly winner: EvidenceBucket<EntityId, Signal>;
    }
  | {
      readonly _tag: "Ambiguous";
      readonly candidates: Chunk.Chunk<EvidenceBucket<EntityId, Signal>>;
    };

export const collectEvidence = <EntityId, Signal extends RankedSignal>(
  items: Iterable<Evidence<EntityId, Signal>>
): EvidenceIndex<EntityId, Signal> =>
  HashMap.mutate(
    HashMap.empty<EntityId, EvidenceBucket<EntityId, Signal>>(),
    (index) => {
      for (const item of items) {
        const existing = HashMap.get(index, item.entityId);
        const nextBucket = Option.match(existing, {
          onNone: () => ({
            entityId: item.entityId,
            bestRank: item.signal.rank,
            evidence: Chunk.of(item)
          }),
          onSome: (bucket) => ({
            entityId: bucket.entityId,
            bestRank: Math.min(bucket.bestRank, item.signal.rank),
            evidence: Chunk.append(bucket.evidence, item)
          })
        });

        HashMap.set(index, item.entityId, nextBucket);
      }
    }
  );

export const resolveUniqueBest = <EntityId extends string, Signal extends RankedSignal>(
  index: EvidenceIndex<EntityId, Signal>
): SingleResolution<EntityId, Signal> => {
  if (HashMap.isEmpty(index)) {
    return { _tag: "Unmatched" };
  }

  const buckets = Chunk.sort(
    Chunk.fromIterable(HashMap.values(index)),
    Order.mapInput(
      Order.tuple(Order.number, Order.string),
      (bucket: EvidenceBucket<EntityId, Signal>) =>
        [bucket.bestRank, bucket.entityId] as const
    )
  );
  const bestRank = Chunk.unsafeGet(buckets, 0).bestRank;
  const top = Chunk.filter(buckets, (bucket) => bucket.bestRank === bestRank);

  return Chunk.size(top) === 1
    ? { _tag: "Matched", winner: Chunk.unsafeGet(top, 0) }
    : { _tag: "Ambiguous", candidates: top };
};
