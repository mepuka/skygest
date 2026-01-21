import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";

export type AccessLog = {
  readonly id: string;
  readonly did: string;
  readonly accessAt: number;
  readonly recsShown: string;
  readonly cursorStart: number;
  readonly cursorEnd: number;
  readonly defaultFrom: number | null;
};

export class AccessRepo extends Context.Tag("@skygest/AccessRepo")<
  AccessRepo,
  {
    readonly logAccess: (log: AccessLog) => Effect.Effect<void, SqlError>;
  }
>() {}
