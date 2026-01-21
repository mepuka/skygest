import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";

export type PaperPost = {
  readonly uri: string;
  readonly cid: string;
  readonly authorDid: string;
  readonly createdAt: number;
  readonly indexedAt: number;
  readonly searchText: string | null;
  readonly replyRoot: string | null;
  readonly replyParent: string | null;
  readonly status: "active" | "deleted";
};

export class PostsRepo extends Context.Tag("@skygest/PostsRepo")<
  PostsRepo,
  {
    readonly putMany: (posts: ReadonlyArray<PaperPost>) => Effect.Effect<void, SqlError>;
    readonly listRecent: (cursor: number | null, limit: number) => Effect.Effect<ReadonlyArray<PaperPost>, SqlError>;
    readonly markDeleted: (uri: string) => Effect.Effect<void, SqlError>;
    readonly markDeletedMany: (uris: ReadonlyArray<string>) => Effect.Effect<void, SqlError>;
  }
>() {}
