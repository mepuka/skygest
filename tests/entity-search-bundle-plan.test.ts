import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
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
  Stage1Input,
  Stage1Result
} from "../src/domain/stage1Resolution";
import { PostUri } from "../src/domain/types";
import {
  prepareDataLayerRegistry,
  toDataLayerRegistryLookup
} from "../src/resolution/dataLayerRegistry";
import { buildEntitySearchBundlePlan } from "../src/search/buildEntitySearchBundlePlan";
import {
  collectNormalizedSearchHostnames,
  collectNormalizedSearchUrls,
  collectUniqueSearchText
} from "../src/search/searchSignals";

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

const makeSyntheticSeed = (): DataLayerRegistrySeed => ({
  agents: [
    decodeAgent({
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
    })
  ],
  catalogs: [],
  catalogRecords: [],
  datasets: [
    decodeDataset({
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
    })
  ],
  distributions: [
    decodeDistribution({
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
    })
  ],
  dataServices: [],
  datasetSeries: [],
  variables: [
    decodeVariable({
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
    })
  ],
  series: [
    decodeSeries({
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
    })
  ]
});

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
    },
    {
      _tag: "DatasetMatch",
      datasetId,
      title: "EIA U.S. Electric System Operating Data",
      bestRank: 1,
      evidence: []
    },
    {
      _tag: "DistributionMatch",
      distributionId,
      title: "EIA Grid Monitor API",
      bestRank: 1,
      evidence: []
    },
    {
      _tag: "VariableMatch",
      variableId,
      label: "Wind electricity generation",
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
    },
    {
      _tag: "UnmatchedUrlResidual",
      source: "visible-url",
      url: "https://api.eia.gov/v2/electricity/rto/",
      normalizedUrl: "api.eia.gov/v2/electricity/rto",
      hostname: "api.eia.gov"
    },
    {
      _tag: "UnmatchedTextResidual",
      source: "axis-label",
      text: "Wind generation",
      normalizedText: "wind generation",
      assetKey: "asset-1"
    }
  ]
});

describe("entity search bundle plan", () => {
  it("deduplicates nested text and normalizes exact URL signals", () => {
    expect(
      collectUniqueSearchText(
        " EIA ",
        ["eia", "Grid Monitor"],
        { label: "grid monitor", extra: "ERCOT" }
      )
    ).toEqual(["EIA", "Grid Monitor", "ERCOT"]);

    expect(
      collectNormalizedSearchUrls(
        "https://www.eia.gov/electricity/gridmonitor/",
        "eia.gov/electricity/gridmonitor"
      )
    ).toEqual(["eia.gov/electricity/gridmonitor"]);

    expect(
      collectNormalizedSearchHostnames(
        "https://api.eia.gov/v2/electricity/rto/",
        "api.eia.gov"
      )
    ).toEqual(["api.eia.gov"]);
  });

  it("builds a typed plan from stage-one matches and bundle evidence", () => {
    const prepared = makePreparedRegistry();
    const plan = buildEntitySearchBundlePlan(
      makeStage1Input(),
      toDataLayerRegistryLookup(prepared),
      makeStage1Result()
    );

    expect(plan.publisherAgentId).toBe(agentId);
    expect(plan.datasetId).toBe(datasetId);
    expect(plan.variableId).toBe(variableId);
    expect(plan.exactCanonicalUrls).toEqual([
      "eia.gov/electricity/gridmonitor",
      "api.eia.gov/v2/electricity/rto"
    ]);
    expect(plan.exactHostnames).toEqual(["eia.gov", "api.eia.gov"]);
    expect(plan.agentText).toContain("EIA");
    expect(plan.datasetText).toContain("Source: EIA");
    expect(plan.datasetText).toContain("EIA Hourly Electric Grid Monitor");
    expect(plan.distributionText).toContain("api.eia.gov");
    expect(plan.seriesText).toContain("ERCOT wind generation");
    expect(plan.variableText).toContain("Wind generation");
  });
});
