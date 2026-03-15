import { Effect, Layer } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { makeBiLayer, seedKnowledgeBase, withTempSqliteFile, sampleDid } from "./support/runtime";
import { SqlClient } from "@effect/sql";
import { EditorialRepo } from "../src/services/EditorialRepo";
import { EditorialRepoD1 } from "../src/services/d1/EditorialRepoD1";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";
import type { EditorialPickRecord } from "../src/domain/editorial";
import type { TopicSlug } from "../src/domain/bi";
import type { AtUri } from "../src/domain/types";

const makeEditorialLayer = (options?: { filename?: string }) => {
  const base = makeBiLayer(options);
  return Layer.mergeAll(base, EditorialRepoD1.layer.pipe(Layer.provideMerge(base)));
};

const fixtureUris = smokeFixtureUris(sampleDid);
const solarUri = fixtureUris[0] as AtUri;
const windUri = fixtureUris[1] as AtUri;

const makePick = (
  overrides: Partial<EditorialPickRecord> = {}
): EditorialPickRecord => ({
  postUri: solarUri,
  score: 85,
  reason: "Important solar analysis",
  category: "analysis",
  curator: "system",
  status: "active",
  pickedAt: 1_710_000_100_000,
  expiresAt: null,
  ...overrides
} as EditorialPickRecord);

describe("editorial_picks migration", () => {
  it.live("creates the editorial_picks table with post_uri as PK", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(
          seedKnowledgeBase().pipe(Effect.provide(layer))
        );
        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const tables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='editorial_picks'
            `;
            expect(tables).toHaveLength(1);
            const info = yield* sql`PRAGMA table_info(editorial_picks)`;
            const pkCol = (info as any[]).find((c: any) => c.pk === 1);
            expect(pkCol?.name).toBe("post_uri");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});

describe("EditorialRepoD1", () => {
  it.effect("upsertPick inserts a new pick and returns true", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;
      const created = yield* repo.upsertPick(makePick());
      expect(created).toBe(true);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("upsertPick overwrites an existing pick and returns false", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const first = yield* repo.upsertPick(makePick());
      expect(first).toBe(true);

      const second = yield* repo.upsertPick(
        makePick({ score: 90 as any, reason: "Updated reason" })
      );
      expect(second).toBe(false);

      // Verify the update took effect
      const picks = yield* repo.listPicks({ limit: 10 });
      const pick = picks.find((p) => p.postUri === solarUri);
      expect(pick?.score).toBe(90);
      expect(pick?.reason).toBe("Updated reason");
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("retractPick sets status to retracted and returns true", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick());
      const retracted = yield* repo.retractPick(solarUri);
      expect(retracted).toBe(true);

      // Retracted pick should not appear in active listings
      const picks = yield* repo.listPicks({ limit: 10 });
      expect(picks.find((p) => p.postUri === solarUri)).toBeUndefined();
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("retractPick returns false for non-existent post", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const retracted = yield* repo.retractPick("at://did:plc:fake/app.bsky.feed.post/nope");
      expect(retracted).toBe(false);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("postExists returns true for seeded post, false for unknown URI", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const exists = yield* repo.postExists(solarUri);
      expect(exists).toBe(true);

      const notExists = yield* repo.postExists("at://did:plc:fake/app.bsky.feed.post/nope");
      expect(notExists).toBe(false);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed joins picks with posts/experts and returns all topics", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri } as any));
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post",
          category: "discussion"
        } as any)
      );

      const feed = yield* repo.getCuratedFeed({ limit: 10 });

      expect(feed).toHaveLength(2);
      // Ordered by score DESC — solar (85) first, wind (70) second
      expect(feed[0]!.uri).toBe(solarUri);
      expect(feed[0]!.editorialScore).toBe(85);
      expect(feed[0]!.editorialReason).toBe("Important solar analysis");
      expect(feed[0]!.editorialCategory).toBe("analysis");
      expect(feed[0]!.topics.length).toBeGreaterThan(0);
      expect(feed[0]!.handle).not.toBeUndefined();
      expect(feed[0]!.text.length).toBeGreaterThan(0);

      expect(feed[1]!.uri).toBe(windUri);
      expect(feed[1]!.editorialScore).toBe(70);
      expect(feed[1]!.topics.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed with topic filter uses EXISTS and still returns full topic list", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri } as any));
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post"
        } as any)
      );

      // Filter by "solar" topic — only solar post should appear
      const feed = yield* repo.getCuratedFeed({
        limit: 10,
        topicSlugs: ["solar" as TopicSlug]
      });

      expect(feed).toHaveLength(1);
      expect(feed[0]!.uri).toBe(solarUri);
      // The full topic list should still contain all topics for the post
      // (not just the filter topic), proving the LEFT JOIN aggregation
      // is separate from the EXISTS filter
      expect(feed[0]!.topics).toContain("solar");
      expect(feed[0]!.topics.length).toBeGreaterThan(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("getCuratedFeed returns empty when topicSlugs is empty array", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick());

      const feed = yield* repo.getCuratedFeed({
        limit: 10,
        topicSlugs: [] as unknown as ReadonlyArray<TopicSlug>
      });

      expect(feed).toHaveLength(0);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("expireStale expires picks past their expires_at", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      const now = 1_710_000_200_000;

      // Pick that should expire (expires_at in the past relative to now)
      yield* repo.upsertPick(
        makePick({
          postUri: solarUri,
          expiresAt: now - 1000
        } as any)
      );

      // Pick that should NOT expire (no expiry)
      yield* repo.upsertPick(
        makePick({
          postUri: windUri,
          score: 70 as any,
          reason: "Wind post",
          expiresAt: null
        } as any)
      );

      const expired = yield* repo.expireStale(now);
      expect(expired).toBe(1);

      // Only the wind pick should remain active
      const picks = yield* repo.listPicks({ limit: 10 });
      expect(picks).toHaveLength(1);
      expect(picks[0]!.postUri).toBe(windUri);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );

  it.effect("listPicks respects minScore filter", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* EditorialRepo;

      yield* repo.upsertPick(makePick({ postUri: solarUri, score: 85 as any }));
      yield* repo.upsertPick(
        makePick({ postUri: windUri, score: 40 as any, reason: "Low score" } as any)
      );

      const high = yield* repo.listPicks({ minScore: 80 as any, limit: 10 });
      expect(high).toHaveLength(1);
      expect(high[0]!.postUri).toBe(solarUri);

      const all = yield* repo.listPicks({ limit: 10 });
      expect(all).toHaveLength(2);
    }).pipe(Effect.provide(makeEditorialLayer()))
  );
});
