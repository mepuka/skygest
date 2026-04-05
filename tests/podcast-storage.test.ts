import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  PodcastEpisodeBundle as PodcastEpisodeBundleSchema,
  PodcastTranscript as PodcastTranscriptSchema
} from "../src/domain/podcast";
import { runMigrations } from "../src/db/migrate";
import { CloudflareEnv, type EnvBindings } from "../src/platform/Env";
import { PodcastRepo } from "../src/services/PodcastRepo";
import { PodcastStorageService } from "../src/services/PodcastStorageService";
import { PublicationsRepo } from "../src/services/PublicationsRepo";
import { TranscriptStorageService } from "../src/services/TranscriptStorageService";
import { PodcastRepoD1 } from "../src/services/d1/PodcastRepoD1";
import { PublicationsRepoD1 } from "../src/services/d1/PublicationsRepoD1";
import { makeSqliteLayer, sampleDid } from "./support/runtime";
import { createFakeR2Bucket } from "./support/fakeR2";

const decodePodcastBundle = Schema.decodeUnknownSync(PodcastEpisodeBundleSchema);
const decodePodcastTranscript = Schema.decodeUnknownSync(PodcastTranscriptSchema);

const makePodcastStorageLayer = () => {
  const sqliteLayer = makeSqliteLayer();
  const fakeBucket = createFakeR2Bucket();
  const env = {
    DB: {} as D1Database,
    TRANSCRIPTS_BUCKET: fakeBucket.bucket
  } satisfies EnvBindings;

  const publicationsLayer = PublicationsRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const podcastRepoLayer = PodcastRepoD1.layer.pipe(
    Layer.provideMerge(sqliteLayer)
  );
  const transcriptLayer = TranscriptStorageService.layer.pipe(
    Layer.provide(CloudflareEnv.layer(env, { required: [] }))
  );
  const storageLayer = PodcastStorageService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(podcastRepoLayer, transcriptLayer))
  );

  return {
    layer: Layer.mergeAll(
      sqliteLayer,
      publicationsLayer,
      podcastRepoLayer,
      transcriptLayer,
      storageLayer
    ),
    objects: fakeBucket.objects
  };
};

const seedPodcastShow = (showSlug: string) =>
  Effect.gen(function* () {
    const publications = yield* PublicationsRepo;
    yield* publications.seedCurated(
      {
        ontologyVersion: "test",
        snapshotVersion: "test-seed",
        publications: [{
          medium: "podcast" as const,
          hostname: null,
          showSlug,
          feedUrl: `https://example.com/${showSlug}.rss`,
          appleId: null,
          spotifyId: null,
          tier: "energy-focused" as const
        }]
      },
      1_710_000_000_000
    );
  });

const makeBundle = () =>
  decodePodcastBundle({
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
      transcriptR2Key: null,
      lifecycleState: "segmented",
      createdAt: 1_710_100_000_000,
      updatedAt: 1_710_100_000_000
    },
    segments: [{
      segmentId: "catalyst-2026-04-04-segment-0",
      episodeId: "catalyst-2026-04-04",
      segmentIndex: 0,
      primarySpeakerDid: sampleDid,
      speakerDids: [sampleDid],
      startTimestampMs: 0,
      endTimestampMs: 60_000,
      text: "Battery storage is accelerating because project economics improved.",
      createdAt: 1_710_100_000_000,
      topicMatches: [{
        topicSlug: "storage",
        matchedTerm: "battery storage",
        matchSignal: "term",
        matchValue: "battery storage",
        matchScore: 0.9,
        ontologyVersion: "test-v1",
        matcherVersion: "test-v1"
      }]
    }]
  });

const makeTranscript = () =>
  decodePodcastTranscript({
    format: "skygest-transcript-v1",
    showSlug: "catalyst-with-shayle-kann",
    episodeId: "catalyst-2026-04-04",
    durationMs: 60_000,
    speakers: [{
      id: "S0",
      resolvedDid: sampleDid,
      name: "Host"
    }],
    segments: [{
      startMs: 0,
      endMs: 60_000,
      speakerId: "S0",
      text: "Battery storage is accelerating because project economics improved."
    }]
  });

describe("PodcastStorageService", () => {
  it.effect("stores the transcript first and persists the derived R2 key in D1", () => {
    const { layer, objects } = makePodcastStorageLayer();

    return Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPodcastShow("catalyst-with-shayle-kann");

      const storage = yield* PodcastStorageService;
      const podcastRepo = yield* PodcastRepo;
      const transcriptKey = yield* storage.upsertEpisodeBundleWithTranscript(
        makeBundle(),
        makeTranscript()
      );
      const stored = yield* podcastRepo.getEpisodeBundle(
        makeBundle().episode.episodeId
      );

      expect(objects.has(transcriptKey)).toBe(true);
      expect(stored?.episode.transcriptR2Key).toBe(transcriptKey);
    }).pipe(Effect.provide(layer));
  });

  it.effect("deletes the uploaded transcript when the D1 write fails", () => {
    const { layer, objects } = makePodcastStorageLayer();

    return Effect.gen(function* () {
      yield* runMigrations;
      yield* seedPodcastShow("catalyst-with-shayle-kann");

      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        CREATE TRIGGER fail_podcast_segment_insert
        BEFORE INSERT ON podcast_segments
        BEGIN
          SELECT RAISE(FAIL, 'forced podcast segment failure');
        END
      `.pipe(Effect.asVoid);

      const storage = yield* PodcastStorageService;
      const error = yield* storage.upsertEpisodeBundleWithTranscript(
        makeBundle(),
        makeTranscript()
      ).pipe(Effect.flip);
      const [episodeCount] = yield* sql<{ count: number }>`
        SELECT COUNT(*) as count
        FROM podcast_episodes
      `;

      expect(error._tag).toBe("PodcastStorageCoordinationError");
      expect(error.operation).toBe("persistBundle");
      expect(objects.size).toBe(0);
      expect(episodeCount?.count).toBe(0);
    }).pipe(Effect.provide(layer));
  });
});
