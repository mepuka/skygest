import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
import type { DbError } from "../domain/errors";
import type {
  GetPostLinksPageInput,
  GetRecentPostsPageInput,
  PostLinksPageResult,
  RecentPostsPageResult,
  SearchPostsPageInput,
  SearchPostsPageResult
} from "../domain/api";
import { AppConfig } from "../platform/Config";
import { clampLimit } from "../platform/Limit";
import { ExpertsRepo } from "./ExpertsRepo";
import { KnowledgeRepo } from "./KnowledgeRepo";
import { OntologyCatalog } from "./OntologyCatalog";
import type {
  ExplainPostTopicsInput,
  ExplainPostTopicsOutput,
  ExplainedPostTopic,
  ExpandTopicsInput,
  ExpandedTopicsOutput,
  ExpertListItem,
  GetTopicInput,
  OntologyConceptSlug,
  OntologyListTopic,
  GetPostLinksInput,
  GetRecentPostsInput,
  KnowledgeLinkResult,
  KnowledgePostResult,
  ListTopicsInput,
  ListExpertsInput,
  SearchPostsInput
} from "../domain/bi";
import type {
  ListPublicationsInput,
  PublicationListItem
} from "../domain/bi";
import { PublicationsRepo } from "./PublicationsRepo";

export class KnowledgeQueryService extends Context.Tag("@skygest/KnowledgeQueryService")<
  KnowledgeQueryService,
  {
    readonly searchPosts: (
      input: SearchPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError | DbError>;
    readonly searchPostsPage: (
      input: SearchPostsPageInput
    ) => Effect.Effect<SearchPostsPageResult, SqlError | DbError>;
    readonly getRecentPosts: (
      input: GetRecentPostsInput
    ) => Effect.Effect<ReadonlyArray<KnowledgePostResult>, SqlError | DbError>;
    readonly getRecentPostsPage: (
      input: GetRecentPostsPageInput
    ) => Effect.Effect<RecentPostsPageResult, SqlError | DbError>;
    readonly getPostLinks: (
      input: GetPostLinksInput
    ) => Effect.Effect<ReadonlyArray<KnowledgeLinkResult>, SqlError | DbError>;
    readonly getPostLinksPage: (
      input: GetPostLinksPageInput
    ) => Effect.Effect<PostLinksPageResult, SqlError | DbError>;
    readonly listExperts: (
      input: ListExpertsInput
    ) => Effect.Effect<ReadonlyArray<ExpertListItem>, SqlError | DbError>;
    readonly listTopics: (
      input: ListTopicsInput
    ) => Effect.Effect<ReadonlyArray<OntologyListTopic>>;
    readonly getTopic: (
      input: GetTopicInput
    ) => Effect.Effect<OntologyListTopic | null>;
    readonly expandTopics: (
      input: ExpandTopicsInput
    ) => Effect.Effect<ExpandedTopicsOutput>;
    readonly explainPostTopics: (
      postUri: ExplainPostTopicsInput["postUri"]
    ) => Effect.Effect<ExplainPostTopicsOutput, SqlError | DbError>;
    readonly listPublications: (
      input: ListPublicationsInput
    ) => Effect.Effect<ReadonlyArray<PublicationListItem>, SqlError | DbError>;
  }
>() {
  static readonly layer = Layer.effect(
    KnowledgeQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const ontology = yield* OntologyCatalog;
      const publicationsRepo = yield* PublicationsRepo;

      const resolveTopicSlugs = Effect.fn("KnowledgeQueryService.resolveTopicSlugs")(function* (
        topic: string | undefined
      ) {
        if (topic === undefined) {
          return undefined;
        }

        const expanded = yield* ontology.expandTopics([topic], "descendants");
        return expanded.canonicalTopicSlugs;
      });

      const searchPosts = Effect.fn("KnowledgeQueryService.searchPosts")(function* (input: SearchPostsInput) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        return yield* knowledgeRepo.searchPosts({
          query: input.query,
          since: input.since,
          until: input.until,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      });

      const searchPostsPage = Effect.fn("KnowledgeQueryService.searchPostsPage")(function* (
        input: SearchPostsPageInput
      ) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        const limit = clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax);
        const rows = yield* knowledgeRepo.searchPostsPage({
          query: input.query,
          limit: limit + 1,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.since === undefined ? {} : { since: input.since }),
          ...(input.until === undefined ? {} : { until: input.until }),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
        const hasMore = rows.length > limit;
        const pageRows = hasMore ? rows.slice(0, limit) : rows;
        const lastItem = pageRows[pageRows.length - 1];
        const nextCursor = hasMore && lastItem !== undefined
          ? { rank: lastItem.rank, createdAt: lastItem.createdAt, uri: lastItem.uri }
          : null;

        const items = pageRows.map(({ rank: _rank, ...rest }) => rest);

        return { items, nextCursor } satisfies SearchPostsPageResult;
      });

      const getRecentPosts = Effect.fn("KnowledgeQueryService.getRecentPosts")(function* (input: GetRecentPostsInput) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        return yield* knowledgeRepo.getRecentPosts({
          expertDid: input.expertDid,
          since: input.since,
          until: input.until,
          cursor: input.cursor,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      });

      const getRecentPostsPage = Effect.fn("KnowledgeQueryService.getRecentPostsPage")(function* (
        input: GetRecentPostsPageInput
      ) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        const limit = clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax);
        const rows = yield* knowledgeRepo.getRecentPostsPage({
          expertDid: input.expertDid,
          since: input.since,
          until: input.until,
          limit: limit + 1,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const lastItem = items[items.length - 1];

        return {
          items,
          nextCursor: hasMore && lastItem !== undefined
            ? {
                createdAt: lastItem.createdAt,
                uri: lastItem.uri
              }
            : null
        } satisfies RecentPostsPageResult;
      });

      const getPostLinks = Effect.fn("KnowledgeQueryService.getPostLinks")(function* (input: GetPostLinksInput) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        return yield* knowledgeRepo.getPostLinks({
          domain: input.domain,
          since: input.since,
          until: input.until,
          cursor: input.cursor,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      });

      const getPostLinksPage = Effect.fn("KnowledgeQueryService.getPostLinksPage")(function* (
        input: GetPostLinksPageInput
      ) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        const limit = clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax);
        const rows = yield* knowledgeRepo.getPostLinksPage({
          domain: input.domain,
          since: input.since,
          until: input.until,
          limit: limit + 1,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const lastItem = items[items.length - 1];

        return {
          items,
          nextCursor: hasMore && lastItem !== undefined
            ? {
                createdAt: lastItem.createdAt,
                postUri: lastItem.postUri,
                url: lastItem.url
              }
            : null
        } satisfies PostLinksPageResult;
      });

      const listExperts = Effect.fn("KnowledgeQueryService.listExperts")(function* (input: ListExpertsInput) {
        return yield* expertsRepo.list(
          input.domain ?? null,
          input.active ?? null,
          clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        );
      });

      const listTopics = Effect.fn("KnowledgeQueryService.listTopics")(function* (input: ListTopicsInput) {
        return yield* ontology.listTopics(input.view ?? "facets");
      });

      const getTopic = Effect.fn("KnowledgeQueryService.getTopic")(function* (input: GetTopicInput) {
        return yield* ontology.getTopic(input.slug);
      });

      const expandTopics = Effect.fn("KnowledgeQueryService.expandTopics")(function* (input: ExpandTopicsInput) {
        return yield* ontology.expandTopics(input.slugs, input.mode ?? "exact");
      });

      const explainPostTopics = Effect.fn("KnowledgeQueryService.explainPostTopics")(function* (
        postUri: ExplainPostTopicsInput["postUri"]
      ) {
        const matches = yield* knowledgeRepo.getPostTopicMatches(postUri);
        const items = yield* Effect.forEach(
          matches,
          (match) =>
            Effect.gen(function* () {
              const topic = yield* ontology.getTopic(match.topicSlug);
              const fallback = ontology.topics.find((item) => item.slug === match.topicSlug);
              const topicLabel = topic?.label ?? fallback?.label ?? match.topicSlug;
              const conceptSlugs = topic?.kind === "canonical-topic"
                ? topic.conceptSlugs as ReadonlyArray<OntologyConceptSlug>
                : fallback?.conceptSlugs ?? [];

              return {
                postUri: match.postUri,
                topicSlug: match.topicSlug,
                topicLabel,
                conceptSlugs,
                matchedTerm: match.matchedTerm,
                matchSignal: match.matchSignal,
                matchValue: match.matchValue,
                matchScore: match.matchScore,
                ontologyVersion: match.ontologyVersion,
                matcherVersion: match.matcherVersion
              } satisfies ExplainedPostTopic;
            }),
          { concurrency: 1 }
        );

        return {
          postUri,
          items
        } satisfies ExplainPostTopicsOutput;
      });

      const listPublications = Effect.fn("KnowledgeQueryService.listPublications")(function* (input: ListPublicationsInput) {
        return yield* publicationsRepo.list({
          tier: input.tier,
          source: input.source,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax)
        });
      });

      return KnowledgeQueryService.of({
        searchPosts,
        searchPostsPage,
        getRecentPosts,
        getRecentPostsPage,
        getPostLinks,
        getPostLinksPage,
        listExperts,
        listTopics,
        getTopic,
        expandTopics,
        explainPostTopics,
        listPublications
      });
    })
  );
}
