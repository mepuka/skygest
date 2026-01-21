import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";

export type UserRow = {
  readonly did: string;
  readonly handle: string | null;
  readonly displayName: string | null;
  readonly createdAt: number | null;
  readonly lastAccessAt: number | null;
  readonly accessCount: number;
  readonly consentAccesses: number;
  readonly optOut: boolean;
  readonly deactivated: boolean;
};

export class UsersRepo extends Context.Tag("@skygest/UsersRepo")<
  UsersRepo,
  {
    readonly upsert: (user: UserRow) => Effect.Effect<void, SqlError>;
    readonly get: (did: string) => Effect.Effect<UserRow | null, SqlError>;
    readonly listActive: () => Effect.Effect<ReadonlyArray<string>, SqlError>;
    readonly incrementAccess: (did: string, consentIncrement: number) => Effect.Effect<void, SqlError>;
  }
>() {}
