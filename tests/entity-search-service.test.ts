import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema } from "effect";
import {
  Agent,
  Dataset,
  Distribution,
  Series,
  Variable,
  type DataLayerRegistrySeed,
  mintAgentId,
  mintDatasetId,
  mintDistributionId,
  mintSeriesId,
  mintVariableId
} from "../src/domain/data-layer";
import type { EntitySearchSemanticRecallHit } from "../src/domain/entitySearch";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import { DataLayerRegistry } from "../src/services/DataLayerRegistry";
import { runEntitySearchMigrations } from "../src/search/migrate";
import { entitySearchSqlLayer } from "../src/search/Layer";
import { projectEntitySearchDocs } from "../src/search/projectEntitySearchDocs";
import { EntitySearchRepo } from "../src/services/EntitySearchRepo";
import { EntitySearchService } from "../src/services/EntitySearchService";
import { EntitySemanticRecall } from "../src/services/EntitySemanticRecall";
import { EntitySearchRepoD1 } from "../src/services/d1/EntitySearchRepoD1";
import { makeSqliteLayer } from "./support/runtime";

const decodeAgent = Schema.decodeUnknownSync(Agent);
const decodeDataset = Schema.decodeUnknownSync(Dataset);
const decodeDistribution = Schema.decodeUnknownSync(Distribution);
const decodeSeries = Schema.decodeUnknownSync(Series);
const decodeVariable = Schema.decodeUnknownSync(Variable);

const agentId = mintAgentId();
const datasetId = mintDatasetId();
const distributionId = mintDistributionId();
const variableId = mintVariableId();
const seriesId = mintSeriesId();

const makeSyntheticSeed = (): DataLayerRegistrySeed => {
  const agent = decodeAgent({
    _tag: "Agent",
    id: agentId,
    kind: "organization",
    name: "U.S. Energy Information Administration",
    alternateNames: ["EIA", "Energy Information Administration"],
    homepage: "https://www.eia.gov/",
    aliases: [
      {
        scheme: "url",
        value: "https://www.eia.gov/",
        relation: "exactMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const variable = decodeVariable({
    _tag: "Variable",
    id: variableId,
    label: "Wind electricity generation",
    definition: "Electrical energy produced by wind turbines",
    measuredProperty: "generation",
    domainObject: "electricity",
    technologyOrFuel: "wind",
    statisticType: "flow",
    aggregation: "sum",
    unitFamily: "energy",
    aliases: [
      {
        scheme: "display-alias",
        value: "Wind output",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const dataset = decodeDataset({
    _tag: "Dataset",
    id: datasetId,
    title: "EIA U.S. Electric System Operating Data",
    description:
      "Hourly electric system operating data including demand and generation by source.",
    publisherAgentId: agentId,
    landingPage: "https://www.eia.gov/electricity/gridmonitor/",
    keywords: ["electricity", "grid", "hourly"],
    themes: ["electricity", "grid operations"],
    variableIds: [variableId],
    distributionIds: [distributionId],
    aliases: [
      {
        scheme: "display-alias",
        value: "EIA Hourly Electric Grid Monitor",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const distribution = decodeDistribution({
    _tag: "Distribution",
    id: distributionId,
    datasetId,
    kind: "api-access",
    title: "EIA Grid Monitor API",
    description: "API access to hourly generation and demand values.",
    accessURL: "https://api.eia.gov/v2/electricity/rto/",
    downloadURL: "https://api.eia.gov/bulk/EBA.zip",
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const series = decodeSeries({
    _tag: "Series",
    id: seriesId,
    label: "ERCOT wind generation (hourly)",
    variableId,
    datasetId,
    fixedDims: {
      place: "US-TX",
      market: "ERCOT",
      frequency: "hourly"
    },
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  return {
    agents: [agent],
    catalogs: [],
    catalogRecords: [],
    datasets: [dataset],
    distributions: [distribution],
    dataServices: [],
    datasetSeries: [],
    variables: [variable],
    series: [series]
  };
};

const makePreparedRegistry = () => {
  const prepared = prepareDataLayerRegistry(makeSyntheticSeed());
  expect(Result.isSuccess(prepared)).toBe(true);
  if (Result.isFailure(prepared)) {
    throw new Error("expected prepared registry");
  }
  return prepared.success;
};

const makeServiceLayer = (
  semanticHits?: ReadonlyArray<EntitySearchSemanticRecallHit>
) => {
  const sqliteLayer = makeSqliteLayer();
  const searchSqlLayer = entitySearchSqlLayer(sqliteLayer);
  const prepared = makePreparedRegistry();
  const repoLayer = EntitySearchRepoD1.layer.pipe(
    Layer.provideMerge(searchSqlLayer)
  );
  const semanticRecallLayer = Layer.succeed(EntitySemanticRecall, {
    recall: () => Effect.succeed(semanticHits ?? [])
  });
  const serviceLayer = EntitySearchService.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        DataLayerRegistry.layerFromPrepared(prepared),
        repoLayer,
        semanticRecallLayer
      )
    )
  );

  return Layer.mergeAll(
    sqliteLayer,
    searchSqlLayer,
    DataLayerRegistry.layerFromPrepared(prepared),
    repoLayer,
    semanticRecallLayer,
    serviceLayer
  );
};

const seedSearchDocs = Effect.gen(function* () {
  yield* runEntitySearchMigrations;
  const repo = yield* EntitySearchRepo;
  const docs = projectEntitySearchDocs(makePreparedRegistry());
  yield* repo.replaceAllDocuments(docs);
});

describe("EntitySearchService", () => {
  it.effect("dispatches the generic and typed search methods through the repo", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;
      const service = yield* EntitySearchService;

      const allTypes = yield* service.search({
        query: "ERCOT wind generation",
        entityTypes: ["Series"],
        limit: 3
      });
      const agents = yield* service.searchAgents({
        query: "Energy Information Administration",
        limit: 3
      });
      const datasets = yield* service.searchDatasets({
        query: "Hourly Electric Grid Monitor",
        limit: 3
      });
      const distributions = yield* service.searchDistributions({
        exactHostnames: ["https://api.eia.gov/v2/electricity/rto/"],
        limit: 3
      });
      const series = yield* service.searchSeries({
        query: "ERCOT wind generation",
        limit: 3
      });

      expect(allTypes[0]?.document.entityId).toBe(seriesId);
      expect(agents[0]?.document.entityId).toBe(agentId);
      expect(datasets[0]?.document.entityId).toBe(datasetId);
      expect(distributions[0]?.document.entityId).toBe(distributionId);
      expect(series[0]?.document.entityId).toBe(seriesId);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("retrieves series through inherited parent URL and hostname surfaces", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;
      const service = yield* EntitySearchService;

      const byExactUrl = yield* service.searchSeries({
        exactCanonicalUrls: ["https://api.eia.gov/v2/electricity/rto/"],
        limit: 3
      });
      const byExactHostname = yield* service.searchSeries({
        exactHostnames: ["https://api.eia.gov/v2/electricity/rto/"],
        limit: 3
      });

      expect(byExactUrl[0]?.document.entityId).toBe(seriesId);
      expect(byExactUrl[0]?.matchKind).toBe("exact-url");
      expect(byExactHostname[0]?.document.entityId).toBe(seriesId);
      expect(byExactHostname[0]?.matchKind).toBe("exact-hostname");
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("serves canonical search_entities exact probes and fail-closed warnings", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;
      const service = yield* EntitySearchService;

      const exactIri = yield* service.searchEntities({
        probes: {
          iris: [datasetId]
        },
        entityTypes: ["Dataset", "Catalog"],
        limit: 3
      });
      expect(exactIri.hits[0]?.iri).toBe(datasetId);
      expect(exactIri.hits[0]?.matchReason).toBe("exact-iri");
      expect(exactIri.warnings).toEqual([
        {
          entityType: "Catalog",
          reason: "not-yet-enabled"
        }
      ]);

      const exactAlias = yield* service.searchEntities({
        probes: {
          aliases: [
            {
              scheme: "display-alias",
              value: "Wind output"
            }
          ]
        },
        entityTypes: ["Variable"],
        limit: 3
      });
      expect(exactAlias.hits[0]?.iri).toBe(variableId);
      expect(exactAlias.hits[0]?.matchReason).toBe("exact-alias");
      expect(exactAlias.hits[0]?.evidence[0]?.kind).toBe("alias");

      const deferredOnly = yield* service.searchEntities({
        query: "catalog",
        entityTypes: ["Catalog"],
        limit: 3
      });
      expect(deferredOnly.hits).toEqual([]);
      expect(deferredOnly.warnings).toEqual([
        {
          entityType: "Catalog",
          reason: "not-yet-enabled"
        }
      ]);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("merges lexical and semantic candidates into a hybrid result list", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;
      const service = yield* EntitySearchService;

      const result = yield* service.searchVariables({
        query: "wind electricity generation",
        limit: 3
      });

      expect(result[0]?.document.entityId).toBe(variableId);
      expect(result[0]?.matchKind).toBe("hybrid");
    }).pipe(
      Effect.provide(
        makeServiceLayer([
          {
            entityId: variableId,
            entityType: "Variable",
            score: 0.95
          }
        ])
      )
    )
  );
});
