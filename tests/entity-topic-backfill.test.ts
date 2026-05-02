import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EnergyTopicEntity,
  EnergyTopicIri,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  ReindexQueueD1,
  ReindexQueueService
} from "@skygest/ontology-store";
import { EntityTopicBackfillService } from "../src/services/EntityTopicBackfillService";
import { OntologyCatalog } from "../src/services/OntologyCatalog";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installEntityGraphSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
});

const makeServiceLayer = () => {
  const snapshotLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const queueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const backfillLayer = EntityTopicBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(OntologyCatalog.layer, snapshotLayer, queueLayer)
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    OntologyCatalog.layer,
    snapshotLayer,
    queueLayer,
    backfillLayer
  );
};

describe("EntityTopicBackfillService", () => {
  it.effect("snapshots ontology concepts and schedules projection work", () =>
    Effect.gen(function* () {
      yield* installEntityGraphSchema;
      const ontology = yield* OntologyCatalog;
      const concepts = Array.from(ontology.concepts).sort((left, right) =>
        left.slug.localeCompare(right.slug)
      );
      const first = concepts[0]!;

      const backfill = yield* EntityTopicBackfillService;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const result = yield* backfill.backfill({ limit: 2, offset: 0 });
      expect(result).toEqual({
        total: concepts.length,
        scanned: 2,
        migrated: 2,
        queued: 2,
        failed: 0,
        failedIris: []
      });

      const saved = yield* snapshots.load(
        EnergyTopicEntity,
        Schema.decodeUnknownSync(EnergyTopicIri)(first.iri)
      );
      expect(saved.iri).toBe(first.iri);
      expect(saved.slug).toBe(first.slug);
      expect(saved.label).toBe(first.label);
      expect(saved.altLabels).toEqual(first.altLabels);
      expect(saved.topConcept).toBe(first.topConcept);

      const queued = yield* queue.nextBatch(0, 10);
      expect(queued).toHaveLength(2);
      expect(queued[0]?.targetEntityType).toBe("EnergyTopic");
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("paginates ontology concepts deterministically", () =>
    Effect.gen(function* () {
      yield* installEntityGraphSchema;
      const backfill = yield* EntityTopicBackfillService;
      const page = yield* backfill.backfill({ limit: 3, offset: 3 });

      expect(page.scanned).toBe(3);
      expect(page.migrated).toBe(3);
      expect(page.queued).toBe(3);
      expect(page.failed).toBe(0);
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
