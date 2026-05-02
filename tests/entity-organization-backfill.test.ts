import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityGraphRepo,
  EntityGraphRepoD1,
  EntityIngestionWriter,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  OrganizationEntity,
  OrganizationIri,
  ReindexQueueD1,
  ReindexQueueService,
  asEntityIri
} from "@skygest/ontology-store";
import { EntityOrganizationBackfillService } from "../src/services/EntityOrganizationBackfillService";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
  yield* sql`
    CREATE TABLE IF NOT EXISTS publications (
      publication_id TEXT PRIMARY KEY,
      medium TEXT NOT NULL CHECK (medium IN ('text', 'podcast')),
      hostname TEXT UNIQUE,
      show_slug TEXT UNIQUE,
      feed_url TEXT UNIQUE,
      apple_id TEXT UNIQUE,
      spotify_id TEXT UNIQUE,
      tier TEXT NOT NULL CHECK (tier IN ('energy-focused', 'general-outlet', 'unknown')),
      source TEXT NOT NULL CHECK (source IN ('seed', 'discovered')),
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    )
  `.pipe(Effect.asVoid);
});

const seedPublications = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO publications (
      publication_id,
      medium,
      hostname,
      show_slug,
      feed_url,
      apple_id,
      spotify_id,
      tier,
      source,
      first_seen_at,
      last_seen_at
    ) VALUES
      ('reuters.com', 'text', 'reuters.com', NULL, NULL, NULL, NULL, 'energy-focused', 'seed', 1, 2),
      ('catalyst-with-shayle-kann', 'podcast', NULL, 'catalyst-with-shayle-kann', 'https://feeds.example/catalyst.xml', NULL, NULL, 'general-outlet', 'seed', 3, 4)
  `.pipe(Effect.asVoid);
});

const makeServiceLayer = () => {
  const snapshotLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const queueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const graphLayer = EntityGraphRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const writerLayer = EntityIngestionWriter.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(snapshotLayer, queueLayer))
  );
  const backfillLayer = EntityOrganizationBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(sqliteLayer, writerLayer, graphLayer)
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    snapshotLayer,
    queueLayer,
    graphLayer,
    writerLayer,
    backfillLayer
  );
};

describe("EntityOrganizationBackfillService", () => {
  it.effect("stores publications as Organization snapshots and publisher-role edges", () =>
    Effect.gen(function* () {
      yield* installSchema;
      yield* seedPublications;

      const backfill = yield* EntityOrganizationBackfillService;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;
      const graph = yield* EntityGraphRepo;

      const result = yield* backfill.backfill({ limit: 10, offset: 0 });
      expect(result).toEqual({
        total: 2,
        scanned: 2,
        migrated: 2,
        queued: 2,
        bearsEdges: 2,
        failed: 0,
        failedPublicationIds: []
      });

      const reutersIri = Schema.decodeUnknownSync(OrganizationIri)(
        "https://w3id.org/energy-intel/organization/reuters_com"
      );
      const reuters = yield* snapshots.load(OrganizationEntity, reutersIri);
      expect(reuters.displayName).toBe("Reuters");
      expect(reuters.primaryTopic).toBe("energy");
      expect(reuters.authority).toBe("energy-focused");

      const queued = yield* queue.nextBatch(0, 10);
      expect(queued.map((item) => item.targetEntityType)).toEqual([
        "Organization",
        "Organization"
      ]);

      const links = yield* graph.linksOut(asEntityIri(reuters.iri));
      expect(links).toHaveLength(1);
      expect(links[0]?.link.objectIri).toBe(
        "https://w3id.org/energy-intel/publisherRole/reuters_com"
      );
      expect(links[0]?.evidence[0]?.assertedBy).toBe(
        "EntityOrganizationBackfillService"
      );
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
