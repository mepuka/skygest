import { describe, expect, it } from "@effect/vitest";
import {
  OntologySearchIndex,
  type OntologySearchInput,
  type OntologySearchResult
} from "@skygest/ontology-store";
import { Effect, Layer, Schema } from "effect";
import {
  OntologyEntityIri,
  OntologyEntityType,
  SearchEntitiesInput,
  SearchEntityHit,
  type SearchEntityHit as SearchEntityHitValue
} from "../src/domain/entitySearch";
import {
  OntologyEntityHydrator,
  type HydrateOntologyEntityInput,
  type HydrateOntologyEntityResult
} from "../src/services/OntologyEntityHydrator";
import { SearchEntitiesService } from "../src/services/SearchEntitiesService";
import {
  RequestMetrics,
  type SearchEntitiesMetricInput
} from "../src/platform/Observability";

const decodeInput = Schema.decodeUnknownSync(SearchEntitiesInput);
const decodeEntityType = Schema.decodeUnknownSync(OntologyEntityType);
const decodeIri = Schema.decodeUnknownSync(OntologyEntityIri);
const decodeHit = Schema.decodeUnknownSync(SearchEntityHit);

const expertType = decodeEntityType("Expert");
const expertIri = decodeIri("skygest:expert:solar-desk");
const topicType = decodeEntityType("EnergyTopic");
const topicIri = decodeIri("skygest:topic:solar");

type TestState = {
  readonly searches: Array<OntologySearchInput>;
  readonly hydrations: Array<HydrateOntologyEntityInput>;
  readonly metrics: Array<SearchEntitiesMetricInput>;
  searchResults: ReadonlyArray<OntologySearchResult>;
  readonly hydratedHits: Map<string, SearchEntityHitValue>;
};

const metadataFor = (entityType: string, iri: string) => ({
  entity_type: entityType,
  iri,
  topic: "energy",
  authority: "skygest",
  time_bucket: "all"
});

const searchResult = (
  entityType: string,
  iri: string,
  score: number,
  text: string,
  key = `${entityType}:${iri}`
): OntologySearchResult => ({
  entityType,
  iri,
  key,
  score,
  text,
  metadata: metadataFor(entityType, iri)
});

const hit = (
  entityType: typeof expertType | typeof topicType,
  iri: typeof expertIri | typeof topicIri,
  label: string,
  rank: number,
  matchReason: "exact-iri" | "match",
  score = 1
): SearchEntityHitValue =>
  decodeHit({
    entityType,
    iri,
    label,
    summary: `${label} summary`,
    rank,
    score,
    matchReason,
    evidence: [
      {
        kind: matchReason === "exact-iri" ? "iri" : "chunk",
        text: `${label} evidence`,
        source: iri
      }
    ]
  });

const hydrationKey = (entityType: string | undefined, iri: string) =>
  `${entityType ?? ""}|${iri}`;

const makeState = (): TestState => ({
  searches: [],
  hydrations: [],
  metrics: [],
  searchResults: [],
  hydratedHits: new Map()
});

const makeLayer = (state: TestState) => {
  const indexLayer = Layer.succeed(
    OntologySearchIndex,
    OntologySearchIndex.of({
      search: (input) =>
        Effect.sync(() => {
          state.searches.push(input);
          return state.searchResults;
        })
    })
  );
  const hydratorLayer = Layer.succeed(
    OntologyEntityHydrator,
    OntologyEntityHydrator.of({
      hydrate: (input) =>
        Effect.sync((): HydrateOntologyEntityResult => {
          state.hydrations.push(input);
          const hydrated =
            state.hydratedHits.get(hydrationKey(input.entityType, input.iri)) ??
            state.hydratedHits.get(hydrationKey(undefined, input.iri));
          return hydrated === undefined
            ? {
                _tag: "Miss",
                iri: input.iri,
                reason: "not-found",
                ...(input.entityType === undefined
                  ? {}
                  : { entityType: input.entityType })
              }
            : {
                _tag: "Hit",
                hit: hydrated
              };
        })
    })
  );
  const metricsLayer = Layer.succeed(
    RequestMetrics,
    RequestMetrics.of({
      recordSearchEntities: (input) =>
        Effect.sync(() => {
          state.metrics.push(input);
        })
    })
  );

  return SearchEntitiesService.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(indexLayer, hydratorLayer, metricsLayer))
  );
};

describe("SearchEntitiesService", () => {
  it.effect("hydrates exact IRI directly without calling AI Search", () => {
    const state = makeState();
    return Effect.gen(function* () {
      state.hydratedHits.set(
        hydrationKey(undefined, String(expertIri)),
        hit(expertType, expertIri, "Solar Desk", 1, "exact-iri")
      );
      const service = yield* SearchEntitiesService;

      const result = yield* service.searchEntities(
        decodeInput({
          iri: expertIri,
          limit: 1
        })
      );

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.iri).toBe(expertIri);
      expect(result.hits[0]?.matchReason).toBe("exact-iri");
      expect(state.searches).toEqual([]);
      expect(state.hydrations).toHaveLength(1);
      expect(state.metrics[0]?.exactIriHitCount).toBe(1);
    }).pipe(Effect.provide(makeLayer(state)));
  });

  it.effect("passes query filters to Cloudflare AI Search and dedupes chunks", () => {
    const state = makeState();
    return Effect.gen(function* () {
      state.searchResults = [
        searchResult("Expert", String(expertIri), 0.93, "solar expert"),
        searchResult("Expert", String(expertIri), 0.89, "duplicate chunk")
      ];
      state.hydratedHits.set(
        hydrationKey("Expert", String(expertIri)),
        hit(expertType, expertIri, "Solar Desk", 1, "match", 0.93)
      );
      const service = yield* SearchEntitiesService;

      const result = yield* service.searchEntities(
        decodeInput({
          query: "solar expert",
          entityTypes: ["Expert"],
          limit: 5
        })
      );

      expect(state.searches).toEqual([
        {
          query: "solar expert",
          maxResults: 5,
          retrievalType: "hybrid",
          filters: {
            entity_type: ["Expert"]
          }
        }
      ]);
      expect(state.hydrations).toHaveLength(1);
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.rank).toBe(1);
      expect(result.hits[0]?.matchReason).toBe("match");
      expect(state.metrics[0]?.droppedAiHitTotal).toBe(1);
    }).pipe(Effect.provide(makeLayer(state)));
  });

  it.effect("omits hydration misses and records dropped AI hits", () => {
    const state = makeState();
    return Effect.gen(function* () {
      state.searchResults = [
        searchResult("EnergyTopic", String(topicIri), 0.8, "solar topic"),
        searchResult("Expert", String(expertIri), 0.7, "missing expert")
      ];
      state.hydratedHits.set(
        hydrationKey("EnergyTopic", String(topicIri)),
        hit(topicType, topicIri, "Solar", 1, "match", 0.8)
      );
      const service = yield* SearchEntitiesService;

      const result = yield* service.searchEntities(
        decodeInput({
          query: "solar",
          limit: 10
        })
      );

      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.iri).toBe(topicIri);
      expect(result.hits[0]?.rank).toBe(1);
      expect(state.metrics[0]?.hydrationMissTotal).toBe(1);
      expect(state.metrics[0]?.droppedAiHitTotal).toBe(1);
    }).pipe(Effect.provide(makeLayer(state)));
  });
});
