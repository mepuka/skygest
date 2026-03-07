import { Context, Effect } from "effect";
import type { SqlError } from "@effect/sql/SqlError";

export class IngestLeaseRepo extends Context.Tag("@skygest/IngestLeaseRepo")<
  IngestLeaseRepo,
  {
    readonly tryAcquire: (
      name: string,
      owner: string,
      now: number,
      expiresAt: number
    ) => Effect.Effect<boolean, SqlError>;
    readonly renew: (
      name: string,
      owner: string,
      expiresAt: number
    ) => Effect.Effect<boolean, SqlError>;
    readonly release: (
      name: string,
      owner: string
    ) => Effect.Effect<void, SqlError>;
  }
>() {}
