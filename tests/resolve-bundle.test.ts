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
import type {
  EnrichedBundle
} from "../src/domain/enrichedBundle";
import { ProviderId } from "../src/domain/source";
import type { EntitySearchSemanticRecallHit } from "../src/domain/entitySearch";
import type { Stage1Input } from "../src/domain/stage1Resolution";
import { PostUri } from "../src/domain/types";
import { prepareDataLayerRegistry } from "../src/resolution/dataLayerRegistry";
import { resolveBundle } from "../src/resolution/bundle/resolveBundle";
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

const eiaAgentId = mintAgentId();
const eiaDatasetId = mintDatasetId();
const eiaDistributionId = mintDistributionId();
const eiaVariableId = mintVariableId();
const eiaSeriesId = mintSeriesId();
const otherAgentId = mintAgentId();
const otherDatasetId = mintDatasetId();
const otherDistributionId = mintDistributionId();

const makeSyntheticSeed = (): DataLayerRegistrySeed => {
  const eiaAgent = decodeAgent({
    _tag: "Agent",
    id: eiaAgentId,
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

  const otherAgent = decodeAgent({
    _tag: "Agent",
    id: otherAgentId,
    kind: "organization",
    name: "Canada Energy Dashboard",
    alternateNames: ["CED"],
    homepage: "https://energy.canada.example/",
    aliases: [
      {
        scheme: "url",
        value: "https://energy.canada.example/",
        relation: "exactMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const variable = decodeVariable({
    _tag: "Variable",
    id: eiaVariableId,
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

  const eiaDataset = decodeDataset({
    _tag: "Dataset",
    id: eiaDatasetId,
    title: "U.S. Hourly Electric Grid Monitor",
    description:
      "Hourly electric system operating data including demand and generation by source.",
    publisherAgentId: eiaAgentId,
    landingPage: "https://www.eia.gov/electricity/gridmonitor/",
    keywords: ["electricity", "grid", "hourly"],
    themes: ["electricity", "grid operations"],
    variableIds: [eiaVariableId],
    distributionIds: [eiaDistributionId],
    aliases: [
      {
        scheme: "display-alias",
        value: "Canada Grid Monitor",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const otherDataset = decodeDataset({
    _tag: "Dataset",
    id: otherDatasetId,
    title: "Canada Hourly Electric Grid Monitor",
    description: "Hourly grid monitor for Canada",
    publisherAgentId: otherAgentId,
    landingPage: "https://energy.canada.example/gridmonitor/",
    keywords: ["electricity", "grid", "hourly"],
    themes: ["electricity", "grid operations"],
    variableIds: [],
    distributionIds: [otherDistributionId],
    aliases: [
      {
        scheme: "display-alias",
        value: "Hourly Electric Grid Monitor",
        relation: "closeMatch"
      }
    ],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const eiaDistribution = decodeDistribution({
    _tag: "Distribution",
    id: eiaDistributionId,
    datasetId: eiaDatasetId,
    kind: "api-access",
    title: "EIA Grid Monitor API",
    description: "API access to hourly generation and demand values.",
    accessURL: "https://api.eia.gov/v2/electricity/rto/",
    downloadURL: "https://api.eia.gov/bulk/EBA.zip",
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const otherDistribution = decodeDistribution({
    _tag: "Distribution",
    id: otherDistributionId,
    datasetId: otherDatasetId,
    kind: "api-access",
    title: "Canada Grid Monitor API",
    description: "API access to hourly Canadian generation and demand values.",
    accessURL: "https://api.energy.canada.example/gridmonitor/",
    aliases: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  });

  const series = decodeSeries({
    _tag: "Series",
    id: eiaSeriesId,
    label: "ERCOT wind generation (hourly)",
    variableId: eiaVariableId,
    datasetId: eiaDatasetId,
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
    agents: [eiaAgent, otherAgent],
    catalogs: [],
    catalogRecords: [],
    datasets: [eiaDataset, otherDataset],
    distributions: [eiaDistribution, otherDistribution],
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
        title: "U.S. Hourly Electric Grid Monitor",
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
      title: "U.S. Hourly Electric Grid Monitor",
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
          assetKeys: ["asset-1" as any]
        }
      ]
    },
    assets: [
      {
        assetKey: "asset-1" as any,
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
              datasetName: "Hourly Electric Grid Monitor"
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
          title: "Hourly Electric Grid Monitor",
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

const makeBundle = (
  transform?: (input: Stage1Input) => Stage1Input
): EnrichedBundle => {
  const input = transform?.(makeStage1Input()) ?? makeStage1Input();
  const asset = input.vision?.assets[0];
  if (asset === undefined) {
    throw new Error("expected first vision asset");
  }

  return {
    asset,
    sourceAttribution: input.sourceAttribution,
    postContext: input.postContext
  };
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

describe("resolveBundle", () => {
  it.effect("resolves agent and dataset hits while preserving exact URL/domain trails", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;

      const result = yield* resolveBundle(makeBundle(), { limit: 3 as any });

      expect(result.agents[0]?.entityId).toBe(eiaAgentId);
      expect(result.agents[0]?.matchKind).toBe("exact-hostname");
      expect(result.datasets[0]?.entityId).toBe(eiaDatasetId);
      expect(result.datasets[0]?.matchKind).toBe("exact-url");
      expect(result.series).toEqual([]);
      expect(result.variables).toEqual([]);

      const agentProviderTrail = result.trail.find(
        (entry) =>
          entry.rung === "Agent" &&
          entry.signal.kind === "source-attribution-provider-label"
      );
      const datasetUrlTrail = result.trail.find(
        (entry) =>
          entry.rung === "Dataset" && entry.signal.kind === "link-card-url"
      );
      const datasetNameTrail = result.trail.find(
        (entry) =>
          entry.rung === "Dataset" &&
          entry.signal.kind === "source-line-dataset-name" &&
          entry.scoped
      );

      expect(agentProviderTrail?.hits[0]?.entityId).toBe(eiaAgentId);
      expect(datasetUrlTrail?.hits[0]?.entityId).toBe(eiaDatasetId);
      expect(datasetUrlTrail?.lane).toBe("exact-url");
      expect(datasetNameTrail?.scopeAgentIds).toEqual([eiaAgentId]);
      expect(datasetNameTrail?.hits[0]?.entityId).toBe(eiaDatasetId);
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("scopes dataset text search to earlier resolved agents", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;

      const result = yield* resolveBundle(
        makeBundle((input) => ({
          ...input,
          postContext: {
            ...input.postContext,
            links: [],
            linkCards: []
          },
          sourceAttribution: input.sourceAttribution === null
            ? null
            : {
                ...input.sourceAttribution,
                contentSource: null
              },
          vision: input.vision === null
            ? null
            : {
                ...input.vision,
                assets: input.vision.assets.map((asset) => ({
                  ...asset,
                  analysis: {
                    ...asset.analysis,
                    visibleUrls: []
                  }
                }))
              }
        })),
        { limit: 3 as any }
      );

      const datasetNameTrail = result.trail.find(
        (entry) =>
          entry.rung === "Dataset" &&
          entry.signal.kind === "source-line-dataset-name" &&
          entry.scoped
      );

      expect(result.datasets[0]?.entityId).toBe(eiaDatasetId);
      expect(result.datasets[0]?.scoped).toBe(true);
      expect(datasetNameTrail?.scopeAgentIds).toEqual([eiaAgentId]);
      expect(datasetNameTrail?.hits.some((hit) => hit.entityId === eiaDatasetId)).toBe(
        true
      );
    }).pipe(Effect.provide(makeServiceLayer()))
  );

  it.effect("leaves deferred series and variable buckets empty in the provenance-first slice", () =>
    Effect.gen(function* () {
      yield* seedSearchDocs;

      const result = yield* resolveBundle(makeBundle(), { limit: 3 as any });

      expect(result.series).toEqual([]);
      expect(result.variables).toEqual([]);
      expect(result.trail.some((entry) => entry.rung === "Series")).toBe(false);
      expect(result.trail.some((entry) => entry.rung === "Variable")).toBe(false);
    }).pipe(Effect.provide(makeServiceLayer()))
  );
});
