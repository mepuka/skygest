import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  PostEntity,
  PostIri,
  ReindexQueueD1,
  ReindexQueueService
} from "@skygest/ontology-store";
import { EntityPostBackfillService } from "../src/services/EntityPostBackfillService";

const sqliteLayer = SqliteClient.layer({ filename: ":memory:" });

const installPostsSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* Effect.forEach(
    ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
    (statement) => sql`${sql.unsafe(statement)}`.pipe(Effect.asVoid),
    { discard: true }
  );
  yield* sql`
    CREATE TABLE IF NOT EXISTS posts (
      uri TEXT PRIMARY KEY,
      did TEXT NOT NULL,
      cid TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      indexed_at INTEGER NOT NULL,
      has_links INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    )
  `.pipe(Effect.asVoid);
});

const seedPosts = (posts: ReadonlyArray<{
  readonly uri: string;
  readonly did: string;
  readonly text: string;
  readonly createdAt: number;
  readonly status?: string;
}>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Effect.forEach(
      posts,
      (post) =>
        sql`
          INSERT INTO posts (uri, did, text, created_at, indexed_at, status)
          VALUES (${post.uri}, ${post.did}, ${post.text}, ${post.createdAt}, ${post.createdAt}, ${post.status ?? "active"})
        `.pipe(Effect.asVoid),
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
  const backfillLayer = EntityPostBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(sqliteLayer, snapshotLayer, queueLayer)
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    snapshotLayer,
    queueLayer,
    backfillLayer
  );
};

describe("EntityPostBackfillService", () => {
  it.effect("snapshots active posts and schedules projection work", () =>
    Effect.gen(function* () {
      yield* installPostsSchema;
      yield* seedPosts([
        {
          uri: "at://did:plc:alice/app.bsky.feed.post/3kpost1",
          did: "did:plc:alice",
          text: "First post about grid stability.",
          createdAt: 1715000000000
        },
        {
          uri: "at://did:plc:bob/app.bsky.feed.post/3kpost2",
          did: "did:plc:bob",
          text: "Second post about hydrogen.",
          createdAt: 1715000100000
        },
        {
          uri: "at://did:plc:dropped/app.bsky.feed.post/3kpost3",
          did: "did:plc:dropped",
          text: "Inactive post.",
          createdAt: 1715000200000,
          status: "deleted"
        }
      ]);

      const backfill = yield* EntityPostBackfillService;
      const snapshots = yield* EntitySnapshotStore;
      const queue = yield* ReindexQueueService;

      const result = yield* backfill.backfill({ limit: 10, offset: 0 });
      expect(result).toEqual({
        total: 2,
        scanned: 2,
        migrated: 2,
        queued: 2,
        failed: 0,
        failedUris: []
      });

      const saved = yield* snapshots.load(
        PostEntity,
        Schema.decodeUnknownSync(PostIri)(
          "https://w3id.org/energy-intel/post/did_plc_alice_3kpost1"
        )
      );
      expect(saved.did).toBe("did:plc:alice");
      expect(saved.atUri).toBe(
        "at://did:plc:alice/app.bsky.feed.post/3kpost1"
      );
      expect(saved.text).toBe("First post about grid stability.");
      expect(saved.postedAt).toBe(1715000000000);
      expect(saved.authoredBy).toBeUndefined();

      const queued = yield* queue.nextBatch(0, 10);
      expect(queued).toHaveLength(2);
      expect(queued[0]?.targetEntityType).toBe("Post");
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("paginates correctly and reports total", () =>
    Effect.gen(function* () {
      yield* installPostsSchema;
      yield* seedPosts(
        Array.from({ length: 5 }, (_, index) => ({
          uri: `at://did:plc:author${String(index)}/app.bsky.feed.post/${String(
            index
          )}`,
          did: `did:plc:author${String(index)}`,
          text: `Post ${String(index)}`,
          createdAt: 1715000000000 + index * 1000
        }))
      );

      const backfill = yield* EntityPostBackfillService;
      const page1 = yield* backfill.backfill({ limit: 2, offset: 0 });
      const page2 = yield* backfill.backfill({ limit: 2, offset: 2 });

      expect(page1.total).toBe(5);
      expect(page1.scanned).toBe(2);
      expect(page1.migrated).toBe(2);
      expect(page2.total).toBe(5);
      expect(page2.scanned).toBe(2);
      expect(page2.migrated).toBe(2);
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
