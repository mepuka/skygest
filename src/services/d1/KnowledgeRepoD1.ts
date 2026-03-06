import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import { Effect, Layer, Option } from "effect";
import { SqlClient } from "@effect/sql";
import { SqlError } from "@effect/sql/SqlError";
import { KnowledgeRepo } from "../KnowledgeRepo";
import type {
  DeletedKnowledgePost,
  GetPostLinksInput,
  GetRecentPostsInput,
  KnowledgeLinkResult,
  KnowledgePost,
  KnowledgePostResult,
  SearchPostsInput
} from "../../domain/bi";

const isDefined = <A>(value: A | null): value is A => value !== null;

type PostRow = Omit<KnowledgePostResult, "topics"> & {
  readonly topicsCsv: string | null;
};

const makeBatchError = (cause: unknown, message: string) =>
  new SqlError({ cause, message });

const toPostResult = (row: PostRow): KnowledgePostResult => ({
  uri: row.uri,
  did: row.did,
  handle: row.handle,
  text: row.text,
  createdAt: row.createdAt,
  topics: row.topicsCsv === null || row.topicsCsv.length === 0
    ? []
    : row.topicsCsv.split(",").filter((topic) => topic.length > 0)
});

const insertTopics = (sql: SqlClient.SqlClient, post: KnowledgePost) =>
  Effect.forEach(
    post.topics,
    (topic) =>
      sql`
        INSERT OR IGNORE INTO post_topics (post_uri, topic_slug, matched_term)
        VALUES (${post.uri}, ${topic.topicSlug}, ${topic.matchedTerm})
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

const runAtomicBatch = (
  db: D1Database,
  statements: ReadonlyArray<D1PreparedStatement>,
  operation: string
) =>
  Effect.tryPromise({
    try: async () => {
      await db.batch(Array.from(statements));
    },
    catch: (cause) => makeBatchError(cause, `Failed to execute D1 batch for ${operation}`)
  }).pipe(Effect.asVoid);

const makeUpsertStatements = (
  db: D1Database,
  post: KnowledgePost
): ReadonlyArray<D1PreparedStatement> => {
  const statements: Array<D1PreparedStatement> = [
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
    db.prepare("DELETE FROM posts_fts WHERE uri = ?").bind(post.uri)
  ];

  for (const topic of post.topics) {
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO post_topics (post_uri, topic_slug, matched_term)
        VALUES (?, ?, ?)
      `).bind(post.uri, topic.topicSlug, topic.matchedTerm)
    );
  }

  for (const link of post.links) {
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO links (
          post_uri, url, title, description, domain, extracted_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        post.uri,
        link.url,
        link.title,
        link.description,
        link.domain,
        link.extractedAt
      )
    );
  }

  statements.push(
    db.prepare(`
      INSERT INTO posts_fts (uri, text)
      VALUES (?, ?)
    `).bind(post.uri, post.text)
  );

  return statements;
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
      const existing = yield* sql<{ ingestId: string | null }>`
        SELECT ingest_id as ingestId
        FROM posts
        WHERE uri = ${post.uri}
      `;

      if (existing[0]?.ingestId === post.ingestId) {
        return;
      }

      if (rawDb !== null) {
        yield* runAtomicBatch(rawDb, makeUpsertStatements(rawDb, post), "KnowledgeRepo.upsertOne");
        return;
      }

      yield* sql`
          INSERT INTO posts (
            uri, did, cid, text, created_at, indexed_at,
            has_links, status, ingest_id
          ) VALUES (
            ${post.uri},
            ${post.did},
            ${post.cid},
            ${post.text},
            ${post.createdAt},
            ${post.indexedAt},
            ${post.hasLinks ? 1 : 0},
            ${post.status},
            ${post.ingestId}
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

      yield* sql`DELETE FROM post_topics WHERE post_uri = ${post.uri}`.pipe(Effect.asVoid);
      yield* sql`DELETE FROM links WHERE post_uri = ${post.uri}`.pipe(Effect.asVoid);
      yield* sql`DELETE FROM posts_fts WHERE uri = ${post.uri}`.pipe(Effect.asVoid);

      yield* insertTopics(sql, post);
      yield* insertLinks(sql, post);
      yield* sql`
          INSERT INTO posts_fts (uri, text)
          VALUES (${post.uri}, ${post.text})
        `.pipe(Effect.asVoid);
    });

    const markDeletedOne = Effect.fn("KnowledgeRepo.markDeletedOne")(function* (post: DeletedKnowledgePost) {
      const existing = yield* sql<{ ingestId: string | null }>`
        SELECT ingest_id as ingestId
        FROM posts
        WHERE uri = ${post.uri}
      `;

      if (existing[0]?.ingestId === post.ingestId) {
        return;
      }

      if (rawDb !== null) {
        yield* runAtomicBatch(rawDb, makeDeleteStatements(rawDb, post), "KnowledgeRepo.markDeletedOne");
        return;
      }

      yield* sql`
          INSERT INTO posts (
            uri, did, cid, text, created_at, indexed_at,
            has_links, status, ingest_id
          ) VALUES (
            ${post.uri},
            ${post.did},
            ${post.cid},
            '',
            ${post.createdAt},
            ${post.indexedAt},
            0,
            'deleted',
            ${post.ingestId}
          )
          ON CONFLICT(uri) DO UPDATE SET
            did = excluded.did,
            cid = excluded.cid,
            indexed_at = excluded.indexed_at,
            status = excluded.status,
            ingest_id = excluded.ingest_id
        `.pipe(Effect.asVoid);

      yield* sql`DELETE FROM post_topics WHERE post_uri = ${post.uri}`.pipe(Effect.asVoid);
      yield* sql`DELETE FROM links WHERE post_uri = ${post.uri}`.pipe(Effect.asVoid);
      yield* sql`DELETE FROM posts_fts WHERE uri = ${post.uri}`.pipe(Effect.asVoid);
    });

    const upsertPosts = (posts: ReadonlyArray<KnowledgePost>) =>
      Effect.forEach(posts, upsertOne, { discard: true });

    const markDeleted = (posts: ReadonlyArray<DeletedKnowledgePost>) =>
      Effect.forEach(posts, markDeletedOne, { discard: true });

    const searchPosts = (input: SearchPostsInput) => {
      const trimmed = input.query.trim();
      if (trimmed.length === 0) {
        return Effect.succeed([]);
      }

      const postConditions = [
        sql`p.status = 'active'`,
        input.since === undefined ? null : sql`p.created_at >= ${input.since}`,
        input.topic === undefined
          ? null
          : sql`EXISTS (
              SELECT 1
              FROM post_topics filter_pt
              WHERE filter_pt.post_uri = p.uri AND filter_pt.topic_slug = ${input.topic}
            )`
      ].filter(isDefined);

      return sql<PostRow>`
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
        LIMIT ${input.limit ?? 20}
      `.pipe(Effect.map((rows) => rows.map(toPostResult)));
    };

    const getRecentPosts = (input: GetRecentPostsInput) => {
      const conditions = [
        sql`p.status = 'active'`,
        input.since === undefined ? null : sql`p.created_at >= ${input.since}`,
        input.expertDid === undefined ? null : sql`p.did = ${input.expertDid}`,
        input.topic === undefined
          ? null
          : sql`EXISTS (
              SELECT 1
              FROM post_topics filter_pt
              WHERE filter_pt.post_uri = p.uri AND filter_pt.topic_slug = ${input.topic}
            )`
      ].filter(isDefined);

      return sql<PostRow>`
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
        LIMIT ${input.limit ?? 20}
      `.pipe(Effect.map((rows) => rows.map(toPostResult)));
    };

    const getPostLinks = (input: GetPostLinksInput) => {
      const conditions = [
        sql`p.status = 'active'`,
        input.since === undefined ? null : sql`p.created_at >= ${input.since}`,
        input.domain === undefined ? null : sql`l.domain = ${input.domain}`,
        input.topic === undefined
          ? null
          : sql`EXISTS (
              SELECT 1
              FROM post_topics filter_pt
              WHERE filter_pt.post_uri = p.uri AND filter_pt.topic_slug = ${input.topic}
            )`
      ].filter(isDefined);

      return sql<KnowledgeLinkResult>`
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
        ORDER BY l.extracted_at DESC, l.post_uri ASC
        LIMIT ${input.limit ?? 20}
      `;
    };

    return KnowledgeRepo.of({
      upsertPosts,
      markDeleted,
      searchPosts,
      getRecentPosts,
      getPostLinks
    });
  }))
};
