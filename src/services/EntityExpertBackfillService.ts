import { Clock, Effect, Exit, Layer, ServiceMap } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  EntitySnapshotStore,
  ExpertEntity,
  ReindexQueueService,
  asEntityIri,
  asEntityTag,
  expertFromLegacyRow
} from "@skygest/ontology-store";
import type { DbError } from "../domain/errors";
import type { ExpertRecord } from "../domain/bi";
import { ExpertsRepo } from "./ExpertsRepo";

export interface EntityExpertBackfillInput {
  readonly limit?: number;
  readonly offset?: number;
  readonly active?: boolean | null;
}

export interface EntityExpertBackfillResult {
  readonly total: number;
  readonly scanned: number;
  readonly migrated: number;
  readonly queued: number;
  readonly failed: number;
  readonly failedDids: ReadonlyArray<string>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const normalizeLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit)
    ? DEFAULT_LIMIT
    : Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));

const normalizeOffset = (offset: number | undefined): number =>
  offset === undefined || !Number.isFinite(offset)
    ? 0
    : Math.max(0, Math.floor(offset));

const toLegacyExpertRow = (record: ExpertRecord) => ({
  did: record.did,
  handle: record.handle,
  displayName: record.displayName,
  bio: record.description,
  tier: record.tier,
  primaryTopic: record.domain
});

export class EntityExpertBackfillService extends ServiceMap.Service<
  EntityExpertBackfillService,
  {
    readonly backfill: (
      input?: EntityExpertBackfillInput
    ) => Effect.Effect<EntityExpertBackfillResult, SqlError | DbError>;
  }
>()("@skygest/EntityExpertBackfillService") {
  static readonly layer = Layer.effect(
    EntityExpertBackfillService,
    Effect.gen(function* () {
      const experts = yield* ExpertsRepo;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const saveAndQueue = Effect.fn(
        "EntityExpertBackfillService.saveAndQueue"
      )(function* (record: ExpertRecord) {
        const expert = yield* expertFromLegacyRow(toLegacyExpertRow(record));
        const iri = asEntityIri(expert.iri);
        const now = yield* Clock.currentTimeMillis;

        yield* snapshots.save(ExpertEntity, expert);
        yield* queue.schedule({
          targetEntityType: asEntityTag("Expert"),
          targetIri: iri,
          originIri: iri,
          cause: "entity-changed",
          causePriority: 0,
          propagationDepth: 0,
          nextAttemptAt: now
        });
      });

      const backfill = Effect.fn("EntityExpertBackfillService.backfill")(
        function* (input?: EntityExpertBackfillInput) {
          const limit = normalizeLimit(input?.limit);
          const offset = normalizeOffset(input?.offset);
          const active = input?.active ?? true;
          const page = yield* experts.list(null, active, limit, offset);
          const dids = page.items.map((item) => item.did);
          const fullRecords = yield* experts.getByDids(dids);
          const fullRecordByDid = new Map(
            fullRecords.map((record) => [record.did, record])
          );
          const orderedRecords = dids.flatMap((did) => {
            const record = fullRecordByDid.get(did);
            return record === undefined ? [] : [record];
          });
          const missingDids = dids.filter((did) => !fullRecordByDid.has(did));

          const outcomes = yield* Effect.forEach(
            orderedRecords,
            (record) => Effect.exit(saveAndQueue(record)),
            { concurrency: 1 }
          );
          const migrated = outcomes.filter((outcome) => Exit.isSuccess(outcome))
            .length;
          const failedDids = [
            ...missingDids,
            ...outcomes.flatMap((outcome, index) =>
              Exit.isSuccess(outcome) ? [] : [orderedRecords[index]?.did ?? "unknown"]
            )
          ];

          return {
            total: page.total,
            scanned: page.items.length,
            migrated,
            queued: migrated,
            failed: page.items.length - migrated,
            failedDids
          };
        }
      );

      return EntityExpertBackfillService.of({ backfill });
    })
  );
}
