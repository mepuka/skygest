import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import {
  PipelineStatusOutput,
  type PipelineStatusOutput as PipelineStatusOutputType
} from "../../domain/pipeline";
import { PipelineStatusRepo } from "../PipelineStatusRepo";
import { decodeWithDbError } from "./schemaDecode";

const CountRowSchema = Schema.Struct({
  total: Schema.Number,
  bluesky: Schema.Number,
  twitter: Schema.Number,
  energyFocused: Schema.Number,
  generalOutlet: Schema.Number,
  independent: Schema.Number
});
const CountRowsSchema = Schema.Array(CountRowSchema);

const PostCountRowSchema = Schema.Struct({
  total: Schema.Number,
  bluesky: Schema.Number,
  twitter: Schema.Number
});
const PostCountRowsSchema = Schema.Array(PostCountRowSchema);

const CurationCountRowSchema = Schema.Struct({
  curated: Schema.Number,
  rejected: Schema.Number,
  flagged: Schema.Number
});
const CurationCountRowsSchema = Schema.Array(CurationCountRowSchema);

const StoredEnrichmentCountRowSchema = Schema.Struct({
  total: Schema.Number,
  vision: Schema.Number,
  sourceAttribution: Schema.Number
});
const StoredEnrichmentCountRowsSchema = Schema.Array(StoredEnrichmentCountRowSchema);

const RunCountRowSchema = Schema.Struct({
  complete: Schema.Number,
  queued: Schema.Number,
  running: Schema.Number,
  failed: Schema.Number,
  needsReview: Schema.Number
});
const RunCountRowsSchema = Schema.Array(RunCountRowSchema);

const LastSweepRowSchema = Schema.Struct({
  runId: Schema.String,
  completedAt: Schema.Number,
  postsStored: Schema.Number,
  failures: Schema.Number,
  status: Schema.Literals(["complete", "failed"])
});
const LastSweepRowsSchema = Schema.Array(LastSweepRowSchema);

const toStatus = ({
  expertCounts,
  postCounts,
  curationCounts,
  storedCounts,
  runCounts,
  lastSweep
}: {
  readonly expertCounts: Schema.Schema.Type<typeof CountRowSchema>;
  readonly postCounts: Schema.Schema.Type<typeof PostCountRowSchema>;
  readonly curationCounts: Schema.Schema.Type<typeof CurationCountRowSchema>;
  readonly storedCounts: Schema.Schema.Type<typeof StoredEnrichmentCountRowSchema>;
  readonly runCounts: Schema.Schema.Type<typeof RunCountRowSchema>;
  readonly lastSweep: Schema.Schema.Type<typeof LastSweepRowSchema> | null;
}): PipelineStatusOutputType => ({
  experts: {
    total: expertCounts.total,
    bluesky: expertCounts.bluesky,
    twitter: expertCounts.twitter,
    byTier: {
      energyFocused: expertCounts.energyFocused,
      generalOutlet: expertCounts.generalOutlet,
      independent: expertCounts.independent
    }
  },
  posts: {
    total: postCounts.total,
    bluesky: postCounts.bluesky,
    twitter: postCounts.twitter
  },
  curation: {
    curated: curationCounts.curated,
    rejected: curationCounts.rejected,
    flagged: curationCounts.flagged
  },
  enrichments: {
    stored: {
      total: storedCounts.total,
      vision: storedCounts.vision,
      sourceAttribution: storedCounts.sourceAttribution
    },
    runs: {
      complete: runCounts.complete,
      queued: runCounts.queued,
      running: runCounts.running,
      failed: runCounts.failed,
      needsReview: runCounts.needsReview
    }
  },
  lastSweep
});

export const PipelineStatusRepoD1 = {
  layer: Layer.effect(PipelineStatusRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const getStatus = () =>
      Effect.all({
        expertCounts: sql<any>`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN source = 'twitter-import' THEN 1 END) as twitter,
            COUNT(CASE WHEN source != 'twitter-import' THEN 1 END) as bluesky,
            COUNT(CASE WHEN COALESCE(tier, 'independent') = 'energy-focused' THEN 1 END) as energyFocused,
            COUNT(CASE WHEN COALESCE(tier, 'independent') = 'general-outlet' THEN 1 END) as generalOutlet,
            COUNT(CASE WHEN COALESCE(tier, 'independent') = 'independent' THEN 1 END) as independent
          FROM experts
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              CountRowsSchema,
              rows,
              "Failed to decode pipeline expert counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            total: 0,
            bluesky: 0,
            twitter: 0,
            energyFocused: 0,
            generalOutlet: 0,
            independent: 0
          })
        ),
        postCounts: sql<any>`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN uri LIKE 'at://%' THEN 1 END) as bluesky,
            COUNT(CASE WHEN uri LIKE 'x://%' THEN 1 END) as twitter
          FROM posts
          WHERE status = 'active'
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              PostCountRowsSchema,
              rows,
              "Failed to decode pipeline post counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            total: 0,
            bluesky: 0,
            twitter: 0
          })
        ),
        curationCounts: sql<any>`
          SELECT
            COUNT(CASE WHEN status = 'curated' THEN 1 END) as curated,
            COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
            COUNT(CASE WHEN status = 'flagged' THEN 1 END) as flagged
          FROM post_curation
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              CurationCountRowsSchema,
              rows,
              "Failed to decode pipeline curation counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            curated: 0,
            rejected: 0,
            flagged: 0
          })
        ),
        storedCounts: sql<any>`
          SELECT
            COUNT(*) as total,
            COUNT(CASE WHEN enrichment_type = 'vision' THEN 1 END) as vision,
            COUNT(CASE WHEN enrichment_type = 'source-attribution' THEN 1 END) as sourceAttribution
          FROM post_enrichments
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              StoredEnrichmentCountRowsSchema,
              rows,
              "Failed to decode pipeline stored enrichment counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            total: 0,
            vision: 0,
            sourceAttribution: 0
          })
        ),
        runCounts: sql<any>`
          SELECT
            COUNT(CASE WHEN status = 'complete' THEN 1 END) as complete,
            COUNT(CASE WHEN status = 'queued' THEN 1 END) as queued,
            COUNT(CASE WHEN status = 'running' THEN 1 END) as running,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
            COUNT(CASE WHEN status = 'needs-review' THEN 1 END) as needsReview
          FROM post_enrichment_runs
        `.pipe(
          Effect.flatMap((rows) =>
            decodeWithDbError(
              RunCountRowsSchema,
              rows,
              "Failed to decode pipeline enrichment run counts"
            )
          ),
          Effect.map((rows) => rows[0] ?? {
            complete: 0,
            queued: 0,
            running: 0,
            failed: 0,
            needsReview: 0
          })
        ),
        lastSweep: sql<any>`
          SELECT
            id as runId,
            finished_at as completedAt,
            posts_stored as postsStored,
            experts_failed as failures,
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
