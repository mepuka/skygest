import { SqlClient } from "effect/unstable/sql";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";
import {
  CandidatePayloadNotPickedError
} from "../src/domain/candidatePayload";
import { DataRefResolutionEnrichment } from "../src/domain/enrichment";
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
import type { PostUri } from "../src/domain/types";

const solarUri = `at://${sampleDid}/app.bsky.feed.post/post-solar` as PostUri;
const decodeDataRefResolutionEnrichment = Schema.decodeUnknownSync(
  DataRefResolutionEnrichment
);
const dataRefAgentId = "https://id.skygest.io/agent/ag_TESTDATAREF01";
const dataRefDatasetId = "https://id.skygest.io/dataset/ds_TESTDATAREF01";
const dataRefVariableId = "https://id.skygest.io/variable/var_TESTDATAREF01";

const makeDataRefResolutionPayload = () =>
  decodeDataRefResolutionEnrichment({
    kind: "data-ref-resolution",
    stage1: {
      matches: [
        {
          _tag: "DatasetMatch",
          datasetId: dataRefDatasetId,
          title: "Average retail electricity price",
          bestRank: 1,
          evidence: [
            {
              _tag: "DatasetTitleEvidence",
              signal: "dataset-title",
              rank: 1,
              datasetName: "Average retail electricity price",
              normalizedTitle: "average retail electricity price"
            }
          ]
        }
      ],
      residuals: []
    },
    kernel: [
      {
        _tag: "Resolved",
        bundle: {
          postUri: solarUri,
          postText: ["Average retail electricity prices rose in Q1 2024."],
          chartTitle: "Average retail electricity price",
          xAxis: {
            label: "Quarter",
            unit: null
          },
          yAxis: {
            label: "Price",
            unit: "USD/MWh"
          },
          series: [
            {
              itemKey: "price",
              legendLabel: "Retail price",
              unit: "USD/MWh"
            }
          ],
          keyFindings: [],
          sourceLines: [],
          publisherHints: [],
          temporalCoverage: {
            startDate: "2024-01",
            endDate: "2024-03"
          }
        },
        sharedPartial: {
          measuredProperty: "price",
          domainObject: "electricity",
          statisticType: "price",
          aggregation: "average",
          unitFamily: "currency_per_energy"
        },
        attachedContext: {
          place: "United States"
        },
        items: [
          {
            _tag: "bound",
            itemKey: "price",
            semanticPartial: {
              measuredProperty: "price",
              domainObject: "electricity",
              statisticType: "price",
              aggregation: "average",
              unitFamily: "currency_per_energy"
            },
            attachedContext: {
              place: "United States"
            },
            evidence: [
              {
                source: "series-label",
                text: "Retail price",
                itemKey: "price"
              }
            ],
            variableId: dataRefVariableId,
            label: "Retail electricity price"
          }
        ],
        agentId: dataRefAgentId,
        confidence: 0.95,
        tier: "entailment"
      }
    ],
    resolverVersion: "test-resolver-v1",
    processedAt: 60
  });

const makeLayer = () => {
  const baseLayer = makeBiLayer();
  const repoLayer = CandidatePayloadRepoD1.layer.pipe(Layer.provideMerge(baseLayer));
  const serviceLayer = CandidatePayloadService.layer.pipe(Layer.provideMerge(repoLayer));

  return Layer.mergeAll(baseLayer, repoLayer, serviceLayer);
};

describe("payload storage migrations", () => {
  it.live("creates post_payloads and post_enrichments with the expected primary keys", () =>
    Effect.promise(() =>
      withTempSqliteFile(async (filename) => {
        const sqliteLayer = makeSqliteLayer(filename);

        await Effect.runPromise(
          runMigrations.pipe(Effect.provide(sqliteLayer))
        );

        await Effect.runPromise(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;

            const payloadTables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='post_payloads'
            `;
            expect(payloadTables).toHaveLength(1);

            const payloadInfo = yield* sql`PRAGMA table_info(post_payloads)`;
            const payloadPk = (payloadInfo as any[]).find((column: any) => column.pk === 1);
            expect(payloadPk?.name).toBe("post_uri");

            const enrichmentTables = yield* sql`
              SELECT name FROM sqlite_master
              WHERE type='table' AND name='post_enrichments'
            `;
            expect(enrichmentTables).toHaveLength(1);

            const enrichmentInfo = yield* sql`PRAGMA table_info(post_enrichments)`;
            const enrichmentPk = (enrichmentInfo as any[])
              .filter((column: any) => column.pk > 0)
              .sort((left: any, right: any) => left.pk - right.pk)
              .map((column: any) => column.name);
            expect(enrichmentPk).toEqual(["post_uri", "enrichment_type"]);
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
          kind: "img",
          images: [
            {
              thumb: "https://cdn.bsky.app/thumb-1.jpg",
              fullsize: "https://cdn.bsky.app/full-1.jpg",
              alt: "Line chart"
            }
          ]
        },
        enrichments: [],
        capturedAt: 1_710_000_100_000,
        updatedAt: 1_710_000_100_000,
        enrichedAt: null
      });

      expect(created).toBe(true);

      const stored = yield* repo.getByPostUri(solarUri);
      expect(stored?.captureStage).toBe("candidate");
      expect(stored?.embedType).toBe("img");
      expect(stored?.embedPayload).toEqual({
        kind: "img",
        images: [
          {
            thumb: "https://cdn.bsky.app/thumb-1.jpg",
            fullsize: "https://cdn.bsky.app/full-1.jpg",
            alt: "Line chart"
          }
        ]
      });
      expect(stored?.enrichments).toEqual([]);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("saveEnrichment accumulates different enrichment types and rewrites one type idempotently", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [{ thumb: "thumb-a", fullsize: "full-a", alt: null }]
        },
        enrichments: [],
        capturedAt: 10,
        updatedAt: 10,
        enrichedAt: null
      });
      yield* repo.markPicked(solarUri, 20);

      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "source-attribution",
          enrichmentPayload: { sources: ["gridstatus"] }
        },
        30,
        30
      );

      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "vision",
          enrichmentPayload: { summary: "Chart shows rising prices" }
        },
        40,
        40
      );

      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "vision",
          enrichmentPayload: { summary: "Chart shows prices rising quickly" }
        },
        50,
        50
      );

      const stored = yield* repo.getByPostUri(solarUri);
      expect(stored?.enrichments).toEqual([
        {
          enrichmentType: "source-attribution",
          enrichmentPayload: { sources: ["gridstatus"] },
          updatedAt: 30,
          enrichedAt: 30
        },
        {
          enrichmentType: "vision",
          enrichmentPayload: { summary: "Chart shows prices rising quickly" },
          updatedAt: 50,
          enrichedAt: 50
        }
      ]);
      expect(stored?.updatedAt).toBe(50);
      expect(stored?.enrichedAt).toBe(50);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("upsertCapture preserves picked stage and existing enrichments on refresh", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [{ thumb: "thumb-a", fullsize: "full-a", alt: null }]
        },
        enrichments: [],
        capturedAt: 10,
        updatedAt: 10,
        enrichedAt: null
      });
      yield* repo.markPicked(solarUri, 20);
      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "vision",
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
          kind: "img",
          images: [{ thumb: "thumb-b", fullsize: "full-b", alt: "Updated alt" }]
        },
        enrichments: [],
        capturedAt: 40,
        updatedAt: 40,
        enrichedAt: null
      });

      expect(updated).toBe(false);

      const stored = yield* repo.getByPostUri(solarUri);
      expect(stored?.captureStage).toBe("picked");
      expect(stored?.embedPayload).toEqual({
        kind: "img",
        images: [{ thumb: "thumb-b", fullsize: "full-b", alt: "Updated alt" }]
      });
      expect(stored?.enrichments).toEqual([
        {
          enrichmentType: "vision",
          enrichmentPayload: { summary: "Synthetic alt text" },
          updatedAt: 30,
          enrichedAt: 30
        }
      ]);
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
          enrichmentType: "vision",
          enrichmentPayload: { summary: "No row yet" }
        },
        50,
        50
      );

      expect(stored).toBe(false);
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("saveEnrichment fails when the payload has not been picked", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;

      yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [{ thumb: "thumb-a", fullsize: "full-a", alt: null }]
        },
        enrichments: [],
        capturedAt: 10,
        updatedAt: 10,
        enrichedAt: null
      });

      const error = yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "vision",
          enrichmentPayload: { summary: "Too early" }
        },
        20,
        20
      ).pipe(Effect.flip);

      expect(error).toBeInstanceOf(CandidatePayloadNotPickedError);
      if (error instanceof CandidatePayloadNotPickedError) {
        expect(error.captureStage).toBe("candidate");
      }
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("saveEnrichment persists data-ref candidate citations for resolver output", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const repo = yield* CandidatePayloadRepo;
      const sql = yield* SqlClient.SqlClient;

      yield* repo.upsertCapture({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "img",
        embedPayload: {
          kind: "img",
          images: [{ thumb: "thumb-a", fullsize: "full-a", alt: null }]
        },
        enrichments: [],
        capturedAt: 10,
        updatedAt: 10,
        enrichedAt: null
      });
      yield* repo.markPicked(solarUri, 20);

      yield* repo.saveEnrichment(
        {
          postUri: solarUri,
          enrichmentType: "data-ref-resolution",
          enrichmentPayload: makeDataRefResolutionPayload()
        },
        60,
        60
      );

      const rows = yield* sql<{
        entityId: string;
        resolutionState: string;
        assertedUnit: string | null;
        observationStart: string | null;
        observationEnd: string | null;
        hasObservationTime: number;
      }>`
        SELECT
          entity_id as entityId,
          resolution_state as resolutionState,
          asserted_unit as assertedUnit,
          observation_start as observationStart,
          observation_end as observationEnd,
          has_observation_time as hasObservationTime
        FROM data_ref_candidate_citations
        WHERE source_post_uri = ${solarUri}
        ORDER BY entity_id ASC
      `;

      expect(rows).toEqual([
        {
          entityId: dataRefAgentId,
          resolutionState: "resolved",
          assertedUnit: null,
          observationStart: "2024-01",
          observationEnd: "2024-03",
          hasObservationTime: 1
        },
        {
          entityId: dataRefDatasetId,
          resolutionState: "source_only",
          assertedUnit: null,
          observationStart: null,
          observationEnd: null,
          hasObservationTime: 0
        },
        {
          entityId: dataRefVariableId,
          resolutionState: "resolved",
          assertedUnit: "USD/MWh",
          observationStart: "2024-01",
          observationEnd: "2024-03",
          hasObservationTime: 1
        }
      ]);
    }).pipe(Effect.provide(makeLayer()))
  );
});

describe("CandidatePayloadService", () => {
  it.effect("fails enrichment writes before the payload is picked", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* CandidatePayloadService;

      yield* service.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "link",
        embedPayload: {
          kind: "link",
          uri: "https://example.com/report",
          title: "Grid report",
          description: "Useful context",
          thumb: null
        }
      });

      const error = yield* service.saveEnrichment({
        postUri: solarUri,
        enrichmentType: "vision",
        enrichmentPayload: {
          visionSummary: "Chart shows rising prices"
        }
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(CandidatePayloadNotPickedError);
      if (error instanceof CandidatePayloadNotPickedError) {
        expect(error.captureStage).toBe("candidate");
      }
    }).pipe(Effect.provide(makeLayer()))
  );

  it.effect("captures candidate payloads, marks picks, and stores typed enrichments with service-managed timestamps", () =>
    Effect.gen(function* () {
      yield* seedKnowledgeBase();
      const service = yield* CandidatePayloadService;

      const created = yield* service.capturePayload({
        postUri: solarUri,
        captureStage: "candidate",
        embedType: "link",
        embedPayload: {
          kind: "link",
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

      const sourceEnriched = yield* service.saveEnrichment({
        postUri: solarUri,
        enrichmentType: "source-attribution",
        enrichmentPayload: {
          sources: ["gridstatus"]
        }
      });
      expect(sourceEnriched).toBe(true);

      yield* TestClock.adjust(1);

      const visionEnriched = yield* service.saveEnrichment({
        postUri: solarUri,
        enrichmentType: "vision",
        enrichmentPayload: {
          visionSummary: "Chart shows rising prices"
        }
      });
      expect(visionEnriched).toBe(true);

      const stored = yield* service.getPayload(solarUri);
      expect(stored?.captureStage).toBe("picked");
      expect(stored?.embedType).toBe("link");
      expect(stored?.enrichments).toEqual([
        {
          enrichmentType: "source-attribution",
          enrichmentPayload: {
            sources: ["gridstatus"]
          },
          updatedAt: 2,
          enrichedAt: 2
        },
        {
          enrichmentType: "vision",
          enrichmentPayload: {
            visionSummary: "Chart shows rising prices"
          },
          updatedAt: 3,
          enrichedAt: 3
        }
      ]);
      expect(stored?.capturedAt).toBe(0);
      expect(stored?.updatedAt).toBe(3);
      expect(stored?.enrichedAt).toBe(3);
    }).pipe(Effect.provide(makeLayer()))
  );
});
