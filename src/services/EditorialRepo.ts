import { ServiceMap, Effect } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  EditorialPickRecord,
  EditorialPickSourcePost,
  CuratedPostResult,
  GetCuratedFeedInput,
  ListEditorialPicksInput
} from "../domain/editorial";
import type { TopicSlug } from "../domain/bi";

export class EditorialRepo extends ServiceMap.Service<
  EditorialRepo,
  {
    /** Upsert a pick (last write wins). Returns true if new, false if updated. */
    readonly upsertPick: (
      pick: EditorialPickRecord
    ) => Effect.Effect<boolean, SqlError | DbError>;

    /** Retract a pick by post URI. Returns true if a row was changed. */
    readonly retractPick: (
      postUri: string
    ) => Effect.Effect<boolean, SqlError | DbError>;

    /** List active, non-expired picks. `now` filters out picks past expires_at. */
    readonly listPicks: (
      input: ListEditorialPicksInput,
      now: number
    ) => Effect.Effect<ReadonlyArray<EditorialPickRecord>, SqlError | DbError>;

    /** Look up one active, non-expired pick by post URI. */
    readonly getActivePick: (
      postUri: string,
      now: number
    ) => Effect.Effect<EditorialPickRecord | null, SqlError | DbError>;

    /** Look up the active post row needed for editorial bundle reads. */
    readonly getActivePost: (
      postUri: string
    ) => Effect.Effect<EditorialPickSourcePost | null, SqlError | DbError>;

    /**
     * Curated feed: JOIN editorial_picks → posts → experts, with topic
     * filtering via EXISTS predicate on post_topics (same pattern as
     * executeRecentPostsQuery in KnowledgeRepoD1) and a separate LEFT JOIN
     * on post_topics for aggregating ALL topic slugs into topicsCsv.
     * topicSlugs is pre-resolved by the service layer via ontology expansion.
     * `now` filters out picks past expires_at at query time.
     */
    readonly getCuratedFeed: (
      input: GetCuratedFeedInput & {
        readonly topicSlugs?: ReadonlyArray<TopicSlug>;
      },
      now: number
    ) => Effect.Effect<ReadonlyArray<CuratedPostResult>, SqlError | DbError>;

    /** Check if an active post exists by URI. */
    readonly postExists: (
      postUri: string
    ) => Effect.Effect<boolean, SqlError | DbError>;

    /** Expire picks past their expires_at. Returns count expired. */
    readonly expireStale: (
      now: number
    ) => Effect.Effect<number, SqlError | DbError>;
  }
>()("@skygest/EditorialRepo") {}
