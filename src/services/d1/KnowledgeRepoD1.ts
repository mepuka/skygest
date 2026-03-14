import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "@effect/sql";
import { SqlError } from "@effect/sql/SqlError";
import type {
  GetPostLinksPageQueryInput,
  GetRecentPostsPageQueryInput
} from "../../domain/api";
import { KnowledgeRepo } from "../KnowledgeRepo";
import type {
  DeletedKnowledgePost,
  GetPostLinksQueryInput,
  GetRecentPostsQueryInput,
  KnowledgeLinkResult,
  KnowledgePost,
  KnowledgePostResult,
  SearchPostsQueryInput,
  StoredTopicMatch
} from "../../domain/bi";
import {
  GetPostLinksPageQueryInput as GetPostLinksPageQueryInputSchema,
  GetRecentPostsPageQueryInput as GetRecentPostsPageQueryInputSchema
} from "../../domain/api";
import {
  DeletedKnowledgePost as DeletedKnowledgePostSchema,
  GetPostLinksQueryInput as GetPostLinksQueryInputSchema,
  GetRecentPostsQueryInput as GetRecentPostsQueryInputSchema,
  KnowledgeLinkResult as KnowledgeLinkResultSchema,
  KnowledgePost as KnowledgePostSchema,
  KnowledgePostResult as KnowledgePostResultSchema,
  SearchPostsQueryInput as SearchPostsQueryInputSchema,
  StoredTopicMatch as StoredTopicMatchSchema
} from "../../domain/bi";
import { stringifyUnknown } from "../../platform/Json";
import { decodeWithDbError } from "./schemaDecode";

const isDefined = <A>(value: A | null): value is A => value !== null;

const toCauseMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : stringifyUnknown(cause);

const PostRowSchema = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String)
});
const PostRowsSchema = Schema.Array(PostRowSchema);
const LinkRowsSchema = Schema.Array(KnowledgeLinkResultSchema);
const StoredTopicMatchRowsSchema = Schema.Array(StoredTopicMatchSchema);
type PostRow = Schema.Schema.Type<typeof PostRowSchema>;

const makeBatchError = (cause: unknown, message: string) =>
  new SqlError({
    cause,
    message: `${message}: ${toCauseMessage(cause)}`
  });

type D1BatchBindValue = string | number | null;

const toPostResult = (row: PostRow) => ({
  uri: row.uri,
  did: row.did,
  handle: row.handle,
  text: row.text,
  createdAt: row.createdAt,
  topics: row.topicsCsv === null || row.topicsCsv.length === 0
    ? []
    : row.topicsCsv.split(",").filter((topic) => topic.length > 0)
});

const topicFilterExists = (
  sql: SqlClient.SqlClient,
  topicSlugs: ReadonlyArray<string>
) => sql`EXISTS (
  SELECT 1
  FROM post_topics filter_pt
  WHERE filter_pt.post_uri = p.uri
    AND (${sql.join(" OR ", false)(
      topicSlugs.map((topicSlug) => sql`filter_pt.topic_slug = ${topicSlug}`)
    )})
)`;

const recentPostCursorCondition = (
  sql: SqlClient.SqlClient,
  cursor: GetRecentPostsPageQueryInput["cursor"]
) =>
  cursor === undefined
    ? null
    : sql`(
        p.created_at < ${cursor.createdAt}
        OR (p.created_at = ${cursor.createdAt} AND p.uri > ${cursor.uri})
      )`;

const linkCursorCondition = (
  sql: SqlClient.SqlClient,
  cursor: GetPostLinksPageQueryInput["cursor"]
) =>
  cursor === undefined
    ? null
    : sql`(
        l.extracted_at < ${cursor.createdAt}
        OR (
          l.extracted_at = ${cursor.createdAt}
          AND (
            l.post_uri > ${cursor.postUri}
            OR (l.post_uri = ${cursor.postUri} AND l.url > ${cursor.url})
          )
        )
      )`;

const insertTopics = (sql: SqlClient.SqlClient, post: KnowledgePost) =>
  Effect.forEach(
    post.topics,
    (topic) =>
      sql`
        INSERT OR IGNORE INTO post_topics (
          post_uri,
          topic_slug,
          matched_term,
          match_signal,
          match_value,
          match_score,
          ontology_version,
          matcher_version
        )
        VALUES (
          ${post.uri},
          ${topic.topicSlug},
          ${topic.matchedTerm},
          ${topic.matchSignal},
          ${topic.matchValue},
          ${topic.matchScore},
          ${topic.ontologyVersion},
          ${topic.matcherVersion}
        )
      `.pipe(Effect.asVoid),
    { discard: true }
  );

const insertLinks = (sql: SqlClient.SqlClient, post: KnowledgePost) =>
  Effect.forEach(
    post.links,
    (link) =>
      sql`
        INSERT OR IGNORE INTO links (
          post_uri, url, title, description, domain, extracted_at
        ) VALUES (
          ${post.uri},
          ${link.url},
          ${link.title},
          ${link.description},
          ${link.domain},
          ${link.extractedAt}
        )
      `.pipe(Effect.asVoid),
    { discard: true }
  );

const makeBulkInsertStatement = (
  db: D1Database,
  table: string,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<D1BatchBindValue>>
): D1PreparedStatement | null => {
  if (rows.length === 0) {
    return null;
  }

  const placeholders = rows
    .map((row) => `(${row.map(() => "?").join(", ")})`)
    .join(", ");
  const values = rows.flatMap((row) => [...row]);

  return db.prepare(
    `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`
  ).bind(...values);
};

const runAtomicBatch = (
  db: D1Database,
  statements: ReadonlyArray<D1PreparedStatement>,
  operation: string
) =>
  statements.length === 0
    ? Effect.void
    : Effect.tryPromise({
        try: async () => {
          await db.batch(Array.from(statements));
        },
        catch: (cause) =>
          makeBatchError(
            cause,
            `Failed to execute D1 batch for ${operation}`
          )
      }).pipe(Effect.asVoid);

const makeUpsertStatements = (
  db: D1Database,
  post: KnowledgePost
): ReadonlyArray<D1PreparedStatement> => {
  const topicInsert = makeBulkInsertStatement(
    db,
    "post_topics",
    [
      "post_uri",
      "topic_slug",
      "matched_term",
      "match_signal",
      "match_value",
      "match_score",
      "ontology_version",
      "matcher_version"
    ],
    post.topics.map((topic) => [
      post.uri,
      topic.topicSlug,
      topic.matchedTerm,
      topic.matchSignal,
      topic.matchValue,
      topic.matchScore,
      topic.ontologyVersion,
      topic.matcherVersion
    ])
  );
  const linksInsert = makeBulkInsertStatement(
    db,
    "links",
    [
      "post_uri",
      "url",
      "title",
      "description",
      "domain",
      "extracted_at"
    ],
    post.links.map((link) => [
      post.uri,
      link.url,
      link.title,
      link.description,
      link.domain,
      link.extractedAt
    ])
  );

  return [
    db.prepare(`
      INSERT INTO posts (
        uri, did, cid, text, created_at, indexed_at,
        has_links, status, ingest_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uri) DO UPDATE SET
        did = excluded.did,
        cid = excluded.cid,
        text = excluded.text,
        created_at = excluded.created_at,
        indexed_at = excluded.indexed_at,
        has_links = excluded.has_links,
        status = excluded.status,
        ingest_id = excluded.ingest_id
    `).bind(
      post.uri,
      post.did,
      post.cid,
      post.text,
      post.createdAt,
      post.indexedAt,
      post.hasLinks ? 1 : 0,
      post.status,
      post.ingestId
    ),
    db.prepare("DELETE FROM post_topics WHERE post_uri = ?").bind(post.uri),
    db.prepare("DELETE FROM links WHERE post_uri = ?").bind(post.uri),
    db.prepare("DELETE FROM posts_fts WHERE uri = ?").bind(post.uri),
    ...(topicInsert === null ? [] : [topicInsert]),
    ...(linksInsert === null ? [] : [linksInsert]),
    db.prepare(`
      INSERT INTO posts_fts (uri, text)
      VALUES (?, ?)
    `).bind(post.uri, post.text)
  ];
};

const makeDeleteStatements = (
  db: D1Database,
  post: DeletedKnowledgePost
): ReadonlyArray<D1PreparedStatement> => [
  db.prepare(`
    INSERT INTO posts (
      uri, did, cid, text, created_at, indexed_at,
      has_links, status, ingest_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uri) DO UPDATE SET
      did = excluded.did,
      cid = excluded.cid,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      ingest_id = excluded.ingest_id
  `).bind(
    post.uri,
    post.did,
    post.cid,
    "",
    post.createdAt,
    post.indexedAt,
    0,
    "deleted",
    post.ingestId
  ),
  db.prepare("DELETE FROM post_topics WHERE post_uri = ?").bind(post.uri),
  db.prepare("DELETE FROM links WHERE post_uri = ?").bind(post.uri),
  db.prepare("DELETE FROM posts_fts WHERE uri = ?").bind(post.uri)
];

export const KnowledgeRepoD1 = {
  layer: Layer.effect(KnowledgeRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const d1 = yield* Effect.serviceOption(D1Client.D1Client);
    const rawDb = Option.match(d1, {
      onNone: () => null,
      onSome: (client) => client.config.db
    });

    const upsertOne = Effect.fn("KnowledgeRepo.upsertOne")(function* (post: KnowledgePost) {
      const validated = yield* decodeWithDbError(
        KnowledgePostSchema,
        post,
        `Invalid knowledge post input for ${post.uri}`
      );

      const existing = yield* sql<{ ingestId: string | null }>`
        SELECT ingest_id as ingestId
        FROM posts
        WHERE uri = ${validated.uri}
      `;

      if (existing[0]?.ingestId === validated.ingestId) {
        return;
      }

      if (rawDb !== null) {
        yield* runAtomicBatch(
          rawDb,
          makeUpsertStatements(rawDb, validated),
          `KnowledgeRepo.upsertOne(${validated.uri})`
        );
        return;
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
              INSERT INTO posts (
                uri, did, cid, text, created_at, indexed_at,
                has_links, status, ingest_id
              ) VALUES (
                ${validated.uri},
                ${validated.did},
                ${validated.cid},
                ${validated.text},
                ${validated.createdAt},
                ${validated.indexedAt},
                ${validated.hasLinks ? 1 : 0},
                ${validated.status},
                ${validated.ingestId}
              )
              ON CONFLICT(uri) DO UPDATE SET
                did = excluded.did,
                cid = excluded.cid,
                text = excluded.text,
                created_at = excluded.created_at,
                indexed_at = excluded.indexed_at,
                has_links = excluded.has_links,
                status = excluded.status,
                ingest_id = excluded.ingest_id
            `.pipe(Effect.asVoid);

          yield* sql`DELETE FROM post_topics WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM links WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM posts_fts WHERE uri = ${validated.uri}`.pipe(Effect.asVoid);

          yield* insertTopics(sql, validated);
          yield* insertLinks(sql, validated);
          yield* sql`
              INSERT INTO posts_fts (uri, text)
              VALUES (${validated.uri}, ${validated.text})
            `.pipe(Effect.asVoid);
        })
      );
    });

    const markDeletedOne = Effect.fn("KnowledgeRepo.markDeletedOne")(function* (post: DeletedKnowledgePost) {
      const validated = yield* decodeWithDbError(
        DeletedKnowledgePostSchema,
        post,
        `Invalid deleted knowledge post input for ${post.uri}`
      );

      const existing = yield* sql<{ ingestId: string | null }>`
        SELECT ingest_id as ingestId
        FROM posts
        WHERE uri = ${validated.uri}
      `;

      if (existing[0]?.ingestId === validated.ingestId) {
        return;
      }

      if (rawDb !== null) {
        yield* runAtomicBatch(
          rawDb,
          makeDeleteStatements(rawDb, validated),
          `KnowledgeRepo.markDeletedOne(${validated.uri})`
        );
        return;
      }

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
              INSERT INTO posts (
                uri, did, cid, text, created_at, indexed_at,
                has_links, status, ingest_id
              ) VALUES (
                ${validated.uri},
                ${validated.did},
                ${validated.cid},
                '',
                ${validated.createdAt},
                ${validated.indexedAt},
                0,
                'deleted',
                ${validated.ingestId}
              )
              ON CONFLICT(uri) DO UPDATE SET
                did = excluded.did,
                cid = excluded.cid,
                indexed_at = excluded.indexed_at,
                status = excluded.status,
                ingest_id = excluded.ingest_id
            `.pipe(Effect.asVoid);

          yield* sql`DELETE FROM post_topics WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM links WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM posts_fts WHERE uri = ${validated.uri}`.pipe(Effect.asVoid);
        })
      );
    });

    const upsertPosts = (posts: ReadonlyArray<KnowledgePost>) =>
      Effect.forEach(posts, upsertOne, { discard: true });

    const markDeleted = (posts: ReadonlyArray<DeletedKnowledgePost>) =>
      Effect.forEach(posts, markDeletedOne, { discard: true });

    const searchPosts = (input: SearchPostsQueryInput) => {
      return decodeWithDbError(
        SearchPostsQueryInputSchema,
        input,
        "Invalid search posts input"
      ).pipe(
        Effect.flatMap((validated) => {
          const trimmed = validated.query.trim();
          if (trimmed.length === 0 || validated.topicSlugs?.length === 0) {
            return Effect.succeed([]);
          }

          const postConditions = [
            sql`p.status = 'active'`,
            validated.since === undefined ? null : sql`p.created_at >= ${validated.since}`,
            validated.until === undefined ? null : sql`p.created_at <= ${validated.until}`,
            validated.topicSlugs === undefined
              ? null
              : topicFilterExists(sql, validated.topicSlugs)
          ].filter(isDefined);

          return sql<any>`
            SELECT
              p.uri as uri,
              p.did as did,
              e.handle as handle,
              p.text as text,
              p.created_at as createdAt,
              group_concat(DISTINCT pt.topic_slug) as topicsCsv
            FROM (
              SELECT
                uri,
                rank as rank
              FROM posts_fts
              WHERE posts_fts MATCH ${trimmed}
            ) search
            JOIN posts p ON p.uri = search.uri
            JOIN experts e ON e.did = p.did
            LEFT JOIN post_topics pt ON pt.post_uri = p.uri
            WHERE ${sql.join(" AND ", false)(postConditions)}
            GROUP BY p.uri, p.did, e.handle, p.text, p.created_at, search.rank
            ORDER BY search.rank, p.created_at DESC, p.uri ASC
            LIMIT ${validated.limit ?? 20}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                PostRowsSchema,
                rows,
                "Failed to decode search post rows"
              )
            ),
            Effect.map((rows) => rows.map(toPostResult)),
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(KnowledgePostResultSchema),
                rows,
                "Failed to normalize search post rows"
              )
            )
          );
        })
      );
    };

    const executeRecentPostsQuery = (
      validated: GetRecentPostsQueryInput | GetRecentPostsPageQueryInput
    ) => {
      if (validated.topicSlugs?.length === 0) {
        return Effect.succeed([]);
      }

      const conditions = [
        sql`p.status = 'active'`,
        validated.since === undefined ? null : sql`p.created_at >= ${validated.since}`,
        validated.until === undefined ? null : sql`p.created_at <= ${validated.until}`,
        validated.expertDid === undefined ? null : sql`p.did = ${validated.expertDid}`,
        recentPostCursorCondition(sql, validated.cursor),
        validated.topicSlugs === undefined
          ? null
          : topicFilterExists(sql, validated.topicSlugs)
      ].filter(isDefined);

      return sql<any>`
        SELECT
          p.uri as uri,
          p.did as did,
          e.handle as handle,
          p.text as text,
          p.created_at as createdAt,
          group_concat(DISTINCT pt.topic_slug) as topicsCsv
        FROM posts p
        JOIN experts e ON e.did = p.did
        LEFT JOIN post_topics pt ON pt.post_uri = p.uri
        WHERE ${sql.join(" AND ", false)(conditions)}
        GROUP BY p.uri, p.did, e.handle, p.text, p.created_at
        ORDER BY p.created_at DESC, p.uri ASC
        LIMIT ${validated.limit ?? 20}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            PostRowsSchema,
            rows,
            "Failed to decode recent post rows"
          )
        ),
        Effect.map((rows) => rows.map(toPostResult)),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(KnowledgePostResultSchema),
            rows,
            "Failed to normalize recent post rows"
          )
        )
      );
    };

    const getRecentPosts = (input: GetRecentPostsQueryInput) =>
      decodeWithDbError(
        GetRecentPostsQueryInputSchema,
        input,
        "Invalid get recent posts input"
      ).pipe(
        Effect.flatMap(executeRecentPostsQuery)
      );

    const getRecentPostsPage = (input: GetRecentPostsPageQueryInput) =>
      decodeWithDbError(
        GetRecentPostsPageQueryInputSchema,
        input,
        "Invalid get recent posts page input"
      ).pipe(
        Effect.flatMap(executeRecentPostsQuery)
      );

    const executePostLinksQuery = (
      validated: GetPostLinksQueryInput | GetPostLinksPageQueryInput
    ) => {
      if (validated.topicSlugs?.length === 0) {
        return Effect.succeed([]);
      }

      const conditions = [
        sql`p.status = 'active'`,
        validated.since === undefined ? null : sql`l.extracted_at >= ${validated.since}`,
        validated.until === undefined ? null : sql`l.extracted_at <= ${validated.until}`,
        validated.domain === undefined ? null : sql`l.domain = ${validated.domain}`,
        linkCursorCondition(sql, validated.cursor),
        validated.topicSlugs === undefined
          ? null
          : topicFilterExists(sql, validated.topicSlugs)
      ].filter(isDefined);

      return sql<any>`
        SELECT
          l.post_uri as postUri,
          l.url as url,
          l.domain as domain,
          l.title as title,
          l.description as description,
          l.extracted_at as createdAt
        FROM links l
        JOIN posts p ON p.uri = l.post_uri
        WHERE ${sql.join(" AND ", false)(conditions)}
        ORDER BY l.extracted_at DESC, l.post_uri ASC, l.url ASC
        LIMIT ${validated.limit ?? 20}
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            LinkRowsSchema,
            rows,
            "Failed to decode post link rows"
          )
        )
      );
    };

    const getPostLinks = (input: GetPostLinksQueryInput) =>
      decodeWithDbError(
        GetPostLinksQueryInputSchema,
        input,
        "Invalid get post links input"
      ).pipe(
        Effect.flatMap(executePostLinksQuery)
      );

    const getPostLinksPage = (input: GetPostLinksPageQueryInput) =>
      decodeWithDbError(
        GetPostLinksPageQueryInputSchema,
        input,
        "Invalid get post links page input"
      ).pipe(
        Effect.flatMap(executePostLinksQuery)
      );

    const getPostTopicMatches = (postUri: string) =>
      sql<any>`
        SELECT
          post_uri as postUri,
          topic_slug as topicSlug,
          matched_term as matchedTerm,
          match_signal as matchSignal,
          match_value as matchValue,
          match_score as matchScore,
          ontology_version as ontologyVersion,
          matcher_version as matcherVersion
        FROM post_topics
        WHERE post_uri = ${postUri}
        ORDER BY topic_slug ASC
      `.pipe(
        Effect.flatMap((rows) =>
          decodeWithDbError(
            StoredTopicMatchRowsSchema,
            rows,
            "Failed to decode stored topic matches"
          )
        )
      );

    return KnowledgeRepo.of({
      upsertPosts,
      markDeleted,
      searchPosts,
      getRecentPosts,
      getRecentPostsPage,
      getPostLinks,
      getPostLinksPage,
      getPostTopicMatches
    });
  }))
};
