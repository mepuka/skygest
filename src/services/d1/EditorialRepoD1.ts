import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import { EditorialRepo } from "../EditorialRepo";
import type {
  EditorialPickRecord,
  CuratedPostResult,
  GetCuratedFeedInput,
  ListEditorialPicksInput
} from "../../domain/editorial";
import {
  EditorialPickRecord as EditorialPickRecordSchema,
  CuratedPostResult as CuratedPostResultSchema,
  ListEditorialPicksInput as ListEditorialPicksInputSchema,
  GetCuratedFeedInput as GetCuratedFeedInputSchema
} from "../../domain/editorial";
import type { TopicSlug } from "../../domain/bi";
import { decodeWithDbError } from "./schemaDecode";
import { topicFilterExists } from "./queryFragments";

const isDefined = <A>(value: A | null): value is A => value !== null;

// ---------------------------------------------------------------------------
// Raw row schemas (DB types — no branded types)
// ---------------------------------------------------------------------------

const EditorialPickRowSchema = Schema.Struct({
  postUri: Schema.String,
  score: Schema.Number,
  reason: Schema.String,
  category: Schema.NullOr(Schema.String),
  curator: Schema.String,
  status: Schema.String,
  pickedAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number)
});
const EditorialPickRowsSchema = Schema.Array(EditorialPickRowSchema);

const CuratedPostRowSchema = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  tier: Schema.optionalWith(Schema.String, { default: () => "independent" }),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String),
  editorialScore: Schema.Number,
  editorialReason: Schema.String,
  editorialCategory: Schema.NullOr(Schema.String)
});
const CuratedPostRowsSchema = Schema.Array(CuratedPostRowSchema);
type CuratedPostRow = Schema.Schema.Type<typeof CuratedPostRowSchema>;

const toCuratedPostResult = (row: CuratedPostRow) => ({
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
  editorialScore: row.editorialScore,
  editorialReason: row.editorialReason,
  editorialCategory: row.editorialCategory
});

export const EditorialRepoD1 = {
  layer: Layer.effect(EditorialRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    // ---------------------------------------------------------------------------
    // upsertPick
    // ---------------------------------------------------------------------------
    const upsertPick = (pick: EditorialPickRecord) =>
      decodeWithDbError(
        EditorialPickRecordSchema,
        pick,
        `Invalid editorial pick input for ${pick.postUri}`
      ).pipe(
        Effect.flatMap((validated) =>
          sql<{ postUri: string }>`
            SELECT post_uri as postUri
            FROM editorial_picks
            WHERE post_uri = ${validated.postUri}
          `.pipe(
            Effect.flatMap((existing) => {
              const isNew = existing.length === 0;
              return sql`
                INSERT INTO editorial_picks (
                  post_uri, score, reason, category, curator, status, picked_at, expires_at
                ) VALUES (
                  ${validated.postUri},
                  ${validated.score},
                  ${validated.reason},
                  ${validated.category},
                  ${validated.curator},
                  'active',
                  ${validated.pickedAt},
                  ${validated.expiresAt}
                )
                ON CONFLICT(post_uri) DO UPDATE SET
                  score = excluded.score,
                  reason = excluded.reason,
                  category = excluded.category,
                  curator = excluded.curator,
                  status = 'active',
                  picked_at = excluded.picked_at,
                  expires_at = excluded.expires_at
              `.pipe(
                Effect.asVoid,
                Effect.map(() => isNew)
              );
            })
          )
        )
      );

    // ---------------------------------------------------------------------------
    // retractPick
    // ---------------------------------------------------------------------------
    const retractPick = (postUri: string) =>
      sql`
        UPDATE editorial_picks
        SET status = 'retracted'
        WHERE post_uri = ${postUri}
          AND status = 'active'
      `.pipe(
        Effect.flatMap(() =>
          sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
            Effect.map((rows) => (rows[0]?.cnt ?? 0) > 0)
          )
        )
      );

    // ---------------------------------------------------------------------------
    // listPicks
    // ---------------------------------------------------------------------------
    const listPicks = (input: ListEditorialPicksInput) =>
      decodeWithDbError(
        ListEditorialPicksInputSchema,
        input,
        "Invalid list editorial picks input"
      ).pipe(
        Effect.flatMap((validated) => {
          const conditions = [
            sql`status = 'active'`,
            validated.minScore === undefined ? null : sql`score >= ${validated.minScore}`,
            validated.since === undefined ? null : sql`picked_at >= ${validated.since}`
          ].filter(isDefined);

          const limit = validated.limit ?? 50;

          return sql<any>`
            SELECT
              post_uri as postUri,
              score,
              reason,
              category,
              curator,
              status,
              picked_at as pickedAt,
              expires_at as expiresAt
            FROM editorial_picks
            WHERE ${sql.join(" AND ", false)(conditions)}
            ORDER BY score DESC, picked_at DESC
            LIMIT ${limit}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                EditorialPickRowsSchema,
                rows,
                "Failed to decode editorial pick rows"
              )
            ),
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(EditorialPickRecordSchema),
                rows,
                "Failed to normalize editorial pick rows"
              )
            )
          );
        })
      );

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

    // ---------------------------------------------------------------------------
    // getCuratedFeed
    // ---------------------------------------------------------------------------
    const getCuratedFeed = (
      input: GetCuratedFeedInput & {
        readonly topicSlugs?: ReadonlyArray<TopicSlug>;
      }
    ) =>
      decodeWithDbError(
        GetCuratedFeedInputSchema,
        input,
        "Invalid get curated feed input"
      ).pipe(
        Effect.flatMap((validated) => {
          const topicSlugs = input.topicSlugs;

          if (topicSlugs !== undefined && topicSlugs.length === 0) {
            return Effect.succeed([]);
          }

          const conditions = [
            sql`ep.status = 'active'`,
            sql`p.status = 'active'`,
            validated.minScore === undefined ? null : sql`ep.score >= ${validated.minScore}`,
            validated.since === undefined ? null : sql`ep.picked_at >= ${validated.since}`,
            topicSlugs === undefined
              ? null
              : topicFilterExists(sql, topicSlugs)
          ].filter(isDefined);

          const limit = validated.limit ?? 50;

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
              ep.score as editorialScore,
              ep.reason as editorialReason,
              ep.category as editorialCategory
            FROM editorial_picks ep
            JOIN posts p ON p.uri = ep.post_uri
            JOIN experts e ON e.did = p.did
            LEFT JOIN post_topics pt ON pt.post_uri = p.uri
            WHERE ${sql.join(" AND ", false)(conditions)}
            GROUP BY p.uri, p.did, e.handle, e.avatar, e.tier, p.text, p.created_at, ep.score, ep.reason, ep.category
            ORDER BY ep.score DESC, ep.picked_at DESC
            LIMIT ${limit}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                CuratedPostRowsSchema,
                rows,
                "Failed to decode curated post rows"
              )
            ),
            Effect.map((rows) => rows.map(toCuratedPostResult)),
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(CuratedPostResultSchema),
                rows,
                "Failed to normalize curated post rows"
              )
            )
          );
        })
      );

    // ---------------------------------------------------------------------------
    // expireStale
    // ---------------------------------------------------------------------------
    const expireStale = (now: number) =>
      sql`
        UPDATE editorial_picks
        SET status = 'expired'
        WHERE expires_at IS NOT NULL
          AND expires_at < ${now}
          AND status = 'active'
      `.pipe(
        Effect.flatMap(() =>
          sql<{ cnt: number }>`SELECT changes() as cnt`.pipe(
            Effect.map((rows) => rows[0]?.cnt ?? 0)
          )
        )
      );

    return EditorialRepo.of({
      upsertPick,
      retractPick,
      listPicks,
      postExists,
      getCuratedFeed,
      expireStale
    });
  }))
};
