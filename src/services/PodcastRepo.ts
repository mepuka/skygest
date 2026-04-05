import { Effect, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  PodcastEpisodeBundle,
  PodcastEpisodeRecord
} from "../domain/podcast";
import type { PodcastEpisodeId, PublicationId } from "../domain/types";

export class PodcastRepo extends ServiceMap.Service<
  PodcastRepo,
  {
    readonly upsertEpisodeBundle: (
      bundle: PodcastEpisodeBundle
    ) => Effect.Effect<void, SqlError | DbError>;
    readonly getEpisodeBundle: (
      episodeId: PodcastEpisodeId
    ) => Effect.Effect<PodcastEpisodeBundle | null, SqlError | DbError>;
    readonly listEpisodesByShowSlug: (
      showSlug: PublicationId
    ) => Effect.Effect<ReadonlyArray<PodcastEpisodeRecord>, SqlError | DbError>;
  }
>()("@skygest/PodcastRepo") {}
