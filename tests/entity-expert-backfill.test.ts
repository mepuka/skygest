import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  ExpertEntity,
  ExpertIri,
  ReindexQueueD1,
  ReindexQueueService
} from "@skygest/ontology-store";
import { ExpertRecord as ExpertRecordSchema } from "../src/domain/bi";
import type { ExpertRecord } from "../src/domain/bi";
import { EntityExpertBackfillService } from "../src/services/EntityExpertBackfillService";
import { ExpertsRepo } from "../src/services/ExpertsRepo";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installEntityGraphSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const expertRecord = (input: {
  readonly did: string;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly description: string | null;
  readonly domain: string;
}): ExpertRecord =>
  Schema.decodeUnknownSync(ExpertRecordSchema)({
    ...input,
    avatar: null,
    source: "manual",
    sourceRef: null,
    shard: 0,
    active: true,
    tier: "energy-focused",
    addedAt: 1,
    lastSyncedAt: null
  });

const makeExpertsLayer = (records: ReadonlyArray<ExpertRecord>) =>
  Layer.succeed(ExpertsRepo, {
    upsert: () => Effect.void,
    upsertMany: () => Effect.void,
    getByDid: (did: string) =>
      Effect.succeed(records.find((record) => record.did === did) ?? null),
    setActive: () => Effect.void,
    setLastSyncedAt: () => Effect.void,
    listActive: () => Effect.succeed(records),
    listActiveByShard: () => Effect.succeed([]),
    list: (_domain, active, limit, offset) => {
      const filtered = records.filter((record) =>
        active === null ? true : record.active === active
      );
      const page = filtered.slice(offset, offset + limit);
      return Effect.succeed({
        total: filtered.length,
        items: page.map((record) => ({
          did: record.did,
          handle: record.handle,
          displayName: record.displayName,
          avatar: record.avatar,
          domain: record.domain,
          source: record.source,
          active: record.active,
          tier: record.tier
        }))
      });
    },
    getByDids: (dids) =>
      Effect.succeed(
        records.filter((record) => dids.includes(record.did))
      )
  });

const makeServiceLayer = (records: ReadonlyArray<ExpertRecord>) => {
  const expertsLayer = makeExpertsLayer(records);
  const snapshotLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const queueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const backfillLayer = EntityExpertBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(expertsLayer, snapshotLayer, queueLayer)
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    expertsLayer,
    snapshotLayer,
    queueLayer,
    backfillLayer
  );
};

describe("EntityExpertBackfillService", () => {
  it.effect("stores legacy experts as snapshots and schedules projection work", () => {
    const records = [
      expertRecord({
        did: "did:plc:alice",
        handle: "alice.energy.example",
        displayName: "Alice Energy",
        description: "Grid analyst.",
        domain: "grid"
      }),
      expertRecord({
        did: "did:plc:bob",
        handle: "bob.energy.example",
        displayName: "Bob Energy",
        description: "Hydrogen analyst.",
        domain: "hydrogen"
      })
    ];

    return Effect.gen(function* () {
      yield* installEntityGraphSchema;
      const backfill = yield* EntityExpertBackfillService;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const result = yield* backfill.backfill({ limit: 10, offset: 0 });

      expect(result).toEqual({
        total: 2,
        scanned: 2,
        migrated: 2,
        queued: 2,
        failed: 0,
        failedDids: []
      });

      const saved = yield* snapshots.load(
        ExpertEntity,
        Schema.decodeUnknownSync(ExpertIri)(
          "https://w3id.org/energy-intel/expert/did_plc_alice"
        )
      );
      expect(saved.did).toBe("did:plc:alice");
      expect(saved.displayName).toBe("Alice Energy");
      expect(saved.primaryTopic).toBe("grid");

      const queued = yield* queue.nextBatch(0, 10);
      expect(queued).toHaveLength(2);
      expect(queued.map((item) => item.targetEntityType)).toEqual([
        "Expert",
        "Expert"
      ]);
    }).pipe(Effect.provide(makeServiceLayer(records)));
  });
});
