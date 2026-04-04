import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlClient as SqlClientType } from "effect/unstable/sql";
import { CurationRepo } from "../CurationRepo";
import type {
  CurationPlatformFilter,
  CurationRecord,
  ListCurationCandidatesInput
} from "../../domain/curation";
import {
  CurationCandidateCountOutput as CurationCandidateCountOutputSchema,
  CurationCandidateExportPageOutput as CurationCandidateExportPageOutputSchema,
  CurationCandidatePageOutput as CurationCandidatePageOutputSchema,
  CurationRecord as CurationRecordSchema
} from "../../domain/curation";
import { emptyKnowledgePostHydration, ThreadEmbedType } from "../../domain/bi";
import { platformFromUri } from "../../domain/types";
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
  tier: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "independent")),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String),
  embedType: Schema.NullOr(ThreadEmbedType),
  signalScore: Schema.Number,
  curationStatus: Schema.String,
  predicatesApplied: Schema.String,
  flaggedAt: Schema.Number
});
const CandidateRowsSchema = Schema.Array(CandidateRowSchema);
type CandidateRow = Schema.Schema.Type<typeof CandidateRowSchema>;

const CandidateCountRowSchema = Schema.Struct({
  total: Schema.Number,
  bluesky: Schema.Number,
  twitter: Schema.Number
});
const CandidateCountRowsSchema = Schema.Array(CandidateCountRowSchema);

const PostEmbedTypeRowsSchema = Schema.Array(
  Schema.Struct({
    embedType: Schema.NullOr(ThreadEmbedType)
  })
);

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
    : row.topicsCsv.split(",").filter((topic) => topic.length > 0),
  ...emptyKnowledgePostHydration(),
  embedType: row.embedType,
  signalScore: row.signalScore,
  curationStatus: row.curationStatus,
  predicatesApplied: JSON.parse(row.predicatesApplied) as string[],
  flaggedAt: row.flaggedAt
});

const toCandidateExportItem = (row: CandidateRow) => ({
  uri: row.uri,
  handle: row.handle,
  text: row.text,
  createdAt: row.createdAt,
  topics: row.topicsCsv === null || row.topicsCsv.length === 0
    ? []
    : row.topicsCsv.split(",").filter((topic) => topic.length > 0),
  embedType: row.embedType,
  tier: row.tier,
  platform: platformFromUri(row.uri as any),
  signalScore: row.signalScore
});

const platformFilterCondition = (
  sql: SqlClientType.SqlClient,
  platform: CurationPlatformFilter | undefined
) => {
  switch (platform ?? "all") {
    case "bluesky":
      return sql`p.uri LIKE 'at://%'`;
    case "twitter":
      return sql`p.uri LIKE 'x://%'`;
    case "all":
      return null;
  }
};

const candidateCursorCondition = (
  sql: SqlClientType.SqlClient,
  cursor: ListCurationCandidatesInput["cursor"]
) =>
  cursor === undefined
    ? null
    : sql`(
        c.signal_score < ${cursor.signalScore}
        OR (c.signal_score = ${cursor.signalScore} AND c.flagged_at < ${cursor.flaggedAt})
        OR (
          c.signal_score = ${cursor.signalScore}
          AND c.flagged_at = ${cursor.flaggedAt}
          AND p.uri > ${cursor.postUri}
        )
      )`;

const candidateFilters = (
  sql: SqlClientType.SqlClient,
  input: ListCurationCandidatesInput
) => [
  sql`c.status = ${input.status ?? "flagged"}`,
  sql`p.status = 'active'`,
  platformFilterCondition(sql, input.platform),
  input.minScore === undefined ? null : sql`c.signal_score >= ${input.minScore}`,
  input.since === undefined ? null : sql`c.flagged_at >= ${input.since}`,
  input.topic === undefined
    ? null
    : topicFilterExists(sql, [input.topic])
].filter(isDefined);

const decodeCandidateRows = (
  rows: unknown,
  message: string
) =>
  decodeWithDbError(
    CandidateRowsSchema,
    rows,
    message
  );

const decodeCandidatePage = (page: unknown) =>
  decodeWithDbError(
    CurationCandidatePageOutputSchema,
    page,
    "Failed to normalize curation candidate page"
  );

const decodeCandidateExportPage = (page: unknown) =>
  decodeWithDbError(
    CurationCandidateExportPageOutputSchema,
    page,
    "Failed to normalize curation candidate export page"
  );

const decodeCandidateCounts = (output: unknown) =>
  decodeWithDbError(
    CurationCandidateCountOutputSchema,
    output,
    "Failed to normalize curation candidate counts"
  );

export const CurationRepoD1 = {
  layer: Layer.effect(CurationRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

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

    const bulkUpsertFlags = (records: ReadonlyArray<CurationRecord>) => {
      if (records.length === 0) {
        return Effect.succeed(0);
      }

      return Effect.forEach(records, upsertFlag, { discard: false }).pipe(
        Effect.map((results) => results.filter(Boolean).length)
      );
    };

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

    const countCandidates = (input: ListCurationCandidatesInput) => {
      const conditions = candidateFilters(sql, input);

      return sql<any>`
        SELECT
          COUNT(DISTINCT p.uri) as total,
          COUNT(DISTINCT CASE WHEN p.uri LIKE 'at://%' THEN p.uri END) as bluesky,
          COUNT(DISTINCT CASE WHEN p.uri LIKE 'x://%' THEN p.uri END) as twitter
        FROM post_curation c
        JOIN posts p ON p.uri = c.post_uri
        JOIN experts e ON e.did = p.did
        WHERE ${sql.join(" AND ", false)(conditions)}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            CandidateCountRowsSchema,
            rows,
            "Failed to decode curation candidate counts"
          )
        ),
        Effect.map((rows) => rows[0] ?? { total: 0, bluesky: 0, twitter: 0 }),
        Effect.flatMap((row) =>
          decodeCandidateCounts({
            total: row.total,
            byPlatform: {
              bluesky: row.bluesky,
              twitter: row.twitter
            }
          })
        )
      );
    };

    const fetchCandidateRows = (
      input: ListCurationCandidatesInput
    ) => {
      const conditions = [
        ...candidateFilters(sql, input),
        candidateCursorCondition(sql, input.cursor)
      ].filter(isDefined);
      const pageLimit = Math.max(1, input.limit ?? 50);

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
          p.embed_type as embedType,
          c.signal_score as signalScore,
          c.status as curationStatus,
          c.predicates_applied as predicatesApplied,
          c.flagged_at as flaggedAt
        FROM post_curation c
        JOIN posts p ON p.uri = c.post_uri
        JOIN experts e ON e.did = p.did
        LEFT JOIN post_topics pt ON pt.post_uri = p.uri
        WHERE ${sql.join(" AND ", false)(conditions)}
        GROUP BY
          p.uri,
          p.did,
          e.handle,
          e.avatar,
          e.tier,
          p.text,
          p.created_at,
          p.embed_type,
          c.signal_score,
          c.status,
          c.predicates_applied,
          c.flagged_at
        ORDER BY c.signal_score DESC, c.flagged_at DESC, p.uri ASC
        LIMIT ${pageLimit + 1}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeCandidateRows(
            rows,
            "Failed to decode curation candidate rows"
          )
        ),
        Effect.map((rows) => ({
          pageLimit,
          rows
        }))
      );
    };

    const listCandidates = (input: ListCurationCandidatesInput) =>
      Effect.all({
        counts: countCandidates(input),
        page: fetchCandidateRows(input)
      }).pipe(
        Effect.map(({ counts, page }) => {
          const hasMore = page.rows.length > page.pageLimit;
          const pageRows = hasMore ? page.rows.slice(0, page.pageLimit) : page.rows;
          const items = pageRows.map(toCandidateOutput);
          const nextCursor = hasMore
            ? {
                signalScore: pageRows[pageRows.length - 1]!.signalScore as any,
                flaggedAt: pageRows[pageRows.length - 1]!.flaggedAt,
                postUri: pageRows[pageRows.length - 1]!.uri as any
              }
            : null;

          return {
            items,
            total: counts.total,
            nextCursor
          };
        }),
        Effect.flatMap(decodeCandidatePage)
      );

    const exportCandidates = (input: ListCurationCandidatesInput) =>
      Effect.all({
        counts: countCandidates(input),
        page: fetchCandidateRows(input)
      }).pipe(
        Effect.map(({ counts, page }) => {
          const hasMore = page.rows.length > page.pageLimit;
          const pageRows = hasMore ? page.rows.slice(0, page.pageLimit) : page.rows;
          const items = pageRows.map(toCandidateExportItem);
          const nextCursor = hasMore
            ? {
                signalScore: pageRows[pageRows.length - 1]!.signalScore as any,
                flaggedAt: pageRows[pageRows.length - 1]!.flaggedAt,
                postUri: pageRows[pageRows.length - 1]!.uri as any
              }
            : null;

          return {
            items,
            total: counts.total,
            nextCursor
          };
        }),
        Effect.flatMap(decodeCandidateExportPage)
      );

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

    const getPostEmbedType = (postUri: string) =>
      sql<any>`
        SELECT
          embed_type as embedType
        FROM posts
        WHERE uri = ${postUri}
        LIMIT 1
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            PostEmbedTypeRowsSchema,
            rows,
            `Failed to decode post embed type for ${postUri}`
          )
        ),
        Effect.map((rows) => rows[0]?.embedType ?? null)
      );

    return {
      upsertFlag,
      bulkUpsertFlags,
      updateStatus,
      getByPostUri,
      listCandidates,
      exportCandidates,
      countCandidates,
      postExists,
      getPostEmbedType
    };
  }))
};
