import { SqliteClient } from "@effect/sql-sqlite-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  ENTITY_GRAPH_ALL_SCHEMA_STATEMENTS,
  EntityGraphRepo,
  EntityGraphRepoD1,
  EntitySnapshotStore,
  EntitySnapshotStoreD1,
  PostEntity,
  PostIri,
  ReindexQueueD1,
  ReindexQueueService,
  asEntityIri
} from "@skygest/ontology-store";
import { ExpertRecord as ExpertRecordSchema } from "../src/domain/bi";
import type { ExpertRecord } from "../src/domain/bi";
import { EntityPostBackfillService } from "../src/services/EntityPostBackfillService";
import { ExpertsRepo } from "../src/services/ExpertsRepo";

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
    list: () =>
      Effect.succeed({
        total: records.length,
        items: records.map((record) => ({
          did: record.did,
          handle: record.handle,
          displayName: record.displayName,
          avatar: record.avatar,
          domain: record.domain,
          source: record.source,
          active: record.active,
          tier: record.tier
        }))
      }),
    getByDids: (dids) =>
      Effect.succeed(records.filter((record) => dids.includes(record.did)))
  });

const makeServiceLayer = (experts: ReadonlyArray<ExpertRecord> = []) => {
  const expertsLayer = makeExpertsLayer(experts);
  const snapshotLayer = EntitySnapshotStoreD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const queueLayer = ReindexQueueD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const graphLayer = EntityGraphRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const backfillLayer = EntityPostBackfillService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(sqliteLayer, expertsLayer, snapshotLayer, queueLayer, graphLayer)
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    expertsLayer,
    snapshotLayer,
    queueLayer,
    graphLayer,
    backfillLayer
  );
};

describe("EntityPostBackfillService", () => {
  it.effect("snapshots active posts and schedules projection work", () =>
    Effect.gen(function* () {
      yield* installPostsSchema;
      yield* seedPosts([
        {
          uri: "x://123/status/1",
          did: "did:x:123",
          text: "Unsupported legacy Twitter URI.",
          createdAt: 1714999900000
        },
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
      const graph = yield* EntityGraphRepo;

      const result = yield* backfill.backfill({ limit: 10, offset: 0 });
      expect(result).toEqual({
        total: 2,
        scanned: 2,
        migrated: 2,
        queued: 2,
        authoredByEdges: 1,
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
      expect(saved.authoredBy).toBe(
        "https://w3id.org/energy-intel/expert/did_plc_alice"
      );

      const aliceLinks = yield* graph.linksOut(
        asEntityIri(
          "https://w3id.org/energy-intel/post/did_plc_alice_3kpost1"
        )
      );
      expect(aliceLinks).toHaveLength(1);
      expect(aliceLinks[0]?.link.predicateIri).toBe(
        "https://w3id.org/energy-intel/authoredBy"
      );
      expect(aliceLinks[0]?.link.objectIri).toBe(
        "https://w3id.org/energy-intel/expert/did_plc_alice"
      );
      expect(aliceLinks[0]?.link.effectiveFrom).toBe(1715000000000);
      expect(aliceLinks[0]?.evidence[0]?.assertedBy).toBe(
        "EntityPostBackfillService"
      );

      const queued = yield* queue.nextBatch(0, 10);
      expect(queued).toHaveLength(2);
      expect(queued[0]?.targetEntityType).toBe("Post");
    }).pipe(Effect.provide(makeServiceLayer([
      expertRecord({
        did: "did:plc:alice",
        handle: "alice.energy.example",
        displayName: "Alice Energy",
        description: "Grid analyst.",
        domain: "grid"
      })
    ])))
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
      expect(page1.authoredByEdges).toBe(0);
      expect(page2.total).toBe(5);
      expect(page2.scanned).toBe(2);
      expect(page2.migrated).toBe(2);
      expect(page2.authoredByEdges).toBe(0);
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
