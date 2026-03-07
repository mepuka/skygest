import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { bootstrapExperts } from "../src/bootstrap/ExpertSeeds";
import { runMigrations } from "../src/db/migrate";
import { processBatch } from "../src/filter/FilterWorker";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { makeBiLayer, makeSampleBatch, sampleDid, seedManifest } from "./support/runtime";

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
      expect(topicCount?.count).toBe(5);
      expect(linkCount?.count).toBe(2);
    }).pipe(Effect.provide(makeBiLayer()))
  );
});
