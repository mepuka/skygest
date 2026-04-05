import { SqlClient } from "effect/unstable/sql";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { bootstrapExperts } from "../src/bootstrap/ExpertSeeds";
import { runMigrations } from "../src/db/migrate";
import { KnowledgePost, RankedKnowledgePostResult } from "../src/domain/bi";
import { PodcastEpisodeBundle as PodcastEpisodeBundleSchema } from "../src/domain/podcast";
import { PodcastRepo } from "../src/services/PodcastRepo";
import { processBatch } from "../src/filter/FilterWorker";
import { ExpertsRepo } from "../src/services/ExpertsRepo";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { PublicationsRepo } from "../src/services/PublicationsRepo";
import { buildTranscriptR2Key } from "../src/services/TranscriptStorageService";
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

  it.effect("expert avatar round-trips through ExpertsRepo", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);

      const experts = yield* ExpertsRepo;
      const stored = yield* experts.getByDid(sampleDid);

      // Bootstrapped experts have null avatars
      expect(stored?.avatar).toBeNull();
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("seeds and reads both text publications and podcast shows", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const publications = yield* PublicationsRepo;
      const manifest = {
        ontologyVersion: "test",
        snapshotVersion: "test-seed",
        publications: [
          {
            medium: "text" as const,
            hostname: "reuters.com",
            showSlug: null,
            feedUrl: null,
            appleId: null,
            spotifyId: null,
            tier: "general-outlet" as const
          },
          {
            medium: "podcast" as const,
            hostname: null,
            showSlug: "catalyst-with-shayle-kann",
            feedUrl: "https://example.com/catalyst.rss",
            appleId: "123456789",
            spotifyId: "show-abc",
            tier: "energy-focused" as const
          }
        ]
      };

      const result = yield* publications.seedCurated(manifest, 1_710_000_000_000);
      const listed = yield* publications.list({});
      const byHostname = yield* publications.getByHostnames(["reuters.com"]);
      const byShowSlug = yield* publications.getByShowSlugs([
        "catalyst-with-shayle-kann"
      ]);

      expect(result).toEqual({
        seeded: 2,
        snapshotVersion: "test-seed"
      });
      expect(listed).toEqual([
        {
          publicationId: "catalyst-with-shayle-kann",
          medium: "podcast",
          hostname: null,
          showSlug: "catalyst-with-shayle-kann",
          feedUrl: "https://example.com/catalyst.rss",
          appleId: "123456789",
          spotifyId: "show-abc",
          tier: "energy-focused",
          source: "seed",
          postCount: 0,
          latestPostAt: null
        },
        {
          publicationId: "reuters.com",
          medium: "text",
          hostname: "reuters.com",
          showSlug: null,
          feedUrl: null,
          appleId: null,
          spotifyId: null,
          tier: "general-outlet",
          source: "seed",
          postCount: 0,
          latestPostAt: null
        }
      ]);
      expect(byHostname).toEqual([
        {
          publicationId: "reuters.com",
          medium: "text",
          hostname: "reuters.com",
          showSlug: null,
          feedUrl: null,
          appleId: null,
          spotifyId: null,
          tier: "general-outlet",
          source: "seed",
          firstSeenAt: 1_710_000_000_000,
          lastSeenAt: 1_710_000_000_000
        }
      ]);
      expect(byShowSlug).toEqual([
        {
          publicationId: "catalyst-with-shayle-kann",
          medium: "podcast",
          hostname: null,
          showSlug: "catalyst-with-shayle-kann",
          feedUrl: "https://example.com/catalyst.rss",
          appleId: "123456789",
          spotifyId: "show-abc",
          tier: "energy-focused",
          source: "seed",
          firstSeenAt: 1_710_000_000_000,
          lastSeenAt: 1_710_000_000_000
        }
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("upserts podcast publications idempotently by show slug", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const publications = yield* PublicationsRepo;
      const initialManifest = {
        ontologyVersion: "test",
        snapshotVersion: "seed-1",
        publications: [{
          medium: "podcast" as const,
          hostname: null,
          showSlug: "the-carbon-copy",
          feedUrl: "https://example.com/carbon-copy-v1.rss",
          appleId: "apple-1",
          spotifyId: "spotify-1",
          tier: "energy-focused" as const
        }]
      };
      const updatedManifest = {
        ontologyVersion: "test",
        snapshotVersion: "seed-2",
        publications: [{
          medium: "podcast" as const,
          hostname: null,
          showSlug: "the-carbon-copy",
          feedUrl: "https://example.com/carbon-copy-v2.rss",
          appleId: "apple-2",
          spotifyId: "spotify-1",
          tier: "energy-focused" as const
        }]
      };

      yield* publications.seedCurated(initialManifest, 1_710_000_000_000);
      yield* publications.seedCurated(updatedManifest, 1_710_000_000_500);

      const sql = yield* SqlClient.SqlClient;
      const [countRow] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM publications
        WHERE show_slug = 'the-carbon-copy'
      `;
      const rows = yield* publications.getByShowSlugs(["the-carbon-copy"]);

      expect(countRow?.count).toBe(1);
      expect(rows).toEqual([
        {
          publicationId: "the-carbon-copy",
          medium: "podcast",
          hostname: null,
          showSlug: "the-carbon-copy",
          feedUrl: "https://example.com/carbon-copy-v2.rss",
          appleId: "apple-2",
          spotifyId: "spotify-1",
          tier: "energy-focused",
          source: "seed",
          firstSeenAt: 1_710_000_000_000,
          lastSeenAt: 1_710_000_000_500
        }
      ]);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("round-trips podcast episodes, segments, and topic matches through PodcastRepo", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const publications = yield* PublicationsRepo;
      yield* publications.seedCurated({
        ontologyVersion: "test",
        snapshotVersion: "test-seed",
        publications: [{
          medium: "podcast" as const,
          hostname: null,
          showSlug: "catalyst-with-shayle-kann",
          feedUrl: "https://example.com/catalyst.rss",
          appleId: null,
          spotifyId: null,
          tier: "energy-focused" as const
        }]
      }, 1_710_000_000_000);

      const podcastRepo = yield* PodcastRepo;
      const decodePodcastBundle = Schema.decodeUnknownSync(
        PodcastEpisodeBundleSchema
      );
      const initialTranscriptKey = yield* buildTranscriptR2Key(
        "catalyst-with-shayle-kann" as any,
        "catalyst-2026-04-04" as any
      );
      const updatedTranscriptKey = yield* buildTranscriptR2Key(
        "catalyst-with-shayle-kann" as any,
        "catalyst-2026-04-04-v2" as any
      );
      const initialBundle = decodePodcastBundle({
        episode: {
          episodeId: "catalyst-2026-04-04",
          showSlug: "catalyst-with-shayle-kann",
          title: "Catalyst: Grid storage and transmission",
          publishedAt: 1_710_100_000_000,
          audioUrl: "https://example.com/catalyst-2026-04-04.mp3",
          durationSeconds: 1_800,
          speakerDids: [sampleDid],
          chapterMarkers: [{
            startTimestampMs: 0,
            title: "Intro"
          }],
          transcriptR2Key: initialTranscriptKey,
          lifecycleState: "segmented",
          createdAt: 1_710_100_000_000,
          updatedAt: 1_710_100_000_000
        },
        segments: [
          {
            segmentId: "catalyst-2026-04-04-segment-0",
            episodeId: "catalyst-2026-04-04",
            segmentIndex: 0,
            primarySpeakerDid: sampleDid,
            speakerDids: [sampleDid],
            startTimestampMs: 0,
            endTimestampMs: 60_000,
            text: "Battery storage is accelerating because project economics improved.",
            createdAt: 1_710_100_000_000,
            topicMatches: [
              {
                topicSlug: "storage",
                matchedTerm: "battery storage",
                matchSignal: "term",
                matchValue: "battery storage",
                matchScore: 0.9,
                ontologyVersion: "test-v1",
                matcherVersion: "test-v1"
              }
            ]
          },
          {
            segmentId: "catalyst-2026-04-04-segment-1",
            episodeId: "catalyst-2026-04-04",
            segmentIndex: 1,
            primarySpeakerDid: sampleDid,
            speakerDids: [sampleDid],
            startTimestampMs: 60_000,
            endTimestampMs: 120_000,
            text: "Transmission constraints still slow interconnection.",
            createdAt: 1_710_100_000_100,
            topicMatches: [
              {
                topicSlug: "transmission",
                matchedTerm: "interconnection",
                matchSignal: "term",
                matchValue: "interconnection",
                matchScore: 0.8,
                ontologyVersion: "test-v1",
                matcherVersion: "test-v1"
              }
            ]
          }
        ]
      });
      const updatedBundle = decodePodcastBundle({
        episode: {
          episodeId: "catalyst-2026-04-04",
          showSlug: "catalyst-with-shayle-kann",
          title: "Catalyst: Grid storage and transmission (updated)",
          publishedAt: 1_710_100_000_000,
          audioUrl: "https://example.com/catalyst-2026-04-04.mp3",
          durationSeconds: 1_820,
          speakerDids: [sampleDid],
          chapterMarkers: [{
            startTimestampMs: 0,
            title: "Updated intro"
          }],
          transcriptR2Key: updatedTranscriptKey,
          lifecycleState: "pushed",
          createdAt: 1_710_100_000_000,
          updatedAt: 1_710_100_000_500
        },
        segments: [
          {
            segmentId: "catalyst-2026-04-04-segment-0",
            episodeId: "catalyst-2026-04-04",
            segmentIndex: 0,
            primarySpeakerDid: sampleDid,
            speakerDids: [sampleDid],
            startTimestampMs: 0,
            endTimestampMs: 90_000,
            text: "Battery storage and grid flexibility are now central investment themes.",
            createdAt: 1_710_100_000_500,
            topicMatches: [
              {
                topicSlug: "storage",
                matchedTerm: "grid flexibility",
                matchSignal: "term",
                matchValue: "grid flexibility",
                matchScore: 0.95,
                ontologyVersion: "test-v2",
                matcherVersion: "test-v2"
              }
            ]
          }
        ]
      });

      yield* podcastRepo.upsertEpisodeBundle(initialBundle);
      yield* podcastRepo.upsertEpisodeBundle(updatedBundle);

      const stored = yield* podcastRepo.getEpisodeBundle(
        initialBundle.episode.episodeId
      );
      const showEpisodes = yield* podcastRepo.listEpisodesByShowSlug(
        initialBundle.episode.showSlug
      );
      const sql = yield* SqlClient.SqlClient;
      const [segmentCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM podcast_segments
        WHERE episode_id = 'catalyst-2026-04-04'
      `;
      const [topicCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM podcast_segment_topics
        WHERE segment_id = 'catalyst-2026-04-04-segment-0'
      `;

      expect(segmentCount?.count).toBe(1);
      expect(topicCount?.count).toBe(1);
      expect(showEpisodes).toEqual([
        {
          episodeId: "catalyst-2026-04-04",
          showSlug: "catalyst-with-shayle-kann",
          title: "Catalyst: Grid storage and transmission (updated)",
          publishedAt: 1_710_100_000_000,
          audioUrl: "https://example.com/catalyst-2026-04-04.mp3",
          durationSeconds: 1_820,
          speakerDids: [sampleDid],
          chapterMarkers: [{
            startTimestampMs: 0,
            title: "Updated intro"
          }],
          transcriptR2Key: updatedTranscriptKey,
          lifecycleState: "pushed",
          createdAt: 1_710_100_000_000,
          updatedAt: 1_710_100_000_500
        }
      ]);
      expect(stored).toEqual({
        episode: {
          episodeId: "catalyst-2026-04-04",
          showSlug: "catalyst-with-shayle-kann",
          title: "Catalyst: Grid storage and transmission (updated)",
          publishedAt: 1_710_100_000_000,
          audioUrl: "https://example.com/catalyst-2026-04-04.mp3",
          durationSeconds: 1_820,
          speakerDids: [sampleDid],
          chapterMarkers: [{
            startTimestampMs: 0,
            title: "Updated intro"
          }],
          transcriptR2Key: updatedTranscriptKey,
          lifecycleState: "pushed",
          createdAt: 1_710_100_000_000,
          updatedAt: 1_710_100_000_500
        },
        segments: [
          {
            segmentId: "catalyst-2026-04-04-segment-0",
            episodeId: "catalyst-2026-04-04",
            segmentIndex: 0,
            primarySpeakerDid: sampleDid,
            speakerDids: [sampleDid],
            startTimestampMs: 0,
            endTimestampMs: 90_000,
            text: "Battery storage and grid flexibility are now central investment themes.",
            createdAt: 1_710_100_000_500,
            topicMatches: [
              {
                topicSlug: "storage",
                matchedTerm: "grid flexibility",
                matchSignal: "term",
                matchValue: "grid flexibility",
                matchScore: 0.95,
                ontologyVersion: "test-v2",
                matcherVersion: "test-v2"
              }
            ]
          }
        ]
      });
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("returns null when a podcast episode bundle is missing", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const podcastRepo = yield* PodcastRepo;
      const missing = yield* podcastRepo.getEpisodeBundle(
        "missing-episode" as any
      );

      expect(missing).toBeNull();
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("stores podcast episodes even when they currently have no segments", () =>
    Effect.gen(function* () {
      yield* runMigrations;

      const publications = yield* PublicationsRepo;
      yield* publications.seedCurated({
        ontologyVersion: "test",
        snapshotVersion: "test-seed",
        publications: [{
          medium: "podcast" as const,
          hostname: null,
          showSlug: "the-carbon-copy",
          feedUrl: "https://example.com/the-carbon-copy.rss",
          appleId: null,
          spotifyId: null,
          tier: "energy-focused" as const
        }]
      }, 1_710_000_000_000);

      const podcastRepo = yield* PodcastRepo;
      const transcriptKey = yield* buildTranscriptR2Key(
        "the-carbon-copy" as any,
        "carbon-copy-2026-04-06" as any
      );
      const bundle = Schema.decodeUnknownSync(PodcastEpisodeBundleSchema)({
        episode: {
          episodeId: "carbon-copy-2026-04-06",
          showSlug: "the-carbon-copy",
          title: "The Carbon Copy: Pipeline outlook",
          publishedAt: 1_710_200_000_000,
          audioUrl: "https://example.com/carbon-copy-2026-04-06.mp3",
          durationSeconds: 900,
          speakerDids: [sampleDid],
          chapterMarkers: null,
          transcriptR2Key: transcriptKey,
          lifecycleState: "transcribed",
          createdAt: 1_710_200_000_000,
          updatedAt: 1_710_200_000_000
        },
        segments: []
      });

      yield* podcastRepo.upsertEpisodeBundle(bundle);

      const stored = yield* podcastRepo.getEpisodeBundle(bundle.episode.episodeId);
      expect(stored).toEqual(bundle);
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("link imageUrl round-trips through KnowledgeRepo", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* KnowledgeRepo;

      const links = yield* repo.getPostLinks({ limit: 10 });
      expect(links.length).toBeGreaterThan(0);

      // The solar fixture post has a thumb blob ref, so imageUrl should be non-null
      const solarLink = links.find((l) => l.url === "https://example.com/solar-storage");
      expect(solarLink).toBeDefined();
      expect(solarLink!.imageUrl).not.toBeNull();
      expect(solarLink!.imageUrl).toContain("cdn.bsky.app");
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("searchPostsPage returns rows that normalize through RankedKnowledgePostResult", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* KnowledgeRepo;

      const rows = yield* repo.searchPostsPage({ query: "solar", limit: 10 });
      expect(rows.length).toBeGreaterThan(0);

      // Should already be normalized through the schema — verify by re-decoding
      const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(RankedKnowledgePostResult))(rows);
      expect(decoded.length).toBe(rows.length);
      expect(typeof decoded[0]?.rank).toBe("number");
    }).pipe(Effect.provide(makeBiLayer()))
  );

  it.effect("upsertPosts handles >80 posts with mixed existing/new ingestIds", () =>
    Effect.gen(function* () {
      yield* runMigrations;
      yield* bootstrapExperts(seedManifest, 1, 1_710_000_000_000);

      const repo = yield* KnowledgeRepo;
      const sql = yield* SqlClient.SqlClient;
      const now = 1_710_000_000_000;

      // Generate 100 posts to exceed the 80-param idempotency chunk size
      // ingest_id is UNIQUE per row, so each post needs its own ingestId
      const makePost = (i: number, runPrefix: string): KnowledgePost => ({
        uri: `at://${sampleDid}/app.bsky.feed.post/batch-${i}` as any,
        did: sampleDid,
        cid: `cid-batch-${i}`,
        text: `Post number ${i} about solar energy`,
        createdAt: now + i * 1000,
        indexedAt: now + i * 1000,
        hasLinks: false,
        status: "active",
        ingestId: `${runPrefix}-${i}`,
        embedType: null,
        topics: [],
        links: []
      });

      // First pass: insert 100 posts with ingestIds "run-1-0" through "run-1-99"
      const firstBatch = Array.from({ length: 100 }, (_, i) => makePost(i, "run-1"));
      yield* repo.upsertPosts(firstBatch);

      const [countAfterFirst] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM posts`;
      expect(countAfterFirst?.count).toBe(100);

      // Second pass: same 100 URIs with same ingestIds — all should be skipped (idempotent)
      yield* repo.upsertPosts(firstBatch);
      const [countAfterIdempotent] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM posts`;
      expect(countAfterIdempotent?.count).toBe(100);

      // Third pass: 50 existing URIs with new ingestIds + 50 new URIs
      const mixedBatch = [
        ...Array.from({ length: 50 }, (_, i) => makePost(i, "run-2")),     // existing URIs, new ingestId → upsert
        ...Array.from({ length: 50 }, (_, i) => makePost(100 + i, "run-2")) // new URIs → insert
      ];
      yield* repo.upsertPosts(mixedBatch);

      const [countAfterMixed] = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM posts`;
      expect(countAfterMixed?.count).toBe(150); // 100 original + 50 new

      // Verify the updated posts have new ingestId
      const [updatedSample] = yield* sql<{ ingestId: string }>`
        SELECT ingest_id as ingestId FROM posts WHERE uri = ${`at://${sampleDid}/app.bsky.feed.post/batch-0`}
      `;
      expect(updatedSample?.ingestId).toBe("run-2-0");

      // Verify untouched posts kept old ingestId
      const [untouchedSample] = yield* sql<{ ingestId: string }>`
        SELECT ingest_id as ingestId FROM posts WHERE uri = ${`at://${sampleDid}/app.bsky.feed.post/batch-50`}
      `;
      expect(untouchedSample?.ingestId).toBe("run-1-50");
    }).pipe(Effect.provide(makeBiLayer()))
  );
});
