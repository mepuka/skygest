import { Array, Effect, Request, RequestResolver } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { PostsRepo, type PaperPost } from "./PostsRepo";

export class ListRecentByAuthor extends Request.TaggedClass("ListRecentByAuthor")<
  ReadonlyArray<PaperPost>,
  SqlError,
  { readonly authorDid: string; readonly limit: number }
> {}

export type PostsReadRequest = ListRecentByAuthor;

export const PostsReadResolver = RequestResolver.fromEffectTagged<PostsReadRequest>()({
  ListRecentByAuthor: (requests) =>
    Effect.gen(function* () {
      const posts = yield* PostsRepo;
      const grouped = Array.groupBy(requests, (req) => String(req.limit));
      const entries = Object.entries(grouped);

      const groupedResults = yield* Effect.forEach(
        entries,
        ([limitKey, reqs]) => {
          const limit = Number(limitKey);
          const authorDids = Array.dedupe(Array.map(reqs, (req) => req.authorDid));
          return posts.listRecentByAuthors(authorDids, limit).pipe(
            Effect.map((rows) => {
              const byAuthor = Array.groupBy(rows, (row) => row.authorDid);
              return [limitKey, byAuthor] as const;
            })
          );
        },
        { concurrency: "unbounded" }
      );

      const byLimit = new Map(groupedResults);

      return Array.map(requests, (req) => {
        const byAuthor = byLimit.get(String(req.limit)) ?? {};
        return byAuthor[req.authorDid] ?? [];
      });
    })
});
