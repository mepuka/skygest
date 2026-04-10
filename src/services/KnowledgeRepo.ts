import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  GetPostLinksPageQueryInput,
  GetRecentPostsPageQueryInput,
  SearchPostsPageQueryInput
} from "../domain/api";
import type {
  DeletedKnowledgePost,
  GetPostLinksQueryInput,
  GetRecentPostsQueryInput,
  KnowledgeLinkResult,
  KnowledgePost,
  KnowledgePostResult,
  LinkRecord,
  RankedKnowledgePostResult,
  SearchPostsQueryInput,
  StoredTopicMatch
} from "../domain/bi";
import type { PostUri } from "../domain/types";

export class KnowledgeRepo extends ServiceMap.Service<
  KnowledgeRepo,
  {
    readonly upsertPosts: (posts: ReadonlyArray<KnowledgePost>) => Effect.Effect<void, SqlError | DbError>;
    readonly markDeleted: (posts: ReadonlyArray<DeletedKnowledgePost>) => Effect.Effect<void, SqlError | DbError>;
    readonly searchPosts: (
      input: SearchPostsQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError | DbError>;
    readonly getRecentPosts: (
      input: GetRecentPostsQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError | DbError>;
    readonly getRecentPostsPage: (
      input: GetRecentPostsPageQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError | DbError>;
    readonly getPostLinks: (
      input: GetPostLinksQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError | DbError>;
    readonly getPostLinksPage: (
      input: GetPostLinksPageQueryInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError | DbError>;
    readonly getPostByUri: (
      postUri: PostUri
    ) => Effect.Effect<KnowledgePostResult | null, SqlError | DbError>;
    readonly getLinksByPostUri: (
      postUri: PostUri
    ) => Effect.Effect<ReadonlyArray<LinkRecord>, SqlError | DbError>;
    readonly getPostTopicMatches: (
      postUri: string
    ) => Effect.Effect<ReadonlyArray<StoredTopicMatch>, SqlError | DbError>;
    readonly searchPostsPage: (
      input: SearchPostsPageQueryInput
    ) => Effect.Effect<ReadonlyArray<RankedKnowledgePostResult>, SqlError | DbError>;
    readonly optimizeFts: () => Effect.Effect<void, SqlError | DbError>;
  }
>()("@skygest/KnowledgeRepo") {}
