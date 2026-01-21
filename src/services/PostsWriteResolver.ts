import { Effect, Request, RequestResolver } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { PostsRepo, type PaperPost } from "./PostsRepo";

export class PutPost extends Request.TaggedClass("PutPost")<
  void,
  SqlError,
  { readonly post: PaperPost }
> {}

export class DeletePost extends Request.TaggedClass("DeletePost")<
  void,
  SqlError,
  { readonly uri: string }
> {}

export type PostsWriteRequest = PutPost | DeletePost;

export const PostsWriteResolver = RequestResolver.fromEffectTagged<PostsWriteRequest>()({
  PutPost: (requests) =>
    Effect.gen(function* () {
      const posts = yield* PostsRepo;
      yield* posts.putMany(requests.map((req) => req.post));
      return requests.map(() => undefined);
    }),
  DeletePost: (requests) =>
    Effect.gen(function* () {
      const posts = yield* PostsRepo;
      yield* posts.markDeletedMany(requests.map((req) => req.uri));
      return requests.map(() => undefined);
    })
});
