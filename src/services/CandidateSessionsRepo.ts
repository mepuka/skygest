import { Context, Effect } from "effect";
import type * as PlatformError from "@effect/platform/Error";

export class CandidateSessionsRepo extends Context.Tag("@skygest/CandidateSessionsRepo")<
  CandidateSessionsRepo,
  {
    readonly put: (
      sessionId: string,
      items: ReadonlyArray<string>,
      ttlSeconds: number
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly get: (
      sessionId: string
    ) => Effect.Effect<ReadonlyArray<string> | null, PlatformError.PlatformError>;
  }
>() {}
