import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  PipelineStatusOutput,
  type PipelineStatusOutput as PipelineStatusOutputType
} from "../../domain/pipeline";
import { PipelineStatusRepo } from "../PipelineStatusRepo";
import { decodeWithDbError } from "./schemaDecode";

const SnapshotCountsRowSchema = Schema.Struct({
  expertTotal: Schema.Number,
  expertBluesky: Schema.Number,
  expertTwitter: Schema.Number,
  expertEnergyFocused: Schema.Number,
  expertGeneralOutlet: Schema.Number,
  expertIndependent: Schema.Number,
  postTotal: Schema.Number,
  postBluesky: Schema.Number,
  postTwitter: Schema.Number,
  curated: Schema.Number,
  rejected: Schema.Number,
  flagged: Schema.Number,
  uncurated: Schema.Number,
  enrichmentTotal: Schema.Number,
  vision: Schema.Number,
  sourceAttribution: Schema.Number,
  grounding: Schema.Number,
  dataRefResolution: Schema.Number,
  runComplete: Schema.Number,
  runQueued: Schema.Number,
  runRunning: Schema.Number,
  runFailed: Schema.Number,
  runNeedsReview: Schema.Number
});
const SnapshotCountsRowsSchema = Schema.Array(SnapshotCountsRowSchema);

const zeroSnapshotCounts: Schema.Schema.Type<typeof SnapshotCountsRowSchema> = {
  expertTotal: 0,
  expertBluesky: 0,
  expertTwitter: 0,
  expertEnergyFocused: 0,
  expertGeneralOutlet: 0,
  expertIndependent: 0,
  postTotal: 0,
  postBluesky: 0,
  postTwitter: 0,
  curated: 0,
  rejected: 0,
  flagged: 0,
  uncurated: 0,
  enrichmentTotal: 0,
  vision: 0,
  sourceAttribution: 0,
  grounding: 0,
  dataRefResolution: 0,
  runComplete: 0,
  runQueued: 0,
  runRunning: 0,
  runFailed: 0,
  runNeedsReview: 0
};

const LastSweepRowSchema = Schema.Struct({
  runId: Schema.String,
  completedAt: Schema.Number,
  postsStored: Schema.Number,
  expertsFailed: Schema.Number,
  status: Schema.Literals(["complete", "failed"])
});
const LastSweepRowsSchema = Schema.Array(LastSweepRowSchema);

const toStatus = ({
  snapshotCounts,
  lastSweep
}: {
  readonly snapshotCounts: Schema.Schema.Type<typeof SnapshotCountsRowSchema>;
  readonly lastSweep: Schema.Schema.Type<typeof LastSweepRowSchema> | null;
}): PipelineStatusOutputType => ({
  asOf: Date.now(),
  experts: {
    total: snapshotCounts.expertTotal,
    bluesky: snapshotCounts.expertBluesky,
    twitter: snapshotCounts.expertTwitter,
    byTier: {
      energyFocused: snapshotCounts.expertEnergyFocused,
      generalOutlet: snapshotCounts.expertGeneralOutlet,
      independent: snapshotCounts.expertIndependent
    }
  },
  posts: {
    total: snapshotCounts.postTotal,
    bluesky: snapshotCounts.postBluesky,
    twitter: snapshotCounts.postTwitter
  },
  curation: {
    curated: snapshotCounts.curated,
    rejected: snapshotCounts.rejected,
    flagged: snapshotCounts.flagged,
    uncurated: snapshotCounts.uncurated
  },
  enrichments: {
    stored: {
      total: snapshotCounts.enrichmentTotal,
      vision: snapshotCounts.vision,
      sourceAttribution: snapshotCounts.sourceAttribution,
      grounding: snapshotCounts.grounding,
      dataRefResolution: snapshotCounts.dataRefResolution
    },
    runs: {
      complete: snapshotCounts.runComplete,
      queued: snapshotCounts.runQueued,
      running: snapshotCounts.runRunning,
      failed: snapshotCounts.runFailed,
      needsReview: snapshotCounts.runNeedsReview
    }
  },
  lastSweep
});

export const PipelineStatusRepoD1 = {
  layer: Layer.effect(PipelineStatusRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getStatus = () =>
      Effect.all({
        snapshotCounts: sql<any>`
          WITH
            active_experts AS (
              SELECT
                did,
                COALESCE(tier, 'independent') as tier
              FROM experts
              WHERE active = 1
            ),
            active_posts AS (
              SELECT
                uri,
                did
              FROM posts
              WHERE status = 'active'
            ),
            active_curation AS (
              SELECT
                pc.post_uri as postUri,
                pc.status as status
              FROM post_curation pc
              JOIN active_posts ap ON ap.uri = pc.post_uri
            )
          SELECT
            (SELECT COUNT(*) FROM active_experts) as expertTotal,
            (SELECT COUNT(*) FROM active_experts WHERE did LIKE 'did:plc:%') as expertBluesky,
            (SELECT COUNT(*) FROM active_experts WHERE did LIKE 'did:x:%') as expertTwitter,
            (SELECT COUNT(*) FROM active_experts WHERE tier = 'energy-focused') as expertEnergyFocused,
            (SELECT COUNT(*) FROM active_experts WHERE tier = 'general-outlet') as expertGeneralOutlet,
            (SELECT COUNT(*) FROM active_experts WHERE tier = 'independent') as expertIndependent,
            (SELECT COUNT(*) FROM active_posts) as postTotal,
            (SELECT COUNT(*) FROM active_posts WHERE did LIKE 'did:plc:%') as postBluesky,
            (SELECT COUNT(*) FROM active_posts WHERE did LIKE 'did:x:%') as postTwitter,
            (SELECT COUNT(*) FROM active_curation WHERE status = 'curated') as curated,
            (SELECT COUNT(*) FROM active_curation WHERE status = 'rejected') as rejected,
            (SELECT COUNT(*) FROM active_curation WHERE status = 'flagged') as flagged,
            (
              SELECT COUNT(*)
              FROM active_posts ap
              LEFT JOIN active_curation ac ON ac.postUri = ap.uri
              WHERE ac.postUri IS NULL
            ) as uncurated,
            (SELECT COUNT(*) FROM post_enrichments) as enrichmentTotal,
            (SELECT COUNT(*) FROM post_enrichments WHERE enrichment_type = 'vision') as vision,
            (
              SELECT COUNT(*)
              FROM post_enrichments
              WHERE enrichment_type = 'source-attribution'
            ) as sourceAttribution,
            (SELECT COUNT(*) FROM post_enrichments WHERE enrichment_type = 'grounding') as grounding,
            (
              SELECT COUNT(*)
              FROM post_enrichments
              WHERE enrichment_type = 'data-ref-resolution'
            ) as dataRefResolution,
            (
              SELECT COUNT(*)
              FROM post_enrichment_runs
              WHERE status = 'complete'
            ) as runComplete,
            (
              SELECT COUNT(*)
              FROM post_enrichment_runs
              WHERE status = 'queued'
            ) as runQueued,
            (
              SELECT COUNT(*)
              FROM post_enrichment_runs
              WHERE status = 'running'
            ) as runRunning,
            (
              SELECT COUNT(*)
              FROM post_enrichment_runs
              WHERE status = 'failed'
            ) as runFailed,
            (
              SELECT COUNT(*)
              FROM post_enrichment_runs
              WHERE status = 'needs-review'
            ) as runNeedsReview
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              SnapshotCountsRowsSchema,
              rows,
              "Failed to decode pipeline snapshot counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? zeroSnapshotCounts)
        ),
        lastSweep: sql<any>`
          SELECT
            id as runId,
            finished_at as completedAt,
            posts_stored as postsStored,
            experts_failed as expertsFailed,
            status as status
          FROM ingest_runs
          WHERE kind = 'head-sweep'
            AND finished_at IS NOT NULL
            AND status IN ('complete', 'failed')
          ORDER BY finished_at DESC, id DESC
          LIMIT 1
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              LastSweepRowsSchema,
              rows,
              "Failed to decode latest head sweep"
            )
          ),
          Effect.map((rows) => rows[0] ?? null)
        )
      }).pipe(
        Effect.map(toStatus),
        Effect.flatMap((status) =>
          decodeWithDbError(
            PipelineStatusOutput,
            status,
            "Failed to normalize pipeline status snapshot"
          )
        )
      );

    return PipelineStatusRepo.of({ getStatus });
  }))
};
