import { SqlClient } from "@effect/sql";
import { Effect, Layer, TestClock } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { runMigrations } from "../src/db/migrate";
import { CandidatePayloadService } from "../src/services/CandidatePayloadService";
import { CandidatePayloadRepo } from "../src/services/CandidatePayloadRepo";
import { CandidatePayloadRepoD1 } from "../src/services/d1/CandidatePayloadRepoD1";
import {
  makeBiLayer,
  makeSqliteLayer,
  sampleDid,
  seedKnowledgeBase,
  withTempSqliteFile
} from "./support/runtime";
import type { AtUri } from "../src/domain/types";

const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as AtUri;

const makeLayer = () => {
  const baseLayer = makeBiLayer();
  const repoLayer = CandidatePayloadRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const serviceLayer = CandidatePayloadService.layer.pipe(Layer.provideMerge(repoLayer));

  return Layer.mergeAll(baseLayer, repoLayer, serviceLayer);
};

describe("post_payloads migration", () => {
  it.live("creates the post_payloads table with post_uri as PK", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const sqliteLayer = makeSqliteLayer(filename);

        await Effect.runPromise(
          runMigrations.pipe(Effect.provide(sqliteLayer))
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const tables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='post_payloads'
            `;
            expect(tables).toHaveLength(1);
            const info = yield* sql`PRAGMA table_info(post_payloads)`;
            const pkCol = (info as any[]).find((c: any) => c.pk === 1);
            expect(pkCol?.name).toBe("post_uri");
          }).pipe(Effect.provide(sqliteLayer))
        );
      })
    )
  );
});

describe("CandidatePayloadRepoD1", () => {
  it.effect("upsertCapture inserts a new candidate payload and returns true", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      const created = yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          images: [
            {
              thumb: "https://cdn.bsky.app/thumb-1.jpg",
              fullsize: "https://cdn.bsky.app/full-1.jpg",
              alt: "Line chart"
            }
          ]
        },
        enrichmentPayload: null,
        capturedAt: 1_710_000_100_000,
        updatedAt: 1_710_000_100_000,
        enrichedAt: null
      });

      expect(created).toBe(true);

      const stored = yield* repo.getByPostUri(solarUri);
      expect(stored?.captureStage).toBe("candidate");
      expect(stored?.embedType).toBe("img");
      expect(stored?.embedPayload).toEqual({
        images: [
          {
            thumb: "https://cdn.bsky.app/thumb-1.jpg",
            fullsize: "https://cdn.bsky.app/full-1.jpg",
            alt: "Line chart"
          }
        ]
      });
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("upsertCapture preserves picked stage and existing enrichment on refresh", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          images: [{ thumb: "thumb-a", fullsize: "full-a", alt: null }]
        },
        enrichmentPayload: null,
        capturedAt: 10,
        updatedAt: 10,
        enrichedAt: null
      });
      yield* repo.markPicked(solarUri, 20);
      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentPayload: { summary: "Synthetic alt text" }
        },
        30,
        30
      );

      const updated = yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          images: [{ thumb: "thumb-b", fullsize: "full-b", alt: "Updated alt" }]
        },
        enrichmentPayload: null,
        capturedAt: 40,
        updatedAt: 40,
        enrichedAt: null
      });

      expect(updated).toBe(false);

      const stored = yield* repo.getByPostUri(solarUri);
      expect(stored?.captureStage).toBe("picked");
      expect(stored?.embedPayload).toEqual({
        images: [{ thumb: "thumb-b", fullsize: "full-b", alt: "Updated alt" }]
      });
      expect(stored?.enrichmentPayload).toEqual({ summary: "Synthetic alt text" });
      expect(stored?.capturedAt).toBe(10);
      expect(stored?.updatedAt).toBe(40);
      expect(stored?.enrichedAt).toBe(30);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("saveEnrichment returns false when no stored payload exists", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      const stored = yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentPayload: { summary: "No row yet" }
        },
        50,
        50
      );

      expect(stored).toBe(false);
    }).pipe(Effect.provide(makeLayer()))
  );
});

describe("CandidatePayloadService", () => {
  it.effect("captures candidate payloads, marks picks, and stores enrichment with service-managed timestamps", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* CandidatePayloadService;

      const created = yield* service.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "link",
        embedPayload: {
          uri: "https://example.com/report",
          title: "Grid report",
          description: "Useful context",
          thumb: null
        }
      });
      expect(created).toBe(true);

      yield* TestClock.adjust(1);

      const marked = yield* service.markPicked(solarUri);
      expect(marked).toBe(true);

      yield* TestClock.adjust(1);

      const enriched = yield* service.saveEnrichment({
        postUri: solarUri,
        enrichmentPayload: {
          sourceAttribution: ["gridstatus"],
          visionSummary: "Chart shows rising prices"
        }
      });
      expect(enriched).toBe(true);

      const stored = yield* service.getPayload(solarUri);
      expect(stored?.captureStage).toBe("picked");
      expect(stored?.embedType).toBe("link");
      expect(stored?.enrichmentPayload).toEqual({
        sourceAttribution: ["gridstatus"],
        visionSummary: "Chart shows rising prices"
      });
      expect(stored?.capturedAt).toBe(0);
      expect(stored?.updatedAt).toBeGreaterThanOrEqual(stored?.capturedAt ?? 0);
      expect(stored?.updatedAt).toBe(2);
      expect(stored?.enrichedAt).toBe(2);
    }).pipe(Effect.provide(makeLayer()))
  );
});
