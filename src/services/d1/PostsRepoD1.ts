import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { PostsRepo, PaperPost } from "../PostsRepo";

export const PostsRepoD1 = {
  layer: Layer.effect(PostsRepo, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const putMany = (posts: ReadonlyArray<PaperPost>) =>
      posts.length === 0
        ? Effect.void
        : sql`
            INSERT OR IGNORE INTO posts
            ${sql.insert(posts.map((p) => ({
              uri: p.uri,
              cid: p.cid,
              author_did: p.authorDid,
              created_at: p.createdAt,
              indexed_at: p.indexedAt,
              search_text: p.searchText,
              reply_root: p.replyRoot,
              reply_parent: p.replyParent,
              status: p.status
            })))}
          `.pipe(Effect.asVoid);

    const listRecent = (cursor: number | null, limit: number) =>
      cursor === null
        ? sql<PaperPost>`
            SELECT
              uri as uri,
              cid as cid,
              author_did as authorDid,
              created_at as createdAt,
              indexed_at as indexedAt,
              search_text as searchText,
              reply_root as replyRoot,
              reply_parent as replyParent,
              status as status
            FROM posts
            WHERE status != 'deleted'
            ORDER BY created_at DESC, uri DESC
            LIMIT ${limit}
          `
        : sql<PaperPost>`
            SELECT
              uri as uri,
              cid as cid,
              author_did as authorDid,
              created_at as createdAt,
              indexed_at as indexedAt,
              search_text as searchText,
              reply_root as replyRoot,
              reply_parent as replyParent,
              status as status
            FROM posts
            WHERE status != 'deleted' AND created_at < ${cursor}
            ORDER BY created_at DESC, uri DESC
            LIMIT ${limit}
          `;

    const markDeleted = (uri: string) =>
      sql`UPDATE posts SET status = 'deleted' WHERE uri = ${uri}`.pipe(Effect.asVoid);

    const markDeletedMany = (uris: ReadonlyArray<string>) =>
      uris.length === 0
        ? Effect.void
        : sql`UPDATE posts SET status = 'deleted' WHERE ${sql.in("uri", uris)}`.pipe(Effect.asVoid);

    return PostsRepo.of({ putMany, listRecent, markDeleted, markDeletedMany });
  }))
};
