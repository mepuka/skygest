import { Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { describe, expect, it } from "@effect/vitest";
import {
  makeBiLayer,
  makeSqliteLayer,
  seedKnowledgeBase,
  sampleDid,
  testConfig,
  withTempSqliteFile
} from "./support/runtime";
import { BlueskyClient } from "../src/bluesky/BlueskyClient";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { CurationRepo } from "../src/services/CurationRepo";
import { CurationService } from "../src/services/CurationService";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";

const fixtureUris = smokeFixtureUris(sampleDid);
const solarUri = fixtureUris[0]!;
const windUri = fixtureUris[1]!;

describe("CurationRepo", () => {
  it.live("upsertFlag inserts a flagged record", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;

            const inserted = yield* repo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 45 as any,
              predicatesApplied: ["energy-focused-expert", "has-links"],
              flaggedAt: Date.now(),
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });
            expect(inserted).toBe(true);

            const record = yield* repo.getByPostUri(solarUri);
            expect(record).not.toBeNull();
            expect(record!.status).toBe("flagged");
            expect(record!.signalScore).toBe(45);
            expect(record!.predicatesApplied).toEqual(["energy-focused-expert", "has-links"]);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );

  it.live("upsertFlag preserves curated status", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;
            const now = Date.now();

            // First insert as flagged
            yield* repo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 45 as any,
              predicatesApplied: ["has-links"],
              flaggedAt: now,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });

            // Update to curated
            yield* repo.updateStatus(solarUri, "curated", "test-curator", "good post", now);

            // Try to re-flag — should be preserved
            const reflagged = yield* repo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 60 as any,
              predicatesApplied: ["has-links", "multi-topic"],
              flaggedAt: now + 1000,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });
            expect(reflagged).toBe(false);

            const record = yield* repo.getByPostUri(solarUri);
            expect(record!.status).toBe("curated");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );

  it.live("listCandidates returns flagged posts with joined data", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;

            yield* repo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 65 as any,
              predicatesApplied: ["energy-focused-expert", "has-links", "multi-topic"],
              flaggedAt: Date.now(),
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });

            const page = yield* repo.listCandidates({});
            expect(page.items.length).toBeGreaterThan(0);
            expect(page.total).toBeGreaterThan(0);

            const c = page.items.find((x) => x.uri === solarUri);
            expect(c).toBeDefined();
            expect(c!.signalScore).toBe(65);
            expect(c!.curationStatus).toBe("flagged");
            expect(c!.predicatesApplied).toContain("energy-focused-expert");
            expect(c!.topics.length).toBeGreaterThan(0);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );

  it.live("supports platform filters, counts, and cursor pagination", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          config: { curationMinSignalScore: 100 }
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;
            const sql = yield* SqlClient.SqlClient;
            const now = Date.now();
            const twitterUri = "x://tweet/test-1";

            yield* sql`
              INSERT INTO posts (
                uri,
                did,
                cid,
                text,
                created_at,
                indexed_at,
                has_links,
                status,
                ingest_id,
                embed_type
              ) VALUES (
                ${twitterUri},
                ${sampleDid},
                ${"cid-twitter-1"},
                ${"Imported Twitter market update"},
                ${now - 1000},
                ${now - 1000},
                ${0},
                ${"active"},
                ${"ingest-twitter-1"},
                ${null}
              )
            `;

            yield* repo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 95 as any,
              predicatesApplied: ["has-links"],
              flaggedAt: now + 3,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });
            yield* repo.upsertFlag({
              postUri: windUri as any,
              status: "flagged",
              signalScore: 85 as any,
              predicatesApplied: ["multi-topic"],
              flaggedAt: now + 2,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });
            yield* repo.upsertFlag({
              postUri: twitterUri as any,
              status: "flagged",
              signalScore: 75 as any,
              predicatesApplied: ["manual-import"],
              flaggedAt: now + 1,
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });

            const counts = yield* repo.countCandidates({});
            expect(counts.total).toBe(3);
            expect(counts.byPlatform.bluesky).toBe(2);
            expect(counts.byPlatform.twitter).toBe(1);

            const firstPage = yield* repo.listCandidates({ limit: 2, platform: "all" });
            expect(firstPage.total).toBe(3);
            expect(firstPage.items.map((item) => item.uri)).toEqual([solarUri, windUri]);
            expect(firstPage.nextCursor).not.toBeNull();

            const secondPage = yield* repo.listCandidates({
              limit: 2,
              platform: "all",
              cursor: firstPage.nextCursor!
            });
            expect(secondPage.total).toBe(3);
            expect(secondPage.items).toHaveLength(1);
            expect(secondPage.items[0]?.uri).toBe(twitterUri);

            const twitterOnly = yield* repo.listCandidates({ platform: "twitter" });
            expect(twitterOnly.total).toBe(1);
            expect(twitterOnly.items).toHaveLength(1);
            expect(twitterOnly.items[0]?.uri).toBe(twitterUri);

            const exportPage = yield* repo.exportCandidates({ platform: "twitter" });
            expect(exportPage.total).toBe(1);
            expect(exportPage.items[0]?.platform).toBe("twitter");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});

describe("CurationService.flagBatch", () => {
  it.live("flags posts that meet the threshold", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        // Use low threshold so our seed posts get flagged
        const layer = makeBiLayer({ filename, config: { curationMinSignalScore: 10 } });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;

            // After seedKnowledgeBase, processBatch will have already
            // called flagBatch via the FilterWorker hook.
            // Check that some posts were flagged.
            const candidates = yield* repo.listCandidates({});
            expect(candidates.items.length).toBeGreaterThan(0);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );

  it.live("does not flag posts below threshold", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        // Use very high threshold
        const layer = makeBiLayer({ filename, config: { curationMinSignalScore: 100 } });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const repo = yield* CurationRepo;
            const candidates = yield* repo.listCandidates({});
            expect(candidates.items).toHaveLength(0);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});

const failingBlueskyClient = Layer.succeed(BlueskyClient, {
  resolveDidOrHandle: () => Effect.die("BlueskyClient should not be called"),
  getProfile: () => Effect.die("BlueskyClient should not be called"),
  getFollows: () => Effect.die("BlueskyClient should not be called"),
  resolveRepoService: () => Effect.die("BlueskyClient should not be called"),
  listRecordsAtService: () => Effect.die("BlueskyClient should not be called"),
  getPostThread: () => Effect.die("BlueskyClient should not be called"),
  getPosts: () => Effect.die("BlueskyClient should not be called"),
} as any);

describe("CurationService.curatePost skip-fetch", () => {
  it.live("curates Bluesky post with stored payload without re-fetching", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({ filename, blueskyClient: failingBlueskyClient });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            const curationService = yield* CurationService;
            const curationRepo = yield* CurationRepo;

            // Flag the post first
            yield* curationRepo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 50 as any,
              predicatesApplied: ["energy-focused-expert"],
              flaggedAt: Date.now(),
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });

            // Pre-store payload (simulating import with captured embed)
            yield* payloadService.capturePayload({
              postUri: solarUri as any,
              captureStage: "candidate",
              embedType: "link",
              embedPayload: { kind: "link", uri: "https://example.com", title: "Test", description: null, thumb: null }
            });

            // curatePost should succeed using stored payload — NOT calling BlueskyClient
            const result = yield* curationService.curatePost(
              { postUri: solarUri as any, action: "curate" },
              "test-operator"
            );
            expect(result.newStatus).toBe("curated");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});

describe("CurationService.bulkCurate", () => {
  it.live("applies mixed curate and reject decisions with per-post error reporting", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const layer = makeBiLayer({
          filename,
          config: { curationMinSignalScore: 100 },
          blueskyClient: failingBlueskyClient
        });
        await Effect.runPromise(seedKnowledgeBase().pipe(Effect.provide(layer)));

        await Effect.runPromise(
          Effect.gen(function* () {
            const payloadService = yield* CandidatePayloadService;
            const curationService = yield* CurationService;
            const curationRepo = yield* CurationRepo;

            yield* curationRepo.upsertFlag({
              postUri: solarUri as any,
              status: "flagged",
              signalScore: 60 as any,
              predicatesApplied: ["has-links"],
              flaggedAt: Date.now(),
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });
            yield* curationRepo.upsertFlag({
              postUri: windUri as any,
              status: "flagged",
              signalScore: 55 as any,
              predicatesApplied: ["multi-topic"],
              flaggedAt: Date.now(),
              curatedAt: null,
              curatedBy: null,
              reviewNote: null
            });

            yield* payloadService.capturePayload({
              postUri: solarUri as any,
              captureStage: "candidate",
              embedType: "link",
              embedPayload: {
                kind: "link",
                uri: "https://example.com/article",
                title: "Stored payload",
                description: null,
                thumb: null
              }
            });

            const result = yield* curationService.bulkCurate(
              {
                decisions: [
                  { postUri: solarUri as any, action: "curate" },
                  { postUri: windUri as any, action: "reject", note: "off topic" },
                  { postUri: "at://did:plc:missing/app.bsky.feed.post/nope" as any, action: "reject" }
                ]
              },
              "test-operator"
            );

            expect(result.curated).toBe(1);
            expect(result.rejected).toBe(1);
            expect(result.skipped).toBe(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]?.postUri).toBe("at://did:plc:missing/app.bsky.feed.post/nope");

            const curated = yield* curationRepo.getByPostUri(solarUri);
            const rejected = yield* curationRepo.getByPostUri(windUri);
            expect(curated?.status).toBe("curated");
            expect(rejected?.status).toBe("rejected");
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});
