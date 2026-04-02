import { ServiceMap, Effect, type PlatformError } from "effect";

export class CandidateSessionsRepo extends ServiceMap.Service<
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
>()("@skygest/CandidateSessionsRepo") {}
