import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import { CurationRepo } from "../CurationRepo";
import type { CurationRecord, ListCurationCandidatesInput } from "../../domain/curation";
import {
  CurationRecord as CurationRecordSchema,
  CurationCandidateOutput as CurationCandidateOutputSchema
} from "../../domain/curation";
import { emptyKnowledgePostHydration } from "../../domain/bi";
import { decodeWithDbError } from "./schemaDecode";
import { topicFilterExists } from "./queryFragments";

const isDefined = <A>(value: A | null): value is A => value !== null;

// ---------------------------------------------------------------------------
// Raw row schemas (DB types — no branded types)
// ---------------------------------------------------------------------------

const CurationRowSchema = Schema.Struct({
  postUri: Schema.String,
  status: Schema.String,
  signalScore: Schema.Number,
  predicatesApplied: Schema.String,
  flaggedAt: Schema.Number,
  curatedAt: Schema.NullOr(Schema.Number),
  curatedBy: Schema.NullOr(Schema.String),
  reviewNote: Schema.NullOr(Schema.String)
});
const CurationRowsSchema = Schema.Array(CurationRowSchema);
type CurationRow = Schema.Schema.Type<typeof CurationRowSchema>;

const toCurationRecord = (row: CurationRow) => ({
  ...row,
  predicatesApplied: JSON.parse(row.predicatesApplied) as string[]
});

const CandidateRowSchema = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  tier: Schema.optionalWith(Schema.String, { default: () => "independent" }),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String),
  signalScore: Schema.Number,
  curationStatus: Schema.String,
  predicatesApplied: Schema.String,
  flaggedAt: Schema.Number
});
const CandidateRowsSchema = Schema.Array(CandidateRowSchema);
type CandidateRow = Schema.Schema.Type<typeof CandidateRowSchema>;

const toCandidateOutput = (row: CandidateRow) => ({
  uri: row.uri,
  did: row.did,
  handle: row.handle,
  avatar: row.avatar,
  tier: row.tier,
  text: row.text,
  createdAt: row.createdAt,
  topics: row.topicsCsv === null || row.topicsCsv.length === 0
    ? []
    : row.topicsCsv.split(",").filter((t) => t.length > 0),
  ...emptyKnowledgePostHydration(),
  signalScore: row.signalScore,
  curationStatus: row.curationStatus,
  predicatesApplied: JSON.parse(row.predicatesApplied) as string[],
  flaggedAt: row.flaggedAt
});

export const CurationRepoD1 = {
  layer: Layer.effect(CurationRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    // ---------------------------------------------------------------------------
    // upsertFlag — preserves curated/rejected
    // ---------------------------------------------------------------------------
    const upsertFlag = (record: CurationRecord) =>
      sql`
        INSERT INTO post_curation (
          post_uri, status, signal_score, predicates_applied,
          flagged_at, curated_at, curated_by, review_note
        ) VALUES (
          ${record.postUri},
          ${record.status},
          ${record.signalScore},
          ${JSON.stringify(record.predicatesApplied)},
          ${record.flaggedAt},
          ${record.curatedAt},
          ${record.curatedBy},
          ${record.reviewNote}
        )
        ON CONFLICT(post_uri) DO UPDATE SET
          signal_score = excluded.signal_score,
          predicates_applied = excluded.predicates_applied,
          flagged_at = excluded.flagged_at
        WHERE post_curation.status = 'flagged'
      `.pipe(
        Effect.flatMap(() =>
          sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
            Effect.map((rows) => (rows[0]?.cnt ?? 0) > 0)
          )
        )
      );

    // ---------------------------------------------------------------------------
    // bulkUpsertFlags
    // ---------------------------------------------------------------------------
    const bulkUpsertFlags = (records: ReadonlyArray<CurationRecord>) => {
      if (records.length === 0) return Effect.succeed(0);
      return Effect.forEach(records, upsertFlag, { discard: false }).pipe(
        Effect.map((results) => results.filter(Boolean).length)
      );
    };

    // ---------------------------------------------------------------------------
    // updateStatus
    // ---------------------------------------------------------------------------
    const updateStatus = (
      postUri: string,
      status: string,
      curatedBy: string | null,
      note: string | null,
      curatedAt: number
    ) =>
      sql`
        INSERT INTO post_curation (
          post_uri, status, signal_score, predicates_applied,
          flagged_at, curated_at, curated_by, review_note
        ) VALUES (
          ${postUri},
          ${status},
          ${0},
          ${"[]"},
          ${curatedAt},
          ${curatedAt},
          ${curatedBy},
          ${note}
        )
        ON CONFLICT(post_uri) DO UPDATE SET
          status = ${status},
          curated_at = ${curatedAt},
          curated_by = ${curatedBy},
          review_note = ${note}
      `.pipe(
        Effect.flatMap(() =>
          sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
            Effect.map((rows) => (rows[0]?.cnt ?? 0) > 0)
          )
        )
      );

    // ---------------------------------------------------------------------------
    // getByPostUri
    // ---------------------------------------------------------------------------
    const getByPostUri = (postUri: string) =>
      sql<any>`
        SELECT
          post_uri as postUri,
          status,
          signal_score as signalScore,
          predicates_applied as predicatesApplied,
          flagged_at as flaggedAt,
          curated_at as curatedAt,
          curated_by as curatedBy,
          review_note as reviewNote
        FROM post_curation
        WHERE post_uri = ${postUri}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CurationRowsSchema,
            rows,
            `Failed to decode curation row for ${postUri}`
          )
        ),
        Effect.map((rows) => rows.map(toCurationRecord)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(CurationRecordSchema),
            rows,
            `Failed to normalize curation row for ${postUri}`
          )
        ),
        Effect.map((rows) => rows[0] ?? null)
      );

    // ---------------------------------------------------------------------------
    // listCandidates — JOIN with posts, experts, post_topics
    // ---------------------------------------------------------------------------
    const listCandidates = (input: ListCurationCandidatesInput) => {
      const status = input.status ?? "flagged";
      const conditions = [
        sql`c.status = ${status}`,
        sql`p.status = 'active'`,
        input.minScore === undefined ? null : sql`c.signal_score >= ${input.minScore}`,
        input.since === undefined ? null : sql`c.flagged_at >= ${input.since}`,
        input.topic === undefined
          ? null
          : topicFilterExists(sql, [input.topic])
      ].filter(isDefined);

      const limit = Math.min(input.limit ?? 50, 100);

      return sql<any>`
        SELECT
          p.uri as uri,
          p.did as did,
          e.handle as handle,
          e.avatar as avatar,
          COALESCE(e.tier, 'independent') as tier,
          p.text as text,
          p.created_at as createdAt,
          group_concat(DISTINCT pt.topic_slug) as topicsCsv,
          c.signal_score as signalScore,
          c.status as curationStatus,
          c.predicates_applied as predicatesApplied,
          c.flagged_at as flaggedAt
        FROM post_curation c
        JOIN posts p ON p.uri = c.post_uri
        JOIN experts e ON e.did = p.did
        LEFT JOIN post_topics pt ON pt.post_uri = p.uri
        WHERE ${sql.join(" AND ", false)(conditions)}
        GROUP BY p.uri, p.did, e.handle, e.avatar, e.tier, p.text, p.created_at,
                 c.signal_score, c.status, c.predicates_applied, c.flagged_at
        ORDER BY c.signal_score DESC, c.flagged_at DESC
        LIMIT ${limit}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CandidateRowsSchema,
            rows,
            "Failed to decode curation candidate rows"
          )
        ),
        Effect.map((rows) => rows.map(toCandidateOutput)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(CurationCandidateOutputSchema),
            rows,
            "Failed to normalize curation candidate rows"
          )
        )
      );
    };

    // ---------------------------------------------------------------------------
    // postExists
    // ---------------------------------------------------------------------------
    const postExists = (postUri: string) =>
      sql<{ found: number }>`
        SELECT 1 as found
        FROM posts
        WHERE uri = ${postUri}
          AND status = 'active'
        LIMIT 1
      `.pipe(
        Effect.map((rows) => rows.length > 0)
      );

    return CurationRepo.of({
      upsertFlag,
      bulkUpsertFlags,
      updateStatus,
      getByPostUri,
      listCandidates,
      postExists
    });
  }))
};
