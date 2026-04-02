import { Clock, ServiceMap, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { DbError } from "../domain/errors";
import type { PostUri } from "../domain/types";
import type {
  SubmitEditorialPickInput,
  SubmitEditorialPickOutput,
  RemoveEditorialPickOutput,
  ListEditorialPicksInput,
  EditorialPickOutput,
  GetCuratedFeedInput,
  CuratedPostResult
} from "../domain/editorial";
import { EditorialPostNotFoundError } from "../domain/editorial";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { EditorialRepo } from "./EditorialRepo";
import { OntologyCatalog } from "./OntologyCatalog";

export class EditorialService extends ServiceMap.Service<
  EditorialService,
  {
    readonly submitPick: (
      input: SubmitEditorialPickInput,
      curator: string
    ) => Effect.Effect<SubmitEditorialPickOutput, SqlError | DbError | EditorialPostNotFoundError>;

    readonly retractPick: (
      postUri: string
    ) => Effect.Effect<RemoveEditorialPickOutput, SqlError | DbError>;

    readonly listPicks: (
      input: ListEditorialPicksInput
    ) => Effect.Effect<ReadonlyArray<EditorialPickOutput>, SqlError | DbError>;

    readonly getCuratedFeed: (
      input: GetCuratedFeedInput
    ) => Effect.Effect<ReadonlyArray<CuratedPostResult>, SqlError | DbError>;

    readonly expireStale: () => Effect.Effect<number, SqlError | DbError>;
  }
>()("@skygest/EditorialService") {
  static readonly layer = Layer.effect(EditorialService, Effect.gen(function* () {
    const repo = yield* EditorialRepo;
    const config = yield* AppConfig;
    const ontology = yield* OntologyCatalog;

    const clampEditorialLimit = (limit: number | undefined) =>
      clampLimit(limit, config.mcpLimitDefault, config.mcpLimitMax);

    const submitPick = Effect.fn("EditorialService.submitPick")(
      function* (input: SubmitEditorialPickInput, curator: string) {
        const exists = yield* repo.postExists(input.postUri);
        if (!exists) {
          return yield* EditorialPostNotFoundError.make({ postUri: input.postUri });
        }
        const now = yield* Clock.currentTimeMillis;
        const defaultExpiryHours = Math.max(1, config.editorialDefaultExpiryHours);
        const expiresAt = input.expiresInHours !== undefined
          ? now + input.expiresInHours * 60 * 60 * 1000
          : now + defaultExpiryHours * 60 * 60 * 1000;
        const created = yield* repo.upsertPick({
          postUri: input.postUri,
          score: input.score,
          reason: input.reason,
          category: input.category ?? null,
          curator,
          status: "active",
          pickedAt: now,
          expiresAt
        });
        return { postUri: input.postUri, created };
      }
    );

    const retractPick = Effect.fn("EditorialService.retractPick")(
      function* (postUri: string) {
        const removed = yield* repo.retractPick(postUri);
        return { postUri: postUri as PostUri, removed };
      }
    );

    const listPicks = Effect.fn("EditorialService.listPicks")(
      function* (input: ListEditorialPicksInput) {
        const now = yield* Clock.currentTimeMillis;
        const records = yield* repo.listPicks({
          ...input,
          limit: clampEditorialLimit(input.limit)
        }, now);
        return records.map((r) => ({
          postUri: r.postUri,
          score: r.score,
          reason: r.reason,
          category: r.category,
          curator: r.curator,
          pickedAt: r.pickedAt
        }));
      }
    );

    const getCuratedFeed = Effect.fn("EditorialService.getCuratedFeed")(
      function* (input: GetCuratedFeedInput) {
        const now = yield* Clock.currentTimeMillis;
        const topicSlugs = yield* ontology.resolveCanonicalTopicSlugs(input.topic);
        return yield* repo.getCuratedFeed({
          ...input,
          limit: clampEditorialLimit(input.limit),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        }, now);
      }
    );

    const expireStale = Effect.fn("EditorialService.expireStale")(function* () {
      const now = yield* Clock.currentTimeMillis;
      return yield* repo.expireStale(now);
    });

    return {
      submitPick,
      retractPick,
      listPicks,
      getCuratedFeed,
      expireStale
    };
  }));
}
