import { Clock, Effect, Layer, Option, Schema, ServiceMap } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";
import type { DbError } from "../domain/errors";
import {
  EntitySearchDocument,
  EntitySearchEntityType as EntitySearchEntityTypeSchema,
  EntitySearchHit,
  EntitySearchQueryInput,
  SearchEntitiesInput,
  SearchEntitiesResult,
  SearchEntityHit,
  SearchAgentsInput,
  SearchDatasetsInput,
  SearchDistributionsInput,
  SearchLimit,
  SearchSeriesInput,
  SearchVariablesInput,
  type EntitySearchAliasProbe,
  type EntitySearchDocument as EntitySearchDocumentValue,
  type EntitySearchEntityType,
  type EntitySearchHit as EntitySearchHitValue,
  type EntitySearchIndexError,
  type EntitySearchQueryInput as EntitySearchQueryInputValue,
  type EntitySearchSemanticRecallInput as EntitySearchSemanticRecallInputValue,
  type EntitySearchSemanticRecallHit,
  type SearchEntitiesInput as SearchEntitiesInputValue,
  type SearchEntitiesRequestedEntityType,
  type SearchEntitiesResult as SearchEntitiesResultValue,
  type SearchEntitiesWarning as SearchEntitiesWarningValue,
  type SearchEntityEvidence as SearchEntityEvidenceValue,
  type SearchEntityHit as SearchEntityHitValue,
  type SearchEntityMatchReason
} from "../domain/entitySearch";
import { normalizeAliasLookupValue } from "../platform/Normalize";
import { stripUndefined } from "../platform/Json";
import { RequestMetrics } from "../platform/Observability";
import { DataLayerRegistry } from "./DataLayerRegistry";
import { EntitySearchRepo } from "./EntitySearchRepo";
import { EntitySemanticRecall } from "./EntitySemanticRecall";

const decodeSearchHit = Schema.decodeUnknownSync(EntitySearchHit);
const decodeSearchEntityHit = Schema.decodeUnknownSync(SearchEntityHit);
const decodeSearchEntitiesResult = Schema.decodeUnknownSync(SearchEntitiesResult);
const defaultSearchLimit = 20 as SearchLimit;
const reciprocalRankConstant = 60;
const searchEntitiesExactBand = 1_000;

const noopRequestMetrics = RequestMetrics.of({
  recordSearchEntities: () => Effect.void
});

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

const enabledEntityTypes = new Set<string>(EntitySearchEntityTypeSchema.literals);

const isEnabledEntityType = (
  entityType: SearchEntitiesRequestedEntityType
): entityType is EntitySearchEntityType =>
  enabledEntityTypes.has(entityType);

const splitEntityTypes = (
  entityTypes: ReadonlyArray<SearchEntitiesRequestedEntityType> | undefined
): {
  readonly enabled: ReadonlyArray<EntitySearchEntityType> | undefined;
  readonly warnings: ReadonlyArray<SearchEntitiesWarningValue> | undefined;
} => {
  if (entityTypes === undefined) {
    return { enabled: undefined, warnings: undefined };
  }

  const enabled: Array<EntitySearchEntityType> = [];
  const warnings: Array<SearchEntitiesWarningValue> = [];

  for (const entityType of [...new Set(entityTypes)]) {
    if (isEnabledEntityType(entityType)) {
      enabled.push(entityType);
    } else {
      warnings.push({ entityType, reason: "not-yet-enabled" });
    }
  }

  return {
    enabled,
    warnings: warnings.length === 0 ? undefined : warnings
  };
};

const hasEnabledSearchTypes = (
  enabled: ReadonlyArray<EntitySearchEntityType> | undefined
) =>
  enabled === undefined || enabled.length > 0;

const publicMatchReason = (
  matchKind: EntitySearchHitValue["matchKind"]
): SearchEntityMatchReason => {
  switch (matchKind) {
    case "lexical":
      return "keyword";
    case "exact-iri":
    case "exact-url":
    case "exact-hostname":
    case "exact-alias":
    case "semantic":
    case "hybrid":
      return matchKind;
  }
};

const boundedEvidenceText = (value: string) => {
  const trimmed = value.replace(/\s+/gu, " ").trim();
  return trimmed.length <= 240 ? trimmed : `${trimmed.slice(0, 237)}...`;
};

const makeEvidence = (
  kind: SearchEntityEvidenceValue["kind"],
  text: string,
  source?: SearchEntityEvidenceValue["source"]
): SearchEntityEvidenceValue => stripUndefined({
  kind,
  text: boundedEvidenceText(text),
  source
});

const primarySummary = (
  document: EntitySearchDocumentValue
): string | undefined =>
  document.secondaryLabel ?? document.semanticText.split(/\s+/u).slice(0, 24).join(" ");

const makeSearchEntityHit = (
  document: EntitySearchDocumentValue,
  rank: number,
  score: number,
  matchReason: SearchEntityMatchReason,
  evidence: ReadonlyArray<SearchEntityEvidenceValue>
): SearchEntityHitValue =>
  decodeSearchEntityHit(stripUndefined({
    entityType: document.entityType,
    iri: document.entityId,
    label: document.primaryLabel,
    summary: primarySummary(document),
    rank,
    score,
    matchReason,
    evidence: evidence.slice(0, 3)
  }));

const normalizedAliasKey = (alias: EntitySearchAliasProbe) =>
  `${alias.scheme}\0${normalizeAliasLookupValue(alias.scheme, alias.value)}`;

const documentMatchesAliasProbe = (
  document: EntitySearchDocumentValue,
  probeKeys: ReadonlySet<string>
) =>
  document.aliases.some((alias) =>
    probeKeys.has(
      `${alias.scheme}\0${normalizeAliasLookupValue(alias.scheme, alias.value)}`
    )
  );

const toSearchEntitiesQueryInput = (
  input: SearchEntitiesInputValue,
  enabled: ReadonlyArray<EntitySearchEntityType> | undefined
): EntitySearchQueryInputValue =>
  stripUndefined({
    query: input.query,
    entityTypes: enabled,
    scope: input.scope,
    exactCanonicalUrls: input.probes?.urls,
    exactHostnames: input.probes?.hostnames,
    limit: input.limit
  });

export class EntitySearchService extends ServiceMap.Service<
  EntitySearchService,
  {
    readonly search: (
      input: EntitySearchQueryInputValue
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchEntities: (
      input: SearchEntitiesInputValue
    ) => Effect.Effect<
      SearchEntitiesResultValue,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchAgents: (
      input: SearchAgentsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchDatasets: (
      input: SearchDatasetsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchDistributions: (
      input: SearchDistributionsInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchSeries: (
      input: SearchSeriesInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
    readonly searchVariables: (
      input: SearchVariablesInput
    ) => Effect.Effect<
      ReadonlyArray<EntitySearchHitValue>,
      SqlError | DbError | EntitySearchIndexError
    >;
  }
>()("@skygest/EntitySearchService") {
  static readonly layer = Layer.effect(
    EntitySearchService,
    Effect.gen(function* () {
      const registry = yield* DataLayerRegistry;
      const repo = yield* EntitySearchRepo;
      const semanticRecall = yield* EntitySemanticRecall;
      const metricsOption = yield* Effect.serviceOption(RequestMetrics);
      const metrics = Option.getOrElse(metricsOption, () => noopRequestMetrics);

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

          const semanticDocuments = yield* repo.getManyByEntityId(
            semanticHits.map((semantic) => semantic.entityId)
          );
          const semanticDocumentById = new Map(
            semanticDocuments.map((document) => [document.entityId, document])
          );

          for (const [index, semantic] of semanticHits.entries()) {
            const document = semanticDocumentById.get(semantic.entityId);
            if (document === undefined) {
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

      const searchEntities = Effect.fn("EntitySearchService.searchEntities")(
        function* (input: SearchEntitiesInputValue) {
          const startedAt = yield* Clock.currentTimeMillis;
          const limit = clampSearchLimit(input.limit);
          const { enabled, warnings } = splitEntityTypes(input.entityTypes);
          const failClosedTotal = warnings?.length ?? 0;

          if (!hasEnabledSearchTypes(enabled)) {
            const completedAt = yield* Clock.currentTimeMillis;
            yield* metrics.recordSearchEntities({
              durationMs: completedAt - startedAt,
              aiSearchLatencyMs: 0,
              hydrationLatencyMs: 0,
              exactProbeHitCounts: {
                iri: 0,
                url: 0,
                hostname: 0,
                alias: 0
              },
              hydrationMissTotal: 0,
              failClosedTotal,
              hitCount: 0,
              status: "ok"
            });
            return decodeSearchEntitiesResult(stripUndefined({
              hits: [],
              warnings
            }));
          }

          const candidates = new Map<
            string,
            {
              readonly document: EntitySearchDocumentValue;
              score: number;
              readonly matchReasons: Set<SearchEntityMatchReason>;
              readonly evidence: Array<SearchEntityEvidenceValue>;
            }
          >();

          const addCandidate = (
            document: EntitySearchDocumentValue,
            score: number,
            matchReason: SearchEntityMatchReason,
            evidence: SearchEntityEvidenceValue
          ) => {
            const current = candidates.get(document.entityId);
            if (current === undefined) {
              candidates.set(document.entityId, {
                document,
                score,
                matchReasons: new Set([matchReason]),
                evidence: [evidence]
              });
              return;
            }

            current.score = Math.max(current.score, score);
            current.matchReasons.add(matchReason);
            if (current.evidence.length < 3) {
              current.evidence.push(evidence);
            }
          };

          const exactIris = [...new Set(input.probes?.iris ?? [])];
          const hydrationStartedAt = yield* Clock.currentTimeMillis;
          const exactIriDocs = yield* repo.getManyByEntityId(exactIris);
          const hydrationCompletedAt = yield* Clock.currentTimeMillis;
          const exactIriDocIds = new Set(
            exactIriDocs.map((document) => document.entityId)
          );
          const hydrationMissTotal = exactIris.filter(
            (iri) => !exactIriDocIds.has(iri)
          ).length;

          for (const document of exactIriDocs) {
            if (enabled !== undefined && !enabled.includes(document.entityType)) {
              continue;
            }
            addCandidate(
              document,
              searchEntitiesExactBand + 400,
              "exact-iri",
              makeEvidence("iri", document.entityId, document.entityId)
            );
          }

          const recallStartedAt = yield* Clock.currentTimeMillis;
          const recallHits = yield* search(toSearchEntitiesQueryInput(input, enabled));
          const recallCompletedAt = yield* Clock.currentTimeMillis;

          for (const hit of recallHits) {
            addCandidate(
              hit.document,
              hit.matchKind.startsWith("exact-")
                ? searchEntitiesExactBand + hit.score
                : hit.score,
              publicMatchReason(hit.matchKind),
              makeEvidence(
                hit.matchKind === "exact-url"
                  ? "url"
                  : hit.matchKind === "exact-hostname"
                    ? "hostname"
                    : hit.matchKind === "semantic"
                      ? "semantic-chunk"
                      : "snippet",
                hit.snippet ?? hit.document.primaryLabel,
                hit.document.entityId
              )
            );
          }

          const aliases = input.probes?.aliases ?? [];
          if (aliases.length > 0) {
            const aliasProbeKeys = new Set(aliases.map(normalizedAliasKey));
            const aliasQuery = joinQueryTerms(aliases.map((alias) => alias.value));
            if (aliasQuery !== undefined) {
              const aliasHits = yield* repo.searchLexical(stripUndefined({
                query: aliasQuery,
                entityTypes: enabled,
                scope: input.scope,
                limit
              }));

              for (const hit of aliasHits) {
                if (!documentMatchesAliasProbe(hit.document, aliasProbeKeys)) {
                  continue;
                }
                addCandidate(
                  hit.document,
                  searchEntitiesExactBand + 50,
                  "exact-alias",
                  makeEvidence("alias", hit.snippet ?? aliasQuery, hit.document.entityId)
                );
              }
            }
          }

          const orderedHits = [...candidates.values()]
            .map((candidate) => {
              const matchReason: SearchEntityMatchReason = candidate.matchReasons.has("exact-iri")
                ? "exact-iri"
                : candidate.matchReasons.has("exact-url")
                  ? "exact-url"
                  : candidate.matchReasons.has("exact-hostname")
                    ? "exact-hostname"
                    : candidate.matchReasons.has("exact-alias")
                      ? "exact-alias"
                      : candidate.matchReasons.has("hybrid")
                        ? "hybrid"
                        : candidate.matchReasons.has("semantic")
                          ? "semantic"
                          : "keyword";
              return {
                ...candidate,
                matchReason
              };
            })
            .sort((left, right) =>
              right.score === left.score
                ? left.document.entityId.localeCompare(right.document.entityId)
                : right.score - left.score
            )
            .slice(0, limit)
            .map((candidate, index) =>
              makeSearchEntityHit(
                candidate.document,
                index + 1,
                candidate.score,
                candidate.matchReason,
                candidate.evidence
              )
            );

          const exactProbeHitCounts = {
            iri: orderedHits.filter((hit) => hit.matchReason === "exact-iri").length,
            url: orderedHits.filter((hit) => hit.matchReason === "exact-url").length,
            hostname: orderedHits.filter((hit) => hit.matchReason === "exact-hostname").length,
            alias: orderedHits.filter((hit) => hit.matchReason === "exact-alias").length
          };
          const completedAt = yield* Clock.currentTimeMillis;

          yield* metrics.recordSearchEntities({
            durationMs: completedAt - startedAt,
            aiSearchLatencyMs: recallCompletedAt - recallStartedAt,
            hydrationLatencyMs: hydrationCompletedAt - hydrationStartedAt,
            exactProbeHitCounts,
            hydrationMissTotal,
            failClosedTotal,
            hitCount: orderedHits.length,
            status: "ok"
          });

          return decodeSearchEntitiesResult(stripUndefined({
            hits: orderedHits,
            warnings
          }));
        }
      );

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

      return EntitySearchService.of({
        search,
        searchEntities,
        searchAgents,
        searchDatasets,
        searchDistributions,
        searchSeries,
        searchVariables
      });
    })
  );
}
