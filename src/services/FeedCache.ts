import { Context, Effect } from "effect";
import type * as PlatformError from "@effect/platform/Error";

export class FeedCache extends Context.Tag("@skygest/FeedCache")<
  FeedCache,
  {
    readonly getFeed: (
      did: string,
      algorithm: string
    ) => Effect.Effect<ReadonlyArray<string> | null, PlatformError.PlatformError>;
    readonly putFeed: (
      did: string,
      algorithm: string,
      items: ReadonlyArray<string>,
      ttlSeconds: number
    ) => Effect.Effect<void, PlatformError.PlatformError>;
    readonly getMeta: (
      did: string,
      algorithm: string
    ) => Effect.Effect<Record<string, unknown> | null, PlatformError.PlatformError>;
    readonly putMeta: (
      did: string,
      algorithm: string,
      meta: Record<string, unknown>,
      ttlSeconds: number
    ) => Effect.Effect<void, PlatformError.PlatformError>;
  }
>() {}
