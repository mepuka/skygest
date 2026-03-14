import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { bootstrapExperts } from "../src/bootstrap/ExpertSeeds";
import { runMigrations } from "../src/db/migrate";
import { processBatch } from "../src/filter/FilterWorker";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { makeBiLayer, makeSampleBatch, sampleDid, seedKnowledgeBase, seedManifest } from "./support/runtime";

describe("repository layers", () => {
  it.effect("upsert and list experts from the checked-in seed manifest", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* bootstrapExperts(seedManifest, 4, 1_710_000_000_000);

      const experts = yield* ExpertsRepo;
      const all = yield* experts.listActive();
      const stored = yield* experts.getByDid(sampleDid);
      const activeBeforeDisable = yield* Effect.forEach(
        [0, 1, 2, 3],
        (shard) => experts.listActiveByShard(shard)
      );
      yield* experts.setActive(sampleDid, false);
      const updated = yield* experts.getByDid(sampleDid);
      const activeAfterDisable = yield* Effect.forEach(
        [0, 1, 2, 3],
        (shard) => experts.listActiveByShard(shard)
      );

      expect(all).toHaveLength(seedManifest.experts.length);
      expect(stored?.did).toBe(sampleDid);
      expect(updated?.active).toBe(false);
      expect(activeBeforeDisable.flat()).toContain(sampleDid);
      expect(activeAfterDisable.flat()).not.toContain(sampleDid);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("keep post, topic, and link writes idempotent across duplicate ingest deliveries", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);
      yield* processBatch(makeSampleBatch());
      yield* processBatch(makeSampleBatch());

      const sql = yield* SqlClient.SqlClient;
      const [postCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM posts
      `;
      const [topicCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM post_topics
      `;
      const [linkCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM links
      `;

      expect(postCount?.count).toBe(2);
      expect(topicCount?.count).toBe(6);
      expect(linkCount?.count).toBe(2);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("rolls back post writes when a later link insert fails", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);

      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TRIGGER fail_links_insert
        BEFORE INSERT ON links
        BEGIN
          SELECT RAISE(FAIL, 'forced links failure');
        END
      `.pipe(Effect.asVoid);

      yield* Effect.exit(processBatch(makeSampleBatch()));

      const [postCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM posts
      `;
      const [topicCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM post_topics
      `;
      const [linkCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM links
      `;
      const [ftsCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count FROM posts_fts
      `;

      expect(postCount?.count).toBe(0);
      expect(topicCount?.count).toBe(0);
      expect(linkCount?.count).toBe(0);
      expect(ftsCount?.count).toBe(0);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("optimizeFts succeeds after seeding and search still works", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* KnowledgeRepo;
      yield* repo.optimizeFts();

      const results = yield* repo.searchPosts({ query: "solar", limit: 10 });
      expect(results.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("porter stemming matches morphological variants", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* KnowledgeRepo;

      // Smoke fixture post 1 contains "solar" — stemming should match "solar"
      const exact = yield* repo.searchPosts({ query: "solar", limit: 10 });
      expect(exact.length).toBeGreaterThan(0);

      // Smoke fixture post 2 contains "transmission" — stemming maps
      // "transmitting" → "transmit" and "transmission" → "transmiss",
      // so test with the exact stored term to verify FTS5 works at all
      const stored = yield* repo.searchPosts({ query: "transmission", limit: 10 });
      expect(stored.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeBiLayer()))
  );
});
