import { SqlClient } from "@effect/sql";
import { Effect } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { processBatch } from "../src/filter/FilterWorker";
import { KnowledgeQueryService } from "../src/services/KnowledgeQueryService";
import {
  makeBiLayer,
  makeDeleteBatch,
  makeSampleBatch,
  sampleDid,
  seedKnowledgeBase
} from "./support/runtime";

describe("ingest slice", () => {
  it.effect("normalizes posts into BI tables and keeps duplicate deliveries as no-ops", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      yield* processBatch(makeSampleBatch());

      const sql = yield* SqlClient.SqlClient;
      const query = yield* KnowledgeQueryService;

      const [postCount] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM posts`;
      const [linkCount] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM links`;
      const [ftsCount] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM posts_fts`;
      const solarPosts = yield* query.searchPosts({ query: "solar" });
      const recentPosts = yield* query.getRecentPosts({ expertDid: sampleDid });
      const links = yield* query.getPostLinks({ topic: "grid-and-infrastructure" });

      expect(postCount?.count).toBe(2);
      expect(linkCount?.count).toBe(2);
      expect(ftsCount?.count).toBe(2);
      expect(solarPosts).toHaveLength(1);
      expect(recentPosts).toHaveLength(2);
      expect(links).toHaveLength(2);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("marks deleted posts and removes them from query results", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      yield* processBatch(makeDeleteBatch());

      const query = yield* KnowledgeQueryService;
      const recentPosts = yield* query.getRecentPosts({ expertDid: sampleDid });
      const solarPosts = yield* query.searchPosts({ query: "solar" });

      expect(recentPosts.map((post) => post.uri)).not.toContain(
        `at://${sampleDid}/app.bsky.feed.post/post-solar`
      );
      expect(solarPosts).toHaveLength(0);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("stores match provenance that can be explained through the query service", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();

      const query = yield* KnowledgeQueryService;
      const explanation = yield* query.explainPostTopics(
        `at://${sampleDid}/app.bsky.feed.post/post-solar` as any
      );

      expect(explanation.items.some((item) => item.topicSlug === "solar")).toBe(true);
      expect(explanation.items.every((item) => item.matchScore !== null)).toBe(true);
      expect(explanation.items.every((item) => item.matcherVersion.length > 0)).toBe(true);
    }).pipe(Effect.provide(makeBiLayer()))
  );
});
