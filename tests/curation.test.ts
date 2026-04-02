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
import { CurationRepo } from "../src/services/CurationRepo";
import { CurationService } from "../src/services/CurationService";
import { KnowledgeRepo } from "../src/services/KnowledgeRepo";
import { smokeFixtureUris } from "../src/staging/SmokeFixture";

const fixtureUris = smokeFixtureUris(sampleDid);
const solarUri = fixtureUris[0]!;

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

            const candidates = yield* repo.listCandidates({});
            expect(candidates.length).toBeGreaterThan(0);

            const c = candidates.find((x) => x.uri === solarUri);
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
            expect(candidates.length).toBeGreaterThan(0);
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
            expect(candidates).toHaveLength(0);
          }).pipe(Effect.provide(layer))
        );
      })
    )
  );
});
