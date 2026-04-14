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
import { ProviderId } from "../src/domain/source";
import type {
  EntitySearchSemanticRecallHit
} from "../src/domain/entitySearch";
import type {
  Stage1Input,
  Stage1Result
} from "../src/domain/stage1Resolution";
import { PostUri } from "../src/domain/types";
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
const decodePostUri = Schema.decodeUnknownSync(PostUri);
const decodeProviderId = Schema.decodeUnknownSync(ProviderId);

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

const makeStage1Input = (): Stage1Input => ({
  postContext: {
    postUri: decodePostUri("at://did:plc:test/app.bsky.feed.post/post-1"),
    text: "EIA chart showing ERCOT wind generation",
    links: [
      {
        url: "https://www.eia.gov/electricity/gridmonitor/",
        title: "EIA Hourly Electric Grid Monitor",
        description: "Hourly electric system operating data",
        imageUrl: null,
        domain: "www.eia.gov",
        extractedAt: 1
      }
    ],
    linkCards: [
      {
        source: "embed",
        uri: "https://api.eia.gov/v2/electricity/rto/",
        title: "EIA Grid Monitor API",
        description: "API access to hourly generation and demand values.",
        thumb: null
      }
    ],
    threadCoverage: "focus-only"
  },
  sourceAttribution: {
    kind: "source-attribution",
    provider: {
      providerId: decodeProviderId("eia"),
      providerLabel: "EIA",
      sourceFamily: null
    },
    resolution: "matched",
    providerCandidates: [],
    contentSource: {
      url: "https://www.eia.gov/electricity/gridmonitor/",
      title: "EIA Hourly Electric Grid Monitor",
      domain: "www.eia.gov",
      publication: "EIA"
    },
    socialProvenance: null,
    processedAt: 1
  },
  vision: {
    kind: "vision",
    summary: {
      text: "Wind generation in ERCOT",
      mediaTypes: ["chart"],
      chartTypes: ["line-chart"],
      titles: ["ERCOT wind generation (hourly)"],
      keyFindings: [
        {
          text: "ERCOT wind output rises",
          assetKeys: ["asset-1"]
        }
      ]
    },
    assets: [
      {
        assetKey: "asset-1",
        assetType: "image",
        source: "embed",
        index: 0,
        originalAltText: null,
        extractionRoute: "full",
        analysis: {
          mediaType: "chart",
          chartTypes: ["line-chart"],
          altText: null,
          altTextProvenance: "absent",
          xAxis: {
            label: "Hour",
            unit: null
          },
          yAxis: {
            label: "Wind generation",
            unit: "MWh"
          },
          series: [
            {
              legendLabel: "ERCOT wind generation",
              unit: "MWh"
            }
          ],
          sourceLines: [
            {
              sourceText: "Source: EIA",
              datasetName: "EIA Hourly Electric Grid Monitor"
            }
          ],
          temporalCoverage: null,
          keyFindings: ["ERCOT wind output"],
          visibleUrls: ["https://api.eia.gov/v2/electricity/rto/"],
          organizationMentions: [
            {
              name: "EIA",
              location: "body"
            }
          ],
          logoText: ["EIA"],
          title: "ERCOT wind generation (hourly)",
          modelId: "test",
          processedAt: 1
        }
      }
    ],
    modelId: "test",
    promptVersion: "v1",
    processedAt: 1
  }
});

const makeStage1Result = (): Stage1Result => ({
  matches: [
    {
      _tag: "AgentMatch",
      agentId,
      name: "U.S. Energy Information Administration",
      bestRank: 1,
      evidence: []
    }
  ],
  residuals: [
    {
      _tag: "UnmatchedDatasetTitleResidual",
      datasetName: "EIA Hourly Electric Grid Monitor",
      normalizedTitle: "eia hourly electric grid monitor",
      assetKey: "asset-1"
    }
  ]
});

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
  it.effect("builds typed bundle candidates from Stage 1 evidence", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;
      const service = yield* EntitySearchService;

      const result = yield* service.searchBundleCandidates({
        stage1Input: makeStage1Input(),
        stage1: makeStage1Result(),
        limit: 3
      });

      expect(result.plan.publisherAgentId).toBe(agentId);
      expect(result.plan.exactCanonicalUrls).toContain(
        "eia.gov/electricity/gridmonitor"
      );
      expect(result.plan.exactHostnames).toContain("api.eia.gov");
      expect(result.datasets[0]?.document.entityId).toBe(datasetId);
      expect(result.distributions[0]?.document.entityId).toBe(distributionId);
      expect(result.series[0]?.document.entityId).toBe(seriesId);
      expect(result.variables[0]?.document.entityId).toBe(variableId);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

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
