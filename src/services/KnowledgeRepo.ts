import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type {
  DeletedKnowledgePost,
  GetPostLinksQueryInput,
  GetRecentPostsQueryInput,
  KnowledgeLinkResult,
  KnowledgePost,
  KnowledgePostResult,
  SearchPostsQueryInput,
  StoredTopicMatch
} from "../domain/bi";

export class KnowledgeRepo extends Context.Tag("@skygest/KnowledgeRepo")<
  KnowledgeRepo,
  {
    readonly upsertPosts: (posts: ReadonlyArray<KnowledgePost>) => Effect.Effect<void, SqlError>;
    readonly markDeleted: (posts: ReadonlyArray<DeletedKnowledgePost>) => Effect.Effect<void, SqlError>;
    readonly searchPosts: (
      input: SearchPostsQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getRecentPosts: (
      input: GetRecentPostsQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getPostLinks: (
      input: GetPostLinksQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError>;
    readonly getPostTopicMatches: (
      postUri: string
    ) => Effect.Effect<ReadonlyArray<StoredTopicMatch>, SqlError>;
  }
>() {}
