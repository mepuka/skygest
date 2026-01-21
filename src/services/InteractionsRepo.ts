import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";

export type InteractionRow = {
  readonly id: string;
  readonly userDid: string;
  readonly postUri: string;
  readonly type: "like" | "repost" | "quotepost";
  readonly createdAt: number;
};

export class InteractionsRepo extends Context.Tag("@skygest/InteractionsRepo")<
  InteractionsRepo,
  {
    readonly putMany: (rows: ReadonlyArray<InteractionRow>) => Effect.Effect<void, SqlError>;
  }
>() {}
