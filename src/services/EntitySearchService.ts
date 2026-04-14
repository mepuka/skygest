import { Effect, Layer, Schema, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  EntitySearchBundleCandidates,
  EntitySearchHit,
  EntitySearchQueryInput,
  SearchAgentsInput,
  SearchDatasetsInput,
  SearchDistributionsInput,
  SearchLimit,
  SearchSeriesInput,
  SearchVariablesInput,
  type EntitySearchBundleCandidates as EntitySearchBundleCandidatesValue,
  type EntitySearchEntityType,
  type EntitySearchHit as EntitySearchHitValue,
  type EntitySearchQueryInput as EntitySearchQueryInputValue,
  type EntitySearchSemanticRecallInput as EntitySearchSemanticRecallInputValue,
  type EntitySearchSemanticRecallHit
} from "../domain/entitySearch";
import type {
  Stage1Input,
  Stage1Result
} from "../domain/stage1Resolution";
import { stripUndefined } from "../platform/Json";
import { buildEntitySearchBundlePlan } from "../search/buildEntitySearchBundlePlan";
import { DataLayerRegistry } from "./DataLayerRegistry";
import { EntitySearchRepo } from "./EntitySearchRepo";
import { EntitySemanticRecall } from "./EntitySemanticRecall";

type SearchBundleCandidatesInput = {
  readonly stage1Input: Stage1Input;
  readonly stage1?: Stage1Result;
  readonly limit?: SearchLimit;
};

const decodeBundleCandidates = Schema.decodeUnknownSync(EntitySearchBundleCandidates);
const decodeSearchHit = Schema.decodeUnknownSync(EntitySearchHit);
const defaultSearchLimit = 20 as SearchLimit;
const reciprocalRankConstant = 60;
const maxBundleTextQueries = 4;

const clampSearchLimit = (value: SearchLimit | undefined): SearchLimit =>
  value === undefined ? defaultSearchLimit : value;

const joinQueryTerms = (values: ReadonlyArray<string>): string | undefined => {
  const joined = values.join(" ").trim();
  return joined.length === 0 ? undefined : joined;
};

const buildTypedInput = (
  entityType: EntitySearchEntityType,
  input: EntitySearchQueryInputValue
): EntitySearchQueryInputValue =>
  stripUndefined({
    ...input,
    entityTypes: [entityType]
  });

const reciprocalRank = (rank: number) =>
  1 / (reciprocalRankConstant + rank);

const selectBundleQueries = (
  values: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const queries: Array<string> = [];

  for (const raw of values) {
    const query = raw.trim();
    if (query.length === 0) {
      continue;
    }

    const key = query.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    queries.push(query);

    if (queries.length >= maxBundleTextQueries) {
      break;
    }
  }

  return queries;
};

const mergeMatchKinds = (
  values: ReadonlySet<EntitySearchHitValue["matchKind"]>
): EntitySearchHitValue["matchKind"] => {
  if (values.has("exact-url")) {
    return "exact-url";
  }
  if (values.has("exact-hostname")) {
    return "exact-hostname";
  }
  if (values.has("hybrid")) {
    return "hybrid";
  }
  if (values.has("lexical")) {
    return "lexical";
  }
  return "semantic";
};

export class EntitySearchService extends ServiceMap.Service<
  EntitySearchService,
  {
    readonly search: (
      input: EntitySearchQueryInputValue
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchAgents: (
      input: SearchAgentsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchDatasets: (
      input: SearchDatasetsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchDistributions: (
      input: SearchDistributionsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchSeries: (
      input: SearchSeriesInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchVariables: (
      input: SearchVariablesInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError
    >;
    readonly searchBundleCandidates: (
      input: SearchBundleCandidatesInput
    ) => Effect.Effect<
      EntitySearchBundleCandidatesValue,
      SqlError | DbError
    >;
  }
>()("@skygest/EntitySearchService") {
  static readonly layer = Layer.effect(
    EntitySearchService,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;
      const repo = yield* EntitySearchRepo;
      const semanticRecall = yield* EntitySemanticRecall;

      const mergeHybridHits = (
        lexicalHits: ReadonlyArray<EntitySearchHitValue>,
        semanticHits: ReadonlyArray<EntitySearchSemanticRecallHit>,
        limit: SearchLimit
      ) =>
        Effect.gen(function* () {
          if (semanticHits.length === 0) {
            return lexicalHits.slice(0, limit);
          }

          const merged = new Map<
            string,
            {
              readonly document: EntitySearchHitValue["document"];
              lexical?: EntitySearchHitValue;
              semantic?: {
                readonly hit: EntitySearchSemanticRecallHit;
                readonly rank: number;
              };
            }
          >();

          for (const lexical of lexicalHits) {
            merged.set(lexical.document.entityId, {
              document: lexical.document,
              lexical
            });
          }

          for (const [index, semantic] of semanticHits.entries()) {
            const document = yield* repo.getByEntityId(semantic.entityId);
            if (document === null) {
              continue;
            }

            const current = merged.get(document.entityId);
            merged.set(document.entityId, {
              document,
              ...(current?.lexical === undefined
                ? {}
                : { lexical: current.lexical }),
              semantic: {
                hit: semantic,
                rank: index + 1
              }
            });
          }

          return [...merged.values()]
            .map((candidate) => {
              const lexical = candidate.lexical;
              const semantic = candidate.semantic;
              const score =
                (lexical === undefined ? 0 : reciprocalRank(lexical.rank)) +
                (semantic === undefined ? 0 : reciprocalRank(semantic.rank));

              const matchKind =
                lexical !== undefined && semantic !== undefined
                  ? "hybrid"
                  : lexical?.matchKind ?? "semantic";

              return decodeSearchHit({
                document: candidate.document,
                score,
                rank: 1,
                matchKind,
                snippet: lexical?.snippet ?? null
              });
            })
            .sort((left, right) =>
              right.score === left.score
                ? left.document.entityId.localeCompare(right.document.entityId)
                : right.score - left.score
            )
            .slice(0, limit)
            .map((hit, index) =>
              decodeSearchHit({
                ...hit,
                rank: index + 1
              })
            );
        });

      const search = Effect.fn("EntitySearchService.search")(function* (
        input: EntitySearchQueryInputValue
      ) {
        const limit = clampSearchLimit(input.limit);
        const lexicalHits = yield* repo.searchLexical({
          ...input,
          limit
        });
        const semanticInput =
          input.query === undefined
            ? null
            : ({
                text: input.query,
                ...(input.entityTypes === undefined
                  ? {}
                  : { entityTypes: input.entityTypes }),
                ...(input.scope === undefined ? {} : { scope: input.scope }),
                limit
              } satisfies EntitySearchSemanticRecallInputValue);

        if (semanticInput === null) {
          return lexicalHits.slice(0, limit);
        }

        const semanticHits = yield* semanticRecall.recall(semanticInput);
        return yield* mergeHybridHits(lexicalHits, semanticHits, limit);
      });

      const searchAgents = Effect.fn("EntitySearchService.searchAgents")(
        function* (input: SearchAgentsInput) {
          return yield* search(buildTypedInput("Agent", input));
        }
      );

      const searchDatasets = Effect.fn("EntitySearchService.searchDatasets")(
        function* (input: SearchDatasetsInput) {
          return yield* search(buildTypedInput("Dataset", input));
        }
      );

      const searchDistributions = Effect.fn(
        "EntitySearchService.searchDistributions"
      )(function* (input: SearchDistributionsInput) {
        return yield* search(buildTypedInput("Distribution", input));
      });

      const searchSeries = Effect.fn("EntitySearchService.searchSeries")(
        function* (input: SearchSeriesInput) {
          return yield* search(buildTypedInput("Series", input));
        }
      );

      const searchVariables = Effect.fn("EntitySearchService.searchVariables")(
        function* (input: SearchVariablesInput) {
          return yield* search(buildTypedInput("Variable", input));
        }
      );

      const searchBundleGroup = Effect.fn(
        "EntitySearchService.searchBundleGroup"
      )(function* (input: {
        readonly entityType: EntitySearchEntityType;
        readonly texts: ReadonlyArray<string>;
        readonly limit: SearchLimit;
        readonly scope?: EntitySearchQueryInputValue["scope"];
        readonly exactCanonicalUrls?: ReadonlyArray<string>;
        readonly exactHostnames?: ReadonlyArray<string>;
      }) {
        const variants: Array<EntitySearchQueryInputValue> = [];
        const queries = selectBundleQueries(input.texts);
        const hasExactSignals =
          (input.exactCanonicalUrls?.length ?? 0) > 0 ||
          (input.exactHostnames?.length ?? 0) > 0;

        if (hasExactSignals) {
          variants.push(
            buildTypedInput(
              input.entityType,
              stripUndefined({
                exactCanonicalUrls: input.exactCanonicalUrls,
                exactHostnames: input.exactHostnames,
                ...(input.scope === undefined ? {} : { scope: input.scope }),
                limit: input.limit
              })
            )
          );
        }

        for (const query of queries) {
          variants.push(
            buildTypedInput(
              input.entityType,
              stripUndefined({
                query,
                ...(input.scope === undefined ? {} : { scope: input.scope }),
                limit: input.limit
              })
            )
          );
        }

        if (variants.length === 0) {
          return [] as ReadonlyArray<EntitySearchHitValue>;
        }

        const rankedLists = yield* Effect.all(
          variants.map((variant) => search(variant)),
          { concurrency: "unbounded" }
        );

        const merged = new Map<
          string,
          {
            readonly document: EntitySearchHitValue["document"];
            score: number;
            snippet: string | null;
            readonly matchKinds: Set<EntitySearchHitValue["matchKind"]>;
          }
        >();

        for (const hits of rankedLists) {
          for (const hit of hits) {
            const current = merged.get(hit.document.entityId);
            if (current === undefined) {
              merged.set(hit.document.entityId, {
                document: hit.document,
                score: hit.score,
                snippet: hit.snippet,
                matchKinds: new Set([hit.matchKind])
              });
              continue;
            }

            current.score += hit.score;
            current.snippet = current.snippet ?? hit.snippet;
            current.matchKinds.add(hit.matchKind);
          }
        }

        return [...merged.values()]
          .map((candidate) =>
            decodeSearchHit({
              document: candidate.document,
              score: candidate.score,
              rank: 1,
              matchKind: mergeMatchKinds(candidate.matchKinds),
              snippet: candidate.snippet
            })
          )
          .sort((left, right) =>
            right.score === left.score
              ? left.document.entityId.localeCompare(right.document.entityId)
              : right.score - left.score
          )
          .slice(0, input.limit)
          .map((hit, index) =>
            decodeSearchHit({
              ...hit,
              rank: index + 1
            })
          );
      });

      const searchBundleCandidates = Effect.fn(
        "EntitySearchService.searchBundleCandidates"
      )(function* (input: SearchBundleCandidatesInput) {
        const limit = clampSearchLimit(input.limit);
        const plan = buildEntitySearchBundlePlan(
          input.stage1Input,
          registry.lookup,
          input.stage1
        );

        const commonScope = stripUndefined({
          ...(plan.publisherAgentId === undefined
            ? {}
            : { publisherAgentId: plan.publisherAgentId }),
          ...(plan.datasetId === undefined ? {} : { datasetId: plan.datasetId }),
          ...(plan.variableId === undefined
            ? {}
            : { variableId: plan.variableId })
        });

        const [agents, datasets, distributions, series, variables] = yield* Effect.all(
          [
            searchBundleGroup({
              entityType: "Agent",
              texts: plan.agentText,
              exactCanonicalUrls: plan.exactCanonicalUrls,
              exactHostnames: plan.exactHostnames,
              limit
            }),
            searchBundleGroup({
              entityType: "Dataset",
              texts: plan.datasetText,
              exactCanonicalUrls: plan.exactCanonicalUrls,
              exactHostnames: plan.exactHostnames,
              scope:
                commonScope.publisherAgentId === undefined
                  ? undefined
                  : { publisherAgentId: commonScope.publisherAgentId },
              limit
            }),
            searchBundleGroup({
              entityType: "Distribution",
              texts: plan.distributionText,
              exactCanonicalUrls: plan.exactCanonicalUrls,
              exactHostnames: plan.exactHostnames,
              scope: stripUndefined({
                ...(commonScope.publisherAgentId === undefined
                  ? {}
                  : { publisherAgentId: commonScope.publisherAgentId }),
                ...(commonScope.datasetId === undefined
                  ? {}
                  : { datasetId: commonScope.datasetId })
              }),
              limit
            }),
            searchBundleGroup({
              entityType: "Series",
              texts: plan.seriesText,
              scope: commonScope,
              limit
            }),
            searchBundleGroup({
              entityType: "Variable",
              texts: plan.variableText,
              scope: stripUndefined({
                ...(commonScope.publisherAgentId === undefined
                  ? {}
                  : { publisherAgentId: commonScope.publisherAgentId }),
                ...(commonScope.datasetId === undefined
                  ? {}
                  : { datasetId: commonScope.datasetId })
              }),
              limit
            })
          ],
          { concurrency: "unbounded" }
        );

        return decodeBundleCandidates({
          plan,
          agents,
          datasets,
          distributions,
          series,
          variables
        });
      });

      return EntitySearchService.of({
        search,
        searchAgents,
        searchDatasets,
        searchDistributions,
        searchSeries,
        searchVariables,
        searchBundleCandidates
      });
    })
  );
}
