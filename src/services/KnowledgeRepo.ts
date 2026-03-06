import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type {
  DeletedKnowledgePost,
  GetPostLinksInput,
  GetRecentPostsInput,
  KnowledgeLinkResult,
  KnowledgePost,
  KnowledgePostResult,
  SearchPostsInput
} from "../domain/bi";

export class KnowledgeRepo extends Context.Tag("@skygest/KnowledgeRepo")<
  KnowledgeRepo,
  {
    readonly upsertPosts: (posts: ReadonlyArray<KnowledgePost>) => Effect.Effect<void, SqlError>;
    readonly markDeleted: (posts: ReadonlyArray<DeletedKnowledgePost>) => Effect.Effect<void, SqlError>;
    readonly searchPosts: (
      input: SearchPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getRecentPosts: (
      input: GetRecentPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getPostLinks: (
      input: GetPostLinksInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError>;
  }
>() {}
