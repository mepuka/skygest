import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { ExpertsRepo } from "./ExpertsRepo";
import { KnowledgeRepo } from "./KnowledgeRepo";
import type {
  ExpertListItem,
  GetPostLinksInput,
  GetRecentPostsInput,
  KnowledgeLinkResult,
  KnowledgePostResult,
  ListExpertsInput,
  SearchPostsInput
} from "../domain/bi";

export class KnowledgeQueryService extends Context.Tag("@skygest/KnowledgeQueryService")<
  KnowledgeQueryService,
  {
    readonly searchPosts: (
      input: SearchPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getRecentPosts: (
      input: GetRecentPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError>;
    readonly getPostLinks: (
      input: GetPostLinksInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError>;
    readonly listExperts: (
      input: ListExpertsInput
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError>;
  }
>() {
  static readonly layer = Layer.effect(
    KnowledgeQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;

      const searchPosts = Effect.fn("KnowledgeQueryService.searchPosts")(function* (input: SearchPostsInput) {
        return yield* knowledgeRepo.searchPosts({
          ...input,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        });
      });

      const getRecentPosts = Effect.fn("KnowledgeQueryService.getRecentPosts")(function* (input: GetRecentPostsInput) {
        return yield* knowledgeRepo.getRecentPosts({
          ...input,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        });
      });

      const getPostLinks = Effect.fn("KnowledgeQueryService.getPostLinks")(function* (input: GetPostLinksInput) {
        return yield* knowledgeRepo.getPostLinks({
          ...input,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        });
      });

      const listExperts = Effect.fn("KnowledgeQueryService.listExperts")(function* (input: ListExpertsInput) {
        return yield* expertsRepo.list(
          input.domain ?? null,
          input.active ?? null,
          clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        );
      });

      return KnowledgeQueryService.of({
        searchPosts,
        getRecentPosts,
        getPostLinks,
        listExperts
      });
    })
  );
}
