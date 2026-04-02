import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { Array as A, Effect, Layer, Option, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { SqlError, UnknownError as SqlUnknownError } from "effect/unstable/sql/SqlError";
import type {
  GetPostLinksPageQueryInput,
  GetRecentPostsPageQueryInput,
  SearchPostsCursor,
  SearchPostsPageQueryInput
} from "../../domain/api";
import {
  SearchPostsPageQueryInput as SearchPostsPageQueryInputSchema
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
  emptyKnowledgePostHydration,
  GetPostLinksQueryInput as GetPostLinksQueryInputSchema,
  GetRecentPostsQueryInput as GetRecentPostsQueryInputSchema,
  KnowledgePost as KnowledgePostSchema,
  KnowledgePostResult as KnowledgePostResultSchema,
  RankedKnowledgePostResult as RankedKnowledgePostResultSchema,
  KnowledgeLinkResult as KnowledgeLinkResultSchema,
  SearchPostsQueryInput as SearchPostsQueryInputSchema,
  StoredTopicMatch as StoredTopicMatchSchema
} from "../../domain/bi";
import { stringifyUnknown } from "../../platform/Json";
import { normalizeDomain } from "../../domain/normalize";
import { sanitizeFtsQuery } from "../../query/sanitizeFts";
import { decodeWithDbError } from "./schemaDecode";
import { topicFilterExists } from "./queryFragments";

const isDefined = <A>(value: A | null): value is A => value !== null;

const toCauseMessage = (cause: unknown) =>
  cause instanceof Error
    ? cause.message
    : stringifyUnknown(cause);

const PostRowSchema = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  tier: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "independent")),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String)
});
const PostRowsSchema = Schema.Array(PostRowSchema);

const LinkRowSchema = Schema.Struct({
  postUri: Schema.String,
  url: Schema.String,
  domain: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
  createdAt: Schema.Number
});
const LinkRowsSchema = Schema.Array(LinkRowSchema);
const StoredTopicMatchRowsSchema = Schema.Array(StoredTopicMatchSchema);
type PostRow = Schema.Schema.Type<typeof PostRowSchema>;

const SearchPostRowSchema = Schema.Struct({
  uri: Schema.String,
  did: Schema.String,
  handle: Schema.NullOr(Schema.String),
  avatar: Schema.NullOr(Schema.String),
  tier: Schema.String.pipe(Schema.withDecodingDefaultKey(() => "independent")),
  text: Schema.String,
  createdAt: Schema.Number,
  topicsCsv: Schema.NullOr(Schema.String),
  snippet: Schema.NullOr(Schema.String),
  rank: Schema.Number
});
const SearchPostRowsSchema = Schema.Array(SearchPostRowSchema);
type SearchPostRow = Schema.Schema.Type<typeof SearchPostRowSchema>;

const toSearchPostResult = (row: SearchPostRow) => ({
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
  snippet: row.snippet,
  ...emptyKnowledgePostHydration(),
  rank: row.rank
});

const makeBatchError = (cause: unknown, message: string) =>
  new SqlError({
    reason: new SqlUnknownError({
      cause,
      message: `${message}: ${toCauseMessage(cause)}`
    })
  });

type D1BatchBindValue = string | number | null;

const toPostResult = (row: PostRow) => ({
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
  ...emptyKnowledgePostHydration()
});

const searchCursorCondition = (
  sql: SqlClient.SqlClient,
  cursor: SearchPostsCursor | undefined
) =>
  cursor === undefined
    ? null
    : sql`(
        posts_fts.rank > ${cursor.rank}
        OR (posts_fts.rank = ${cursor.rank} AND p.created_at < ${cursor.createdAt})
        OR (posts_fts.rank = ${cursor.rank} AND p.created_at = ${cursor.createdAt} AND p.uri > ${cursor.uri})
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
          post_uri, url, title, description, image_url, domain, extracted_at
        ) VALUES (
          ${post.uri},
          ${link.url},
          ${link.title},
          ${link.description},
          ${link.imageUrl},
          ${link.domain},
          ${link.extractedAt}
        )
      `.pipe(Effect.asVoid),
    { discard: true }
  );

const insertDiscoveredPublications = (sql: SqlClient.SqlClient, post: KnowledgePost) => {
  const uniqueDomains = [
    ...new Set(
      post.links
        .map((link) => link.domain)
        .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
        .map(normalizeDomain)
        .filter((d) => d.length > 0)
    )
  ];

  if (uniqueDomains.length === 0) {
    return Effect.void;
  }

  return Effect.forEach(
    uniqueDomains,
    (hostname) =>
      sql`
        INSERT OR IGNORE INTO publications (
          hostname, tier, source, first_seen_at, last_seen_at
        ) VALUES (
          ${hostname},
          'unknown',
          'discovered',
          ${post.indexedAt},
          ${post.indexedAt}
        )
      `.pipe(Effect.asVoid),
    { discard: true }
  );
};

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
      "image_url",
      "domain",
      "extracted_at"
    ],
    post.links.map((link) => [
      post.uri,
      link.url,
      link.title,
      link.description,
      link.imageUrl,
      link.domain,
      link.extractedAt
    ])
  );

  return [
    // 1. Delete old FTS entry before upsert so search stays in sync.
    db.prepare(`
      DELETE FROM posts_fts
      WHERE rowid IN (
        SELECT rowid FROM posts WHERE uri = ?
      )
    `).bind(post.uri),
    // 2. Upsert the post row (changes text in posts table)
    db.prepare(`
      INSERT INTO posts (
        uri, did, cid, text, created_at, indexed_at,
        has_links, status, ingest_id, embed_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(uri) DO UPDATE SET
        did = excluded.did,
        cid = excluded.cid,
        text = excluded.text,
        created_at = excluded.created_at,
        indexed_at = excluded.indexed_at,
        has_links = excluded.has_links,
        status = excluded.status,
        ingest_id = excluded.ingest_id,
        embed_type = excluded.embed_type
    `).bind(
      post.uri,
      post.did,
      post.cid,
      post.text,
      post.createdAt,
      post.indexedAt,
      post.hasLinks ? 1 : 0,
      post.status,
      post.ingestId,
      post.embedType
    ),
    // 3. Delete/insert topics and links
    db.prepare("DELETE FROM post_topics WHERE post_uri = ?").bind(post.uri),
    db.prepare("DELETE FROM links WHERE post_uri = ?").bind(post.uri),
    ...(topicInsert === null ? [] : [topicInsert]),
    ...(linksInsert === null ? [] : [linksInsert]),
    ...(() => {
      const uniqueDomains = [
        ...new Set(
          post.links
            .map((link) => link.domain)
            .filter((d): d is string => d !== null && d !== undefined && d.length > 0)
            .map(normalizeDomain)
            .filter((d) => d.length > 0)
        )
      ];
      const publicationsInsert = makeBulkInsertStatement(
        db,
        "publications",
        ["hostname", "tier", "source", "first_seen_at", "last_seen_at"],
        uniqueDomains.map((domain) => [domain, "unknown", "discovered", post.indexedAt, post.indexedAt])
      );
      return publicationsInsert === null ? [] : [publicationsInsert];
    })(),
    // 4. Insert the rebuilt FTS row after text and topic writes succeed.
    db.prepare(`
      INSERT INTO posts_fts(rowid, uri, text, handle, topic_terms)
      SELECT
        p.rowid,
        p.uri,
        p.text,
        COALESCE(e.handle, ''),
        COALESCE((
          SELECT group_concat(
            COALESCE(NULLIF(pt.match_value, ''), NULLIF(pt.matched_term, ''), pt.topic_slug),
            ' '
          )
          FROM post_topics pt
          WHERE pt.post_uri = p.uri
        ), '')
      FROM posts p
      LEFT JOIN experts e ON e.did = p.did
      WHERE p.uri = ?
    `).bind(post.uri)
  ];
};

const makeDeleteStatements = (
  db: D1Database,
  post: DeletedKnowledgePost
): ReadonlyArray<D1PreparedStatement> => [
  // Delete old FTS entry before upsert — deleted posts should not remain searchable.
  db.prepare(`
    DELETE FROM posts_fts
    WHERE rowid IN (
      SELECT rowid FROM posts WHERE uri = ?
    )
  `).bind(post.uri),
  db.prepare(`
    INSERT INTO posts (
      uri, did, cid, text, created_at, indexed_at,
      has_links, status, ingest_id, embed_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uri) DO UPDATE SET
      did = excluded.did,
      cid = excluded.cid,
      indexed_at = excluded.indexed_at,
      status = excluded.status,
      ingest_id = excluded.ingest_id,
      embed_type = excluded.embed_type
  `).bind(
    post.uri,
    post.did,
    post.cid,
    "",
    post.createdAt,
    post.indexedAt,
    0,
    "deleted",
    post.ingestId,
    null
  ),
  db.prepare("DELETE FROM post_topics WHERE post_uri = ?").bind(post.uri),
  db.prepare("DELETE FROM links WHERE post_uri = ?").bind(post.uri)
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
          // Delete the old FTS row before rewriting post metadata.
          yield* sql`
            DELETE FROM posts_fts
            WHERE rowid IN (
              SELECT rowid FROM posts WHERE uri = ${validated.uri}
            )
          `.pipe(Effect.asVoid);

          yield* sql`
              INSERT INTO posts (
                uri, did, cid, text, created_at, indexed_at,
                has_links, status, ingest_id, embed_type
              ) VALUES (
                ${validated.uri},
                ${validated.did},
                ${validated.cid},
                ${validated.text},
                ${validated.createdAt},
                ${validated.indexedAt},
                ${validated.hasLinks ? 1 : 0},
                ${validated.status},
                ${validated.ingestId},
                ${validated.embedType}
              )
              ON CONFLICT(uri) DO UPDATE SET
                did = excluded.did,
                cid = excluded.cid,
                text = excluded.text,
                created_at = excluded.created_at,
                indexed_at = excluded.indexed_at,
                has_links = excluded.has_links,
                status = excluded.status,
                ingest_id = excluded.ingest_id,
                embed_type = excluded.embed_type
            `.pipe(Effect.asVoid);

          yield* sql`DELETE FROM post_topics WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM links WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);

          yield* insertTopics(sql, validated);
          yield* insertLinks(sql, validated);
          yield* insertDiscoveredPublications(sql, validated);

          // Rebuild the FTS row from post text plus joined metadata.
          yield* sql`
            INSERT INTO posts_fts(rowid, uri, text, handle, topic_terms)
            SELECT
              p.rowid,
              p.uri,
              p.text,
              COALESCE(e.handle, ''),
              COALESCE((
                SELECT group_concat(
                  COALESCE(NULLIF(pt.match_value, ''), NULLIF(pt.matched_term, ''), pt.topic_slug),
                  ' '
                )
                FROM post_topics pt
                WHERE pt.post_uri = p.uri
              ), '')
            FROM posts p
            LEFT JOIN experts e ON e.did = p.did
            WHERE p.uri = ${validated.uri}
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

      // No FTS re-insert needed — deleted posts should not be searchable.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            DELETE FROM posts_fts
            WHERE rowid IN (
              SELECT rowid FROM posts WHERE uri = ${validated.uri}
            )
          `.pipe(Effect.asVoid);

          yield* sql`
              INSERT INTO posts (
                uri, did, cid, text, created_at, indexed_at,
                has_links, status, ingest_id, embed_type
              ) VALUES (
                ${validated.uri},
                ${validated.did},
                ${validated.cid},
                '',
                ${validated.createdAt},
                ${validated.indexedAt},
                0,
                'deleted',
                ${validated.ingestId},
                ${null}
              )
              ON CONFLICT(uri) DO UPDATE SET
                did = excluded.did,
                cid = excluded.cid,
                indexed_at = excluded.indexed_at,
                status = excluded.status,
                ingest_id = excluded.ingest_id,
                embed_type = excluded.embed_type
            `.pipe(Effect.asVoid);

          yield* sql`DELETE FROM post_topics WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
          yield* sql`DELETE FROM links WHERE post_uri = ${validated.uri}`.pipe(Effect.asVoid);
        })
      );
    });

    const BATCH_LIMIT = 500;
    const IDEMPOTENCY_CHUNK_SIZE = 80;

    const upsertPosts = (posts: ReadonlyArray<KnowledgePost>) => {
      if (rawDb === null || posts.length === 0) {
        return Effect.forEach(posts, upsertOne, { discard: true });
      }

      // D1 batch path: validate all posts, batch idempotency-check via
      // chunked IN queries, then combine write statements into db.batch().
      return Effect.gen(function* () {
        // 1. Validate all posts up-front
        const validatedPosts = yield* Effect.forEach(posts, (post) =>
          decodeWithDbError(
            KnowledgePostSchema,
            post,
            `Invalid knowledge post input for ${post.uri}`
          ),
          { concurrency: 1 }
        );

        // 2. Batch idempotency check — chunked IN queries (≤80 params each)
        const existingIngestIds = new Map<string, string | null>();
        const uriChunks = A.chunksOf(validatedPosts, IDEMPOTENCY_CHUNK_SIZE);
        yield* Effect.forEach(uriChunks, (chunk) =>
          Effect.gen(function* () {
            const uris = chunk.map((p) => p.uri);
            const placeholders = uris.map(() => "?").join(", ");
            const rows = yield* Effect.tryPromise({
              try: () =>
                rawDb.prepare(
                  `SELECT uri, ingest_id as ingestId FROM posts WHERE uri IN (${placeholders})`
                ).bind(...uris).all<{ uri: string; ingestId: string | null }>(),
              catch: (cause) =>
                makeBatchError(cause, "Failed to batch-check idempotency")
            });
            for (const row of rows.results) {
              existingIngestIds.set(row.uri, row.ingestId);
            }
          }),
          { discard: true }
        );

        // 3. Collect upsert statements only for posts that need updating
        const statementSets = validatedPosts.map((validated) => {
          if (existingIngestIds.get(validated.uri) === validated.ingestId) {
            return [] as ReadonlyArray<D1PreparedStatement>;
          }
          return makeUpsertStatements(rawDb, validated);
        });

        // 4. Flatten + chunk + batch
        const allStatements = A.flatten(statementSets);
        const chunks = A.chunksOf(allStatements, BATCH_LIMIT);
        yield* Effect.forEach(chunks, (chunk, i) =>
          runAtomicBatch(rawDb, chunk, `KnowledgeRepo.upsertPosts(chunk ${i + 1})`),
          { discard: true }
        );
      });
    };

    const markDeleted = (posts: ReadonlyArray<DeletedKnowledgePost>) => {
      if (rawDb === null || posts.length === 0) {
        return Effect.forEach(posts, markDeletedOne, { discard: true });
      }

      // D1 batch path: validate all posts, then combine delete statements into chunked batches
      return Effect.gen(function* () {
        // 1. Validate → collect statements per post
        const statementSets = yield* Effect.forEach(posts, (post) =>
          Effect.map(
            decodeWithDbError(
              DeletedKnowledgePostSchema,
              post,
              `Invalid deleted post input for ${post.uri}`
            ),
            (validated) => makeDeleteStatements(rawDb, validated)
          ),
          { concurrency: 1 }
        );

        // 2. Flatten + chunk + batch
        const allStatements = A.flatten(statementSets);
        const chunks = A.chunksOf(allStatements, BATCH_LIMIT);
        yield* Effect.forEach(chunks, (chunk, i) =>
          runAtomicBatch(rawDb, chunk, `KnowledgeRepo.markDeleted(chunk ${i + 1})`),
          { discard: true }
        );
      });
    };

    const searchPosts = (input: SearchPostsQueryInput) => {
      return decodeWithDbError(
        SearchPostsQueryInputSchema,
        input,
        "Invalid search posts input"
      ).pipe(
        Effect.flatMap((validated) => {
          const trimmed = sanitizeFtsQuery(validated.query);
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
              search.uri as uri,
              search.did as did,
              search.handle as handle,
              search.avatar as avatar,
              search.tier as tier,
              search.text as text,
              search.createdAt as createdAt,
              group_concat(DISTINCT pt.topic_slug) as topicsCsv
            FROM (
              SELECT
                p.uri, p.did, e.handle, e.avatar, COALESCE(e.tier, 'independent') as tier, p.text,
                p.created_at as createdAt,
                posts_fts.rank as rank
              FROM posts_fts
              JOIN posts p ON p.rowid = posts_fts.rowid
              JOIN experts e ON e.did = p.did
              WHERE posts_fts MATCH ${trimmed}
                AND ${sql.join(" AND ", false)(postConditions)}
            ) search
            LEFT JOIN post_topics pt ON pt.post_uri = search.uri
            GROUP BY search.uri, search.did, search.handle, search.avatar, search.tier, search.text, search.createdAt, search.rank
            ORDER BY search.rank, search.createdAt DESC, search.uri ASC
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

    const searchPostsPage = (input: SearchPostsPageQueryInput) =>
      decodeWithDbError(
        SearchPostsPageQueryInputSchema,
        input,
        "Invalid search posts page input"
      ).pipe(
        Effect.flatMap((validated) => {
          const trimmed = sanitizeFtsQuery(validated.query);
          if (trimmed.length === 0 || validated.topicSlugs?.length === 0) {
            return Effect.succeed([]);
          }

          const conditions = [
            sql`p.status = 'active'`,
            validated.since === undefined ? null : sql`p.created_at >= ${validated.since}`,
            validated.until === undefined ? null : sql`p.created_at <= ${validated.until}`,
            searchCursorCondition(sql, validated.cursor),
            validated.topicSlugs === undefined
              ? null
              : topicFilterExists(sql, validated.topicSlugs)
          ].filter(isDefined);

          return sql<any>`
            SELECT
              search.uri as uri,
              search.did as did,
              search.handle as handle,
              search.avatar as avatar,
              search.tier as tier,
              search.text as text,
              search.createdAt as createdAt,
              group_concat(DISTINCT pt.topic_slug) as topicsCsv,
              search.snippet as snippet,
              search.rank as rank
            FROM (
              SELECT
                p.uri, p.did, e.handle, e.avatar, COALESCE(e.tier, 'independent') as tier, p.text,
                p.created_at as createdAt,
                snippet(posts_fts, 1, '<mark>', '</mark>', '...', 30) as snippet,
                posts_fts.rank as rank
              FROM posts_fts
              JOIN posts p ON p.rowid = posts_fts.rowid
              JOIN experts e ON e.did = p.did
              WHERE posts_fts MATCH ${trimmed}
                AND ${sql.join(" AND ", false)(conditions)}
            ) search
            LEFT JOIN post_topics pt ON pt.post_uri = search.uri
            GROUP BY search.uri, search.did, search.handle, search.avatar, search.tier, search.text, search.createdAt, search.snippet, search.rank
            ORDER BY search.rank, search.createdAt DESC, search.uri ASC
            LIMIT ${validated.limit ?? 20}
          `.pipe(
            Effect.flatMap((rows) =>
              decodeWithDbError(
                SearchPostRowsSchema,
                rows,
                "Failed to decode search post page rows"
              )
            ),
            Effect.map((rows) => rows.map(toSearchPostResult)),
            Effect.flatMap((rows) =>
              decodeWithDbError(
                Schema.Array(RankedKnowledgePostResultSchema),
                rows,
                "Failed to normalize search post page rows"
              )
            )
          );
        })
      );

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
          e.avatar as avatar,
          COALESCE(e.tier, 'independent') as tier,
          p.text as text,
          p.created_at as createdAt,
          group_concat(DISTINCT pt.topic_slug) as topicsCsv
        FROM posts p
        JOIN experts e ON e.did = p.did
        LEFT JOIN post_topics pt ON pt.post_uri = p.uri
        WHERE ${sql.join(" AND ", false)(conditions)}
        GROUP BY p.uri, p.did, e.handle, e.avatar, e.tier, p.text, p.created_at
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
          l.image_url as imageUrl,
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
        ),
        Effect.flatMap((rows) =>
          decodeWithDbError(
            Schema.Array(KnowledgeLinkResultSchema),
            rows,
            "Failed to normalize post link rows"
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

    const optimizeFts = Effect.fn("KnowledgeRepo.optimizeFts")(function* () {
      yield* sql`INSERT INTO posts_fts(posts_fts) VALUES ('optimize')`.pipe(Effect.asVoid);
    });

    return {
      upsertPosts,
      markDeleted,
      searchPosts,
      searchPostsPage,
      getRecentPosts,
      getRecentPostsPage,
      getPostLinks,
      getPostLinksPage,
      getPostTopicMatches,
      optimizeFts
    };
  }))
};
