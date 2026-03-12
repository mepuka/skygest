import { Context, Effect, Layer } from "effect";
import type { SqlError } from "@effect/sql/SqlError";
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
    ) => Effect.Effect<ExplainPostTopicsOutput, SqlError>;
  }
>() {
  static readonly layer = Layer.effect(
    KnowledgeQueryService,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const expertsRepo = yield* ExpertsRepo;
      const knowledgeRepo = yield* KnowledgeRepo;
      const ontology = yield* OntologyCatalog;

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
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      });

      const getRecentPosts = Effect.fn("KnowledgeQueryService.getRecentPosts")(function* (input: GetRecentPostsInput) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        return yield* knowledgeRepo.getRecentPosts({
          expertDid: input.expertDid,
          since: input.since,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
      });

      const getPostLinks = Effect.fn("KnowledgeQueryService.getPostLinks")(function* (input: GetPostLinksInput) {
        const topicSlugs = yield* resolveTopicSlugs(input.topic);
        return yield* knowledgeRepo.getPostLinks({
          domain: input.domain,
          since: input.since,
          limit: clampLimit(input.limit, config.mcpLimitDefault, config.mcpLimitMax),
          ...(topicSlugs === undefined ? {} : { topicSlugs })
        });
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

      return KnowledgeQueryService.of({
        searchPosts,
        getRecentPosts,
        getPostLinks,
        listExperts,
        listTopics,
        getTopic,
        expandTopics,
        explainPostTopics
      });
    })
  );
}
