import {
  OntologySearchIndex,
  type AiSearchError,
  type OntologySearchResult,
  type OntologySearchResultDecodeError
} from "@skygest/ontology-store";
import { Clock, Duration, Effect, Layer, Result, Schema, ServiceMap } from "effect";
import {
  OntologyEntityIri,
  OntologyEntityType,
  type SearchEntitiesInput,
  type SearchEntitiesResult,
  type SearchEntityHit as SearchEntityHitValue
} from "../domain/entitySearch";
import {
  RequestMetrics,
  type SearchEntitiesMetricInput
} from "../platform/Observability";
import {
  OntologyEntityHydrator,
  type HydrateOntologyEntityResult
} from "./OntologyEntityHydrator";

const DEFAULT_SEARCH_LIMIT = 20;

type HydrationCandidate = {
  readonly hit: OntologySearchResult;
  readonly entityType: OntologyEntityType;
  readonly iri: OntologyEntityIri;
};

const errorType = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "_tag" in error &&
  typeof (error as { readonly _tag?: unknown })._tag === "string"
    ? (error as { readonly _tag: string })._tag
    : "unknown";

const dedupeByIri = (
  hits: ReadonlyArray<OntologySearchResult>
): ReadonlyArray<OntologySearchResult> => {
  const seen = new Set<string>();
  const deduped: Array<OntologySearchResult> = [];
  for (const hit of hits) {
    if (seen.has(hit.iri)) continue;
    seen.add(hit.iri);
    deduped.push(hit);
  }
  return deduped;
};

const successfulHits = (
  results: ReadonlyArray<HydrateOntologyEntityResult>
): ReadonlyArray<SearchEntityHitValue> =>
  results.flatMap((result) => (result._tag === "Hit" ? [result.hit] : []));

const decodeEntityType = Schema.decodeUnknownResult(OntologyEntityType);
const decodeIri = Schema.decodeUnknownResult(OntologyEntityIri);

const toHydrationCandidate = (
  hit: OntologySearchResult
): HydrationCandidate | null => {
  const entityType = decodeEntityType(hit.entityType);
  const iri = decodeIri(hit.iri);
  return Result.isSuccess(entityType) && Result.isSuccess(iri)
    ? {
        hit,
        entityType: entityType.success,
        iri: iri.success
      }
    : null;
};

const metricBase = (
  durationMs: number,
  status: SearchEntitiesMetricInput["status"]
): SearchEntitiesMetricInput => ({
  durationMs,
  aiSearchLatencyMs: 0,
  hydrationLatencyMs: 0,
  exactIriHitCount: 0,
  hydrationMissTotal: 0,
  droppedAiHitTotal: 0,
  hitCount: 0,
  status
});

export class SearchEntitiesService extends ServiceMap.Service<
  SearchEntitiesService,
  {
    readonly searchEntities: (
      input: SearchEntitiesInput
    ) => Effect.Effect<
      SearchEntitiesResult,
      AiSearchError | OntologySearchResultDecodeError
    >;
  }
>()("@skygest/SearchEntitiesService") {
  static readonly noopLayer = Layer.succeed(
    SearchEntitiesService,
    SearchEntitiesService.of({
      searchEntities: () => Effect.succeed({ hits: [] })
    })
  );

  static readonly layer = Layer.effect(
    SearchEntitiesService,
    Effect.gen(function* () {
      const index = yield* OntologySearchIndex;
      const hydrator = yield* OntologyEntityHydrator;
      const metrics = yield* RequestMetrics;

      const recordMetric = (input: SearchEntitiesMetricInput) =>
        metrics.recordSearchEntities(input).pipe(Effect.ignore);

      const recordError = (startedAt: number, error: unknown) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* recordMetric({
            ...metricBase(now - startedAt, "error"),
            errorType: errorType(error)
          });
        });

      const searchExactIri = (
        iri: OntologyEntityIri,
        entityTypes: SearchEntitiesInput["entityTypes"],
        startedAt: number
      ) =>
        Effect.gen(function* () {
          const [hydrationDuration, hydrated] = yield* Effect.timed(
            hydrator.hydrate(
              entityTypes === undefined
                ? {
                    iri,
                    rank: 1,
                    score: 1,
                    matchReason: "exact-iri"
                  }
                : {
                    iri,
                    rank: 1,
                    score: 1,
                    matchReason: "exact-iri",
                    candidateEntityTypes: entityTypes
                  }
            )
          );
          const hits = successfulHits([hydrated]);
          const finishedAt = yield* Clock.currentTimeMillis;
          yield* recordMetric({
            ...metricBase(finishedAt - startedAt, "ok"),
            hydrationLatencyMs: Duration.toMillis(hydrationDuration),
            exactIriHitCount: hits.length,
            hydrationMissTotal: hydrated._tag === "Miss" ? 1 : 0,
            hitCount: hits.length
          });
          return { hits };
        });

      const searchQuery = (input: SearchEntitiesInput, startedAt: number) =>
        Effect.gen(function* () {
          const limit = input.limit ?? DEFAULT_SEARCH_LIMIT;
          const [aiSearchDuration, indexHits] = yield* Effect.timed(
            index.search(
              input.entityTypes === undefined
                ? {
                    query: String(input.query),
                    maxResults: limit,
                    retrievalType: "hybrid"
                  }
                : {
                    query: String(input.query),
                    maxResults: limit,
                    retrievalType: "hybrid",
                    filters: {
                      entity_type: input.entityTypes.map((entityType) =>
                        String(entityType)
                      )
                    }
                  }
            )
          );
          const deduped = dedupeByIri(indexHits);
          const candidates = deduped.flatMap((hit) => {
            const candidate = toHydrationCandidate(hit);
            return candidate === null ? [] : [candidate];
          });

          const [hydrationDuration, hydrated] = yield* Effect.timed(
            Effect.forEach(
              candidates,
              (candidate, index) =>
                hydrator.hydrate({
                  entityType: candidate.entityType,
                  iri: candidate.iri,
                  rank: index + 1,
                  score: candidate.hit.score,
                  matchReason: "match",
                  evidenceText: candidate.hit.text
                }),
              { concurrency: 8 }
            )
          );
          const hits = successfulHits(hydrated);
          const hydrationMissTotal = hydrated.length - hits.length;
          const finishedAt = yield* Clock.currentTimeMillis;
          yield* recordMetric({
            ...metricBase(finishedAt - startedAt, "ok"),
            aiSearchLatencyMs: Duration.toMillis(aiSearchDuration),
            hydrationLatencyMs: Duration.toMillis(hydrationDuration),
            hydrationMissTotal,
            droppedAiHitTotal: indexHits.length - hits.length,
            hitCount: hits.length
          });
          return { hits };
        });

      const searchEntities = (input: SearchEntitiesInput) =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;
          const effect =
            input.iri === undefined
              ? searchQuery(input, startedAt)
              : searchExactIri(input.iri, input.entityTypes, startedAt);
          return yield* effect.pipe(
            Effect.tapError((error) => recordError(startedAt, error))
          );
        });

      return SearchEntitiesService.of({ searchEntities });
    })
  );
}
